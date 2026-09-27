import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import {
  apiErrorMessage,
  cleanUtr,
  counterErrorCode,
  handleShiftRequired,
  isValidUtr,
  promptOpenShift,
} from '../../lib/counterErrors';
import { isSameDay, rangeLengthLabel, startOfDay, timeLabel, timeOf, timeSlotsFor, withTime } from '../../lib/dates';
import UtrInput from '../../components/employee/UtrInput';
import TimeFieldPicker from '../../components/ui/TimeFieldPicker';

// Opened from the pickup screen (CONFIRMED booking) and the drop screen
// (PICKED_UP — car already out). Same steps as the web Extend Booking modal:
// 1 pick the new return · 2 choose how to resolve availability · 3 collect.
// Commit always sends collectNow, so the charge is taken right here.
type Phase = 'select' | 'resolve' | 'collect' | 'done';
type Method = 'CASH' | 'UPI';
type Resolution = 'SAME_VEHICLE' | 'SWAP_CURRENT_TO_OTHER' | 'SWAP_FUTURE_BOOKING' | 'PARTIAL_EXTENSION' | 'NO_RESOLUTION';

interface AltVehicle {
  publicId: string;
  make: string;
  model: string;
  regNo: string;
}

interface ResolutionOption {
  type: Resolution;
  label?: string;
  description?: string;
  availableVehicles?: AltVehicle[];
  affectedBookings?: { bookingPublicId: string; newVehicle: AltVehicle }[];
  partialNewEndAt?: string;
}

// POST /api/employee/extensions/evaluate → data. Money is decimal strings.
interface Evaluation {
  extensionPublicId: string;
  oldEndAt: string;
  requestedEndAt: string;
  pricing: { additionalAmount: string; newTotalFinal: string };
  resolutionOptions: ResolutionOption[];
  recommendedResolution: Resolution;
}

const RESOLUTION_LABEL: Record<Resolution, string> = {
  SAME_VEHICLE: 'Same vehicle (no conflict)',
  SWAP_CURRENT_TO_OTHER: 'Swap to an available equivalent vehicle',
  SWAP_FUTURE_BOOKING: "Reassign the conflicting booking's vehicle",
  PARTIAL_EXTENSION: 'Partial extension (until last available time)',
  NO_RESOLUTION: 'No extension available',
};

const inr = (v: number | string) => `₹${(Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const DAY_MS = 86_400_000;
const PRESETS = [1, 2, 3, 7]; // extra days, same return time
const DAY_COUNT = 30; // return dates offered in the strip

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, accent && styles.valueAccent]}>{value}</Text>
    </View>
  );
}

export default function ExtensionScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { bookingId, endAt, make, model } = useLocalSearchParams<{
    bookingId: string; endAt: string; make?: string; model?: string;
  }>();

  // The booking's current return. Refreshed after cancelling a pending
  // extension, whose commit had already moved it.
  const [currentEnd, setCurrentEnd] = useState<string | null>(endAt ?? null);
  const baseEnd = currentEnd ? new Date(currentEnd) : null;

  const [phase, setPhase] = useState<Phase>('select');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — new return date + time (default: one more day, same time) and notes
  const [newEnd, setNewEnd] = useState<Date | null>(() => (endAt ? new Date(new Date(endAt).getTime() + DAY_MS) : null));
  const [timeOpen, setTimeOpen] = useState(false);
  const [notes, setNotes] = useState('');

  // Step 2 — evaluation (the extension is PENDING_PAYMENT server-side from here on)
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [swapVehicleId, setSwapVehicleId] = useState('');

  // Step 3 — committed: the vehicle is held until this is paid or cancelled
  const [amountDue, setAmountDue] = useState(0);
  const [heldUntil, setHeldUntil] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>('CASH');
  const [utr, setUtr] = useState('');
  const [utrError, setUtrError] = useState<string | undefined>();
  const [doneMsg, setDoneMsg] = useState('');

  const extensionPublicId = evaluation?.extensionPublicId ?? null;

  // An evaluated/committed extension blocks any new one until it is paid or
  // cancelled, so leaving mid-way offers to cancel it instead of stranding it.
  const unpaid = !!extensionPublicId && phase !== 'done';
  usePreventRemove(unpaid, ({ data }) => {
    Alert.alert(
      'Cancel this extension?',
      `It hasn't been paid yet. Cancelling keeps the current return time${currentEnd ? ` (${fmt(currentEnd)})` : ''}.`,
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Cancel extension',
          style: 'destructive',
          onPress: async () => {
            try {
              await employeeApi.cancelExtension(extensionPublicId!, 'Cancelled at the counter before payment');
              navigation.dispatch(data.action);
            } catch (err: any) {
              Alert.alert('Could not cancel', apiErrorMessage(err, 'Please try again.'));
            }
          },
        },
      ],
    );
  });

  // Return dates: from the current return's day (or today, for a rental
  // that's already overdue), skipping a first day with no later times left.
  const days = useMemo(() => {
    if (!currentEnd) return [];
    const end = new Date(currentEnd);
    const from = startOfDay(end.getTime() > Date.now() ? end : new Date());
    const out: Date[] = [];
    for (let i = 0; i < DAY_COUNT; i++) {
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
      if (i === 0 && timeSlotsFor(d, { after: end }).length === 0) continue;
      out.push(d);
    }
    return out;
  }, [currentEnd]);

  const pickDay = (day: Date) => {
    if (!newEnd || !baseEnd) return;
    let next = withTime(day, timeOf(newEnd));
    const earliest = Math.max(baseEnd.getTime(), Date.now());
    if (next.getTime() <= earliest) {
      const first = timeSlotsFor(day, { after: baseEnd })[0];
      if (!first) return;
      next = withTime(day, first.value);
    }
    setNewEnd(next);
    setError(null);
  };

  const evaluate = async (baseIso: string | null = currentEnd, requested: Date | null = newEnd) => {
    if (!bookingId || !baseIso || !requested) return;
    if (requested.getTime() <= new Date(baseIso).getTime()) {
      setError('The new return must be after the current return time.');
      return;
    }
    if (requested.getTime() <= Date.now()) {
      setError('Pick a return time in the future.');
      return;
    }
    setBusy(true); setError(null);
    try {
      // Collecting needs an open cash shift. Check before evaluate creates the
      // pending extension, so staff aren't left holding one they can't collect.
      try {
        const shift = await employeeApi.getActiveShift();
        if (!shift.data?.data) {
          promptOpenShift();
          return;
        }
      } catch { /* can't tell — the server still enforces it at commit/collect */ }

      const res = await employeeApi.evaluateExtension({
        bookingPublicId: bookingId,
        newEndAt: requested.toISOString(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      const ev = res.data?.data as Evaluation;
      setEvaluation(ev);
      // Pre-select what the server recommends, like the web.
      const recommended = ev.recommendedResolution;
      setResolution(recommended && recommended !== 'NO_RESOLUTION' ? recommended : null);
      const swap = ev.resolutionOptions.find((o) => o.type === 'SWAP_CURRENT_TO_OTHER');
      setSwapVehicleId(recommended === 'SWAP_CURRENT_TO_OTHER' ? swap?.availableVehicles?.[0]?.publicId ?? '' : '');
      setPhase('resolve');
    } catch (err: any) {
      const message = apiErrorMessage(err, 'Could not evaluate the extension.');
      setError(message);
      // An earlier extension was committed but never paid and blocks new ones.
      // Cash already collected (PAYMENT_COLLECTED) is for a manager to confirm
      // or reject — only an unpaid one may be cancelled here.
      const pending = err?.response?.data;
      const pendingId: string | undefined = pending?.pendingExtensionPublicId;
      if (
        pending?.code === 'EXTENSION_PENDING' &&
        pending?.pendingExtensionStatus === 'PENDING_PAYMENT' &&
        pendingId
      ) {
        Alert.alert('Unpaid extension pending', message, [
          { text: 'Keep it', style: 'cancel' },
          {
            text: 'Cancel the pending extension',
            style: 'destructive',
            onPress: async () => {
              setBusy(true); setError(null);
              try {
                await employeeApi.cancelExtension(pendingId, 'Unpaid extension replaced at the counter');
              } catch (cancelErr: any) {
                setError(apiErrorMessage(cancelErr, 'Could not cancel the pending extension.'));
                setBusy(false);
                return;
              }
              // Cancelling restored the booking's previous return time; keep
              // the chosen extra length on top of it.
              let base = baseIso;
              try {
                const fresh: string | undefined = (await employeeApi.getPickupDetails(bookingId)).data?.data?.endAt;
                if (fresh) { base = fresh; setCurrentEnd(fresh); }
              } catch { /* keep the known return time */ }
              const shifted = new Date(requested.getTime() + (new Date(base).getTime() - new Date(baseIso).getTime()));
              setNewEnd(shifted);
              await evaluate(base, shifted);
            },
          },
        ]);
      }
    } finally {
      setBusy(false);
    }
  };

  // Back to step 1: the quote is released so a new one can be evaluated.
  const changeTime = async () => {
    if (!extensionPublicId) return;
    setBusy(true); setError(null);
    try {
      await employeeApi.cancelExtension(extensionPublicId, 'Return time changed at the counter');
      setEvaluation(null);
      setResolution(null);
      setSwapVehicleId('');
      setPhase('select');
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Could not change the extension.'));
    } finally {
      setBusy(false);
    }
  };

  // Step 2 → 3: commit the chosen resolution; the vehicle is held from here.
  const commit = async () => {
    if (!evaluation || !resolution || resolution === 'NO_RESOLUTION') return;
    if (resolution === 'SWAP_CURRENT_TO_OTHER' && !swapVehicleId) {
      setError('Select the vehicle to swap to.');
      return;
    }
    const opt = evaluation.resolutionOptions.find((o) => o.type === resolution);
    setBusy(true); setError(null);
    try {
      const res = await employeeApi.commitExtension({
        extensionPublicId: evaluation.extensionPublicId,
        resolutionType: resolution,
        ...(resolution === 'SWAP_CURRENT_TO_OTHER' ? { selectedVehiclePublicId: swapVehicleId } : {}),
        ...(resolution === 'SWAP_FUTURE_BOOKING' && opt?.affectedBookings
          ? {
              affectedBookingSwaps: opt.affectedBookings.map((ab) => ({
                bookingPublicId: ab.bookingPublicId,
                newVehiclePublicId: ab.newVehicle.publicId,
              })),
            }
          : {}),
        ...(resolution === 'PARTIAL_EXTENSION' && opt?.partialNewEndAt ? { partialNewEndAt: opt.partialNewEndAt } : {}),
        idempotencyKey: `ext-${bookingId}-${evaluation.extensionPublicId}`,
        collectNow: true,
      });
      const d = res.data?.data;
      // The committed amount is what's due — a partial extension is repriced.
      setAmountDue(Number(d?.remainAmount?.extension ?? d?.additionalAmount ?? evaluation.pricing.additionalAmount));
      setHeldUntil(resolution === 'PARTIAL_EXTENSION' && opt?.partialNewEndAt ? opt.partialNewEndAt : evaluation.requestedEndAt);
      setPhase('collect');
    } catch (err: any) {
      if (handleShiftRequired(err)) return;
      setError(apiErrorMessage(err, 'Could not confirm the extension.'));
    } finally {
      setBusy(false);
    }
  };

  // Step 3: take the money (Cash, or UPI with its UTR).
  const collect = async () => {
    if (!extensionPublicId) return;
    const upi = amountDue > 0 && method === 'UPI';
    if (upi && !isValidUtr(utr)) {
      setUtrError("Enter the 12-digit UTR from the customer's UPI app.");
      return;
    }
    setBusy(true); setError(null); setUtrError(undefined);
    try {
      const res = await employeeApi.collectExtension(extensionPublicId, {
        method: upi ? 'ONLINE' : 'CASH',
        ...(upi ? { onlineTransactionRef: cleanUtr(utr) } : {}),
      });
      const payment = res.data?.data?.payment;
      setDoneMsg(
        payment === 'confirmed'
          ? upi
            ? 'UPI payment recorded and the extension is confirmed.'
            : 'The extension is confirmed.'
          : amountDue > 0
            ? 'Cash recorded. The extension is final once a manager confirms the cash.'
            : 'The extension awaits manager confirmation.',
      );
      setPhase('done');
    } catch (err: any) {
      if (handleShiftRequired(err)) return;
      const code = counterErrorCode(err);
      if (code === 'INVALID_UTR' || code === 'DUPLICATE_UTR') {
        setUtrError(apiErrorMessage(err, 'Check the UTR number.'));
      } else {
        setError(apiErrorMessage(err, 'Could not collect the extension payment.'));
      }
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'done') {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.successBody}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={64} color="#10b981" />
          </View>
          <Text style={styles.successTitle}>Extension done</Text>
          {heldUntil && (
            <View style={styles.newEndPill}>
              <Ionicons name="calendar-outline" size={14} color={Colors.orange} />
              <Text style={styles.newEndPillText}>New return · {fmt(heldUntil)}</Text>
            </View>
          )}
          <Text style={styles.successSub}>{doneMsg}</Text>
          <TouchableOpacity style={[styles.primaryBtn, styles.successBtn]} onPress={() => router.back()} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const noOption = !!evaluation && evaluation.resolutionOptions.every((o) => o.type === 'NO_RESOLUTION');
  const canCommit =
    !!resolution && resolution !== 'NO_RESOLUTION' && (resolution !== 'SWAP_CURRENT_TO_OTHER' || !!swapVehicleId);
  const pickLength = baseEnd && newEnd ? rangeLengthLabel(baseEnd, newEnd) : null;
  const slots = newEnd && baseEnd ? timeSlotsFor(newEnd, { after: baseEnd }) : [];

  return (
    <KeyboardAvoidingView style={[styles.root, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8} disabled={busy}>
          <Ionicons name="arrow-back" size={22} color={busy ? Colors.ink4 : Colors.ink} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>Extend Booking</Text>
          <Text style={styles.stepText}>Step {phase === 'select' ? 1 : phase === 'resolve' ? 2 : 3} of 3</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {(make || model) && <Text style={styles.vehicle}>{make} {model}</Text>}

        {currentEnd && (
          <View style={styles.card}>
            <Row label="Current return" value={fmt(currentEnd)} />
          </View>
        )}

        {/* ── Step 1: new return date + time ── */}
        {phase === 'select' && baseEnd && newEnd && (
          <>
            <Text style={styles.sectionLabel}>Extend by</Text>
            <View style={styles.presetRow}>
              {PRESETS.map((d) => {
                const active = newEnd.getTime() === baseEnd.getTime() + d * DAY_MS;
                return (
                  <TouchableOpacity
                    key={d}
                    style={[styles.preset, active && styles.presetActive]}
                    onPress={() => { setNewEnd(new Date(baseEnd.getTime() + d * DAY_MS)); setError(null); }}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.presetText, active && styles.presetTextActive]}>+{d}d</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sectionLabel}>New return date</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayScroll} contentContainerStyle={styles.dayRow}>
              {days.map((d) => {
                const active = isSameDay(d, newEnd);
                return (
                  <TouchableOpacity
                    key={d.getTime()}
                    style={[styles.day, active && styles.dayActive]}
                    onPress={() => pickDay(d)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.dayWeek, active && styles.dayTextActive]}>
                      {d.toLocaleDateString('en-IN', { weekday: 'short' })}
                    </Text>
                    <Text style={[styles.dayNum, active && styles.dayTextActive]}>{d.getDate()}</Text>
                    <Text style={[styles.dayMonth, active && styles.dayTextActive]}>
                      {d.toLocaleDateString('en-IN', { month: 'short' })}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.sectionLabel}>New return time</Text>
            <TouchableOpacity style={styles.timeField} onPress={() => setTimeOpen(true)} activeOpacity={0.85}>
              <Ionicons name="time-outline" size={18} color={Colors.ink3} />
              <Text style={styles.timeValue}>{timeLabel(timeOf(newEnd))}</Text>
              <Ionicons name="chevron-down" size={16} color={Colors.ink3} />
            </TouchableOpacity>

            <View style={styles.card}>
              <Row label="New return" value={fmt(newEnd.toISOString())} accent />
              {pickLength ? <Text style={styles.extendNote}>Extending by {pickLength}</Text> : null}
            </View>

            <Text style={styles.sectionLabel}>Notes (optional)</Text>
            <TextInput
              style={styles.notes}
              value={notes}
              onChangeText={setNotes}
              placeholder="e.g. Customer requested extension due to travel plans"
              placeholderTextColor={Colors.ink4}
              multiline
              maxLength={500}
            />
          </>
        )}

        {/* ── Step 2: availability + resolution ── */}
        {phase === 'resolve' && evaluation && (
          <>
            <View style={styles.card}>
              <Row label="Requested return" value={fmt(evaluation.requestedEndAt)} accent />
              {rangeLengthLabel(new Date(evaluation.oldEndAt), new Date(evaluation.requestedEndAt)) ? (
                <Row label="Extra time" value={rangeLengthLabel(new Date(evaluation.oldEndAt), new Date(evaluation.requestedEndAt))!} />
              ) : null}
              <View style={styles.divider} />
              <View style={styles.row}>
                <Text style={styles.label}>Additional due</Text>
                <Text style={styles.amount}>{inr(evaluation.pricing.additionalAmount)}</Text>
              </View>
            </View>

            {noOption ? (
              <View style={styles.errorBox}>
                <Ionicons name="close-circle-outline" size={16} color="#e53e3e" />
                <Text style={styles.errorText}>
                  No extension is possible for this time. Try an earlier return time.
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.sectionLabel}>Resolution</Text>
                {evaluation.resolutionOptions.map((opt) => {
                  const disabled = opt.type === 'NO_RESOLUTION';
                  const selected = resolution === opt.type;
                  return (
                    <View key={opt.type}>
                      <TouchableOpacity
                        style={[styles.option, selected && styles.optionActive, disabled && styles.optionDisabled]}
                        onPress={() => {
                          setResolution(opt.type);
                          setSwapVehicleId(opt.type === 'SWAP_CURRENT_TO_OTHER' ? opt.availableVehicles?.[0]?.publicId ?? '' : '');
                          setError(null);
                        }}
                        disabled={disabled || busy}
                        activeOpacity={0.85}
                      >
                        <Ionicons
                          name={selected ? 'radio-button-on' : 'radio-button-off'}
                          size={18}
                          color={selected ? Colors.orange : Colors.ink4}
                          style={{ marginTop: 1 }}
                        />
                        <View style={styles.optionBody}>
                          <Text style={[styles.optionTitle, selected && styles.optionTitleActive]}>
                            {RESOLUTION_LABEL[opt.type] ?? opt.label ?? opt.type}
                          </Text>
                          {opt.type === 'PARTIAL_EXTENSION' && opt.partialNewEndAt ? (
                            <Text style={styles.optionSub}>
                              Until {fmt(opt.partialNewEndAt)} — the charge is recalculated for this time.
                            </Text>
                          ) : null}
                          {opt.type === 'SWAP_FUTURE_BOOKING'
                            ? opt.affectedBookings?.map((ab) => (
                                <Text key={ab.bookingPublicId} style={styles.optionSub}>
                                  Booking …{ab.bookingPublicId.slice(-8).toUpperCase()} → {ab.newVehicle.make} {ab.newVehicle.model} ({ab.newVehicle.regNo})
                                </Text>
                              ))
                            : null}
                        </View>
                      </TouchableOpacity>

                      {/* Vehicle to swap to */}
                      {selected && opt.type === 'SWAP_CURRENT_TO_OTHER' && opt.availableVehicles?.length ? (
                        <View style={styles.vehicleList}>
                          {opt.availableVehicles.map((v) => {
                            const picked = swapVehicleId === v.publicId;
                            return (
                              <TouchableOpacity
                                key={v.publicId}
                                style={[styles.vehicleRow, picked && styles.vehicleRowActive]}
                                onPress={() => { setSwapVehicleId(v.publicId); setError(null); }}
                                disabled={busy}
                                activeOpacity={0.85}
                              >
                                <Ionicons name="car-outline" size={16} color={picked ? Colors.orange : Colors.ink3} />
                                <Text style={[styles.vehicleText, picked && styles.vehicleTextActive]}>
                                  {v.make} {v.model} — {v.regNo}
                                </Text>
                                {picked && <Ionicons name="checkmark" size={16} color={Colors.orange} />}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </>
            )}

            <TouchableOpacity onPress={changeTime} disabled={busy} hitSlop={8} style={styles.changeLink}>
              <Text style={styles.changeLinkText}>Change return time</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Step 3: collect ── */}
        {phase === 'collect' && (
          <>
            <View style={styles.card}>
              {heldUntil ? <Row label="New return" value={fmt(heldUntil)} accent /> : null}
              <View style={styles.divider} />
              <View style={styles.row}>
                <Text style={styles.label}>Amount due</Text>
                <Text style={styles.amount}>{inr(amountDue)}</Text>
              </View>
              <Text style={styles.holdNote}>The vehicle is on hold until this is collected or the extension is cancelled.</Text>
            </View>

            {amountDue > 0 && (
              <>
                <Text style={styles.sectionLabel}>Collected by</Text>
                <View style={styles.card}>
                  <View style={styles.methodRow}>
                    {(['CASH', 'UPI'] as const).map((m) => (
                      <TouchableOpacity
                        key={m}
                        style={[styles.methodBtn, method === m && styles.methodBtnActive]}
                        onPress={() => { setMethod(m); setError(null); }}
                        disabled={busy}
                        activeOpacity={0.85}
                      >
                        <Ionicons
                          name={m === 'CASH' ? 'wallet-outline' : 'keypad-outline'}
                          size={16}
                          color={method === m ? Colors.white : Colors.ink3}
                        />
                        <Text style={[styles.methodText, method === m && styles.methodTextActive]}>
                          {m === 'CASH' ? 'Cash' : 'UPI (UTR)'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {method === 'UPI' && (
                    <>
                      <Text style={styles.upiHint}>
                        Ask the customer to pay {inr(amountDue)} to the shop's UPI QR, then enter the UTR.
                      </Text>
                      <UtrInput
                        value={utr}
                        onChangeText={(t) => { setUtr(t); setUtrError(undefined); }}
                        error={utrError}
                      />
                    </>
                  )}
                </View>
              </>
            )}
          </>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color="#e53e3e" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        {phase === 'select' && (
          <TouchableOpacity style={[styles.primaryBtn, busy && styles.btnDisabled]} onPress={() => evaluate()} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color={Colors.white} size="small" /> : <Text style={styles.primaryBtnText}>Check availability</Text>}
          </TouchableOpacity>
        )}
        {phase === 'resolve' && !noOption && (
          <TouchableOpacity
            style={[styles.primaryBtn, (busy || !canCommit) && styles.btnDisabled]}
            onPress={commit}
            disabled={busy || !canCommit}
            activeOpacity={0.85}
          >
            {busy ? <ActivityIndicator color={Colors.white} size="small" /> : <Text style={styles.primaryBtnText}>Confirm & collect</Text>}
          </TouchableOpacity>
        )}
        {phase === 'resolve' && noOption && (
          <TouchableOpacity style={[styles.primaryBtn, busy && styles.btnDisabled]} onPress={changeTime} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color={Colors.white} size="small" /> : <Text style={styles.primaryBtnText}>Change return time</Text>}
          </TouchableOpacity>
        )}
        {phase === 'collect' && (
          <TouchableOpacity style={[styles.primaryBtn, busy && styles.btnDisabled]} onPress={collect} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color={Colors.white} size="small" /> : (
              <Text style={styles.primaryBtnText}>
                {amountDue > 0 ? `Collect ${inr(amountDue)}${method === 'UPI' ? ' via UPI' : ' cash'}` : 'Confirm extension'}
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {newEnd && (
        <TimeFieldPicker
          visible={timeOpen}
          value={timeOf(newEnd)}
          slots={slots}
          title="New return time"
          onSelect={(v) => { setNewEnd(withTime(newEnd, v)); setError(null); }}
          onClose={() => setTimeOpen(false)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, gap: 12 },
  back: { width: 36, height: 36, justifyContent: 'center' },
  headerText: { gap: 2 },
  title: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  stepText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  content: { paddingHorizontal: 20, gap: 12, paddingBottom: 40 },
  vehicle: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  card: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.hairline, padding: 16, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  value: { flexShrink: 1, textAlign: 'right', fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  valueAccent: { fontSize: 15, color: Colors.orange },
  extendNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, textAlign: 'right' },
  holdNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17 },
  amount: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink, letterSpacing: -0.4 },
  changeLink: { alignSelf: 'center', paddingVertical: 6 },
  changeLinkText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange },
  divider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 4 },
  sectionLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3, textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 },

  presetRow: { flexDirection: 'row', gap: 8 },
  preset: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.hairline },
  presetActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  presetText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink2 },
  presetTextActive: { color: Colors.white },

  dayScroll: { marginHorizontal: -20 },
  dayRow: { paddingHorizontal: 20, gap: 8 },
  day: {
    width: 58, paddingVertical: 10, borderRadius: 14, alignItems: 'center', gap: 2,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.hairline,
  },
  dayActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  dayWeek: { fontFamily: Fonts.bodyMedium, fontSize: 11, color: Colors.ink3 },
  dayNum: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink },
  dayMonth: { fontFamily: Fonts.bodyMedium, fontSize: 11, color: Colors.ink3 },
  dayTextActive: { color: Colors.white },

  timeField: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.hairline,
    paddingHorizontal: 14, paddingVertical: 14,
  },
  timeValue: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },

  notes: {
    backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.hairline,
    paddingHorizontal: 14, paddingVertical: 12, minHeight: 72, textAlignVertical: 'top',
    fontFamily: Fonts.body, fontSize: 14, color: Colors.ink,
  },

  option: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.hairline, padding: 14,
  },
  optionActive: { borderColor: Colors.orange, backgroundColor: '#fff7f2' },
  optionDisabled: { opacity: 0.5 },
  optionBody: { flex: 1, gap: 3 },
  optionTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink2 },
  optionTitleActive: { color: Colors.ink },
  optionSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17 },

  vehicleList: { marginTop: 6, marginLeft: 28, gap: 6 },
  vehicleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.hairline,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  vehicleRowActive: { borderColor: Colors.orange },
  vehicleText: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  vehicleTextActive: { color: Colors.ink },

  methodRow: { flexDirection: 'row', gap: 8 },
  methodBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: 12, backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline,
  },
  methodBtnActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  methodText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink3 },
  methodTextActive: { color: Colors.white },
  upiHint: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, lineHeight: 19, marginTop: 4 },

  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#e53e3e10', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e53e3e30' },
  errorText: { fontFamily: Fonts.body, fontSize: 13, color: '#e53e3e', flex: 1 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.hairline, backgroundColor: Colors.bg },
  primaryBtn: { backgroundColor: Colors.orange, borderRadius: 16, paddingVertical: 17, alignItems: 'center' },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },
  successBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  successIcon: { width: 100, height: 100, borderRadius: 30, backgroundColor: '#10b98115', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  successTitle: { fontFamily: Fonts.displayBold, fontSize: 28, color: Colors.ink, letterSpacing: -0.8 },
  successSub: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink3, textAlign: 'center', lineHeight: 22 },
  successBtn: { alignSelf: 'stretch' },
  newEndPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.orangeSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
  },
  newEndPillText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
});

import { useEffect, useMemo, useState } from 'react';
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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import { dlInUseErrorText } from '../../lib/dlInUse';
import {
  apiErrorMessage,
  handleShiftRequired,
  promptOpenShift,
} from '../../lib/counterErrors';
import type { CounterPaymentChoice } from '../../lib/counterPayment';
import { isSameDay, rangeLengthLabel, startOfDay, timeLabel, timeOf, timeSlotsFor, withTime } from '../../lib/dates';
import {
  extensionGstSplit,
  formatExtensionHours,
  gstLabel,
  gstSplitText,
  inrExact,
  type ExtensionGstFields,
  type ExtensionGstSplit,
} from '../../lib/gst';
import { MAX_BOOKING_DAYS, MONTHLY_MAX_DAYS } from '../../lib/bookingWindow';
import {
  buildScheduleErrorMessage,
  closedDayText,
  fitReturnTime,
  hasOfficeHours,
  isClosedDay,
  isReturnTimeAllowed,
  rangeHoursLine,
  slotsWithinHours,
  toScheduleConfig,
  validateReturnTime,
} from '../../lib/branchSchedule';
import { useBranchSchedule } from '../../hooks/useBranchSchedule';
import { useAuthStore } from '../../store/auth';
import { BranchHoursLine, TimesNotice } from '../../components/booking/BranchHours';
import type { ExtensionEligibility } from '../../types/api';
import type { ExtensionFreeKm } from '../../types/api';
import CounterPaymentPicker, { useCounterPayment } from '../../components/employee/CounterPaymentPicker';
import SwapVehiclePicker from '../../components/employee/SwapVehiclePicker';
import TimeFieldPicker from '../../components/ui/TimeFieldPicker';

// Opened from the pickup screen (CONFIRMED booking) and the drop screen
// (PICKED_UP — car already out). Same steps as the web Extend Booking modal:
// 1 pick the new return · 2 choose how to resolve availability · 3 collect.
// Commit always sends collectNow, so the charge is taken right here.
type Phase = 'select' | 'resolve' | 'collect' | 'done';
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
  // Free km this option adds (#7) — a partial option: up to partialNewEndAt
  extensionFreeKm?: ExtensionFreeKm | null;
}

// POST /api/employee/extensions/evaluate → data. Money is decimal strings.
interface Evaluation {
  extensionPublicId: string;
  oldEndAt: string;
  requestedEndAt: string;
  // additionalAmount = taxableAmount + taxAmount (GST split, #23). Hours are
  // numbers: current rental length and the time this quote adds.
  // extensionFreeKm: free km the quote adds (#7) — absent from an older server.
  pricing: { additionalAmount: string; newTotalFinal: string; originalHours?: number; extensionHours?: number } &
    ExtensionGstFields & { extensionFreeKm?: ExtensionFreeKm | null };
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

// Paise shown when present: the extension's GST is rounded to the paisa.
const inr = (v: number | string) => inrExact(v);
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
// Extra time on top of the current return (whole days keep the same clock
// time); +12h turns a 12-hour rental into a full day (#5).
const PRESETS = [
  { label: '+12h', ms: 12 * HOUR_MS },
  { label: '+1d', ms: DAY_MS },
  { label: '+2d', ms: 2 * DAY_MS },
  { label: '+3d', ms: 3 * DAY_MS },
  { label: '+7d', ms: 7 * DAY_MS },
];
// Monthly-plan bookings (#15) can run to 180 days: whole months (30 days, as billed).
const MONTH_PRESETS = [
  { label: '+1 mo', ms: 30 * DAY_MS },
  { label: '+2 mo', ms: 60 * DAY_MS },
];
// Return dates offered in the strip: up to the server's maxEndAt (180 days for
// a monthly plan), else 30 days when an older server sends no limit.
const DAY_COUNT = 30;
const MAX_STRIP_DAYS = MONTHLY_MAX_DAYS + 1;

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

// Free km the extension adds to the drop allowance (#7), as the server worked
// it out: whole days and a 12-hour block earn km, other hours none.
function FreeKmRows({ freeKm }: { freeKm: ExtensionFreeKm }) {
  return (
    <>
      <Row label="Free km added" value={freeKm.km > 0 ? `+${freeKm.km.toLocaleString('en-IN')} km` : 'None'} />
      <Text style={styles.holdNote}>{freeKm.label}</Text>
    </>
  );
}

// The extension charge's GST split, as the server stored it (never computed
// here). Item 17: the rent is GST-inclusive — rent without GST + the GST split
// out of it = the amount due; base / discount are in without-GST terms.
function GstSplitRows({ split }: { split: ExtensionGstSplit }) {
  return (
    <>
      {split.discount > 0 ? (
        <>
          <Row label="Rent without GST, before discount" value={inr(split.base)} />
          <Row label="Discount (without GST)" value={`−${inr(split.discount)}`} />
        </>
      ) : null}
      <Row label="Rent without GST" value={inr(split.taxable)} />
      <Row label={gstLabel('GST', split.rate)} value={inr(split.tax)} />
      {split.tax > 0 ? <Text style={styles.gstNote}>{gstSplitText(split.cgst, split.sgst)}</Text> : null}
    </>
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

  // How far the booking may run (#15: 15 days from pickup, 180 for a monthly
  // plan) and when the branch takes returns (#2). Keyed on the current return
  // so a cancelled pending extension refreshes it.
  const {
    data: eligibility,
    isError: eligibilityFailed,
    refetch: refetchEligibility,
  } = useQuery({
    queryKey: ['employee', 'extension-eligibility', bookingId, currentEnd],
    queryFn: async () =>
      ((await employeeApi.extensionEligibility(bookingId!)).data?.data ?? null) as ExtensionEligibility | null,
    enabled: !!bookingId,
    retry: false,
  });
  const maxEnd = useMemo(() => {
    const d = eligibility?.maxEndAt ? new Date(eligibility.maxEndAt) : null;
    return d && !isNaN(d.getTime()) ? d : null;
  }, [eligibility?.maxEndAt]);
  const eligibilityHours = useMemo(() => toScheduleConfig(eligibility?.officeHours), [eligibility?.officeHours]);
  // Older server without the eligibility endpoint: the staff branch's hours.
  const staffBranch = useAuthStore((s) => s.user?.branchPublicId ?? null);
  const { data: branchHours } = useBranchSchedule(eligibilityFailed ? staffBranch : null);
  const schedule = eligibilityHours ?? branchHours ?? null;
  const maxDays = eligibility?.maxBookingDays ?? MAX_BOOKING_DAYS;
  // Not extendable (at the limit, or not CONFIRMED / PICKED_UP): the server says why.
  const notExtendable = eligibility && !eligibility.eligible ? eligibility.reason ?? 'This booking cannot be extended.' : null;

  // Step 1 — new return date + time (default: one more day, same time) and notes
  const [newEnd, setNewEnd] = useState<Date | null>(() => (endAt ? new Date(new Date(endAt).getTime() + DAY_MS) : null));

  // Once the limit and hours are known, keep the chosen return inside them.
  useEffect(() => {
    if (!currentEnd) return;
    const base = new Date(currentEnd);
    const after = base.getTime() > Date.now() ? base : new Date();
    setNewEnd((e) => {
      if (!e) return e;
      const fitted = fitReturnTime(e, schedule, { after, before: maxEnd });
      return fitted && fitted.getTime() !== e.getTime() ? fitted : e;
    });
  }, [schedule, maxEnd, currentEnd]);

  // An accepted new return: after the current one (and now), within the
  // limit, inside branch hours.
  const returnOk = (at: Date) =>
    !!currentEnd &&
    at.getTime() > Math.max(new Date(currentEnd).getTime(), Date.now()) &&
    (!maxEnd || at.getTime() <= maxEnd.getTime()) &&
    (!hasOfficeHours(schedule) || isReturnTimeAllowed(schedule, at));
  const daySlots = (day: Date) =>
    currentEnd ? slotsWithinHours(day, schedule, 'return', { after: new Date(currentEnd), before: maxEnd }) : [];
  const [timeOpen, setTimeOpen] = useState(false);
  const [notes, setNotes] = useState('');

  // Step 2 — evaluation (the extension is PENDING_PAYMENT server-side from here on)
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [swapVehicleId, setSwapVehicleId] = useState('');
  // SWAP_CURRENT_TO_OTHER cars for the swap picker sheet (#4), keyed by
  // publicId. The server sends only make / model / regNo here.
  const swapPickerVehicles = useMemo(
    () =>
      (evaluation?.resolutionOptions.find((o) => o.type === 'SWAP_CURRENT_TO_OTHER')?.availableVehicles ?? []).map(
        (v) => ({ id: v.publicId, make: v.make, model: v.model, regNo: v.regNo }),
      ),
    [evaluation],
  );

  // Step 3 — committed: the vehicle is held until this is paid or cancelled
  const [amountDue, setAmountDue] = useState(0);
  // GST split of the committed charge (a partial extension is repriced at commit)
  const [dueGst, setDueGst] = useState<ExtensionGstSplit | null>(null);
  const [heldUntil, setHeldUntil] = useState<string | null>(null);
  // Free km the committed extension adds (#7) — null from an older server.
  const [heldFreeKm, setHeldFreeKm] = useState<ExtensionFreeKm | null>(null);
  // Cash / UPI (payment-screen photo) / Split / Credit (#11 / #12)
  const pay = useCounterPayment('CASH');
  const method = pay.method;
  const [doneMsg, setDoneMsg] = useState('');
  // Cash / UPI / split wait for the branch manager; credit confirms at once.
  const [doneAwaiting, setDoneAwaiting] = useState(false);

  const extensionPublicId = evaluation?.extensionPublicId ?? null;

  // Committing, collecting or cancelling a committed extension moves the
  // booking's return time (and maybe its Daily/Monthly tab): refresh the Fleet
  // queues, the overdue list (under ['employee', 'returns']) and the counts.
  const qc = useQueryClient();
  const refreshQueues = () => {
    qc.invalidateQueries({ queryKey: ['employee', 'pickups'] });
    qc.invalidateQueries({ queryKey: ['employee', 'returns'] });
    qc.invalidateQueries({ queryKey: ['employee', 'dashboard-stats'] });
  };

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
              refreshQueues();
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
  // that's already overdue), skipping a first day with no later times left,
  // up to the booking-period limit (#15).
  const days = useMemo(() => {
    if (!currentEnd) return [];
    const end = new Date(currentEnd);
    const from = startOfDay(end.getTime() > Date.now() ? end : new Date());
    const last = maxEnd ? startOfDay(maxEnd) : null;
    const count = last ? MAX_STRIP_DAYS : DAY_COUNT;
    const out: Date[] = [];
    for (let i = 0; i < count; i++) {
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
      if (last && d.getTime() > last.getTime()) break;
      if (i === 0 && timeSlotsFor(d, { after: end }).length === 0) continue;
      out.push(d);
    }
    return out;
  }, [currentEnd, maxEnd]);

  // Keeps the chosen time on the new day when the branch accepts it there,
  // else the nearest accepted time that day.
  const pickDay = (day: Date) => {
    if (!newEnd || !baseEnd) return;
    const same = withTime(day, timeOf(newEnd));
    if (returnOk(same)) {
      setNewEnd(same);
      setError(null);
      return;
    }
    const slots = daySlots(day);
    if (!slots.length) return;
    const want = timeOf(newEnd);
    const pick = slots.find((s) => s.value >= want) ?? slots[slots.length - 1]!;
    setNewEnd(withTime(day, pick.value));
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
    // Same rules the server applies (#15 / #2), said before a quote is made.
    if (maxEnd && requested.getTime() > maxEnd.getTime()) {
      setError(`This booking can be extended up to ${fmt(maxEnd.toISOString())} (${maxDays}-day limit).`);
      return;
    }
    if (hasOfficeHours(schedule)) {
      const verdict = validateReturnTime(schedule, requested);
      if (verdict.status === 'RETURN_OUTSIDE_HOURS') {
        setError(buildScheduleErrorMessage(verdict));
        return;
      }
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
      // X3 DL_IN_USE also names the booking holding this driving licence
      setError(dlInUseErrorText(err) ?? message);
      // The limit moved on since this screen loaded — refresh it so the
      // pickers stop at the server's maxEndAt.
      if (err?.response?.data?.code === 'BOOKING_MAX_PERIOD_EXCEEDED') void refetchEligibility();
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
                refreshQueues();
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
      refreshQueues();
      // The committed amount is what's due — a partial extension is repriced.
      setAmountDue(Number(d?.remainAmount?.extension ?? d?.additionalAmount ?? evaluation.pricing.additionalAmount));
      // The committed split; an older server sends none, so fall back to the
      // quote's unless the charge was repriced (partial).
      setDueGst(
        extensionGstSplit(d) ??
          (resolution === 'PARTIAL_EXTENSION' ? null : extensionGstSplit(evaluation.pricing)),
      );
      setHeldUntil(resolution === 'PARTIAL_EXTENSION' && opt?.partialNewEndAt ? opt.partialNewEndAt : evaluation.requestedEndAt);
      setHeldFreeKm(d?.extensionFreeKm ?? opt?.extensionFreeKm ?? null);
      setPhase('collect');
    } catch (err: any) {
      if (handleShiftRequired(err)) return;
      setError(dlInUseErrorText(err) ?? apiErrorMessage(err, 'Could not confirm the extension.'));
    } finally {
      setBusy(false);
    }
  };

  // Step 3: take the money — Cash, UPI (photo of the payment screen) or Split
  // wait for the branch manager in Cash Confirmations; Credit confirms the
  // extension at once and leaves the amount owed (#11 / #12).
  const collect = async () => {
    if (!extensionPublicId) return;
    let choice: CounterPaymentChoice | null = { method: 'CASH', amount: 0 };
    if (amountDue > 0) {
      choice = pay.resolve(amountDue);
      if (!choice) return;
    }
    setBusy(true); setError(null);
    try {
      const res = await employeeApi.collectExtension(
        extensionPublicId,
        choice.method === 'UPI'
          ? { method: 'UPI', proof_file_id: choice.proofFileId }
          : choice.method === 'SPLIT'
            ? { method: 'SPLIT', cashAmount: choice.cashAmount, onlineAmount: choice.upiAmount, proof_file_id: choice.proofFileId }
            : choice.method === 'CREDIT'
              ? { method: 'CREDIT', collateral: choice.collateral }
              : { method: 'CASH' },
      );
      const data = res.data?.data;
      const confirmed = data?.payment === 'confirmed';
      refreshQueues();
      // The Payment panel on the pickup / drop screen (credit owed, pending money).
      qc.invalidateQueries({ queryKey: ['employee', 'financial-state', bookingId] });
      setDoneAwaiting(!confirmed);
      setDoneMsg(
        data?.credit
          ? `${inr(Number(data.credit.amount ?? amountDue))} is on credit (collateral: ${data.credit.collateral ?? (choice.method === 'CREDIT' ? choice.collateral : '')}). The branch manager clears it when the customer pays.`
          : confirmed
            ? 'The extension is confirmed.'
            : amountDue > 0
              ? `${choice.method === 'UPI' ? 'UPI payment' : choice.method === 'SPLIT' ? 'Split payment' : 'Cash'} recorded. The extension is final once the branch manager confirms the payment.`
              : 'The extension awaits manager confirmation.',
      );
      setPhase('done');
    } catch (err: any) {
      if (handleShiftRequired(err)) return;
      // Photo / split / collateral problems show under the payment picker.
      if (pay.showServerError(err)) return;
      setError(apiErrorMessage(err, 'Could not collect the extension payment.'));
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'done') {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.successBody}>
          <View style={[styles.successIcon, doneAwaiting && styles.successIconWaiting]}>
            <Ionicons name={doneAwaiting ? 'time' : 'checkmark-circle'} size={64} color={doneAwaiting ? '#d97706' : '#10b981'} />
          </View>
          <Text style={styles.successTitle}>{doneAwaiting ? 'Awaiting manager confirmation' : 'Extension done'}</Text>
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
  // Accepted return times on the chosen day: branch hours + the 15-day limit.
  const slots = newEnd ? daySlots(newEnd) : [];
  // Return inside the grace after closing: accepted, but say so (#2).
  const returnVerdict = newEnd && hasOfficeHours(schedule) ? validateReturnTime(schedule, newEnd) : null;
  const graceNotice =
    returnVerdict?.status === 'RETURN_GRACE'
      ? {
          tone: 'warn' as const,
          text: `The branch closes at ${returnVerdict.closingTime} that day — returns are accepted until ${returnVerdict.gracePeriodEnd}.`,
        }
      : null;
  // The quote's extra time (server hours) and the GST split of its charge (#23).
  const quotedLength = evaluation
    ? formatExtensionHours(evaluation.pricing.extensionHours) ??
      rangeLengthLabel(new Date(evaluation.oldEndAt), new Date(evaluation.requestedEndAt))
    : null;
  const quotedGst = extensionGstSplit(evaluation?.pricing);

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

        {/* #15 — nothing left to extend (or not extendable now): the server says why */}
        {phase === 'select' && notExtendable && (
          <View style={styles.errorBox}>
            <Ionicons name="close-circle-outline" size={16} color="#e53e3e" />
            <Text style={styles.errorText}>{notExtendable}</Text>
          </View>
        )}

        {/* ── Step 1: new return date + time ── */}
        {phase === 'select' && !notExtendable && baseEnd && newEnd && (
          <>
            <Text style={styles.sectionLabel}>Extend by</Text>
            {/* Monthly plan: a second row of whole-month presets */}
            {(eligibility?.isMonthly ? [PRESETS, MONTH_PRESETS] : [PRESETS]).map((presets, r) => (
              <View key={r} style={[styles.presetRow, r > 0 && styles.presetRowNext]}>
                {presets.map((p) => {
                  const target = new Date(baseEnd.getTime() + p.ms);
                  const active = newEnd.getTime() === target.getTime();
                  // Past the limit or outside branch hours: not offered.
                  const blocked = !returnOk(target);
                  return (
                    <TouchableOpacity
                      key={p.label}
                      style={[styles.preset, active && styles.presetActive, blocked && styles.presetBlocked]}
                      onPress={() => { setNewEnd(target); setError(null); }}
                      disabled={blocked}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.presetText, active && styles.presetTextActive]}>{p.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}

            <Text style={styles.sectionLabel}>New return date</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayScroll} contentContainerStyle={styles.dayRow}>
              {days.map((d) => {
                const active = isSameDay(d, newEnd);
                // Closed days, and days with no accepted return time left, are greyed out (#2).
                const closed = isClosedDay(schedule, d);
                const off = !active && daySlots(d).length === 0;
                return (
                  <TouchableOpacity
                    key={d.getTime()}
                    style={[styles.day, active && styles.dayActive, off && styles.dayOff]}
                    onPress={() => pickDay(d)}
                    disabled={off}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.dayWeek, active && styles.dayTextActive]}>
                      {d.toLocaleDateString('en-IN', { weekday: 'short' })}
                    </Text>
                    <Text style={[styles.dayNum, active && styles.dayTextActive]}>{d.getDate()}</Text>
                    <Text style={[styles.dayMonth, active && styles.dayTextActive]}>
                      {closed ? 'Closed' : d.toLocaleDateString('en-IN', { month: 'short' })}
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
            <BranchHoursLine text={rangeHoursLine(schedule, newEnd, newEnd, { returnOnly: true })} />
            <TimesNotice notice={graceNotice} />

            <View style={styles.card}>
              <Row label="New return" value={fmt(newEnd.toISOString())} accent />
              {pickLength ? <Text style={styles.extendNote}>Extending by {pickLength}</Text> : null}
              {maxEnd ? (
                <Text style={styles.extendNote}>
                  Latest possible return {fmt(maxEnd.toISOString())} ({maxDays}-day limit)
                </Text>
              ) : null}
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
              {quotedLength ? <Row label="Extra time" value={quotedLength} /> : null}
              {evaluation.pricing.extensionFreeKm ? <FreeKmRows freeKm={evaluation.pricing.extensionFreeKm} /> : null}
              <View style={styles.divider} />
              {quotedGst ? <GstSplitRows split={quotedGst} /> : null}
              <View style={styles.row}>
                <Text style={styles.label}>{quotedGst ? 'Additional due (incl. GST)' : 'Additional due'}</Text>
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
                          {opt.type === 'PARTIAL_EXTENSION' && opt.extensionFreeKm ? (
                            <Text style={styles.optionSub}>
                              Free km for this time:{' '}
                              {opt.extensionFreeKm.km > 0 ? `+${opt.extensionFreeKm.km.toLocaleString('en-IN')} km` : 'none'}
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

                      {/* Vehicle to swap to: the shared picker sheet with search (#4) */}
                      {selected && opt.type === 'SWAP_CURRENT_TO_OTHER' && swapPickerVehicles.length ? (
                        <View style={styles.vehicleList}>
                          <SwapVehiclePicker
                            vehicles={swapPickerVehicles}
                            selectedId={swapVehicleId || null}
                            onSelect={(v) => { setSwapVehicleId(v.id); setError(null); }}
                            disabled={busy}
                          />
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
              {heldFreeKm ? <FreeKmRows freeKm={heldFreeKm} /> : null}
              <View style={styles.divider} />
              {dueGst ? <GstSplitRows split={dueGst} /> : null}
              <View style={styles.row}>
                <Text style={styles.label}>{dueGst ? 'Amount due (incl. GST)' : 'Amount due'}</Text>
                <Text style={styles.amount}>{inr(amountDue)}</Text>
              </View>
              <Text style={styles.holdNote}>The vehicle is on hold until this is collected or the extension is cancelled.</Text>
            </View>

            {amountDue > 0 && (
              <>
                <Text style={styles.sectionLabel}>Collected by</Text>
                <View style={styles.card}>
                  {/* Cash / UPI (photo) / Split / Credit — all but credit await the manager */}
                  <CounterPaymentPicker
                    ctl={pay}
                    amount={amountDue}
                    disabled={busy}
                    title={null}
                  />
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
          notExtendable ? (
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>Back</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.primaryBtn, busy && styles.btnDisabled]} onPress={() => evaluate()} disabled={busy} activeOpacity={0.85}>
              {busy ? <ActivityIndicator color={Colors.white} size="small" /> : <Text style={styles.primaryBtnText}>Check availability</Text>}
            </TouchableOpacity>
          )
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
                {amountDue > 0
                  ? method === 'CREDIT'
                    ? `Put ${inr(amountDue)} on credit`
                    : `Collect ${inr(amountDue)}${method === 'UPI' ? ' via UPI' : method === 'SPLIT' ? ' (split)' : ' cash'}`
                  : 'Confirm extension'}
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
          emptyText={closedDayText(schedule, newEnd)}
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
  gstNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, textAlign: 'right', marginTop: -4 },
  amount: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink, letterSpacing: -0.4 },
  changeLink: { alignSelf: 'center', paddingVertical: 6 },
  changeLinkText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange },
  divider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 4 },
  sectionLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3, textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 },

  presetRow: { flexDirection: 'row', gap: 8 },
  presetRowNext: { marginTop: 8 },
  preset: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.hairline },
  presetActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  presetText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink2 },
  presetTextActive: { color: Colors.white },
  presetBlocked: { opacity: 0.4 },

  dayScroll: { marginHorizontal: -20 },
  dayRow: { paddingHorizontal: 20, gap: 8 },
  day: {
    width: 58, paddingVertical: 10, borderRadius: 14, alignItems: 'center', gap: 2,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.hairline,
  },
  dayActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  dayOff: { opacity: 0.4 },
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

  vehicleList: { marginTop: 6, marginLeft: 28 },

  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#e53e3e10', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e53e3e30' },
  errorText: { fontFamily: Fonts.body, fontSize: 13, color: '#e53e3e', flex: 1 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.hairline, backgroundColor: Colors.bg },
  primaryBtn: { backgroundColor: Colors.orange, borderRadius: 16, paddingVertical: 17, alignItems: 'center' },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },
  successBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  successIcon: { width: 100, height: 100, borderRadius: 30, backgroundColor: '#10b98115', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  successIconWaiting: { backgroundColor: '#d9770615' },
  successTitle: { fontFamily: Fonts.displayBold, fontSize: 28, color: Colors.ink, letterSpacing: -0.8, textAlign: 'center' },
  successSub: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink3, textAlign: 'center', lineHeight: 22 },
  successBtn: { alignSelf: 'stretch' },
  newEndPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.orangeSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
  },
  newEndPillText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
});

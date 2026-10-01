import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import { apiErrorMessage } from '../../lib/counterErrors';
import {
  defaultChargeDifference,
  fuelBarsValue,
  priceDifferenceOf,
  type SwapCandidate,
  type SwapErrorCode,
  type SwapReason,
  type SwapVehicleBody,
  type VehicleSwapRecord,
} from '../../types/vehicleSwap';
import {
  SwapCandidateList,
  SwapFuelBars,
  SwapPriceDifference,
  SwapReasonChips,
  chargeDifferenceToSend,
  swapInr,
  useSwapCandidates,
} from './SwapParts';

// #13 — swap the car during an active rental (booking PICKED_UP), from the drop
// screen. Same server rules as the pickup swap, plus the handover readings: the
// returning car's end odometer + fuel and the replacement's start odometer +
// fuel. The pro-rated, pre-GST price difference is not collected here — when
// "Charge customer" is on it goes on the drop bill with GST.

type Field = 'vehicle' | 'reason' | 'endOdo' | 'endFuel' | 'startOdo' | 'startFuel' | 'maintNotes';

// READINGS_REQUIRED `missing` names → the input they belong to.
const MISSING_FIELD: Record<string, Field> = {
  originalVehicleEndOdometer: 'endOdo',
  originalVehicleFuelLevel: 'endFuel',
  newVehicleStartOdometer: 'startOdo',
  newVehicleFuelLevel: 'startFuel',
};

const km = (n: number) => `${n.toLocaleString('en-IN')} km`;
const parseOdo = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

export default function ActiveSwapSheet({
  visible,
  bookingId,
  onClose,
  onSwapped,
}: {
  visible: boolean;
  bookingId: string;
  onClose: () => void;
  onSwapped: (swap: VehicleSwapRecord | null) => void;
}) {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch, isFetching } = useSwapCandidates(bookingId, visible);
  const vehicles = data?.vehicles ?? [];
  const context = data?.context ?? null;
  // Older servers sent no swapContext; the drop screen only opens this for
  // PICKED_UP bookings, which always need the readings.
  const readingsRequired = context ? context.readingsRequired : true;
  const segmentStart = context?.currentVehicleStartOdometer ?? null;
  const current = context?.currentVehicle ?? null;

  const [selected, setSelected] = useState<SwapCandidate | null>(null);
  const [reason, setReason] = useState<SwapReason | null>(null);
  const [reasonNotes, setReasonNotes] = useState('');
  const [charge, setCharge] = useState(false);
  const [endOdo, setEndOdo] = useState('');
  const [endFuel, setEndFuel] = useState('');
  const [startOdo, setStartOdo] = useState('');
  const [startFuel, setStartFuel] = useState('');
  const [markMaint, setMarkMaint] = useState(false);
  const [maintNotes, setMaintNotes] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);

  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);

  // Every open starts a fresh form.
  useEffect(() => {
    if (!visible) return;
    setSelected(null);
    setReason(null);
    setReasonNotes('');
    setCharge(false);
    setEndOdo('');
    setEndFuel('');
    setStartOdo('');
    setStartFuel('');
    setMarkMaint(false);
    setMaintNotes('');
    setErrors({});
    setSubmitError(null);
  }, [visible]);

  // A reload can drop the picked car (taken meanwhile) or re-price it.
  useEffect(() => {
    if (!selected || !data) return;
    const fresh = data.vehicles.find((v) => v.id === selected.id) ?? null;
    if (!fresh) setSelected(null);
    else if (fresh !== selected) setSelected(fresh);
  }, [data]);

  // iOS: the KeyboardAvoidingView lifts the sheet. Android (edge-to-edge) may not
  // resize the modal: pad the content by the keyboard height. Both: scroll the
  // focused reading into view.
  useEffect(() => {
    if (!visible) return;
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => {
      setKbHeight(e.endCoordinates.height);
      setTimeout(() => {
        const input = TextInput.State.currentlyFocusedInput();
        if (!input || !contentRef.current) return;
        input.measureLayout(
          contentRef.current as any,
          (_x, y) => { scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true }); },
          () => {},
        );
      }, 100);
    });
    const hide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, [visible]);

  const clearError = (f: Field) => setErrors((e) => (e[f] ? { ...e, [f]: undefined } : e));

  const pickVehicle = (v: SwapCandidate) => {
    setSelected(v);
    clearError('vehicle');
    // Prefill the replacement's readings from its last recorded values (editable).
    // fuelLevel is a percent on the vehicle; fuelBars is the same reading in bars.
    setStartOdo(v.odo != null ? String(v.odo) : '');
    setStartFuel(fuelBarsValue(v.fuelBars) ?? '');
    clearError('startOdo');
    clearError('startFuel');
    setSubmitError(null);
  };

  const pickReason = (r: SwapReason) => {
    setReason(r);
    // "Charge customer" follows the reason's default whenever the reason changes.
    setCharge(defaultChargeDifference(context, r));
    clearError('reason');
  };

  const close = () => {
    if (swapping) return;
    Keyboard.dismiss();
    onClose();
  };

  const validate = () => {
    const next: Partial<Record<Field, string>> = {};
    if (!selected) next.vehicle = 'Pick the replacement vehicle.';
    if (!reason) next.reason = 'Pick a reason for the swap.';
    if (readingsRequired) {
      const end = parseOdo(endOdo);
      if (end == null) next.endOdo = 'Enter the odometer of the car coming back.';
      else if (segmentStart != null && end < segmentStart) {
        next.endOdo = `Can't be lower than ${km(segmentStart)}, its reading when this rental started on it.`;
      }
      if (!fuelBarsValue(endFuel)) next.endFuel = 'Pick its fuel level.';
      if (selected) {
        const start = parseOdo(startOdo);
        if (start == null) next.startOdo = 'Enter the odometer of the replacement.';
        else if (selected.odo != null && start < selected.odo) {
          next.startOdo = `Can't be lower than ${km(selected.odo)}, its last recorded reading.`;
        }
        if (!fuelBarsValue(startFuel)) next.startFuel = 'Pick its fuel level.';
      }
    }
    if (markMaint && !maintNotes.trim()) next.maintNotes = 'Say what needs fixing.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const doSwap = async () => {
    if (!selected || !reason) return;
    const chargeDifference = chargeDifferenceToSend(selected, reason, charge);
    const body: SwapVehicleBody = {
      newVehicleId: selected.id,
      reason,
      ...(reasonNotes.trim() ? { reasonNotes: reasonNotes.trim() } : {}),
      ...(markMaint ? { markOriginalForMaintenance: true, originalVehicleNotes: maintNotes.trim() } : {}),
      ...(readingsRequired
        ? {
            originalVehicleEndOdometer: parseOdo(endOdo) ?? undefined,
            originalVehicleFuelLevel: fuelBarsValue(endFuel) ?? undefined,
            newVehicleStartOdometer: parseOdo(startOdo) ?? undefined,
            newVehicleFuelLevel: fuelBarsValue(startFuel) ?? undefined,
          }
        : {}),
      chargeDifference,
    };
    setSwapping(true);
    setSubmitError(null);
    try {
      const res = await employeeApi.swapVehicle(bookingId, body);
      const swap = (res.data?.data ?? null) as VehicleSwapRecord | null;
      const diff = priceDifferenceOf(swap?.priceDifference) ?? 0;
      const regNo = swap?.newVehicle?.regNo ?? selected.regNo;
      const money =
        diff > 0
          ? swap?.chargeDifference
            ? ` Price difference ${swapInr(diff)} + GST goes on the drop bill.`
            : ` The ${swapInr(diff)} price difference was waived.`
          : '';
      Keyboard.dismiss();
      onSwapped(swap);
      // iOS drops an alert presented while the sheet is still sliding away.
      setTimeout(
        () => Alert.alert('Vehicle swapped', `The rental continues on ${regNo}.${money}`),
        Platform.OS === 'ios' ? 450 : 0,
      );
    } catch (err: any) {
      const res = err?.response?.data;
      const code = res?.code as SwapErrorCode | undefined;
      const message = apiErrorMessage(err, 'Could not swap the vehicle.');
      switch (code) {
        case 'READINGS_REQUIRED': {
          const missing: string[] = Array.isArray(res?.missing) ? res.missing : [];
          const next: Partial<Record<Field, string>> = {};
          missing.forEach((m) => { const f = MISSING_FIELD[m]; if (f) next[f] = 'Required for a swap during the rental.'; });
          setErrors((e) => ({ ...e, ...next }));
          break;
        }
        case 'ODOMETER_BELOW_START':
          setErrors((e) => ({ ...e, endOdo: message }));
          break;
        case 'ODOMETER_BELOW_RECORDED':
          setErrors((e) => ({ ...e, startOdo: message }));
          break;
        case 'VEHICLE_NOT_AVAILABLE':
        case 'VEHICLE_NOT_FOUND':
        case 'VEHICLE_TYPE_MISMATCH':
        case 'CATEGORY_DOWNGRADE':
          // The car can't take this booking any more — offer the fresh list.
          setSelected(null);
          refetch();
          break;
        case 'VEHICLE_BUSY':
        case 'BOOKING_CHANGED':
          refetch();
          break;
        default:
          break;
      }
      setSubmitError(message);
    } finally {
      setSwapping(false);
    }
  };

  const submit = () => {
    Keyboard.dismiss();
    if (!validate() || !selected || !reason) {
      setSubmitError('Fill in the highlighted fields above.');
      return;
    }
    setSubmitError(null);
    const diff = priceDifferenceOf(selected.priceDifference);
    const charged = chargeDifferenceToSend(selected, reason, charge);
    const money =
      diff != null && diff > 0
        ? charged
          ? `\n\nPrice difference ${swapInr(diff)} + GST will be added to the drop bill.`
          : `\n\nThe ${swapInr(diff)} price difference is waived.`
        : '';
    Alert.alert(
      `Swap to ${selected.regNo}?`,
      `${current ? `${current.regNo} comes back and ` : ''}the customer continues in the ${selected.make} ${selected.model}.${money}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Swap vehicle', onPress: doSwap },
      ],
    );
  };

  const loadError = isError ? (error as any)?.response?.data : null;
  const loadCode = loadError?.code as SwapErrorCode | undefined;
  const loadMessage = isError ? apiErrorMessage(error, 'Could not load the replacement vehicles.') : '';
  const overdueEndAt: string | undefined = loadCode === 'BOOKING_OVERDUE' ? loadError?.endAt : undefined;

  const openExtension = () => {
    if (!overdueEndAt) return;
    onClose();
    router.push({ pathname: '/employee/extension', params: { bookingId, endAt: overdueEndAt } });
  };

  const canSubmit = !!selected && !!reason && !swapping;

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={close}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={close}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Swap vehicle</Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  {current ? `Now: ${current.make} ${current.model} · ${current.regNo}` : 'During the rental'}
                </Text>
              </View>
              <TouchableOpacity onPress={close} hitSlop={10} disabled={swapping} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={swapping ? Colors.ink4 : Colors.ink} />
              </TouchableOpacity>
            </View>

            <ScrollView
              ref={scrollRef}
              innerViewRef={contentRef as React.RefObject<View>}
              contentContainerStyle={[styles.body, { paddingBottom: 32 + (Platform.OS === 'android' ? kbHeight : 0) }]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {isLoading || (!data && !isError) ? (
                <ActivityIndicator color={Colors.orange} style={{ marginVertical: 32 }} />
              ) : isError ? (
                <View style={styles.blocked}>
                  <Ionicons name="alert-circle-outline" size={28} color="#d97706" />
                  <Text style={styles.blockedText}>{loadMessage}</Text>
                  {overdueEndAt ? (
                    <TouchableOpacity style={styles.secondaryBtn} onPress={openExtension} activeOpacity={0.85}>
                      <Ionicons name="calendar-outline" size={16} color={Colors.ink2} />
                      <Text style={styles.secondaryBtnText}>Extend rental</Text>
                    </TouchableOpacity>
                  ) : loadCode === 'RETURN_IN_PROGRESS' || loadCode === 'EXTENSION_PENDING' || loadCode === 'MANAGER_CONFIRMATION_PENDING' || loadCode === 'SWAP_NOT_ELIGIBLE' ? null : (
                    <TouchableOpacity style={styles.secondaryBtn} onPress={() => refetch()} activeOpacity={0.85}>
                      <Ionicons name="refresh" size={16} color={Colors.ink2} />
                      <Text style={styles.secondaryBtnText}>Try again</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : vehicles.length === 0 ? (
                <View style={styles.blocked}>
                  <Ionicons name="car-outline" size={28} color={Colors.ink4} />
                  <Text style={styles.blockedText}>
                    No replacement is free{context ? ` until ${formatDate(context.endAt)}` : ''} in this branch. Only cars of the
                    same or a higher category that aren't booked for the rest of this rental can be offered.
                  </Text>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={() => refetch()} activeOpacity={0.85} disabled={isFetching}>
                    <Ionicons name="refresh" size={16} color={Colors.ink2} />
                    <Text style={styles.secondaryBtnText}>{isFetching ? 'Checking…' : 'Check again'}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={styles.label}>Replacement vehicle</Text>
                  <Text style={styles.hintTop}>
                    Free until the return{context ? ` (${formatDate(context.endAt)})` : ''}. Same category first; higher categories are upgrades.
                  </Text>
                  {context?.pricingError ? (
                    <Text style={styles.warn}>Price differences unavailable: {context.pricingError}</Text>
                  ) : null}
                  <SwapCandidateList vehicles={vehicles} selectedId={selected?.id ?? null} onSelect={pickVehicle} disabled={swapping} />
                  {errors.vehicle ? <Text style={styles.fieldError}>{errors.vehicle}</Text> : null}

                  <Text style={[styles.label, { marginTop: 14 }]}>Reason</Text>
                  <SwapReasonChips value={reason} onChange={pickReason} disabled={swapping} />
                  {errors.reason ? <Text style={styles.fieldError}>{errors.reason}</Text> : null}
                  <TextInput
                    style={styles.input}
                    value={reasonNotes}
                    onChangeText={setReasonNotes}
                    placeholder="Notes (optional)"
                    placeholderTextColor={Colors.ink4}
                    maxLength={500}
                    editable={!swapping}
                  />

                  {readingsRequired && (
                    <>
                      <Text style={[styles.label, { marginTop: 18 }]}>
                        Coming back{current ? ` · ${current.regNo}` : ''}
                      </Text>
                      <TextInput
                        style={[styles.input, styles.inputTight, !!errors.endOdo && styles.inputError]}
                        value={endOdo}
                        onChangeText={(t) => { setEndOdo(t.replace(/[^0-9]/g, '')); clearError('endOdo'); }}
                        placeholder="Odometer now (km)"
                        placeholderTextColor={Colors.ink4}
                        keyboardType="number-pad"
                        maxLength={7}
                        editable={!swapping}
                      />
                      {errors.endOdo ? (
                        <Text style={styles.fieldError}>{errors.endOdo}</Text>
                      ) : segmentStart != null ? (
                        <Text style={styles.hint}>Started this rental at {km(segmentStart)}.</Text>
                      ) : null}
                      <Text style={styles.subLabel}>Fuel now (bars)</Text>
                      <SwapFuelBars value={endFuel} onChange={(v) => { setEndFuel(v); clearError('endFuel'); }} disabled={swapping} />
                      {errors.endFuel ? <Text style={styles.fieldError}>{errors.endFuel}</Text> : null}

                      {selected && (
                        <>
                          <Text style={[styles.label, { marginTop: 18 }]}>Going out · {selected.regNo}</Text>
                          <TextInput
                            style={[styles.input, styles.inputTight, !!errors.startOdo && styles.inputError]}
                            value={startOdo}
                            onChangeText={(t) => { setStartOdo(t.replace(/[^0-9]/g, '')); clearError('startOdo'); }}
                            placeholder="Odometer at handover (km)"
                            placeholderTextColor={Colors.ink4}
                            keyboardType="number-pad"
                            maxLength={7}
                            editable={!swapping}
                          />
                          {errors.startOdo ? (
                            <Text style={styles.fieldError}>{errors.startOdo}</Text>
                          ) : selected.odo != null ? (
                            <Text style={styles.hint}>Last recorded {km(selected.odo)} — check the dashboard.</Text>
                          ) : null}
                          <Text style={styles.subLabel}>Fuel at handover (bars)</Text>
                          <SwapFuelBars value={startFuel} onChange={(v) => { setStartFuel(v); clearError('startFuel'); }} disabled={swapping} />
                          {errors.startFuel ? <Text style={styles.fieldError}>{errors.startFuel}</Text> : null}
                        </>
                      )}
                    </>
                  )}

                  {selected && (
                    <SwapPriceDifference
                      candidate={selected}
                      pricingError={context?.pricingError ?? null}
                      reason={reason}
                      charge={charge}
                      onChargeChange={setCharge}
                      disabled={swapping}
                    />
                  )}

                  <View style={styles.maintRow}>
                    <Text style={styles.maintLabel}>
                      Send {current ? current.regNo : 'the returning car'} to maintenance
                    </Text>
                    <Switch
                      value={markMaint}
                      onValueChange={(v) => { setMarkMaint(v); clearError('maintNotes'); }}
                      disabled={swapping}
                      trackColor={{ false: Colors.ink4, true: Colors.orange }}
                      thumbColor={Colors.white}
                    />
                  </View>
                  {markMaint && (
                    <>
                      <TextInput
                        style={[styles.input, !!errors.maintNotes && styles.inputError]}
                        value={maintNotes}
                        onChangeText={(t) => { setMaintNotes(t); clearError('maintNotes'); }}
                        placeholder="What needs fixing (required)"
                        placeholderTextColor={Colors.ink4}
                        maxLength={1000}
                        editable={!swapping}
                      />
                      {errors.maintNotes ? <Text style={styles.fieldError}>{errors.maintNotes}</Text> : null}
                    </>
                  )}

                  {submitError ? (
                    <View style={styles.errorBox}>
                      <Ionicons name="alert-circle-outline" size={16} color="#dc3545" />
                      <Text style={styles.errorText}>{submitError}</Text>
                    </View>
                  ) : null}

                  <TouchableOpacity
                    style={[styles.swapBtn, !canSubmit && styles.swapBtnDisabled]}
                    onPress={submit}
                    disabled={!canSubmit}
                    activeOpacity={0.85}
                  >
                    {swapping ? (
                      <ActivityIndicator size="small" color={Colors.white} />
                    ) : (
                      <Text style={styles.swapBtnText}>Swap vehicle</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  kav: { width: '100%', height: '92%', justifyContent: 'flex-end' },
  sheet: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.ink4, alignSelf: 'center', marginTop: 10, marginBottom: 6 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  title: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  subtitle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 2 },
  body: { paddingHorizontal: 20, paddingTop: 16 },

  label: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink, marginBottom: 8 },
  subLabel: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink3, marginTop: 12, marginBottom: 8 },
  hintTop: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: -4, marginBottom: 10, lineHeight: 17 },
  hint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 6 },
  warn: { fontFamily: Fonts.body, fontSize: 12, color: '#d97706', marginBottom: 10, lineHeight: 17 },
  fieldError: { fontFamily: Fonts.body, fontSize: 12, color: '#e53e3e', marginTop: 6 },

  input: {
    backgroundColor: Colors.bg, borderRadius: 12, borderWidth: 1, borderColor: Colors.hairline,
    paddingHorizontal: 14, paddingVertical: 11, fontFamily: Fonts.body, fontSize: 14, color: Colors.ink, marginTop: 10,
  },
  inputTight: { marginTop: 0, fontFamily: Fonts.bodySemiBold, fontSize: 16 },
  inputError: { borderColor: '#e53e3e' },

  maintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, gap: 12 },
  maintLabel: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2, flex: 1 },

  blocked: { alignItems: 'center', gap: 12, paddingVertical: 28, paddingHorizontal: 8 },
  blockedText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink2, textAlign: 'center', lineHeight: 20 },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1,
    borderColor: Colors.hairline, backgroundColor: Colors.bg, paddingHorizontal: 16, paddingVertical: 10,
  },
  secondaryBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink2 },

  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 16, padding: 12, borderRadius: 12,
    backgroundColor: '#fdecee', borderWidth: 1, borderColor: '#f5c2c7',
  },
  errorText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: '#842029', lineHeight: 18 },

  swapBtn: { backgroundColor: Colors.orange, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  swapBtnDisabled: { opacity: 0.5 },
  swapBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white },
});

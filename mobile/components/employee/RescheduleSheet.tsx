import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import { apiErrorMessage } from '../../lib/counterErrors';
import { isSameDay, startOfDay, timeOf, withTime, type TimeSlot } from '../../lib/dates';
import { isClosedDay, rangeHoursLine, toScheduleConfig } from '../../lib/branchSchedule';
import {
  canPickupNow,
  differenceLabel,
  istMinuteIso,
  periodEndLimits,
  periodEndSlots,
  periodStartSlots,
  rescheduleReturn,
  rescheduleSlots,
  rupees,
} from '../../lib/reschedule';
import { BranchHoursLine } from '../booking/BranchHours';
import type { RescheduleResult } from '../../types/api';

const REASON_MAX = 500;
const NOW = 'NOW';

function fmtWhen(d: Date | string) {
  return new Date(d).toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

interface Props {
  visible: boolean;
  bookingPublicId: string;
  onClose: () => void;
  /** Moved: the server's message ("Booking rescheduled — pickup …, return ….") and result. */
  onRescheduled: (result: RescheduleResult, message: string) => void;
}

type DayEntry = { day: Date; slots: TimeSlot[]; closed: boolean };

// Fleet "Reschedule rental period" (client TODO 4): a confirmed booking that
// hasn't been picked up gets a new start AND a new end, each picked on its own
// (branch hours, 30-minute grid; "Now" for a customer who is already here).
// The server checks the period and prices it; the sheet shows the old total,
// the new total and the difference before the FE confirms. An older server
// (no periodReschedule) only moves the pickup, as before.
export default function RescheduleSheet({ visible, bookingPublicId, onClose, onRescheduled }: Props) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, error: loadError, refetch, isFetching } = useQuery({
    queryKey: ['employee', 'reschedule-options', bookingPublicId],
    queryFn: async () => (await employeeApi.rescheduleOptions(bookingPublicId)).data.data,
    enabled: visible && !!bookingPublicId,
    staleTime: 0,
    retry: false,
  });
  const periodMode = data?.periodReschedule === true;

  const [startDay, setStartDay] = useState<Date | null>(null);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [endDay, setEndDay] = useState<Date | null>(null);
  const [endTime, setEndTime] = useState<string | null>(null);
  const [nowAt, setNowAt] = useState<Date>(() => new Date());
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh form every time the sheet opens, on the booking's current period
  useEffect(() => {
    if (!visible) return;
    setStartDay(null);
    setStartTime(null);
    setEndDay(null);
    setEndTime(null);
    setReason('');
    setError(null);
    setNowAt(new Date());
  }, [visible]);

  const config = useMemo(() => toScheduleConfig(data?.officeHours), [data?.officeHours]);

  // Start days: today … the latest pickup
  const startDays = useMemo<DayEntry[]>(() => {
    if (!data?.reschedulable) return [];
    const first = startOfDay(new Date(data.earliestStartAt));
    const last = startOfDay(new Date(data.latestStartAt));
    const out: DayEntry[] = [];
    for (let i = 0; i < 200; i++) {
      const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
      if (d.getTime() > last.getTime()) break;
      const slots = periodMode ? periodStartSlots(d, data, nowAt) : rescheduleSlots(d, data, nowAt);
      out.push({ day: d, slots, closed: isClosedDay(config, d) });
    }
    return out;
  }, [data, config, periodMode, nowAt]);

  const nowAllowed = !!data && periodMode && canPickupNow(data, nowAt);

  // Preselect the booking's own period (period mode), else its pickup day
  useEffect(() => {
    if (startDay || !data || startDays.length === 0) return;
    const current = new Date(data.startAt);
    const own = startDays.find((d) => isSameDay(d.day, current) && d.slots.length > 0);
    const first = own ?? startDays.find((d) => d.slots.length > 0);
    if (!first) return;
    setStartDay(first.day);
    if (periodMode && own && own.slots.some((s) => s.value === timeOf(current))) {
      setStartTime(timeOf(current));
      setEndDay(startOfDay(new Date(data.endAt)));
      setEndTime(timeOf(new Date(data.endAt)));
    }
  }, [startDays, data, startDay, periodMode]);

  const startSlots = startDay ? startDays.find((d) => isSameDay(d.day, startDay))?.slots ?? [] : [];
  const isTodayStart = !!startDay && isSameDay(startDay, nowAt);
  useEffect(() => {
    if (startTime && startTime !== NOW && !startSlots.some((s) => s.value === startTime)) setStartTime(null);
  }, [startSlots, startTime]);

  const newStart = startDay && startTime
    ? startTime === NOW ? new Date(Math.ceil(nowAt.getTime() / 60000) * 60000) : withTime(startDay, startTime)
    : null;

  // End days: the start day … start + 30 days (monthly: + 180)
  const endDays = useMemo<DayEntry[]>(() => {
    if (!data || !newStart || !periodMode) return [];
    const { min, max } = periodEndLimits(newStart, data);
    const first = startOfDay(min.getTime() - newStart.getTime() > 86400000 ? min : newStart);
    const last = startOfDay(max);
    const out: DayEntry[] = [];
    for (let i = 0; i < 200; i++) {
      const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
      if (d.getTime() > last.getTime()) break;
      out.push({ day: d, slots: periodEndSlots(d, newStart, data, nowAt), closed: isClosedDay(config, d) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, config, periodMode, newStart?.getTime(), nowAt]);

  const endSlots = endDay ? endDays.find((d) => isSameDay(d.day, endDay))?.slots ?? [] : [];
  useEffect(() => {
    if (endTime && !endSlots.some((s) => s.value === endTime)) setEndTime(null);
  }, [endSlots, endTime]);

  const newEnd = periodMode
    ? endDay && endTime ? withTime(endDay, endTime) : null
    : newStart && data ? rescheduleReturn(newStart, data, config) : null;

  const changed =
    !!data && !!newStart && !!newEnd &&
    (Math.abs(newStart.getTime() - new Date(data.startAt).getTime()) >= 60000 ||
      Math.abs(newEnd.getTime() - new Date(data.endAt).getTime()) >= 60000);

  // The server's checks + price for the chosen period
  const quoteKey = periodMode && changed && newStart && newEnd ? [istMinuteIso(newStart), istMinuteIso(newEnd)] : null;
  const quote = useQuery({
    queryKey: ['employee', 'reschedule-quote', bookingPublicId, ...(quoteKey ?? [])],
    queryFn: async () =>
      (await employeeApi.rescheduleQuote(bookingPublicId, { newStartAt: quoteKey![0]!, newEndAt: quoteKey![1]! })).data.data,
    enabled: visible && !!quoteKey,
    staleTime: 0,
    retry: false,
  });
  const pricing = quote.data?.pricing;
  const quoteError = quote.isError ? apiErrorMessage(quote.error, 'This period is not available.') : null;

  const canSubmit = !!newStart && !!newEnd && changed && !submitting && (!periodMode || (!!pricing && !quote.isFetching));

  const submit = async () => {
    if (!canSubmit || !newStart || !newEnd) return;
    setSubmitting(true);
    setError(null);
    try {
      const trimmed = reason.trim();
      const res = await employeeApi.rescheduleBooking(bookingPublicId, {
        newStartAt: istMinuteIso(newStart),
        ...(periodMode
          ? { newEndAt: istMinuteIso(newEnd), acceptPriceChange: true, ...(pricing ? { expectedNewTotal: pricing.newTotal } : {}) }
          : {}),
        ...(trimmed ? { reason: trimmed } : {}),
      });
      onRescheduled(res.data.data, res.data.message ?? 'Booking rescheduled.');
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Could not reschedule the booking. Please try again.'));
      const status = err?.response?.status;
      if (status === 409 || status === 400) {
        void refetch();
        void quote.refetch();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const loadMessage = isError ? apiErrorMessage(loadError, 'Could not load the reschedule options.') : null;
  const diff = pricing ? Number(pricing.difference) : 0;
  const confirmLabel = !newStart
    ? 'Choose a new start'
    : !newEnd
      ? 'Choose a new return'
      : !changed
        ? 'Change the start or the return'
        : !periodMode
          ? `Move pickup to ${fmtWhen(newStart)}`
          : !pricing
            ? quote.isFetching ? 'Checking…' : 'Choose an available period'
            : diff > 0
              ? `Reschedule · ${rupees(diff)} more`
              : diff < 0
                ? `Reschedule · ${rupees(-diff)} less`
                : 'Reschedule · same price';

  const dayRow = (days: DayEntry[], selected: Date | null, onPick: (d: Date) => void, offLabel: string) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>
      {days.map((d) => {
        const active = !!selected && isSameDay(d.day, selected);
        const off = d.slots.length === 0 && !(onPick === pickStartDay && nowAllowed && isSameDay(d.day, nowAt));
        return (
          <TouchableOpacity
            key={d.day.getTime()}
            style={[styles.dayPill, active && styles.dayPillActive, off && styles.dayPillOff]}
            onPress={() => onPick(d.day)}
            disabled={off}
            activeOpacity={0.85}
            accessibilityState={{ selected: active, disabled: off }}
          >
            <Text style={[styles.dayWeek, active && styles.dayTextActive]}>
              {d.day.toLocaleDateString('en-IN', { weekday: 'short' })}
            </Text>
            <Text style={[styles.dayNum, active && styles.dayTextActive]}>{d.day.getDate()}</Text>
            <Text style={[styles.dayMonth, active && styles.dayTextActive]}>
              {d.closed ? 'Closed' : off ? offLabel : d.day.toLocaleDateString('en-IN', { month: 'short' })}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  function pickStartDay(d: Date) {
    setStartDay(d);
    setStartTime(null);
    setError(null);
  }
  const pickEndDay = (d: Date) => {
    setEndDay(d);
    setEndTime(null);
    setError(null);
  };

  const slotGrid = (slots: TimeSlot[], value: string | null, onPick: (v: string) => void, extra?: TimeSlot) => (
    <View style={styles.slotGrid}>
      {[...(extra ? [extra] : []), ...slots].map((s) => {
        const active = value === s.value;
        return (
          <TouchableOpacity
            key={s.value}
            style={[styles.slot, active && styles.slotActive]}
            onPress={() => {
              onPick(s.value);
              setError(null);
            }}
            activeOpacity={0.85}
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.slotText, active && styles.slotTextActive]}>{s.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.kav, { paddingTop: insets.top + 8 }]}
          pointerEvents="box-none"
        >
          <View style={[styles.sheet, { maxHeight: Math.round(height * 0.9), paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>{data && !periodMode ? 'Reschedule pickup' : 'Reschedule rental period'}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={Colors.ink} />
              </TouchableOpacity>
            </View>

            {isLoading || (!data && isFetching) ? (
              <ActivityIndicator style={styles.loader} color={Colors.orange} />
            ) : loadMessage || !data ? (
              <View style={styles.blocked}>
                <Text style={styles.blockedText}>{loadMessage ?? 'Could not load the reschedule options.'}</Text>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => refetch()} activeOpacity={0.85}>
                  <Text style={styles.secondaryBtnText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : !data.reschedulable ? (
              <View style={styles.blocked}>
                <View style={styles.blockedRow}>
                  <Ionicons name="lock-closed-outline" size={18} color="#b45309" />
                  <Text style={styles.blockedText}>{data.reason ?? "This booking can't be rescheduled right now."}</Text>
                </View>
                <TouchableOpacity style={styles.secondaryBtn} onPress={onClose} activeOpacity={0.85}>
                  <Text style={styles.secondaryBtnText}>Close</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <ScrollView
                  style={styles.body}
                  contentContainerStyle={styles.bodyContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.currentCard}>
                    <Text style={styles.currentLabel}>CURRENT PERIOD</Text>
                    <Text style={styles.currentValue}>
                      {fmtWhen(data.startAt)} → {fmtWhen(data.endAt)}
                    </Text>
                    <Text style={styles.currentSub}>
                      {periodMode
                        ? `${data.durationLabel}${data.isMonthly ? ' · monthly plan (30–180 days)' : ''} · change the start, the return or both — the price follows`
                        : data.halfDayPackage
                          ? '12-hour package · the return is 12 hours after pickup (or closing that day), the price stays the same'
                          : `${data.durationLabel} · the return moves with the pickup, the price stays the same`}
                    </Text>
                  </View>

                  <Text style={styles.sectionLabel}>{periodMode ? 'Rental start (pickup)' : 'New pickup date'}</Text>
                  {dayRow(startDays, startDay, pickStartDay, 'No slots')}
                  {startDays.every((d) => d.slots.length === 0) && !nowAllowed ? (
                    <Text style={styles.hint}>
                      No pickup time is free for this booking in the next days — the vehicle or the customer's licence
                      is booked, or the branch is closed.
                    </Text>
                  ) : null}
                  {startDay
                    ? slotGrid(
                        startSlots,
                        startTime,
                        setStartTime,
                        isTodayStart && nowAllowed ? { value: NOW, label: 'Now' } : undefined,
                      )
                    : null}

                  {periodMode && newStart ? (
                    <>
                      <Text style={styles.sectionLabel}>Rental end (return)</Text>
                      {dayRow(endDays, endDay, pickEndDay, 'No slots')}
                      {endDays.every((d) => d.slots.length === 0) ? (
                        <Text style={styles.hint}>
                          No return time is free after this start — another booking, a lock or branch hours are in the way.
                        </Text>
                      ) : null}
                      {endDay ? slotGrid(endSlots, endTime, setEndTime) : null}
                    </>
                  ) : null}

                  {newStart ? (
                    <BranchHoursLine text={rangeHoursLine(config, newStart, newEnd ?? newStart)} />
                  ) : null}

                  {newStart && newEnd && changed ? (
                    <View style={styles.previewCard}>
                      <PreviewRow label="New pickup" value={startTime === NOW ? `Now (${fmtWhen(newStart)})` : fmtWhen(newStart)} />
                      <PreviewRow label="New return" value={fmtWhen(newEnd)} strong />
                      {periodMode ? (
                        quote.isFetching ? (
                          <ActivityIndicator color={Colors.orange} style={{ marginVertical: 6 }} />
                        ) : quoteError ? (
                          <Text style={styles.quoteError}>{quoteError}</Text>
                        ) : pricing ? (
                          <>
                            <View style={styles.divider} />
                            <PreviewRow label="Length" value={`${quote.data!.previous.durationLabel} → ${quote.data!.next.durationLabel}`} />
                            <PreviewRow label="Current total" value={rupees(pricing.oldTotal)} />
                            <PreviewRow label="New total" value={rupees(pricing.newTotal)} strong />
                            <PreviewRow label="Difference" value={differenceLabel(pricing.difference)} strong />
                            {Number(pricing.dueAtPickup) > 0 ? (
                              <PreviewRow label="Due at pickup" value={rupees(pricing.dueAtPickup)} />
                            ) : null}
                            {Number(pricing.refundable) > 0 ? (
                              <PreviewRow label="To refund to the customer" value={rupees(pricing.refundable)} />
                            ) : null}
                            {pricing.freeKm.after != null && pricing.freeKm.after !== pricing.freeKm.before ? (
                              <PreviewRow label="Free km" value={`${pricing.freeKm.before ?? '—'} → ${pricing.freeKm.after}`} />
                            ) : null}
                            <Text style={styles.previewNote}>
                              {diff > 0
                                ? 'The difference is collected with the remaining balance at pickup.'
                                : diff < 0
                                  ? 'The customer has paid more than the new total — refund it with "Refund to customer" (not automatic).'
                                  : 'Same price — only the dates change.'}
                              {pricing.couponCode && pricing.couponAppliesToNewWindow === false
                                ? ` Coupon ${pricing.couponCode} doesn't apply to the new period.`
                                : ''}
                            </Text>
                          </>
                        ) : null
                      ) : (
                        <Text style={styles.previewNote}>Same length ({data.durationLabel}) — price unchanged</Text>
                      )}
                    </View>
                  ) : null}

                  <Text style={styles.sectionLabel}>Reason (optional)</Text>
                  <TextInput
                    style={styles.reasonInput}
                    value={reason}
                    onChangeText={(t) => setReason(t.slice(0, REASON_MAX))}
                    placeholder="e.g. Customer arrived a day early"
                    placeholderTextColor={Colors.ink4}
                    multiline
                    maxLength={REASON_MAX}
                  />

                  {error ? (
                    <View style={styles.errorBox}>
                      <Ionicons name="alert-circle-outline" size={16} color={Colors.availNone} />
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  ) : null}
                </ScrollView>

                <TouchableOpacity
                  style={[styles.confirmBtn, !canSubmit && styles.confirmBtnDisabled]}
                  onPress={submit}
                  disabled={!canSubmit}
                  activeOpacity={0.85}
                >
                  {submitting ? (
                    <ActivityIndicator color={Colors.white} />
                  ) : (
                    <Text style={styles.confirmText}>{confirmLabel}</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function PreviewRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.previewRow}>
      <Text style={styles.previewLabel}>{label}</Text>
      <Text style={[styles.previewValue, strong && styles.previewValueStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 16, paddingTop: 8, flexShrink: 1,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.hairline, marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontFamily: Fonts.bodySemiBold, fontSize: 17, color: Colors.ink },
  loader: { marginVertical: 40 },

  body: { flexShrink: 1 },
  bodyContent: { gap: 10, paddingBottom: 12 },

  blocked: { gap: 14, paddingVertical: 12 },
  blockedRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#fffbeb', borderRadius: 14, borderWidth: 1, borderColor: '#fcd34d', padding: 14,
  },
  blockedText: { flex: 1, fontFamily: Fonts.body, fontSize: 14, color: Colors.ink2, lineHeight: 20 },
  secondaryBtn: {
    alignItems: 'center', paddingVertical: 13, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.hairline, backgroundColor: Colors.bg,
  },
  secondaryBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink2 },

  currentCard: { backgroundColor: Colors.bg, borderRadius: 14, padding: 12, gap: 3 },
  currentLabel: { fontFamily: Fonts.bodyMedium, fontSize: 10, color: Colors.ink3, letterSpacing: 0.6 },
  currentValue: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  currentSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },

  sectionLabel: {
    fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3,
    textTransform: 'uppercase', letterSpacing: 1, marginTop: 6,
  },
  dayRow: { gap: 8, paddingRight: 8 },
  dayPill: {
    width: 58, paddingVertical: 10, borderRadius: 14, alignItems: 'center', gap: 2,
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline,
  },
  dayPillActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  dayPillOff: { opacity: 0.4 },
  dayWeek: { fontFamily: Fonts.bodyMedium, fontSize: 11, color: Colors.ink3 },
  dayNum: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink },
  dayMonth: { fontFamily: Fonts.bodyMedium, fontSize: 11, color: Colors.ink3 },
  dayTextActive: { color: Colors.white },
  hint: { fontFamily: Fonts.body, fontSize: 12.5, color: Colors.ink3, lineHeight: 18 },

  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  slot: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline,
  },
  slotActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  slotText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  slotTextActive: { color: Colors.white },

  previewCard: {
    borderRadius: 14, borderWidth: 1, borderColor: '#ff6a1f40', backgroundColor: '#fff7f2',
    padding: 12, gap: 6, marginTop: 4,
  },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  previewLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  previewValue: { flexShrink: 1, textAlign: 'right', fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink },
  previewValueStrong: { fontFamily: Fonts.bodySemiBold, color: Colors.ink },
  previewNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17 },
  quoteError: { fontFamily: Fonts.body, fontSize: 13, color: Colors.availNone, lineHeight: 18 },
  divider: { height: 1, backgroundColor: '#ff6a1f26', marginVertical: 4 },

  reasonInput: {
    minHeight: 64, textAlignVertical: 'top', fontFamily: Fonts.body, fontSize: 14, color: Colors.ink,
    backgroundColor: Colors.bg, borderRadius: 12, borderWidth: 1, borderColor: Colors.hairline,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: Colors.availNoneSoft, borderRadius: 12, padding: 12,
  },
  errorText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: Colors.availNone, lineHeight: 18 },

  confirmBtn: { backgroundColor: Colors.orange, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white },
});

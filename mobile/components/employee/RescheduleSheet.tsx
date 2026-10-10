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
import { isSameDay, startOfDay, withTime, type TimeSlot } from '../../lib/dates';
import { isClosedDay, rangeHoursLine, toScheduleConfig } from '../../lib/branchSchedule';
import { istMinuteIso, rescheduleReturn, rescheduleSlots, shiftLabel } from '../../lib/reschedule';
import { BranchHoursLine } from '../booking/BranchHours';
import type { RescheduleResult } from '../../types/api';

const REASON_MAX = 500;

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

// Fleet "Reschedule" (BRIEF4 P4c): move a confirmed booking that hasn't been
// picked up to a new pickup time. The return moves by the same amount; the
// length and the price stay as they are. Only valid times are offered.
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

  const [day, setDay] = useState<Date | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh form every time the sheet opens (the options reload on their own:
  // the query turns on with the sheet and is always stale).
  useEffect(() => {
    if (!visible) return;
    setDay(null);
    setTime(null);
    setReason('');
    setError(null);
  }, [visible]);

  const config = useMemo(() => toScheduleConfig(data?.officeHours), [data?.officeHours]);
  // IST days from now to the latest pickup, each with the times it offers.
  const days = useMemo(() => {
    if (!data?.reschedulable) return [];
    const first = startOfDay(new Date(data.earliestStartAt));
    const last = startOfDay(new Date(data.latestStartAt));
    const out: { day: Date; slots: TimeSlot[]; closed: boolean }[] = [];
    for (let i = 0; i < 200; i++) {
      const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
      if (d.getTime() > last.getTime()) break;
      out.push({ day: d, slots: rescheduleSlots(d, data, new Date()), closed: isClosedDay(config, d) });
    }
    return out;
  }, [data, config]);

  // Open on the booking's own pickup day when it has times, else the first day that does.
  useEffect(() => {
    if (day || !data || days.length === 0) return;
    const current = new Date(data.startAt);
    const own = days.find((d) => isSameDay(d.day, current) && d.slots.length > 0);
    const first = own ?? days.find((d) => d.slots.length > 0);
    if (first) setDay(first.day);
  }, [days, data, day]);

  const daySlots = day ? days.find((d) => isSameDay(d.day, day))?.slots ?? [] : [];
  // A time picked on one day that isn't offered any more (options reloaded) is dropped.
  useEffect(() => {
    if (time && !daySlots.some((s) => s.value === time)) setTime(null);
  }, [daySlots, time]);

  const newStart = day && time ? withTime(day, time) : null;
  // pickup + the length, or a 12-hour package's return for the new pickup (item 6)
  const newEnd = newStart && data ? rescheduleReturn(newStart, data, config) : null;
  const shiftMs = newStart && data ? newStart.getTime() - new Date(data.startAt).getTime() : 0;

  const submit = async () => {
    if (!newStart || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const trimmed = reason.trim();
      const res = await employeeApi.rescheduleBooking(bookingPublicId, {
        newStartAt: istMinuteIso(newStart),
        ...(trimmed ? { reason: trimmed } : {}),
      });
      onRescheduled(res.data.data, res.data.message ?? 'Booking rescheduled.');
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Could not reschedule the booking. Please try again.'));
      // Something changed meanwhile (a new booking, a hold, a payment): reload what's free.
      const status = err?.response?.status;
      if (status === 409 || status === 400) void refetch();
    } finally {
      setSubmitting(false);
    }
  };

  const loadMessage = isError ? apiErrorMessage(loadError, 'Could not load the reschedule options.') : null;

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
          <View style={[styles.sheet, { maxHeight: Math.round(height * 0.88), paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>Reschedule pickup</Text>
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
                    <Text style={styles.currentLabel}>NOW</Text>
                    <Text style={styles.currentValue}>
                      {fmtWhen(data.startAt)} → {fmtWhen(data.endAt)}
                    </Text>
                    <Text style={styles.currentSub}>
                      {data.halfDayPackage
                        ? '12-hour package · the return is 12 hours after pickup (or closing that day), the price stays the same'
                        : `${data.durationLabel} · the return moves with the pickup, the price stays the same`}
                    </Text>
                  </View>

                  <Text style={styles.sectionLabel}>New pickup date</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>
                    {days.map((d) => {
                      const active = !!day && isSameDay(d.day, day);
                      const off = d.slots.length === 0;
                      return (
                        <TouchableOpacity
                          key={d.day.getTime()}
                          style={[styles.dayPill, active && styles.dayPillActive, off && styles.dayPillOff]}
                          onPress={() => {
                            setDay(d.day);
                            setTime(null);
                            setError(null);
                          }}
                          disabled={off}
                          activeOpacity={0.85}
                          accessibilityState={{ selected: active, disabled: off }}
                        >
                          <Text style={[styles.dayWeek, active && styles.dayTextActive]}>
                            {d.day.toLocaleDateString('en-IN', { weekday: 'short' })}
                          </Text>
                          <Text style={[styles.dayNum, active && styles.dayTextActive]}>{d.day.getDate()}</Text>
                          <Text style={[styles.dayMonth, active && styles.dayTextActive]}>
                            {d.closed ? 'Closed' : off ? 'No slots' : d.day.toLocaleDateString('en-IN', { month: 'short' })}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  {days.every((d) => d.slots.length === 0) ? (
                    <Text style={styles.hint}>
                      No pickup time is free for this booking's length in the next days — the vehicle or the
                      customer's licence is booked, or the return would fall outside branch hours.
                    </Text>
                  ) : null}

                  {day ? (
                    <>
                      <Text style={styles.sectionLabel}>New pickup time</Text>
                      <View style={styles.slotGrid}>
                        {daySlots.map((s) => {
                          const active = time === s.value;
                          return (
                            <TouchableOpacity
                              key={s.value}
                              style={[styles.slot, active && styles.slotActive]}
                              onPress={() => {
                                setTime(s.value);
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
                      <BranchHoursLine
                        text={rangeHoursLine(config, newStart ?? day, newEnd ?? newStart ?? day)}
                      />
                    </>
                  ) : null}

                  {newStart && newEnd ? (
                    <View style={styles.previewCard}>
                      <PreviewRow label="New pickup" value={fmtWhen(newStart)} />
                      <PreviewRow label="New return" value={fmtWhen(newEnd)} strong />
                      <Text style={styles.previewNote}>
                        {shiftMs > 0 ? 'Later' : 'Earlier'} by {shiftLabel(shiftMs)} ·{' '}
                        {data.halfDayPackage ? '12-hour package' : `same length (${data.durationLabel})`} — price unchanged
                      </Text>
                    </View>
                  ) : null}

                  <Text style={styles.sectionLabel}>Reason (optional)</Text>
                  <TextInput
                    style={styles.reasonInput}
                    value={reason}
                    onChangeText={(t) => setReason(t.slice(0, REASON_MAX))}
                    placeholder="e.g. Customer asked to come in the evening"
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
                  style={[styles.confirmBtn, (!newStart || submitting) && styles.confirmBtnDisabled]}
                  onPress={submit}
                  disabled={!newStart || submitting}
                  activeOpacity={0.85}
                >
                  {submitting ? (
                    <ActivityIndicator color={Colors.white} />
                  ) : (
                    <Text style={styles.confirmText}>
                      {newStart ? `Move pickup to ${fmtWhen(newStart)}` : 'Choose a new pickup time'}
                    </Text>
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

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import {
  extensionApi,
  userApi,
  verifyRazorpaySignature,
  type CustomerExtensionQuote,
  type RazorpayOrder,
} from '../../lib/api';
import {
  CHECKING_PAYMENT_TEXT,
  QR_CANCEL_POLL_DELAYS,
  isCheckoutCancelled,
  openRazorpayCheckout,
  type CheckoutMode,
} from '../../lib/razorpay';
import { apiErrorMessage } from '../../lib/counterErrors';
import { extensionGstSplit, formatExtensionHours, gstLabel, gstSplitText, inrExact } from '../../lib/gst';
import { isSameDay, rangeLengthLabel, startOfDay, timeLabel, timeOf, timeSlotsFor, withTime } from '../../lib/dates';
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
import { useAuthStore } from '../../store/auth';
import Button from '../../components/ui/Button';
import TimeFieldPicker from '../../components/ui/TimeFieldPicker';
import RazorpayPayOptions from '../../components/payments/RazorpayPayOptions';
import { BranchHoursLine, TimesNotice } from '../../components/booking/BranchHours';
import type { ExtensionEligibility, UserProfile } from '../../types/api';

type Phase = 'pick' | 'quote' | 'done' | 'failed';
type PollOutcome = { status: 'CONFIRMED' | 'PENDING' | 'FAILED'; message?: string; newEndAt?: string };

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
// New return dates offered, from the current return's day: up to the server's
// maxEndAt (180 days for a monthly plan, #15), else 30 when it sends no limit.
const DAY_COUNT = 30;
const MAX_STRIP_DAYS = MONTHLY_MAX_DAYS + 1;
const QUICK = [
  { label: '+3 hours', ms: 3 * HOUR_MS },
  // A 12-hour trip becomes a full day (#5).
  { label: '+12 hours', ms: 12 * HOUR_MS },
  { label: '+1 day', ms: DAY_MS },
  { label: '+2 days', ms: 2 * DAY_MS },
  { label: '+3 days', ms: 3 * DAY_MS },
];
// Monthly-plan bookings: whole months (30 days, as billed).
const MONTH_QUICK = [
  { label: '+1 month', ms: 30 * DAY_MS },
  { label: '+2 months', ms: 60 * DAY_MS },
];
// Same cadence as the other Checkout polls (2s settle, then back off).
const POLL_DELAYS = [2000, 3000, 3000, 5000, 5000, 5000, 5000, 5000, 5000, 5000];

// Paise shown when present: the extension's GST is rounded to the paisa.
const inr = (v: string | number) => inrExact(v);

function fmtWhen(d: Date | string) {
  return new Date(d).toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, strong && styles.lineLabelStrong]}>{label}</Text>
      <Text style={[styles.lineValue, strong && styles.lineValueStrong]}>{value}</Text>
    </View>
  );
}

export default function ExtendTrip() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { bookingId, endAt, make, model } = useLocalSearchParams<{
    bookingId: string; endAt: string; make?: string; model?: string;
  }>();

  const currentEnd = useMemo(() => {
    const d = endAt ? new Date(endAt) : null;
    return d && !isNaN(d.getTime()) ? d : null;
  }, [endAt]);

  // How far this trip may run (#15: 15 days from pickup, 180 for a monthly
  // plan) and when the branch takes returns (#2) — both ride on the
  // eligibility response, cached with the trip screen's copy.
  const { data: eligibility, refetch: refetchEligibility } = useQuery({
    queryKey: ['extension-eligibility', bookingId],
    queryFn: async () => {
      const res = await extensionApi.eligibility(bookingId!);
      return (res.data?.data ?? null) as ExtensionEligibility | null;
    },
    enabled: !!bookingId,
  });
  const maxEnd = useMemo(() => {
    const d = eligibility?.maxEndAt ? new Date(eligibility.maxEndAt) : null;
    return d && !isNaN(d.getTime()) ? d : null;
  }, [eligibility?.maxEndAt]);
  const schedule = useMemo(() => toScheduleConfig(eligibility?.officeHours), [eligibility?.officeHours]);
  const maxDays = eligibility?.maxBookingDays ?? MAX_BOOKING_DAYS;
  const atCap = eligibility?.atCap === true;

  // Default: one more day, same return time.
  const [newEnd, setNewEnd] = useState<Date | null>(() => (currentEnd ? new Date(currentEnd.getTime() + DAY_MS) : null));

  // Once the limit and hours are known, keep the chosen return inside them.
  useEffect(() => {
    if (!currentEnd) return;
    setNewEnd((e) => {
      if (!e) return e;
      const fitted = fitReturnTime(e, schedule, { after: currentEnd, before: maxEnd });
      return fitted && fitted.getTime() !== e.getTime() ? fitted : e;
    });
  }, [schedule, maxEnd, currentEnd]);

  // An accepted new return: after the current one, within the limit, inside branch hours.
  const returnOk = (at: Date) =>
    !!currentEnd &&
    at.getTime() > currentEnd.getTime() &&
    (!maxEnd || at.getTime() <= maxEnd.getTime()) &&
    (!hasOfficeHours(schedule) || isReturnTimeAllowed(schedule, at));
  const daySlots = (day: Date) =>
    currentEnd ? slotsWithinHours(day, schedule, 'return', { after: currentEnd, before: maxEnd }) : [];
  const [timeOpen, setTimeOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('pick');
  const [quote, setQuote] = useState<CustomerExtensionQuote | null>(null);
  // The unpaid quote the server is holding for this booking (null once
  // released, paid, or when nothing could be offered).
  const [openQuoteId, setOpenQuoteId] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [changing, setChanging] = useState(false);
  const [payMode, setPayMode] = useState<CheckoutMode | null>(null);
  const [busyText, setBusyText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [result, setResult] = useState<{ newEndAt: string; pending: boolean } | null>(null);
  const [failMessage, setFailMessage] = useState('');

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Only used to prefill the Razorpay sheet — shares the ['profile'] cache.
  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => userApi.profile(),
    select: (res) => res.data as UserProfile,
  });
  const authUser = useAuthStore((s) => s.user);

  // Leaving with an unpaid quote releases it, or the booking stays locked
  // against any new extension (the web does the same on close). While a
  // payment is in flight the screen stays put.
  usePreventRemove(phase === 'quote' && (!!openQuoteId || !!payMode), ({ data }) => {
    if (payMode) return;
    const id = openQuoteId;
    setOpenQuoteId(null);
    (id ? extensionApi.cancel(id).catch(() => undefined) : Promise.resolve()).finally(() =>
      navigation.dispatch(data.action),
    );
  });

  // New return dates: the current return's day (when later times are left on
  // it) and the days after it, up to the booking-period limit (#15).
  const days = useMemo(() => {
    if (!currentEnd) return [];
    const first = startOfDay(currentEnd);
    const last = maxEnd ? startOfDay(maxEnd) : null;
    const count = last ? MAX_STRIP_DAYS : DAY_COUNT;
    const out: Date[] = [];
    for (let i = 0; i < count; i++) {
      const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
      if (last && d.getTime() > last.getTime()) break;
      if (i === 0 && timeSlotsFor(d, { after: currentEnd }).length === 0) continue;
      out.push(d);
    }
    return out;
  }, [currentEnd, maxEnd]);

  // Keeps the chosen time on the new day when the branch accepts it there,
  // else the nearest accepted time that day.
  const pickDay = (day: Date) => {
    if (!newEnd || !currentEnd) return;
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

  const invalidateTrip = () => {
    qc.invalidateQueries({ queryKey: ['bookings'] });
    qc.invalidateQueries({ queryKey: ['trip', bookingId] });
    qc.invalidateQueries({ queryKey: ['extension-eligibility', bookingId] });
  };

  const succeed = (newEndAt: string, pending = false) => {
    setOpenQuoteId(null);
    setResult({ newEndAt, pending });
    setPhase('done');
    invalidateTrip();
  };

  const checkPrice = async () => {
    if (!bookingId || !newEnd) return;
    // Same rules the server applies (#15 / #2), said before a quote is made.
    if (maxEnd && newEnd.getTime() > maxEnd.getTime()) {
      setError(`This booking can be extended up to ${fmtWhen(maxEnd)} (${maxDays}-day limit).`);
      return;
    }
    if (hasOfficeHours(schedule)) {
      const verdict = validateReturnTime(schedule, newEnd);
      if (verdict.status === 'RETURN_OUTSIDE_HOURS') {
        setError(buildScheduleErrorMessage(verdict));
        return;
      }
    }
    setEvaluating(true);
    setError(null);
    try {
      const res = await extensionApi.evaluate(bookingId, { newEndAt: newEnd.toISOString() });
      const q = res.data?.data as CustomerExtensionQuote;
      const offered = q?.resolutionOptions?.[0]?.type;
      setQuote(q);
      // NO_RESOLUTION quotes are released server-side already.
      setOpenQuoteId(offered === 'SAME_VEHICLE' || offered === 'PARTIAL_EXTENSION' ? q.extensionPublicId : null);
      setPayError(null);
      setPhase('quote');
    } catch (err: any) {
      const data = err?.response?.data;
      const message = apiErrorMessage(err, 'Could not check the extension. Please try again.');
      setError(message);
      // The limit moved on since this screen loaded — refresh it so the
      // pickers stop at the server's maxEndAt.
      if (data?.code === 'BOOKING_MAX_PERIOD_EXCEEDED') void refetchEligibility();
      // Another extension is open. An unpaid one can be released and retried;
      // one already paid at the counter waits for the branch.
      if (
        data?.code === 'EXTENSION_PENDING' &&
        data?.pendingExtensionStatus === 'PENDING_PAYMENT' &&
        data?.pendingExtensionPublicId
      ) {
        Alert.alert('Extension already in progress', message, [
          { text: 'Keep it', style: 'cancel' },
          {
            text: 'Cancel it and try again',
            style: 'destructive',
            onPress: async () => {
              try {
                await extensionApi.cancel(data.pendingExtensionPublicId);
              } catch (cancelErr: any) {
                setError(apiErrorMessage(cancelErr, 'Could not cancel the earlier extension.'));
                return;
              }
              await checkPrice();
            },
          },
        ]);
      }
    } finally {
      setEvaluating(false);
    }
  };

  // Back to the time picker; the unpaid quote is released first so the next
  // check isn't blocked by it.
  const changeTime = async () => {
    const id = openQuoteId;
    setChanging(true);
    try {
      if (id) await extensionApi.cancel(id).catch(() => undefined);
    } finally {
      if (!mountedRef.current) return;
      setOpenQuoteId(null);
      setQuote(null);
      setPayError(null);
      setChanging(false);
      setPhase('pick');
    }
  };

  const pollExtension = async (orderId: string, delays: number[]): Promise<PollOutcome> => {
    for (let i = 0; i < delays.length; i++) {
      if (!mountedRef.current) break;
      try {
        const res = await extensionApi.verifyPayment(orderId);
        const status = res.data?.status;
        if (status === 'CONFIRMED') return { status, newEndAt: res.data?.data?.newEndAt ?? undefined };
        if (status === 'FAILED') return { status, message: res.data?.message };
      } catch {
        /* transient — keep polling */
      }
      await new Promise((r) => setTimeout(r, delays[i]));
    }
    return { status: 'PENDING' };
  };

  const pay = async (mode: CheckoutMode) => {
    if (!quote || !openQuoteId) return;
    setPayMode(mode);
    setPayError(null);
    try {
      const res = await extensionApi.initiatePayment(openQuoteId);
      const d = res.data?.data ?? {};
      // Nothing due — the server confirmed it outright.
      if (d.extensionStatus === 'CONFIRMED') {
        succeed(d.newEndAt ?? quote.requestedEndAt);
        return;
      }
      const rzp: RazorpayOrder | null = d.razorpay ?? null;
      const orderId: string | undefined = d.transactionId ?? rzp?.orderId;
      if (!rzp?.orderId || !rzp?.keyId || !orderId) {
        setPayError('Could not start the payment. Please try again.');
        return;
      }

      let payment;
      try {
        payment = await openRazorpayCheckout(
          {
            key: rzp.keyId,
            order_id: rzp.orderId,
            amount: rzp.amount,
            currency: rzp.currency,
            description: `Trip extension${make || model ? ` · ${[make, model].filter(Boolean).join(' ')}` : ''}`,
            prefill: {
              name: profile?.name ?? authUser?.name ?? '',
              email: profile?.email ?? authUser?.email ?? '',
              contact: profile?.phone ?? '',
            },
          },
          { mode },
        );
      } catch (rzpErr: any) {
        const cancelled = isCheckoutCancelled(rzpErr);
        // A QR cancel is often this phone's sheet being closed after the QR was
        // paid from another phone — check before calling it cancelled.
        if (cancelled && mode === 'qr') {
          setBusyText(CHECKING_PAYMENT_TEXT);
          const r = await pollExtension(orderId, QR_CANCEL_POLL_DELAYS);
          if (!mountedRef.current) return;
          if (r.status === 'CONFIRMED') {
            succeed(r.newEndAt ?? quote.requestedEndAt);
            return;
          }
          if (r.status === 'FAILED' && r.message) {
            setPayError(r.message);
            return;
          }
        }
        if (!mountedRef.current) return;
        setPayError(
          cancelled
            ? 'Payment cancelled. Your trip was not extended.'
            : rzpErr?.description || 'The payment could not be completed. Please try again.',
        );
        return;
      }

      // Paid — from here the quote must never be released.
      setOpenQuoteId(null);
      setBusyText('Confirming your extension…');
      // /api/payment/verify confirms extension orders by order id; the poll is
      // the fallback and hands back the confirmed return time.
      try {
        await verifyRazorpaySignature({
          razorpay_order_id: payment.razorpay_order_id ?? rzp.orderId,
          razorpay_payment_id: payment.razorpay_payment_id,
          razorpay_signature: payment.razorpay_signature ?? '',
        });
      } catch { /* fall through — the poll below is the fallback */ }
      const r = await pollExtension(orderId, POLL_DELAYS);
      if (!mountedRef.current) return;
      if (r.status === 'CONFIRMED') {
        succeed(r.newEndAt ?? quote.requestedEndAt);
      } else if (r.status === 'FAILED') {
        // Captured but refused (e.g. the booking was cancelled) — the message
        // carries the refund notice, so keep it on screen.
        setFailMessage(r.message ?? 'Your extension could not be confirmed. Any amount debited will be refunded.');
        setPhase('failed');
        invalidateTrip();
      } else {
        succeed(quote.requestedEndAt, true);
      }
    } catch (err: any) {
      // e.g. 409 — the car is no longer free for the new return time.
      if (mountedRef.current) setPayError(apiErrorMessage(err, 'Could not start the payment. Please try again.'));
    } finally {
      if (mountedRef.current) {
        setPayMode(null);
        setBusyText(null);
      }
    }
  };

  const header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8} disabled={!!payMode || changing}>
        <Ionicons name="arrow-back" size={22} color={payMode || changing ? Colors.ink4 : Colors.ink} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Extend trip</Text>
      <View style={{ width: 36 }} />
    </View>
  );

  if (!currentEnd || !newEnd || !bookingId) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {header}
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color={Colors.ink4} />
          <Text style={styles.centerTitle}>Couldn't load this trip</Text>
          <Button title="Back" variant="secondary" onPress={() => router.back()} fullWidth={false} />
        </View>
      </View>
    );
  }

  if (phase === 'done' || phase === 'failed') {
    const ok = phase === 'done';
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.resultBody}>
          <View style={[styles.resultIcon, { backgroundColor: ok ? Colors.availGoodSoft : Colors.availNoneSoft }]}>
            <Ionicons
              name={ok ? (result?.pending ? 'time-outline' : 'checkmark-circle') : 'alert-circle'}
              size={56}
              color={ok ? Colors.availGood : Colors.availNone}
            />
          </View>
          <Text style={styles.resultTitle}>
            {ok ? (result?.pending ? 'Payment received' : 'Trip extended') : 'Extension not confirmed'}
          </Text>
          {ok && result && (
            <View style={styles.newEndPill}>
              <Ionicons name="calendar-outline" size={14} color={Colors.orange} />
              <Text style={styles.newEndPillText}>
                {result.pending ? 'Requested return' : 'New return'} · {fmtWhen(result.newEndAt)}
              </Text>
            </View>
          )}
          <Text style={styles.resultSub}>
            {ok
              ? result?.pending
                ? "We're confirming your extension. Your trip will show the new return time shortly."
                : 'Your booking now ends at the new return time.'
              : failMessage}
          </Text>
        </View>
        <View style={styles.resultFooter}>
          <Button title="Back to trip" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  // Times after the current return on the chosen day (all of them on later
  // days), inside branch hours and the booking-period limit.
  const slots = daySlots(newEnd);
  // Return inside the grace after closing: accepted, but say so (#2).
  const returnVerdict = hasOfficeHours(schedule) ? validateReturnTime(schedule, newEnd) : null;
  const graceNotice =
    returnVerdict?.status === 'RETURN_GRACE'
      ? {
          tone: 'warn' as const,
          text: `The branch closes at ${returnVerdict.closingTime} that day — returns are accepted until ${returnVerdict.gracePeriodEnd}.`,
        }
      : null;
  const offered = quote?.resolutionOptions?.[0];
  const quoteType = offered?.type ?? 'NO_RESOLUTION';
  const extraAmount = Number(quote?.pricing.additionalAmount ?? 0);
  // The server's hours for the quoted time (a partial quote is already narrowed).
  const quoteLength = quote
    ? formatExtensionHours(quote.pricing.extensionHours) ??
      rangeLengthLabel(new Date(quote.oldEndAt), new Date(quote.requestedEndAt))
    : null;
  // GST split of the extra charge (#23) — null from an older server.
  const quoteGst = extensionGstSplit(quote?.pricing);
  const pickLength = rangeLengthLabel(currentEnd, newEnd);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {header}

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {(make || model) ? <Text style={styles.vehicle}>{make} {model}</Text> : null}

        <View style={styles.card}>
          <Line label="Current return" value={fmtWhen(currentEnd)} />
        </View>

        {/* #15 — nothing left to extend: the server says why */}
        {phase === 'pick' && atCap && (
          <View style={[styles.banner, styles.bannerBad]}>
            <Ionicons name="close-circle" size={18} color={Colors.availNone} />
            <View style={styles.bannerTextWrap}>
              <Text style={[styles.bannerTitle, { color: Colors.availNone }]}>Can't extend this trip</Text>
              <Text style={styles.bannerText}>
                {eligibility?.reason ?? `This booking has reached the maximum rental period of ${maxDays} days.`}
              </Text>
            </View>
          </View>
        )}

        {phase === 'pick' && !atCap && (
          <>
            <Text style={styles.sectionTitle}>Extend by</Text>
            <View style={styles.chipRow}>
              {(eligibility?.isMonthly ? [...QUICK, ...MONTH_QUICK] : QUICK).map((q) => {
                const target = new Date(currentEnd.getTime() + q.ms);
                const active = newEnd.getTime() === target.getTime();
                // Past the limit or outside branch hours: not offered.
                const blocked = !returnOk(target);
                return (
                  <TouchableOpacity
                    key={q.label}
                    style={[styles.chip, active && styles.chipActive, blocked && styles.chipBlocked]}
                    onPress={() => { setNewEnd(target); setError(null); }}
                    disabled={blocked}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{q.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sectionTitle}>New return date</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dayRow}
              style={styles.dayScroll}
            >
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

            <Text style={styles.sectionTitle}>New return time</Text>
            <TouchableOpacity style={styles.timeField} onPress={() => setTimeOpen(true)} activeOpacity={0.85}>
              <Ionicons name="time-outline" size={18} color={Colors.ink3} />
              <Text style={styles.timeValue}>{timeLabel(timeOf(newEnd))}</Text>
              <Ionicons name="chevron-down" size={16} color={Colors.ink3} />
            </TouchableOpacity>
            <BranchHoursLine text={rangeHoursLine(schedule, newEnd, newEnd, { returnOnly: true })} />
            <TimesNotice notice={graceNotice} />

            <View style={[styles.card, styles.summaryCard]}>
              <Line label="New return" value={fmtWhen(newEnd)} strong />
              {pickLength ? <Text style={styles.summaryNote}>Extending by {pickLength}</Text> : null}
              {maxEnd ? (
                <Text style={styles.summaryNote}>
                  Latest possible return {fmtWhen(maxEnd)} ({maxDays}-day limit)
                </Text>
              ) : null}
            </View>
          </>
        )}

        {phase === 'quote' && quote && (
          <>
            {quoteType === 'SAME_VEHICLE' && (
              <View style={[styles.banner, styles.bannerGood]}>
                <Ionicons name="checkmark-circle" size={18} color={Colors.availGood} />
                <View style={styles.bannerTextWrap}>
                  <Text style={[styles.bannerTitle, { color: Colors.availGood }]}>Extension available</Text>
                  <Text style={styles.bannerText}>Your car is free until {fmtWhen(quote.requestedEndAt)}.</Text>
                </View>
              </View>
            )}
            {quoteType === 'PARTIAL_EXTENSION' && (
              <View style={[styles.banner, styles.bannerWarn]}>
                <Ionicons name="information-circle" size={18} color={Colors.availLow} />
                <View style={styles.bannerTextWrap}>
                  <Text style={[styles.bannerTitle, { color: Colors.availLow }]}>Partial extension only</Text>
                  <Text style={styles.bannerText}>
                    We can extend until {fmtWhen(offered?.partialNewEndAt ?? quote.requestedEndAt)}. The price below is for that time.
                  </Text>
                </View>
              </View>
            )}
            {quoteType === 'NO_RESOLUTION' && (
              <View style={[styles.banner, styles.bannerBad]}>
                <Ionicons name="close-circle" size={18} color={Colors.availNone} />
                <View style={styles.bannerTextWrap}>
                  <Text style={[styles.bannerTitle, { color: Colors.availNone }]}>No extension available</Text>
                  <Text style={styles.bannerText}>
                    Your car isn't free after the current return time. Try an earlier time, or contact the branch.
                  </Text>
                </View>
              </View>
            )}

            {quoteType !== 'NO_RESOLUTION' && (
              <View style={styles.card}>
                <Line label="New return" value={fmtWhen(quote.requestedEndAt)} />
                {quoteLength ? <Line label="Extra time" value={quoteLength} /> : null}
                <View style={styles.divider} />
                <Line label="Current total" value={inrExact(quote.pricing.originalTotalFinal)} />
                {quoteGst ? (
                  <>
                    <Line label="Extension charge (excl. GST)" value={inrExact(quoteGst.taxable)} />
                    {quoteGst.discount > 0 ? (
                      <Text style={styles.splitNote}>After a {inrExact(quoteGst.discount)} discount</Text>
                    ) : null}
                    <Line label={gstLabel('GST', quoteGst.rate)} value={inrExact(quoteGst.tax)} />
                    {quoteGst.tax > 0 ? (
                      <Text style={styles.splitNote}>{gstSplitText(quoteGst.cgst, quoteGst.sgst)}</Text>
                    ) : null}
                  </>
                ) : null}
                <Line
                  label={quoteGst ? 'Extra charge (incl. GST)' : 'Extra charge'}
                  value={inrExact(quote.pricing.additionalAmount)}
                  strong
                />
                <Line label="New total" value={inrExact(quote.pricing.newTotalFinal)} />
              </View>
            )}

            {payError && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={16} color={Colors.availNone} />
                <Text style={styles.errorText}>{payError}</Text>
              </View>
            )}

            {quoteType !== 'NO_RESOLUTION' && (
              <TouchableOpacity onPress={changeTime} disabled={!!payMode || changing} hitSlop={8} style={styles.changeLink}>
                {changing ? (
                  <ActivityIndicator size="small" color={Colors.orange} />
                ) : (
                  <Text style={styles.changeLinkText}>Change return time</Text>
                )}
              </TouchableOpacity>
            )}
          </>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color={Colors.availNone} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        {phase === 'pick' && (
          atCap ? (
            <Button title="Back to trip" variant="secondary" onPress={() => router.back()} />
          ) : (
            <Button title="Check price" onPress={checkPrice} loading={evaluating} />
          )
        )}
        {phase === 'quote' && quoteType === 'NO_RESOLUTION' && (
          <Button title="Choose another time" variant="secondary" onPress={changeTime} />
        )}
        {phase === 'quote' && quoteType !== 'NO_RESOLUTION' && (
          extraAmount > 0 ? (
            <RazorpayPayOptions
              payLabel={`Pay ${inr(quote!.pricing.additionalAmount)}`}
              onPay={pay}
              disabled={changing}
              busyMode={payMode}
              busyLabel={busyText ?? undefined}
              noUpiNote="No UPI app on this phone — scan the QR with a UPI app on another phone."
            />
          ) : (
            <Button title="Confirm extension" onPress={() => pay('default')} loading={!!payMode} disabled={changing} />
          )
        )}
      </View>

      <TimeFieldPicker
        visible={timeOpen}
        value={timeOf(newEnd)}
        slots={slots}
        emptyText={closedDayText(schedule, newEnd)}
        title="New return time"
        onSelect={(v) => { setNewEnd(withTime(newEnd, v)); setError(null); }}
        onClose={() => setTimeOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink, letterSpacing: -0.3 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  centerTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink2 },

  scroll: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32, gap: 12 },
  vehicle: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  summaryCard: { marginTop: 8 },
  summaryNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, textAlign: 'right' },
  splitNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, textAlign: 'right', marginTop: -4 },
  divider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 4 },

  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  lineLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },
  lineLabelStrong: { fontFamily: Fonts.bodySemiBold, color: Colors.ink },
  lineValue: { flexShrink: 1, textAlign: 'right', fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  lineValueStrong: { fontFamily: Fonts.displayBold, fontSize: 17, color: Colors.orange },

  sectionTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 8,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  chipActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  chipBlocked: { opacity: 0.4 },
  chipText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink2 },
  chipTextActive: { color: Colors.white },

  dayScroll: { marginHorizontal: -20 },
  dayRow: { paddingHorizontal: 20, gap: 8 },
  day: {
    width: 58,
    paddingVertical: 10,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 2,
  },
  dayActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  dayOff: { opacity: 0.4 },
  dayWeek: { fontFamily: Fonts.bodyMedium, fontSize: 11, color: Colors.ink3 },
  dayNum: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink },
  dayMonth: { fontFamily: Fonts.bodyMedium, fontSize: 11, color: Colors.ink3 },
  dayTextActive: { color: Colors.white },

  timeField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  timeValue: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },

  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 14, padding: 14, borderWidth: 1 },
  bannerGood: { backgroundColor: Colors.availGoodSoft, borderColor: '#2d9d6130' },
  bannerWarn: { backgroundColor: Colors.availLowSoft, borderColor: '#d9770630' },
  bannerBad: { backgroundColor: Colors.availNoneSoft, borderColor: '#e53e3e30' },
  bannerTextWrap: { flex: 1, gap: 2 },
  bannerTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14 },
  bannerText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, lineHeight: 19 },

  changeLink: { alignSelf: 'center', paddingVertical: 6 },
  changeLinkText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.availNoneSoft,
    borderRadius: 12,
    padding: 14,
  },
  errorText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: Colors.availNone, lineHeight: 18 },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
    backgroundColor: Colors.surface,
  },

  resultBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 },
  resultIcon: { width: 100, height: 100, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  resultTitle: { fontFamily: Fonts.displayBold, fontSize: 28, color: Colors.ink, letterSpacing: -0.8, textAlign: 'center' },
  resultSub: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink3, textAlign: 'center', lineHeight: 22 },
  resultFooter: { paddingHorizontal: 20 },
  newEndPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.orangeSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  newEndPillText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
});

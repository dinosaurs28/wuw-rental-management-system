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
import { rangeLengthLabel } from '../../lib/dates';
import {
  EXTENSION_PACKAGE_REQUIRED,
  EXTENSION_PACKAGE_REQUIRED_MESSAGE,
  MAX_BOOKING_DAYS,
  isExtensionPackageDuration,
  packageLabel,
} from '../../lib/bookingWindow';
import {
  buildScheduleErrorMessage,
  hasOfficeHours,
  rangeHoursLine,
  toScheduleConfig,
  validateReturnTime,
} from '../../lib/branchSchedule';
import { extensionChoices, nearestUsablePackage } from '../../lib/packages';
import { useAuthStore } from '../../store/auth';
import Button from '../../components/ui/Button';
import PackagePicker from '../../components/booking/PackagePicker';
import RazorpayPayOptions from '../../components/payments/RazorpayPayOptions';
import UpiQrPayModal, { type UpiQrExit } from '../../components/payments/UpiQrPayModal';
import { NO_UPI_APP_QR_NOTE, UPI_QR_OPTION_LABEL, useUpiQrAvailable } from '../../lib/upiQr';
import { BranchHoursLine, TimesNotice } from '../../components/booking/BranchHours';
import type { ExtensionEligibility, UserProfile } from '../../types/api';

type Phase = 'pick' | 'quote' | 'done' | 'failed';
type PollOutcome = { status: 'CONFIRMED' | 'PENDING' | 'FAILED'; message?: string; newEndAt?: string };

// Customers extend by packages only (BRIEF4 P3): +12 hours or + N days, up to
// the server's maxEndAt (15 days, 180 for a monthly plan). The first choice
// offered: one more day.
const DEFAULT_EXTENSION_HOURS = 24;
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

  const paramEnd = useMemo(() => {
    const d = endAt ? new Date(endAt) : null;
    return d && !isNaN(d.getTime()) ? d : null;
  }, [endAt]);

  // How far this trip may run (#15: 15 days from pickup, 180 for a monthly
  // plan) and when the branch takes returns (#2) — both ride on the
  // eligibility response, cached with the trip screen's copy.
  const { data: eligibility, isLoading: eligibilityLoading, refetch: refetchEligibility } = useQuery({
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
  // The server's current return wins over the trip screen's copy: extensions
  // are counted from it (+12 hours / + N days exactly).
  const currentEnd = useMemo(() => {
    const d = eligibility?.currentEndAt ? new Date(eligibility.currentEndAt) : null;
    return d && !isNaN(d.getTime()) ? d : paramEnd;
  }, [eligibility?.currentEndAt, paramEnd]);
  const maxDays = eligibility?.maxBookingDays ?? MAX_BOOKING_DAYS;
  const atCap = eligibility?.atCap === true;

  // The extensions on offer: +12 hours, +1 day … up to the limit, each greyed
  // out (with the reason) when the branch doesn't take returns at that time.
  // The server's packageOptions when it sends them; else the same rule here.
  const choices = useMemo(
    () =>
      currentEnd && eligibility
        ? extensionChoices(currentEnd, { serverOptions: eligibility.packageOptions, maxEnd, config: schedule })
        : [],
    [currentEnd, eligibility, maxEnd, schedule],
  );
  // Nothing left to add (under 12 hours to the limit): the server says why.
  const noPackageLeft = !!eligibility && !atCap && choices.length === 0;

  // The chosen extension (hours added). Defaults to one more day, else the
  // nearest one the branch takes.
  const [hours, setHours] = useState<number | null>(null);
  useEffect(() => {
    setHours((h) => nearestUsablePackage(choices, h ?? DEFAULT_EXTENSION_HOURS));
  }, [choices]);
  const chosen = choices.find((c) => c.hours === hours && !c.issue) ?? null;
  const newEnd = chosen?.endAt ?? null;
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
  // Item 2 — the extension being paid by a UPI QR scanned from another phone
  // (the QR screen is open while set). Offered when the server has it on.
  const [qrExtensionId, setQrExtensionId] = useState<string | null>(null);
  const upiQrEnabled = useUpiQrAvailable();

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Only used to prefill the Razorpay sheet — shares the ['profile'] cache.
  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => userApi.profile(),
    select: (res) => res.data as UserProfile,
  });
  const authUser = useAuthStore((s) => s.user);

  // Releases the unpaid quote (#2). 'paid': a UPI QR had already paid it (409
  // UPI_QR_ALREADY_PAID) — the trip IS extended. 'open': its QR couldn't be
  // closed (502 GATEWAY_UNAVAILABLE), so the server kept the quote. Anything
  // else is best-effort: a stale quote is offered for release on the next check.
  const releaseQuote = async (id: string): Promise<{ result: 'released' | 'paid' | 'open'; message?: string }> => {
    try {
      await extensionApi.cancel(id);
    } catch (err: any) {
      const code = err?.response?.data?.code;
      if (code === 'UPI_QR_ALREADY_PAID') return { result: 'paid' };
      if (code === 'GATEWAY_UNAVAILABLE') {
        return { result: 'open', message: apiErrorMessage(err, "We couldn't close the UPI QR code. Please try again.") };
      }
    }
    return { result: 'released' };
  };

  // Leaving with an unpaid quote releases it, or the booking stays locked
  // against any new extension (the web does the same on close). While a
  // payment is in flight the screen stays put.
  usePreventRemove(phase === 'quote' && (!!openQuoteId || !!payMode), ({ data }) => {
    if (payMode) return;
    const id = openQuoteId;
    setOpenQuoteId(null);
    if (!id) {
      navigation.dispatch(data.action);
      return;
    }
    void releaseQuote(id).then((released) => {
      if (!mountedRef.current) return;
      if (released.result === 'paid') {
        // Paid by UPI QR meanwhile: show the extended trip, not a silent "not extended"
        if (quote) succeed(quote.requestedEndAt);
        else navigation.dispatch(data.action);
        return;
      }
      if (released.result === 'open') {
        Alert.alert(
          'UPI QR still open',
          `${released.message}\n\nIf it is paid in the next few minutes, your trip will be extended.`,
          [
            {
              text: 'Stay',
              style: 'cancel',
              onPress: () => {
                setOpenQuoteId(id);
                setPayError(released.message ?? null);
              },
            },
            { text: 'Leave', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
          ],
          { cancelable: false },
        );
        return;
      }
      navigation.dispatch(data.action);
    });
  });

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
    if (!bookingId || !newEnd || !currentEnd) return;
    // Same rules the server applies (P3 / #15 / #2), said before a quote is made.
    if (!isExtensionPackageDuration(currentEnd, newEnd)) {
      setError(EXTENSION_PACKAGE_REQUIRED_MESSAGE);
      return;
    }
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
      // The limit moved on since this screen loaded (or the trip's return
      // changed) — refresh it so the choices match the server's again.
      if (data?.code === 'BOOKING_MAX_PERIOD_EXCEEDED' || data?.code === EXTENSION_PACKAGE_REQUIRED) {
        void refetchEligibility();
      }
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
                // A UPI QR had paid it (#2): the trip's return time moved
                if (cancelErr?.response?.data?.code === 'UPI_QR_ALREADY_PAID') invalidateTrip();
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
    const released = id ? await releaseQuote(id) : { result: 'released' as const };
    if (!mountedRef.current) return;
    setChanging(false);
    if (released.result === 'paid') {
      // A UPI QR paid it meanwhile — the trip is extended; a new quote would
      // start from the server's already-extended return (#2)
      if (quote) succeed(quote.requestedEndAt);
      else invalidateTrip();
      return;
    }
    if (released.result === 'open') {
      // Its QR can still take money: keep this quote rather than start another
      setPayError(released.message ?? null);
      return;
    }
    setOpenQuoteId(null);
    setQuote(null);
    setPayError(null);
    setPhase('pick');
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
    // Item 2 — "Scan a UPI QR from another phone": the QR screen pays this
    // extension (the server makes its Razorpay order first when needed).
    if (mode === 'qr' && upiQrEnabled) {
      setPayError(null);
      setQrExtensionId(openQuoteId);
      return;
    }
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

  // Item 2 — the UPI QR screen closed: what follows for the extension.
  const handleQrExit = (exit: UpiQrExit) => {
    setQrExtensionId(null);
    if (!quote) return;
    if (exit.kind === 'paid') {
      succeed(exit.view?.extension?.newEndAt ?? quote.requestedEndAt);
      return;
    }
    if (exit.kind === 'refund') {
      // Paid twice: the other payment confirmed it (the QR one is refunded).
      const ext = exit.view.extension;
      if (ext?.extensionStatus === 'CONFIRMED') {
        succeed(ext.newEndAt ?? quote.requestedEndAt);
        return;
      }
      // Captured but not applicable — the message carries the refund notice.
      setOpenQuoteId(null);
      setFailMessage(exit.view.message);
      setPhase('failed');
      invalidateTrip();
      return;
    }
    if (exit.kind === 'another-way') {
      // The QR is closed; pay the extension in Razorpay Checkout instead.
      void pay('default');
      return;
    }
    // Left without paying (the quote stays open to pay again), or the QR
    // couldn't be used for this extension — the server says why.
    setPayError(exit.message ?? 'Payment cancelled. Your trip was not extended.');
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

  if (!currentEnd || !bookingId) {
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

  // Return inside the grace after closing: accepted, but say so (#2).
  const returnVerdict = newEnd && hasOfficeHours(schedule) ? validateReturnTime(schedule, newEnd) : null;
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
  // Free km the quoted time adds (#7) — none under 12 h; absent from an older server.
  const quoteFreeKm = quote?.pricing.extensionFreeKm ?? null;
  // No extension on offer ends inside branch hours — say so above the chips.
  const allBlocked = choices.length > 0 && choices.every((c) => !!c.issue);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {header}

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {(make || model) ? <Text style={styles.vehicle}>{make} {model}</Text> : null}

        <View style={styles.card}>
          <Line label="Current return" value={fmtWhen(currentEnd)} />
        </View>

        {/* #15 / P3 — nothing left to extend (at the limit, or under 12 hours
            to it): the server says why */}
        {phase === 'pick' && (atCap || noPackageLeft) && (
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

        {phase === 'pick' && !atCap && !noPackageLeft && (
          <>
            {/* P3 — +12 hours or whole days only; the new return follows */}
            <Text style={styles.sectionTitle}>Extend by</Text>
            {eligibilityLoading ? (
              <ActivityIndicator color={Colors.orange} style={styles.choicesLoader} />
            ) : (
              <PackagePicker
                choices={choices}
                selectedHours={chosen ? chosen.hours : null}
                onSelect={(h) => { setHours(h); setError(null); }}
                emptyText="Couldn't load the extension options. Go back and try again."
              />
            )}
            {allBlocked ? (
              <TimesNotice
                notice={{
                  tone: 'error',
                  text: "None of these returns falls inside branch hours, so the trip can't be extended here. Please contact the branch.",
                }}
              />
            ) : null}
            {newEnd ? (
              <>
                <BranchHoursLine text={rangeHoursLine(schedule, newEnd, newEnd, { returnOnly: true })} />
                <TimesNotice notice={graceNotice} />

                <View style={[styles.card, styles.summaryCard]}>
                  <Line label="New return" value={fmtWhen(newEnd)} strong />
                  <Text style={styles.summaryNote}>Extending by {packageLabel(chosen!.hours)}</Text>
                  {maxEnd ? (
                    <Text style={styles.summaryNote}>
                      Latest possible return {fmtWhen(maxEnd)} ({maxDays}-day limit)
                    </Text>
                  ) : null}
                </View>
              </>
            ) : null}
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
                  {/* P3 — the server snaps it to the longest package that fits */}
                  {offered?.description ? <Text style={styles.bannerText}>{offered.description}</Text> : null}
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
                    {offered?.description ||
                      "Your car isn't free after the current return time. Try a shorter extension, or contact the branch."}
                  </Text>
                </View>
              </View>
            )}

            {quoteType !== 'NO_RESOLUTION' && (
              <View style={styles.card}>
                <Line label="New return" value={fmtWhen(quote.requestedEndAt)} />
                {quoteLength ? <Line label="Extra time" value={quoteLength} /> : null}
                {quoteFreeKm ? (
                  <>
                    <Line
                      label="Free km added"
                      value={quoteFreeKm.km > 0 ? `+${quoteFreeKm.km.toLocaleString('en-IN')} km` : 'None'}
                    />
                    <Text style={styles.splitNote}>{quoteFreeKm.label}</Text>
                  </>
                ) : null}
                <View style={styles.divider} />
                <Line label="Current total" value={inrExact(quote.pricing.originalTotalFinal)} />
                {/* Item 17: the extension's rent is GST-inclusive — rent without
                    GST + GST (split out of it, not added on top) = the charge */}
                {quoteGst ? (
                  <>
                    <Line label="Rent without GST" value={inrExact(quoteGst.taxable)} />
                    {quoteGst.discount > 0 ? (
                      <Text style={styles.splitNote}>After a {inrExact(quoteGst.discount)} discount (without GST)</Text>
                    ) : null}
                    <Line label={gstLabel('GST', quoteGst.rate)} value={inrExact(quoteGst.tax)} />
                    {quoteGst.tax > 0 ? (
                      <Text style={styles.splitNote}>{gstSplitText(quoteGst.cgst, quoteGst.sgst)}</Text>
                    ) : null}
                  </>
                ) : null}
                <Line
                  label={quoteGst ? 'Extension rent (incl. GST)' : 'Extra charge'}
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
                  <Text style={styles.changeLinkText}>Change extension</Text>
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
          atCap || noPackageLeft ? (
            <Button title="Back to trip" variant="secondary" onPress={() => router.back()} />
          ) : (
            <Button title="Check price" onPress={checkPrice} loading={evaluating} disabled={!newEnd} />
          )
        )}
        {phase === 'quote' && quoteType === 'NO_RESOLUTION' && (
          <Button title="Choose another extension" variant="secondary" onPress={changeTime} />
        )}
        {phase === 'quote' && quoteType !== 'NO_RESOLUTION' && (
          extraAmount > 0 ? (
            <RazorpayPayOptions
              payLabel={`Pay ${inr(quote!.pricing.additionalAmount)}`}
              onPay={pay}
              disabled={changing}
              busyMode={payMode}
              busyLabel={busyText ?? undefined}
              // Item 2 — with the server's UPI QR on, the QR option opens the
              // QR screen (first, with this note, on a phone with no UPI app).
              qrLabel={upiQrEnabled ? UPI_QR_OPTION_LABEL : undefined}
              noUpiNote={
                upiQrEnabled
                  ? NO_UPI_APP_QR_NOTE
                  : 'No UPI app on this phone — scan the QR with a UPI app on another phone.'
              }
            />
          ) : (
            <Button title="Confirm extension" onPress={() => pay('default')} loading={!!payMode} disabled={changing} />
          )
        )}
      </View>

      {/* Item 2 — pay the extension by scanning a UPI QR with another phone */}
      <UpiQrPayModal
        target={qrExtensionId ? { extensionId: qrExtensionId } : null}
        expectedAmount={quote ? Number(quote.pricing.additionalAmount) : null}
        subtitle={
          quote
            ? `${[make, model].filter(Boolean).join(' ') || 'Your trip'} · new return ${fmtWhen(quote.requestedEndAt)}`
            : undefined
        }
        canPayAnotherWay
        onExit={handleQrExit}
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

  choicesLoader: { alignSelf: 'flex-start', paddingVertical: 8 },

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

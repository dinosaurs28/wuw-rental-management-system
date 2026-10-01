import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../constants/colors';
import {
  vehiclesApi,
  userApi,
  paymentApi,
  couponRejection,
  type CouponPreviewPricing,
  type CustomerBookingCreateResponse,
  type RazorpayOrder,
} from '../../lib/api';
import { paymentOptionsFor, pickFlow, serverPaymentOptions } from '../../lib/paymentPlan';
import { durationDiscountText, quoteDiscountLines } from '../../lib/discounts';
import {
  CHECKING_PAYMENT_TEXT,
  QR_CANCEL_POLL_DELAYS,
  openRazorpayCheckout,
  isCheckoutCancelled,
  type CheckoutMode,
} from '../../lib/razorpay';
import { durationLabel } from '../../lib/pricing';
import { rangeLengthLabel, startOfDay } from '../../lib/dates';
import { useAuthStore } from '../../store/auth';
import { SignInRequired, useIsGuest } from '../../lib/auth-gate';
import { profileIncompleteMessage } from '../../lib/identity';
import { gstLabel, gstNumber, inrExact, round2 } from '../../lib/gst';
import StudioImage from '../../components/cars/StudioImage';
import { BranchHoursLine, TimesNotice } from '../../components/booking/BranchHours';
import { useBranchSchedule } from '../../hooks/useBranchSchedule';
import { rangeHoursLine } from '../../lib/branchSchedule';
import RazorpayPayOptions from '../../components/payments/RazorpayPayOptions';
import Button from '../../components/ui/Button';
import { LEGAL_URLS } from '../../constants/links';
import type { VehicleDetail, KycDocument, UserProfile, PaymentFlow, PaymentOptions } from '../../types/api';

// The backend still accepts a pickup a little earlier today, so only a pickup
// well in the past (or on an earlier day) sends the customer back to re-pick.
const PICKUP_GRACE_MS = 15 * 60 * 1000;

const PRICE_UNAVAILABLE_TEXT =
  "We couldn't price this rental for these dates, so it can't be paid yet. Go back and choose the dates again.";

// GST of a coupon preview (validate `data.pricing`, numbers) — the coupon is
// taken off before GST, so these replace the vehicle quote's GST figures.
type CouponGst = { taxable: number; tax: number; cgst: number; sgst: number; rate: number | null };

function couponGstFrom(p: any): CouponGst | null {
  const taxable = gstNumber(p?.taxableAmount);
  const tax = gstNumber(p?.taxAmount);
  if (taxable === null || tax === null) return null; // older server: no breakdown
  return {
    taxable,
    tax,
    cgst: gstNumber(p?.cgstAmount) ?? 0,
    sgst: gstNumber(p?.sgstAmount) ?? 0,
    rate: gstNumber(p?.taxRate),
  };
}

// A coupon the server priced for this booking (#20): its re-priced breakdown
// and the payment plans the post-coupon total leaves (#6).
type AppliedCoupon = {
  code: string;
  amount: number;
  gst?: CouponGst | null;
  pricing?: CouponPreviewPricing | null;
  paymentOptions?: PaymentOptions | null;
};

// Plans this booking may be paid with: the server's paymentOptions (the
// coupon preview's once a coupon is applied — the total moved), else the
// local mirror of the same rules for an older server.
function checkoutPaymentOptions(
  vehicle: VehicleDetail,
  coupon: AppliedCoupon | null,
  payableTotal: number | null,
): PaymentOptions {
  const server = coupon ? serverPaymentOptions(coupon.paymentOptions) : serverPaymentOptions(vehicle.paymentOptions);
  return paymentOptionsFor(server, {
    mode: vehicle.customerPaymentMode,
    advanceAmount: vehicle.advancePayAmount ?? 0,
    payableTotal,
  });
}

// Alert as a yes/no question (dismissing it counts as no).
function askToContinue(title: string, message: string, okText: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: okText, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

function DateInput({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.dateInput}>
      <Text style={styles.dateLabel}>{label}</Text>
      <Text style={styles.dateValue}>{value || 'Select date'}</Text>
    </View>
  );
}

function LineItem({
  label,
  value,
  bold,
  credit,
}: {
  label: string;
  value: string;
  bold?: boolean;
  credit?: boolean;
}) {
  return (
    <View style={styles.lineItem}>
      <Text style={[styles.lineLabel, bold && styles.lineLabelBold]}>{label}</Text>
      <Text
        style={[
          styles.lineValue,
          bold && styles.lineValueBold,
          credit && styles.lineValueCredit,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

export default function Checkout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // `branch`: the vehicle's branch from the previous screen (office hours
  // fallback); `adjusted`: set when the return was moved to fit branch hours.
  const { vehicleId, start, end, branch: branchParam, adjusted } = useLocalSearchParams<{
    vehicleId: string; start?: string; end?: string; branch?: string; adjusted?: string;
  }>();
  // Booking is account-based (the API requires a token, KYC and a complete
  // profile). Normally requireAuth on the vehicle CTA stops a guest before
  // they get here; this guards a deep link or a restored navigation state.
  const isGuest = useIsGuest();

  const fmt = (d: Date) =>
    d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  const [startDate] = useState(() => (start ? new Date(start) : new Date(Date.now() + 86400 * 1000)));
  const [endDate] = useState(() => (end ? new Date(end) : new Date(Date.now() + 2 * 86400 * 1000)));
  const [loading, setLoading] = useState(false);
  const [payMode, setPayMode] = useState<CheckoutMode>('default');
  const [startPassed, setStartPassed] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  // The pay footer grows with the QR option / no-UPI note; keep content clear of it.
  const [ctaHeight, setCtaHeight] = useState(0);
  // #36 — which uploaded KYC doc to submit (defaults to the first)
  const [selectedKycId, setSelectedKycId] = useState<string | null>(null);

  // Coupon
  const [couponInput, setCouponInput] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);

  // Payment plan (#6) + terms. null = not picked: the branch's default plan
  // (FULL when it offers both), clamped to the plans it allows (pickFlow).
  const [flow, setFlow] = useState<PaymentFlow | null>(null);
  const [terms, setTerms] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const isGroupKey = !!vehicleId && vehicleId.includes('__');

  const { data: vehicle, isLoading: vehicleLoading } = useQuery({
    queryKey: ['vehicle', vehicleId, startDate.toISOString(), endDate.toISOString()],
    queryFn: () =>
      isGroupKey
        ? vehiclesApi.groupDetail(vehicleId!, { start: startDate.toISOString(), end: endDate.toISOString() })
        : vehiclesApi.detail(vehicleId!, { start: startDate.toISOString(), end: endDate.toISOString() }),
    select: (res) => {
      const d = res.data.data as any;
      // advancePayAmount is a Decimal STRING on the wire — parse it like the group branch below.
      if (!isGroupKey) return { ...d, advancePayAmount: Number(d.advancePayAmount ?? 0) } as VehicleDetail;
      const images: string[] = (d.imageUrl ?? d.images ?? [])
        .map((img: any) => (typeof img === 'string' ? img : img?.file?.url ?? null))
        .filter(Boolean);
      return {
        publicId: d.groupKey,
        make: d.make,
        model: d.model,
        category: d.category,
        branch: d.branch,
        images,
        pricing: { daily: d.pricing?.daily ?? null },
        availability: d.availability,
        status: 'AVAILABLE',
        deposit: d.deposit ?? 0,
        advancePayAmount: Number(d.advancePayAmount ?? 0),
        // Branch payment plan (#6) — the group branch used to drop these.
        customerPaymentMode: d.customerPaymentMode,
        paymentOptions: d.paymentOptions ?? null,
        pricingDetails: d.pricingDetails ?? null,
        branchPublicId: d.branchPublicId ?? null,
      } as VehicleDetail;
    },
    enabled: !!vehicleId,
  });

  // Branch office hours (#2) for the itinerary line.
  const branchPublicId = vehicle?.branchPublicId ?? branchParam ?? null;
  const { data: schedule } = useBranchSchedule(branchPublicId);

  // Back to the vehicle page to pick new times.
  const changeTimes = () => (router.canGoBack() ? router.back() : router.replace(`/vehicle/${vehicleId}`));

  const { data: kyc, isLoading: kycLoading } = useQuery({
    queryKey: ['kyc'],
    queryFn: () => userApi.kyc(),
    select: (res) => (res.data.data ?? []) as KycDocument[],
    enabled: !isGuest,
  });

  // Prefills the Razorpay sheet and drives the profile-complete pre-check (#1) —
  // shares the ['profile'] cache with the profile tab, and a failure to load
  // must never block checkout (the server still enforces the rule).
  const { data: profile, refetch: refetchProfile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => userApi.profile(),
    select: (res) => res.data as UserProfile,
    enabled: !isGuest,
  });
  const authUser = useAuthStore((s) => s.user);

  // Prices the coupon on the server for the plan the customer has picked
  // (signed in: the customer's own coupons and limits apply). `recheck`: the
  // coupon is already applied and the plan changed — drop it if it no longer fits.
  const previewCoupon = async (code: string, plan: PaymentFlow, recheck = false) => {
    if (!code || !vehicle) return;
    setCouponBusy(true);
    setCouponError(null);
    try {
      const res = await vehiclesApi.validateCoupon({
        couponCode: code,
        ...(isGroupKey ? { groupKey: vehicle.publicId } : { vehiclePublicId: vehicle.publicId }),
        startAt: startDate.toISOString(),
        endAt: endDate.toISOString(),
        paymentFlow: plan,
      });
      if (!mountedRef.current) return;
      const d = res.data?.data;
      if (d?.valid) {
        setAppliedCoupon({
          code: d.couponCode ?? code.toUpperCase(),
          amount: Number(d.discountAmount ?? 0),
          // The coupon is pre-GST: the preview's post-coupon GST replaces the quote's
          gst: couponGstFrom(d.pricing),
          // Totals and plans come from the server's re-priced breakdown (#20/#6)
          pricing: d.pricing ?? null,
          paymentOptions: serverPaymentOptions(d.paymentOptions),
        });
        setCouponInput('');
      } else {
        if (recheck) setAppliedCoupon(null);
        setCouponError(
          recheck && d?.reason
            ? `${code} was removed: ${d.reason}`
            : d?.reason ?? 'This coupon is not valid for this booking.',
        );
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      setCouponError(
        err?.response?.data?.message ??
          (recheck ? 'Could not re-check the coupon for this payment plan.' : 'Could not validate coupon.'),
      );
    } finally {
      if (mountedRef.current) setCouponBusy(false);
    }
  };

  const applyCoupon = () => {
    if (!vehicle) return;
    const pd = vehicle.pricingDetails;
    const plan = pickFlow(flow, checkoutPaymentOptions(vehicle, null, pd ? round2(pd.finalTotal + pd.deposit) : null));
    void previewCoupon(couponInput.trim(), plan);
  };

  // Some coupons are for one plan only (COUPON_PAYMENT_PLAN_MISMATCH), so a
  // plan change re-checks the applied coupon.
  const selectFlow = (next: PaymentFlow) => {
    if (couponBusy) return;
    setFlow(next);
    if (appliedCoupon) void previewCoupon(appliedCoupon.code, next, true);
  };

  // Not a sign-in problem: the profile is missing fields (e.g. DL / Aadhaar
  // number). Saving the profile returns here (profile/edit goes back).
  const promptCompleteProfile = (message: string) => {
    Alert.alert('Complete your profile', message, [
      { text: 'Go to Profile', onPress: () => router.push('/profile/edit') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleBook = async (mode: CheckoutMode) => {
    if (!vehicle) return;
    // Checkout left open too long: the pickup time is now in the past. The
    // vehicle page re-normalises the times, so send the customer back there.
    const now = new Date();
    if (startDate.getTime() < now.getTime() - PICKUP_GRACE_MS || startDate < startOfDay(now)) {
      setStartPassed(true);
      return;
    }
    // #1 — the server refuses an incomplete profile (403 PROFILE_INCOMPLETE);
    // say so before the customer gets to payment.
    if (profile && !profile.isProfileCompleted) {
      // The cached copy may predate an update made elsewhere (e.g. the web) — recheck.
      const latest = (await refetchProfile()).data ?? profile;
      if (!latest.isProfileCompleted) {
        promptCompleteProfile(profileIncompleteMessage(latest.missingFields ?? [], 'self'));
        return;
      }
    }
    if (!kyc || kyc.length === 0) {
      Alert.alert(
        'KYC required',
        'You need to upload a driving license or ID document before booking. Please go to Profile → Documents.',
        [
          { text: 'Go to Profile', onPress: () => router.push('/(tabs)/profile') },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }
    if (!terms) {
      Alert.alert('Accept terms', 'Please accept the Terms & Conditions to continue.');
      return;
    }
    // No server price (e.g. the branch has no GST rule): the total incl. GST is
    // unknown, so never start a payment against a guessed amount.
    if (!vehicle.pricingDetails) {
      Alert.alert('Price unavailable', PRICE_UNAVAILABLE_TEXT);
      return;
    }

    // Recompute advance validity at submit time using the SAME fallback as the
    // displayed total, so the sent payment_flow can never diverge from the
    // pay-now amount shown in the CTA (even when pricingDetails is null).
    const pdNow = vehicle.pricingDetails;
    const daysNow = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000));
    const durationNow =
      durationLabel(pdNow?.pricingBreakdown?.duration) ?? rangeLengthLabel(startDate, endDate) ?? '';
    const dailyNow = pdNow?.pricingBreakdown?.applicablePrice ?? vehicle.pricing?.daily ?? 0;
    const subtotalNow = pdNow ? pdNow.basePrice : dailyNow * daysNow;
    const depositNow = pdNow?.deposit ?? 0;
    const taxNow = pdNow?.taxAmount ?? 0; // never a guessed rate — no pricing is blocked above
    const baseTotalNow = pdNow ? pdNow.finalTotal + depositNow : subtotalNow + depositNow + taxNow;
    // With a coupon the server's re-priced total wins — the coupon comes off
    // before GST, so subtracting it from the GST-inclusive total would be wrong.
    const totalNow = appliedCoupon?.pricing
      ? appliedCoupon.pricing.payableTotal
      : Math.max(0, baseTotalNow - (appliedCoupon?.amount ?? 0));
    // The plan shown selected: the branch's allowed plans for this total (#6).
    // The server re-decides and converts (never rejects) a plan it won't take.
    const sendFlow: PaymentFlow = pickFlow(flow, checkoutPaymentOptions(vehicle, appliedCoupon, totalNow));

    // #36 — submit the customer-chosen KYC doc (default: first).
    const chosenKyc = kyc.find((k) => k.publicId === selectedKycId) ?? kyc[0]!;

    setPayMode(mode);
    setLoading(true);
    try {
      const res = await vehiclesApi.createBooking({
        vehicles: isGroupKey ? [] : [vehicle.publicId],
        groupKeys: isGroupKey ? [vehicle.publicId] : [],
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        file_public_id: chosenKyc.file.publicId,
        payment_type: 'ONLINE',
        payment_flow: sendFlow,
        ...(appliedCoupon ? { couponCode: appliedCoupon.code } : {}),
      });

      const created = res.data as CustomerBookingCreateResponse;
      const { holdId, data } = created;
      const totals = data?.totals ?? {};
      const transactionId: string | undefined = totals.transactionId;
      const rzp: RazorpayOrder | null | undefined = totals.razorpay;
      // The plan actually charged — the server may have converted the one sent.
      const chargedFlow: PaymentFlow =
        created.isAdvancePayment != null ? (created.isAdvancePayment ? 'ADVANCE' : 'FULL') : created.payment_flow ?? sendFlow;
      const payNowAmount = totals.payNowAmount ?? (chargedFlow === 'ADVANCE' ? totals.advanceAmount : totals.grandFinalTotal);

      const confirmParams = {
        holdId,
        make: vehicle.make,
        model: vehicle.model,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        total: String(totals.grandFinalTotal ?? ''),
        deposit: String(totals.grandDeposit ?? ''),
        payNow: String(payNowAmount ?? ''),
        remaining: String(totals.dueAtPickup ?? totals.remainingBalance ?? 0),
        flow: chargedFlow,
        coupon: totals.appliedCouponCode ?? '',
      };

      if (!transactionId || !rzp?.orderId || !rzp?.keyId) {
        Alert.alert('Payment error', 'Could not initiate payment. Please try again or contact support.');
        return;
      }

      // #43 — release the inventory hold immediately instead of waiting 10 min to expire.
      const releaseHold = async () => {
        try { await userApi.cancelHold(holdId); } catch { /* best-effort */ }
      };

      // #6 — the branch (or the amounts) didn't allow the plan shown: say what
      // will be charged before opening the payment sheet.
      if (created.paymentFlowAdjusted) {
        setFlow(chargedFlow);
        const amountText = payNowAmount != null ? inrExact(payNowAmount) : null;
        const proceed = await askToContinue(
          'Payment plan changed',
          `${created.paymentFlowAdjustMessage ?? 'This booking uses a different payment plan.'}` +
            (amountText ? ` You'll pay ${amountText} now.` : ''),
          amountText ? `Pay ${amountText}` : 'Continue',
        );
        if (!proceed) {
          await releaseHold();
          return;
        }
      }

      let payment;
      try {
        payment = await openRazorpayCheckout(
          {
            key: rzp.keyId,
            order_id: rzp.orderId,
            amount: rzp.amount,
            currency: rzp.currency,
            description: durationNow ? `${vehicle.make} ${vehicle.model} · ${durationNow}` : `${vehicle.make} ${vehicle.model}`,
            prefill: {
              name: profile?.name ?? authUser?.name ?? '',
              email: profile?.email ?? authUser?.email ?? '',
              contact: profile?.phone ?? '',
            },
          },
          { mode },
        );
      } catch (rzpErr: any) {
        // Razorpay rejects for both user cancellation and real failures.
        const cancelled = isCheckoutCancelled(rzpErr);
        // A QR cancel is often this phone's sheet being closed after the QR was
        // paid from another phone — check before releasing the hold.
        if (cancelled && mode === 'qr') {
          setCheckingPayment(true);
          let paid = false;
          for (const delay of QR_CANCEL_POLL_DELAYS) {
            if (!mountedRef.current) return;
            try {
              const status = (await paymentApi.status(transactionId)).data?.status;
              if (status === 'Success') { paid = true; break; }
              if (status === 'Failed') break;
            } catch { /* transient — keep checking */ }
            await new Promise((r) => setTimeout(r, delay));
          }
          if (!mountedRef.current) return;
          setCheckingPayment(false);
          if (paid) {
            router.replace({ pathname: '/booking/payment-status', params: { transactionId, ...confirmParams } });
            return;
          }
        }
        await releaseHold();
        if (!mountedRef.current) return;
        const description: string = rzpErr?.description ?? '';
        if (cancelled) {
          Alert.alert('Payment cancelled', 'You closed the payment page, so the booking hold was released.');
        } else {
          Alert.alert('Payment failed', description || 'The payment could not be completed. Please try again.');
        }
        return;
      }

      // Confirm the signature server-side. A failure here is not fatal — the
      // status screen still polls, and the Razorpay webhook may confirm late.
      let verified = false;
      try {
        await userApi.verifyRazorpaySignature({
          razorpay_order_id: payment.razorpay_order_id ?? rzp.orderId,
          razorpay_payment_id: payment.razorpay_payment_id,
          razorpay_signature: payment.razorpay_signature ?? '',
        });
        verified = true;
      } catch { /* fall through to polling */ }

      // #38 — hand off to the dedicated status screen (polls + success/pending/failed states).
      if (!mountedRef.current) return;
      router.replace({
        pathname: '/booking/payment-status',
        params: { transactionId, ...(verified ? { verified: '1' } : {}), ...confirmParams },
      });
    } catch (err: any) {
      // #20 — the coupon stopped being valid (expired, limit reached, wrong
      // plan…). Refused before any payment: drop it and show the new total.
      const rejected = couponRejection(err);
      if (rejected) {
        setAppliedCoupon(null);
        setCouponError(rejected.message);
        Alert.alert(
          'Coupon removed',
          `${rejected.message}\n\nYou have not been charged. Check the new total, then pay again.`,
        );
        return;
      }
      if (err?.response?.data?.code === 'PROFILE_INCOMPLETE') {
        void refetchProfile(); // the cached copy was out of date — refresh the banner
        promptCompleteProfile(
          err.response.data.message ??
            profileIncompleteMessage(err.response.data.missingFields ?? [], 'self'),
        );
        return;
      }
      const body = err?.response?.data;
      // #2 — the return falls outside branch hours: the server proposes the
      // next in-hours return. Reopen checkout with it so the new price shows
      // before the customer pays again.
      if (body?.code === 'BRANCH_SCHEDULE_RETURN_ADJUSTED' && body?.verdict?.adjustedReturn) {
        const adjustedReturn = String(body.verdict.adjustedReturn);
        const label: string = body.verdict.nextOpenLabel ?? 'the new time';
        Alert.alert('Return time adjusted', body.message ?? `The branch is closed at your return time. Return at ${label} instead?`, [
          { text: 'Change times', style: 'cancel', onPress: changeTimes },
          {
            text: `Use ${label}`,
            onPress: () =>
              router.replace({
                pathname: '/booking/checkout',
                params: {
                  vehicleId,
                  start: startDate.toISOString(),
                  end: adjustedReturn,
                  adjusted: label,
                  ...(branchPublicId ? { branch: branchPublicId } : {}),
                },
              }),
          },
        ]);
        return;
      }
      // #2 / #15 — pickup outside branch hours, or past the 15-day limit.
      if (
        body?.code === 'BRANCH_SCHEDULE_VIOLATION' ||
        body?.code === 'BOOKING_MAX_PERIOD_EXCEEDED' ||
        body?.code === 'INVALID_DATES'
      ) {
        Alert.alert(
          body.code === 'BOOKING_MAX_PERIOD_EXCEEDED' ? 'Booking period too long' : body.code === 'INVALID_DATES' ? 'Check your dates' : 'Outside branch hours',
          body.message ?? 'Please choose different times.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Change times', onPress: changeTimes },
          ],
        );
        return;
      }
      Alert.alert('Booking failed', err.response?.data?.message ?? 'Unable to complete booking. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // No token — never render a half-initialised checkout. Signing in brings the
  // user back to the car they were booking.
  if (isGuest) {
    return (
      <SignInRequired
        title="Sign in to book"
        description="Booking a vehicle needs an account so we can verify your documents and hold the car for you."
        icon="car-outline"
        returnTo={vehicleId ? `/vehicle/${vehicleId}` : undefined}
      />
    );
  }

  if (vehicleLoading || kycLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.orange} size="large" />
      </View>
    );
  }

  if (!vehicle) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Vehicle not found.</Text>
      </View>
    );
  }

  const days = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000));
  const pd = vehicle.pricingDetails;
  const durationText =
    durationLabel(pd?.pricingBreakdown?.duration) ?? rangeLengthLabel(startDate, endDate) ?? `${days} day${days !== 1 ? 's' : ''}`;
  const daily = pd?.pricingBreakdown?.applicablePrice ?? vehicle.pricing?.daily ?? 0;
  const subtotal = pd ? pd.basePrice : daily * days;
  const deposit = pd?.deposit ?? 0;
  const tax = pd?.taxAmount ?? 0; // no pricing ⇒ "GST not available" and payment is blocked
  // The server's re-priced breakdown once a coupon is applied (#20).
  const couponPricing = appliedCoupon?.pricing ?? null;
  const couponDiscount = couponPricing?.couponDiscountAmount ?? appliedCoupon?.amount ?? 0;
  const baseTotal = pd ? pd.finalTotal + deposit : subtotal + deposit + tax;
  // The coupon comes off before GST, so the post-coupon total is the server's,
  // never baseTotal − coupon (only an older server without a breakdown).
  const total = couponPricing ? couponPricing.payableTotal : Math.max(0, baseTotal - couponDiscount);
  // GST lines exactly as the server priced them (#23): taxable value after all
  // discounts, then CGST/SGST. With a coupon, the coupon preview's figures.
  const gstView: CouponGst | null =
    appliedCoupon?.gst ??
    (pd
      ? {
          taxable: round2(pd.basePrice - pd.discountAmount),
          tax: pd.taxAmount,
          cgst: pd.cgstAmount,
          sgst: pd.sgstAmount,
          rate: pd.taxRate,
        }
      : null);

  const chosenKyc = kyc?.find((k) => k.publicId === selectedKycId) ?? kyc?.[0] ?? null;
  // Payment plan (#6): only what the branch allows for this total — a chooser
  // only when it offers both (FULL preselected); handleBook sends the same plan.
  const payOptions = checkoutPaymentOptions(vehicle, appliedCoupon, pd ? total : null);
  const effectiveFlow: PaymentFlow = pickFlow(flow, payOptions);
  const advanceAmount = payOptions.advanceAmount;
  const payNow = effectiveFlow === 'ADVANCE' ? advanceAmount : total;
  const remainingAtPickup =
    effectiveFlow === 'ADVANCE' ? payOptions.remainingAfterAdvance ?? Math.max(0, round2(total - advanceAmount)) : 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Checkout</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(120, ctaHeight + 24) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Car summary */}
        <View style={styles.section}>
          <View style={styles.carRow}>
            <StudioImage uri={vehicle.images?.[0]} radius={10} contain style={styles.carThumb} />
            <View style={styles.carInfo}>
              <Text style={styles.carName}>{vehicle.make} {vehicle.model}</Text>
              <Text style={styles.carMeta}>{vehicle.category} · {vehicle.branch}</Text>
            </View>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={styles.editLink}>Edit</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Dates */}
        <Text style={styles.sectionTitle}>Rental period</Text>
        <View style={styles.datesRow}>
          <DateInput label="Pick up" value={fmt(startDate)} />
          <View style={styles.dateSep}>
            <Ionicons name="arrow-forward" size={16} color={Colors.ink3} />
          </View>
          <DateInput label="Return" value={fmt(endDate)} />
        </View>
        {/* #2 — branch hours for these days; a note when the return was moved to fit them */}
        <View style={styles.hoursWrap}>
          <BranchHoursLine text={rangeHoursLine(schedule, startDate, endDate)} />
          {adjusted ? (
            <TimesNotice
              notice={{ tone: 'warn', text: `Return moved to ${adjusted} to fit branch hours. The price below is for the new return time.` }}
            />
          ) : null}
        </View>

        {/* #1 — profile incomplete (e.g. no DL / Aadhaar number): booking is refused until it is fixed */}
        {profile && !profile.isProfileCompleted && (
          <TouchableOpacity
            style={[styles.kycBanner, styles.kycMissing]}
            onPress={() => router.push('/profile/edit')}
            activeOpacity={0.85}
          >
            <Text style={[styles.kycText, styles.kycTextMissing]}>
              {profileIncompleteMessage(profile.missingFields ?? [], 'self')} Tap to update your profile.
            </Text>
          </TouchableOpacity>
        )}

        {/* KYC status */}
        <View style={[styles.kycBanner, kyc && kyc.length > 0 ? styles.kycOk : styles.kycMissing]}>
          <Text style={[styles.kycText, kyc && kyc.length > 0 ? styles.kycTextOk : styles.kycTextMissing]}>
            {kyc && kyc.length > 0
              ? `Identity verified (${kyc.length} doc${kyc.length > 1 ? 's' : ''})`
              : 'Upload a driving license to continue'}
          </Text>
        </View>

        {/* #36 — pick which KYC doc to submit when more than one is on file */}
        {kyc && kyc.length > 1 && (
          <>
            <Text style={styles.sectionTitle}>Document to submit</Text>
            <View style={{ gap: 8 }}>
              {kyc.map((doc) => {
                const selected = doc.publicId === (chosenKyc?.publicId ?? null);
                return (
                  <TouchableOpacity
                    key={doc.publicId}
                    style={[styles.kycPick, selected && styles.kycPickActive]}
                    onPress={() => setSelectedKycId(doc.publicId)}
                    activeOpacity={0.85}
                  >
                    <Image source={{ uri: doc.file.url }} style={styles.kycPickThumb} resizeMode="cover" />
                    <View style={styles.kycPickInfo}>
                      <Text style={styles.kycPickType}>
                        {doc.type.replace(/_/g, ' ')}{doc.side ? ` · ${doc.side}` : ''}
                      </Text>
                      <Text style={styles.kycPickStatus}>{doc.status}</Text>
                    </View>
                    <Ionicons
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={selected ? Colors.orange : Colors.ink4}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {/* Coupon */}
        <Text style={styles.sectionTitle}>Coupon</Text>
        {appliedCoupon ? (
          <View style={styles.couponApplied}>
            <Ionicons name="pricetag" size={16} color="#2d9d61" />
            <Text style={styles.couponAppliedText}>
              <Text style={styles.couponCode}>{appliedCoupon.code}</Text> applied · {inrExact(couponDiscount)} off before GST
            </Text>
            <TouchableOpacity
              onPress={() => { setAppliedCoupon(null); setCouponError(null); }}
              disabled={couponBusy}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={18} color={Colors.ink4} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.couponRow}>
            <TextInput
              style={styles.couponInput}
              value={couponInput}
              onChangeText={(t) => { setCouponInput(t); setCouponError(null); }}
              placeholder="Enter coupon code"
              placeholderTextColor={Colors.ink4}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.couponBtn, (!couponInput.trim() || couponBusy) && styles.couponBtnDisabled]}
              onPress={applyCoupon}
              disabled={!couponInput.trim() || couponBusy}
              activeOpacity={0.85}
            >
              {couponBusy ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.couponBtnText}>Apply</Text>}
            </TouchableOpacity>
          </View>
        )}
        {couponError && <Text style={styles.couponErrorText}>{couponError}</Text>}

        {/* Price breakdown */}
        <Text style={styles.sectionTitle}>Price breakdown</Text>
        <View style={styles.priceCard}>
          <LineItem
            label={pd ? `Base rate (${pd.pricingBreakdown?.billedAs ?? durationText})` : `₹${daily.toLocaleString('en-IN')} × ${days} day${days > 1 ? 's' : ''}`}
            value={`₹${(pd?.basePrice ?? daily * days).toLocaleString('en-IN')}`}
          />
          {/* Duration slab named (#24). With a coupon, the server's re-priced
              layers — a slab the coupon replaced (no stacking) is not shown. */}
          {couponPricing
            ? !couponPricing.durationSuppressed &&
              couponPricing.durationDiscountAmount > 0 && (
                <LineItem
                  label={durationDiscountText({ ...couponPricing, durationDiscountType: pd?.durationDiscountType ?? null })}
                  value={`−${inrExact(couponPricing.durationDiscountAmount)}`}
                  credit
                />
              )
            : pd &&
              quoteDiscountLines(pd).map((l) => (
                <LineItem key={l.label} label={l.label} value={`−${inrExact(l.amount)}`} credit />
              ))}
          {couponDiscount > 0 && (
            <LineItem label={`Coupon (${appliedCoupon!.code})`} value={`−${inrExact(couponDiscount)}`} credit />
          )}
          {gstView ? (
            <>
              <LineItem label="Taxable value" value={inrExact(gstView.taxable)} />
              {gstView.cgst > 0 || gstView.sgst > 0 ? (
                <>
                  <LineItem label={gstLabel('CGST', pd?.cgstRate)} value={inrExact(gstView.cgst)} />
                  <LineItem label={gstLabel('SGST', pd?.sgstRate)} value={inrExact(gstView.sgst)} />
                </>
              ) : (
                <LineItem label={gstLabel('GST', gstView.rate)} value={inrExact(gstView.tax)} />
              )}
            </>
          ) : (
            <LineItem label="GST" value="Not available" />
          )}
          <LineItem label="Deposit (refundable, no GST)" value={inrExact(deposit)} />
          {!pd && <Text style={styles.priceUnavailable}>{PRICE_UNAVAILABLE_TEXT}</Text>}
          <View style={styles.divider} />
          <LineItem label="Total" value={`₹${total.toLocaleString('en-IN')}`} bold />
        </View>

        {/* Payment plan (#6) — the branch's plans for this total. Two cards only
            when it offers both; otherwise the one plan that will be charged. */}
        {pd && (
          <>
            <Text style={styles.sectionTitle}>Payment plan</Text>
            <View style={styles.planRow}>
              {payOptions.allowedFlows.includes('FULL') && (
                <TouchableOpacity
                  style={[styles.planCard, effectiveFlow === 'FULL' && styles.planCardActive]}
                  onPress={() => effectiveFlow !== 'FULL' && selectFlow('FULL')}
                  disabled={payOptions.allowedFlows.length < 2 || couponBusy}
                  activeOpacity={0.85}
                >
                  <View style={styles.planTop}>
                    <Text style={[styles.planTitle, effectiveFlow === 'FULL' && styles.planTitleActive]}>Pay full</Text>
                    {effectiveFlow === 'FULL' && <Ionicons name="checkmark-circle" size={18} color={Colors.orange} />}
                  </View>
                  <Text style={styles.planAmount}>{inrExact(total)}</Text>
                  <Text style={styles.planNote}>Nothing due at pickup</Text>
                </TouchableOpacity>
              )}
              {payOptions.allowedFlows.includes('ADVANCE') && (
                <TouchableOpacity
                  style={[styles.planCard, effectiveFlow === 'ADVANCE' && styles.planCardActive]}
                  onPress={() => effectiveFlow !== 'ADVANCE' && selectFlow('ADVANCE')}
                  disabled={payOptions.allowedFlows.length < 2 || couponBusy}
                  activeOpacity={0.85}
                >
                  <View style={styles.planTop}>
                    <Text style={[styles.planTitle, effectiveFlow === 'ADVANCE' && styles.planTitleActive]}>Pay advance</Text>
                    {effectiveFlow === 'ADVANCE' && <Ionicons name="checkmark-circle" size={18} color={Colors.orange} />}
                  </View>
                  <Text style={styles.planAmount}>{inrExact(advanceAmount)}</Text>
                  <Text style={styles.planNote}>
                    {inrExact(payOptions.remainingAfterAdvance ?? Math.max(0, round2(total - advanceAmount)))} at pickup
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            {payOptions.reasonMessage ? <Text style={styles.planReason}>{payOptions.reasonMessage}</Text> : null}
          </>
        )}

        {/* Terms */}
        <TouchableOpacity style={styles.termsRow} onPress={() => setTerms((t) => !t)} activeOpacity={0.8}>
          <View style={[styles.checkbox, terms && styles.checkboxOn]}>
            {terms && <Ionicons name="checkmark" size={13} color={Colors.white} />}
          </View>
          <Text style={styles.termsText}>
            I agree to the{' '}
            <Text style={styles.termsLink} onPress={() => WebBrowser.openBrowserAsync(LEGAL_URLS.terms)}>
              Terms & Conditions
            </Text>{' '}
            and{' '}
            <Text style={styles.termsLink} onPress={() => Linking.openURL(LEGAL_URLS.privacy)}>
              Privacy Policy
            </Text>
            .
          </Text>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          Payment is processed securely via Razorpay. Deposit will be refunded upon return.
        </Text>
      </ScrollView>

      {/* CTA */}
      <View
        style={[styles.cta, { paddingBottom: insets.bottom + 16 }]}
        onLayout={(e) => setCtaHeight(e.nativeEvent.layout.height)}
      >
        <View style={styles.ctaSummary}>
          <Text style={styles.ctaTotal}>₹{payNow.toLocaleString('en-IN')}</Text>
          <Text style={styles.ctaTotalNote}>
            {effectiveFlow === 'ADVANCE' ? `advance now · ${inrExact(remainingAtPickup)} at pickup` : `total · ${durationText}`}
          </Text>
        </View>
        {startPassed ? (
          <>
            <View style={styles.passedNote}>
              <Ionicons name="time-outline" size={16} color={Colors.availNone} />
              <Text style={styles.passedText}>Your pickup time has passed. Choose a new time.</Text>
            </View>
            <Button
              title="Choose a new time"
              onPress={() => (router.canGoBack() ? router.back() : router.replace(`/vehicle/${vehicleId}`))}
            />
          </>
        ) : (
          <RazorpayPayOptions
            payLabel="Confirm & pay"
            onPay={handleBook}
            disabled={loading || !terms || !pd || couponBusy}
            busyMode={loading ? payMode : null}
            busyLabel={checkingPayment ? CHECKING_PAYMENT_TEXT : undefined}
            noUpiNote="No UPI app on this phone — scan the QR with a UPI app on another phone."
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg },
  errorText: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
    backgroundColor: Colors.bg,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink, letterSpacing: -0.3 },
  scroll: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 120 },
  section: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  carRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  carThumb: { width: 64, height: 48, borderRadius: 10, overflow: 'hidden' },
  carThumbPlaceholder: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.hairline },
  carInfo: { flex: 1 },
  carName: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  carMeta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 2 },
  editLink: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.orange },
  sectionTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 16,
    color: Colors.ink,
    letterSpacing: -0.3,
    marginTop: 20,
    marginBottom: 10,
  },
  datesRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hoursWrap: { marginTop: 8, gap: 8 },
  dateInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  dateLabel: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  dateValue: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  dateSep: { paddingTop: 10 },
  kycBanner: { borderRadius: 12, padding: 12, marginTop: 16, borderWidth: 1 },
  kycOk: { backgroundColor: '#d4edda', borderColor: '#c3e6cb' },
  kycMissing: { backgroundColor: '#fff3cd', borderColor: '#ffc107' },
  kycText: { fontFamily: Fonts.bodyMedium, fontSize: 13 },
  kycTextOk: { color: '#1a7035' },
  kycTextMissing: { color: '#856404' },

  kycPick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.hairline,
    padding: 10,
  },
  kycPickActive: { borderColor: Colors.orange, backgroundColor: '#fff7f2' },
  kycPickThumb: { width: 48, height: 40, borderRadius: 8, backgroundColor: Colors.bg },
  kycPickInfo: { flex: 1 },
  kycPickType: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink, textTransform: 'capitalize' },
  kycPickStatus: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3, marginTop: 2 },

  // Coupon
  couponRow: { flexDirection: 'row', gap: 10 },
  couponInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: Fonts.bodyMedium,
    fontSize: 14,
    color: Colors.ink,
    letterSpacing: 0.5,
  },
  couponBtn: {
    backgroundColor: Colors.ink,
    borderRadius: 12,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  couponBtnDisabled: { opacity: 0.4 },
  couponBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.white },
  couponApplied: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#e8f5ee',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2d9d6130',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  couponAppliedText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: '#1a7035' },
  couponCode: { fontFamily: Fonts.bodySemiBold },
  couponErrorText: { fontFamily: Fonts.body, fontSize: 12, color: '#dc3545', marginTop: 8 },

  priceCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 10,
  },
  lineItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },
  lineLabelBold: { fontFamily: Fonts.bodySemiBold, color: Colors.ink, fontSize: 15 },
  lineValue: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  lineValueBold: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink },
  lineValueCredit: { color: '#2d9d61' },
  priceUnavailable: { fontFamily: Fonts.body, fontSize: 12, color: '#856404', lineHeight: 17 },
  divider: { height: 1, backgroundColor: Colors.hairline },

  // Payment plan
  planRow: { flexDirection: 'row', gap: 10 },
  planCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.hairline,
    padding: 14,
    gap: 4,
  },
  planCardActive: { borderColor: Colors.orange, backgroundColor: '#fff7f2' },
  planTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planTitle: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3 },
  planTitleActive: { color: Colors.ink, fontFamily: Fonts.bodySemiBold },
  planAmount: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink, letterSpacing: -0.4 },
  planNote: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3 },
  planReason: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 8, lineHeight: 17 },

  // Terms
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 20 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: Colors.ink4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  termsText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, lineHeight: 19 },
  termsLink: { fontFamily: Fonts.bodySemiBold, color: Colors.orange },

  disclaimer: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 16, lineHeight: 18, textAlign: 'center' },
  cta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
    paddingHorizontal: 20,
    paddingTop: 14,
    gap: 12,
  },
  ctaSummary: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  ctaTotal: { fontFamily: Fonts.displayBold, fontSize: 22, color: Colors.ink, letterSpacing: -0.5 },
  ctaTotalNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  passedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.availNoneSoft,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  passedText: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.availNone },
});

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
import { paymentOptionsFor, payNowSplit, payNowText, serverPaymentOptions } from '../../lib/paymentPlan';
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
import {
  BOOKING_PACKAGE_REQUIRED,
  BOOKING_PACKAGE_REQUIRED_MESSAGE,
  customerPackageFor,
} from '../../lib/bookingWindow';
import { useAuthStore } from '../../store/auth';
import { activeOfferCoupon, useOfferCouponStore } from '../../store/offerCoupon';
import { SignInRequired, useIsGuest } from '../../lib/auth-gate';
import { profileIncompleteMessage } from '../../lib/identity';
import { handleDlInUse } from '../../lib/dlInUse';
import { inrExact, rentGstNoteLines, rentInclGstView, round2 } from '../../lib/gst';
import StudioImage from '../../components/cars/StudioImage';
import { BranchHoursLine, TimesNotice } from '../../components/booking/BranchHours';
import { useBranchSchedule } from '../../hooks/useBranchSchedule';
import { bookingTimesNotice, rangeHoursLine } from '../../lib/branchSchedule';
import RazorpayPayOptions from '../../components/payments/RazorpayPayOptions';
import UpiQrPayModal, { type UpiQrExit } from '../../components/payments/UpiQrPayModal';
import { NO_UPI_APP_QR_NOTE, UPI_QR_OPTION_LABEL, useUpiQrAvailable } from '../../lib/upiQr';
import Button from '../../components/ui/Button';
import { LEGAL_URLS } from '../../constants/links';
import { isVehicleGroupKey } from '../../lib/shareLink';
import type { VehicleDetail, KycDocument, UserProfile, PaymentFlow, PaymentOptions } from '../../types/api';

// The backend still accepts a pickup a little earlier today, so only a pickup
// well in the past (or on an earlier day) sends the customer back to re-pick.
const PICKUP_GRACE_MS = 15 * 60 * 1000;

const PRICE_UNAVAILABLE_TEXT =
  "We couldn't price this rental for these dates, so it can't be paid yet. Go back and choose the dates again.";

// A coupon the server priced for this booking (#20): its re-priced breakdown
// and the payment plans the post-coupon total leaves (#6). `amount` is what it
// takes off the GST-inclusive rent (item 17: a ₹100 coupon is ₹100 off).
type AppliedCoupon = {
  code: string;
  amount: number;
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

// X2 — KYC photos are optional at checkout. NO_KYC = "don't attach a document".
const NO_KYC = '__none__';

/** The KYC document to attach: the chosen one, else the first uploaded; null for none. */
function pickKyc(docs: KycDocument[] | undefined, selectedId: string | null): KycDocument | null {
  if (selectedId === NO_KYC) return null;
  const usable = (docs ?? []).filter((d) => !!d.file?.publicId);
  return usable.find((d) => d.publicId === selectedId) ?? usable[0] ?? null;
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

// A booking hold created and waiting for its online payment: Razorpay
// Checkout, or (Item 2) the UPI QR screen — both pay the same order.
type PendingPayment = {
  holdId: string;
  transactionId: string;
  rzp: RazorpayOrder;
  confirmParams: Record<string, string>;
  description: string;
  payNow: number | null;
};

export default function Checkout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // `branch`: the vehicle's branch from the previous screen (office hours
  // fallback); `adjusted`: set when the return was moved to fit branch hours.
  const { vehicleId, start, end, branch: branchParam, adjusted } = useLocalSearchParams<{
    vehicleId: string; start?: string; end?: string; branch?: string; adjusted?: string;
  }>();
  // Booking is account-based (the API requires a token and a complete profile,
  // incl. the DL + Aadhaar numbers; KYC photos are optional — X2). Normally
  // requireAuth on the vehicle CTA stops a guest before
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
  // Item 2 — the hold being paid by a UPI QR scanned from another phone (the
  // QR screen is open while set). Offered when the server has it switched on.
  const [qrPayment, setQrPayment] = useState<PendingPayment | null>(null);
  const upiQrEnabled = useUpiQrAvailable(!isGuest);
  // The pay footer grows with the QR option / no-UPI note; keep content clear of it.
  const [ctaHeight, setCtaHeight] = useState(0);
  // #36 — which uploaded KYC doc to attach (defaults to the first). Optional
  // (X2): NO_KYC = the customer chose not to attach one.
  const [selectedKycId, setSelectedKycId] = useState<string | null>(null);

  // Coupon
  const [couponInput, setCouponInput] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);
  // #15 — a code picked with "Use code" on a home offer poster: filled in and
  // checked once the car is priced (the normal coupon check decides).
  const offerCoupon = useOfferCouponStore((s) => activeOfferCoupon(s.coupon));
  const loadOfferCoupon = useOfferCouponStore((s) => s.load);
  const clearOfferCoupon = useOfferCouponStore((s) => s.clear);
  const offerPrefilledRef = useRef(false);
  useEffect(() => {
    void loadOfferCoupon();
  }, [loadOfferCoupon]);

  // Terms. (No plan state: advance only — item 18 — the plan is the server's.)
  const [terms, setTerms] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Same group-key test as the vehicle page (a publicId can contain "__").
  const isGroupKey = !!vehicleId && isVehicleGroupKey(vehicleId);

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
  // Times the branch won't take (e.g. a pickup after the last pickup, 30 min
  // before closing) — said on the page, before the server refuses them.
  const timesIssue = (() => {
    const n = bookingTimesNotice(schedule, startDate, endDate);
    return n?.tone === 'error' ? n : null;
  })();

  // Customers book packages only (BRIEF4 P2): 12 hours or whole days. The
  // vehicle page always sends one; anything else (an old link) can't be booked.
  const bookedPackage = customerPackageFor(startDate, endDate);

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

  // Prices the coupon on the server for the plan shown (signed in: the
  // customer's own coupons and limits apply). `recheck`: the coupon is already
  // applied — drop it if it no longer fits.
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
          // Off the GST-inclusive rent (item 17); discountAmount is only its rent-without-GST part
          amount: Number(d.discountInclGst ?? d.discountAmount ?? 0),
          // Totals, the GST inside the rent and plans come from the server's re-priced breakdown (#20/#6)
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

  // The coupon is checked for the plan this booking is charged (item 18: the
  // advance whenever it's usable) — a full-payment-only coupon is refused
  // with the server's reason (COUPON_PAYMENT_PLAN_MISMATCH).
  const applyCoupon = (code?: string) => {
    if (!vehicle) return;
    const pd = vehicle.pricingDetails;
    const plan = checkoutPaymentOptions(vehicle, null, pd ? round2(pd.finalTotal + pd.deposit) : null).defaultFlow;
    void previewCoupon((code ?? couponInput).trim(), plan);
  };

  // #15 — fill in the offer code once per visit and check it like a typed one
  // (only once the car is priced: an unpriced checkout can't be paid anyway).
  useEffect(() => {
    if (offerPrefilledRef.current || isGuest || !offerCoupon || !vehicle) return;
    if (appliedCoupon || couponInput.trim()) return;
    offerPrefilledRef.current = true;
    setCouponInput(offerCoupon.code);
    if (vehicle.pricingDetails) applyCoupon(offerCoupon.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerCoupon, vehicle, isGuest]);

  // "Remove" on an offer code: stop filling it in at every checkout.
  const dropOfferCoupon = () => {
    clearOfferCoupon();
    setCouponInput('');
    setCouponError(null);
  };

  // Not a sign-in problem: the profile is missing fields (e.g. DL / Aadhaar
  // number). Saving the profile returns here (profile/edit goes back).
  const promptCompleteProfile = (message: string) => {
    Alert.alert('Complete your profile', message, [
      { text: 'Go to Profile', onPress: () => router.push('/profile/edit') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // #43 — release the inventory hold immediately instead of waiting 10 min to
  // expire. True when it can't be: a UPI QR already paid it (409
  // UPI_QR_ALREADY_PAID) and the booking is confirmed.
  const releaseHold = async (holdId: string): Promise<boolean> => {
    try {
      await userApi.cancelHold(holdId);
    } catch (err: any) {
      if (err?.response?.data?.code === 'UPI_QR_ALREADY_PAID') return true;
      /* otherwise best-effort */
    }
    return false;
  };

  // #38 — the dedicated status screen (polls + success/pending/failed states).
  const goToPaymentStatus = (p: PendingPayment, extra?: Record<string, string>) =>
    router.replace({
      pathname: '/booking/payment-status',
      params: { transactionId: p.transactionId, ...(extra ?? {}), ...p.confirmParams },
    });

  // Razorpay Checkout for the hold's order (also "Pay another way" from the
  // UPI QR screen). The hold is released when the payment doesn't go through.
  const payByCheckout = async (p: PendingPayment, mode: CheckoutMode) => {
    const { holdId, transactionId, rzp } = p;
    let payment;
    try {
      payment = await openRazorpayCheckout(
        {
          key: rzp.keyId,
          order_id: rzp.orderId,
          amount: rzp.amount,
          currency: rzp.currency,
          description: p.description,
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
          goToPaymentStatus(p);
          return;
        }
      }
      const paidByQr = await releaseHold(holdId);
      if (!mountedRef.current) return;
      if (paidByQr) {
        goToPaymentStatus(p);
        return;
      }
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

    if (!mountedRef.current) return;
    goToPaymentStatus(p, verified ? { verified: '1' } : undefined);
  };

  // Item 2 — the UPI QR screen closed: what follows for the hold.
  const handleQrExit = async (exit: UpiQrExit) => {
    const p = qrPayment;
    setQrPayment(null);
    if (!p) return;
    if (exit.kind === 'paid') {
      goToPaymentStatus(p);
      return;
    }
    if (exit.kind === 'another-way') {
      // The QR is closed; the same order (and hold) goes to Razorpay Checkout.
      setPayMode('default');
      setLoading(true);
      try {
        await payByCheckout(p, 'default');
      } finally {
        if (mountedRef.current) setLoading(false);
      }
      return;
    }
    if (exit.kind === 'refund') {
      // Paid twice: the other payment confirmed the booking (the QR one is refunded).
      if (exit.view.booking.status === 'CONFIRMED') {
        goToPaymentStatus(p);
        return;
      }
      // The refund notice was on the QR screen; the hold is over or unusable.
      if (await releaseHold(p.holdId)) goToPaymentStatus(p);
      return;
    }
    // Left without paying, or the hold ran out: release it (a QR that was
    // paid meanwhile turns this into a confirmed booking).
    const paidByQr = await releaseHold(p.holdId);
    if (!mountedRef.current) return;
    if (paidByQr) {
      goToPaymentStatus(p);
      return;
    }
    if (exit.kind === 'expired') {
      Alert.alert('Booking hold ended', exit.message);
    } else if (exit.message) {
      Alert.alert('Payment not started', `${exit.message}\n\nThe booking hold was released.`);
    } else {
      Alert.alert('Payment cancelled', 'You left the UPI QR payment, so the booking hold was released.');
    }
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
    // Not a 12-hour / whole-day package — the server would refuse it (P2).
    if (!bookedPackage) {
      Alert.alert('Choose a package', BOOKING_PACKAGE_REQUIRED_MESSAGE, [
        { text: 'Not now', style: 'cancel' },
        { text: 'Change times', onPress: changeTimes },
      ]);
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
    // With a coupon the server's re-priced total wins (its caps and rounding);
    // an older server without one: the inclusive coupon off the inclusive total.
    const totalNow = appliedCoupon?.pricing
      ? appliedCoupon.pricing.payableTotal
      : Math.max(0, baseTotalNow - (appliedCoupon?.amount ?? 0));
    // The plan shown (item 18: the advance whenever it's usable). The server
    // re-decides and converts (never rejects) it, flagging any difference.
    const sendFlow: PaymentFlow = checkoutPaymentOptions(vehicle, appliedCoupon, totalNow).defaultFlow;

    // #36 — attach the customer-chosen KYC doc (default: first), if any (X2: optional).
    const chosenKyc = pickKyc(kyc, selectedKycId);

    setPayMode(mode);
    setLoading(true);
    try {
      const res = await vehiclesApi.createBooking({
        vehicles: isGroupKey ? [] : [vehicle.publicId],
        groupKeys: isGroupKey ? [vehicle.publicId] : [],
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        // Only when a document is attached — omitted = no KYC file on the booking.
        ...(chosenKyc ? { file_public_id: chosenKyc.file.publicId } : {}),
        payment_type: 'ONLINE',
        payment_flow: sendFlow,
        ...(appliedCoupon ? { couponCode: appliedCoupon.code } : {}),
      });

      const created = res.data as CustomerBookingCreateResponse;
      // #15 — the offer code went onto a booking: stop filling it in.
      if (offerCoupon && appliedCoupon?.code.toUpperCase() === offerCoupon.code) clearOfferCoupon();
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

      // The server charges a different plan than the one shown (the amounts
      // moved since the quote): say what will be charged before the payment sheet.
      if (created.paymentFlowAdjusted) {
        const amountText = payNowAmount != null ? inrExact(payNowAmount) : null;
        const proceed = await askToContinue(
          'Payment plan changed',
          `${created.paymentFlowAdjustMessage ?? 'This booking uses a different payment plan.'}` +
            (amountText ? ` You'll pay ${amountText} now.` : ''),
          amountText ? `Pay ${amountText}` : 'Continue',
        );
        if (!proceed) {
          await releaseHold(holdId);
          return;
        }
      }

      const payNowNumber = Number(payNowAmount);
      const pending: PendingPayment = {
        holdId,
        transactionId,
        rzp,
        confirmParams,
        description: durationNow ? `${vehicle.make} ${vehicle.model} · ${durationNow}` : `${vehicle.make} ${vehicle.model}`,
        payNow: payNowAmount != null && Number.isFinite(payNowNumber) ? payNowNumber : null,
      };
      // Item 2 — "Scan a UPI QR from another phone": the QR screen pays this
      // hold's order (the hold stays — it's what the QR pays for).
      if (mode === 'qr' && upiQrEnabled) {
        if (mountedRef.current) setQrPayment(pending);
        return;
      }
      await payByCheckout(pending, mode);
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
      if (err?.response?.data?.code === 'CUSTOMER_BLACKLISTED') {
        Alert.alert(
          'Booking unavailable',
          err.response.data.message ?? "This account can't make new bookings right now. Please contact the branch.",
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
      // #2 / #15 — pickup outside branch hours, or past the 15-day limit;
      // P2 — not a 12-hour / whole-day package.
      if (
        body?.code === 'BRANCH_SCHEDULE_VIOLATION' ||
        body?.code === 'BOOKING_MAX_PERIOD_EXCEEDED' ||
        body?.code === 'INVALID_DATES' ||
        body?.code === BOOKING_PACKAGE_REQUIRED
      ) {
        Alert.alert(
          body.code === 'BOOKING_MAX_PERIOD_EXCEEDED'
            ? 'Booking period too long'
            : body.code === 'INVALID_DATES'
            ? 'Check your dates'
            : body.code === BOOKING_PACKAGE_REQUIRED
            ? 'Choose a package'
            : 'Outside branch hours',
          body.message ?? 'Please choose different times.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Change times', onPress: changeTimes },
          ],
        );
        return;
      }
      // X3 — this driving licence has a vehicle out / a booking for these dates
      if (handleDlInUse(err)) return;
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
  // The rent incl. GST, its discounts and the GST inside what is left (item 17),
  // as the server priced them: the coupon preview's figures with a coupon.
  const rentView = couponPricing ? rentInclGstView(couponPricing) : pd ? rentInclGstView(pd) : null;
  const couponDiscount = (couponPricing && rentView ? rentView.couponDiscount : null) ?? appliedCoupon?.amount ?? 0;
  const baseTotal = pd ? pd.finalTotal + deposit : subtotal + deposit + tax;
  // The post-coupon total is the server's (its caps and rounding), never
  // baseTotal − coupon (only an older server without a breakdown).
  const total = couponPricing ? couponPricing.payableTotal : Math.max(0, baseTotal - couponDiscount);

  // Uploaded documents that can be attached (X2: optional), and the one that will be.
  const kycDocs = (kyc ?? []).filter((d) => !!d.file?.publicId);
  const chosenKyc = pickKyc(kyc, selectedKycId);
  // Advance only (item 18): the one plan the server allows for this total
  // ("Pay ₹X now · ₹Y at pickup"); handleBook sends the same plan.
  const payOptions = checkoutPaymentOptions(vehicle, appliedCoupon, pd ? total : null);
  const effectiveFlow: PaymentFlow = payOptions.defaultFlow;
  const paySplit = payNowSplit(payOptions);
  const payNow = paySplit.payNow ?? total;
  const remainingAtPickup = paySplit.atPickup ?? 0;

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
          {/* P1 — the package booked: the return is pickup + 12 hours / N days */}
          {bookedPackage ? (
            <View style={styles.packageRow}>
              <Ionicons name="pricetag-outline" size={14} color={Colors.ink3} />
              <Text style={styles.packageText}>{bookedPackage.label} package</Text>
            </View>
          ) : (
            <TimesNotice notice={{ tone: 'error', text: BOOKING_PACKAGE_REQUIRED_MESSAGE }} />
          )}
          <BranchHoursLine text={rangeHoursLine(schedule, startDate, endDate)} />
          {adjusted ? (
            <TimesNotice
              notice={{ tone: 'warn', text: `Return moved to ${adjusted} to fit branch hours. The price below is for the new return time.` }}
            />
          ) : null}
          <TimesNotice notice={timesIssue} />
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

        {/* X2 — licence / ID photos are optional: the DL number on the profile is
            what's required. #36 — pick which uploaded document to attach, or none. */}
        <View style={styles.sectionTitleRow}>
          <Text style={[styles.sectionTitle, styles.sectionTitleInline]}>Licence / ID document</Text>
          <Text style={styles.optionalTag}>Optional</Text>
        </View>
        {kycDocs.length === 0 ? (
          <View style={styles.kycNote}>
            <Ionicons name="document-outline" size={18} color={Colors.ink3} />
            <View style={styles.kycNoteBody}>
              <Text style={styles.kycNoteText}>
                No document uploaded. You can book without one — bring your original driving licence to pickup.
              </Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} hitSlop={8}>
                <Text style={styles.editLink}>Upload in Profile</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            <View style={{ gap: 8 }}>
              {kycDocs.map((doc) => {
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
              <TouchableOpacity
                style={[styles.kycPick, !chosenKyc && styles.kycPickActive]}
                onPress={() => setSelectedKycId(NO_KYC)}
                activeOpacity={0.85}
              >
                <View style={[styles.kycPickThumb, styles.kycPickNone]}>
                  <Ionicons name="remove-circle-outline" size={18} color={Colors.ink3} />
                </View>
                <View style={styles.kycPickInfo}>
                  <Text style={styles.kycPickType}>Don&apos;t attach a document</Text>
                </View>
                <Ionicons
                  name={!chosenKyc ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={!chosenKyc ? Colors.orange : Colors.ink4}
                />
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Coupon */}
        <Text style={styles.sectionTitle}>Coupon</Text>
        {appliedCoupon ? (
          <View style={styles.couponApplied}>
            <Ionicons name="pricetag" size={16} color="#2d9d61" />
            <Text style={styles.couponAppliedText}>
              <Text style={styles.couponCode}>{appliedCoupon.code}</Text> applied · {inrExact(couponDiscount)} off
            </Text>
            <TouchableOpacity
              onPress={() => {
                // Removing the offer code (#15) also stops it being filled in next time.
                if (offerCoupon && appliedCoupon.code.toUpperCase() === offerCoupon.code) clearOfferCoupon();
                setAppliedCoupon(null);
                setCouponError(null);
              }}
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
              onPress={() => applyCoupon()}
              disabled={!couponInput.trim() || couponBusy}
              activeOpacity={0.85}
            >
              {couponBusy ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.couponBtnText}>Apply</Text>}
            </TouchableOpacity>
          </View>
        )}
        {couponError && <Text style={styles.couponErrorText}>{couponError}</Text>}
        {/* #15 — the field holds the code saved from a home offer poster */}
        {!appliedCoupon && offerCoupon && couponInput.trim().toUpperCase() === offerCoupon.code ? (
          <View style={styles.offerCodeNote}>
            <Ionicons name="pricetag-outline" size={14} color={Colors.ink3} />
            <Text style={styles.offerCodeNoteText}>Code from an offer you picked</Text>
            <TouchableOpacity onPress={dropOfferCoupon} disabled={couponBusy} hitSlop={8}>
              <Text style={styles.editLink}>Remove</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Price breakdown */}
        <Text style={styles.sectionTitle}>Price breakdown</Text>
        <View style={styles.priceCard}>
          {/* Rent is GST-inclusive (item 17): rent → discounts (off the
              inclusive rent) → rent after discount, with the GST inside it */}
          <LineItem
            label={pd ? `Rent (${pd.pricingBreakdown?.billedAs ?? durationText}, incl. GST)` : `₹${daily.toLocaleString('en-IN')} × ${days} day${days > 1 ? 's' : ''}`}
            value={rentView ? inrExact(rentView.rent) : `₹${(daily * days).toLocaleString('en-IN')}`}
          />
          {/* Duration slab named (#24). With a coupon, the server's re-priced
              layers — a slab the coupon replaced (no stacking) is not shown. */}
          {couponPricing && rentView
            ? !couponPricing.durationSuppressed &&
              rentView.durationDiscount > 0 && (
                <LineItem
                  label={durationDiscountText({ ...couponPricing, durationDiscountType: pd?.durationDiscountType ?? null })}
                  value={`−${inrExact(rentView.durationDiscount)}`}
                  credit
                />
              )
            : pd &&
              rentView &&
              quoteDiscountLines({ ...pd, discountAmount: rentView.discount, durationDiscountAmount: rentView.durationDiscount }).map((l) => (
                <LineItem key={l.label} label={l.label} value={`−${inrExact(l.amount)}`} credit />
              ))}
          {couponDiscount > 0 && (
            <LineItem label={`Coupon (${appliedCoupon!.code})`} value={`−${inrExact(couponDiscount)}`} credit />
          )}
          {rentView ? (
            <>
              {rentView.discount > 0 && <LineItem label="Rent after discount" value={inrExact(rentView.rentAfterDiscount)} />}
              {rentGstNoteLines(rentView, pd).map((t) => (
                <Text key={t} style={styles.priceNote}>{t}</Text>
              ))}
            </>
          ) : (
            <LineItem label="GST" value="Not available" />
          )}
          <LineItem label="Deposit (refundable, no GST)" value={inrExact(deposit)} />
          {!pd && <Text style={styles.priceUnavailable}>{PRICE_UNAVAILABLE_TEXT}</Text>}
          <View style={styles.divider} />
          <LineItem label="Total" value={`₹${total.toLocaleString('en-IN')}`} bold />
        </View>

        {/* Payment — advance only (item 18): the one plan the server charges for
            this total (re-priced with the coupon), never a choice. */}
        {pd && (
          <>
            <Text style={styles.sectionTitle}>Payment</Text>
            <View style={[styles.planCard, styles.planCardActive]}>
              <View style={styles.planTop}>
                <Text style={[styles.planTitle, styles.planTitleActive]}>
                  {effectiveFlow === 'ADVANCE' ? 'Advance payment' : 'Full payment'}
                </Text>
                <Ionicons name="checkmark-circle" size={18} color={Colors.orange} />
              </View>
              <Text style={styles.planLine}>{payNowText(paySplit, inrExact)}</Text>
              <Text style={styles.planNote}>
                {effectiveFlow === 'ADVANCE'
                  ? 'The advance is paid online now; the balance is collected at pickup.'
                  : 'The full amount is paid online now · deposit included'}
              </Text>
            </View>
            {paySplit.fullReason ? <Text style={styles.planReason}>{paySplit.fullReason}</Text> : null}
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
            {/* Item 18: always "now · ₹Y at pickup" (₹0 when paid in full) */}
            {`${effectiveFlow === 'ADVANCE' ? 'advance' : 'full amount'} now · ${inrExact(remainingAtPickup)} at pickup`}
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
            disabled={loading || !terms || !pd || couponBusy || !bookedPackage}
            busyMode={loading ? payMode : null}
            busyLabel={checkingPayment ? CHECKING_PAYMENT_TEXT : undefined}
            // Item 2 — with the server's UPI QR on, the QR option opens the QR
            // screen (first, with this note, on a phone with no UPI app).
            qrLabel={upiQrEnabled ? UPI_QR_OPTION_LABEL : undefined}
            noUpiNote={
              upiQrEnabled
                ? NO_UPI_APP_QR_NOTE
                : 'No UPI app on this phone — scan the QR with a UPI app on another phone.'
            }
          />
        )}
      </View>

      {/* Item 2 — pay this hold by scanning a UPI QR with another phone */}
      <UpiQrPayModal
        target={qrPayment ? { bookingId: qrPayment.holdId } : null}
        expectedAmount={qrPayment?.payNow ?? null}
        subtitle={qrPayment?.description}
        canPayAnotherWay
        onExit={(exit) => void handleQrExit(exit)}
      />
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
  packageRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  packageText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink2 },
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
  kycMissing: { backgroundColor: '#fff3cd', borderColor: '#ffc107' },
  kycText: { fontFamily: Fonts.bodyMedium, fontSize: 13 },
  kycTextMissing: { color: '#856404' },

  // Licence / ID document (X2: optional)
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 10 },
  sectionTitleInline: { marginTop: 0, marginBottom: 0 },
  optionalTag: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    backgroundColor: '#0a0a0a0d',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  kycNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 12,
  },
  kycNoteBody: { flex: 1, gap: 6 },
  kycNoteText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, lineHeight: 18 },
  kycPickNone: { alignItems: 'center', justifyContent: 'center' },

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
  offerCodeNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  offerCodeNoteText: { flex: 1, fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },

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
  // The GST inside the rent (item 17) — a note, not a line that adds to the total.
  priceNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, textAlign: 'right', lineHeight: 17, marginTop: -6 },
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
  // "Pay ₹X now · ₹Y at pickup" (item 18) — may wrap on narrow phones
  planLine: { fontFamily: Fonts.displayBold, fontSize: 16, color: Colors.ink, letterSpacing: -0.3, lineHeight: 22 },
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

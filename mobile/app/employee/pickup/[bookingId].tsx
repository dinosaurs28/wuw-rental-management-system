import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import ConfirmModal from '../../../components/ui/ConfirmModal';
import RemainingBalanceCollect from '../../../components/employee/RemainingBalanceCollect';
import PhotoCaptureSection, { type CapturedPhoto, type CaptureField } from '../../../components/employee/PhotoCaptureSection';
import CounterPaymentPanel from '../../../components/employee/CounterPaymentPanel';
import VehicleSwapSection from '../../../components/employee/VehicleSwapSection';
import RescheduleSheet from '../../../components/employee/RescheduleSheet';
import CounterPaymentPicker, {
  CounterRefundPicker,
  useCounterPayment,
  useCounterRefund,
} from '../../../components/employee/CounterPaymentPicker';
import { CREDIT_NOT_FOR_DEPOSIT_MESSAGE, counterChoiceLabel } from '../../../lib/counterPayment';
import ImageViewer from '../../../components/ui/ImageViewer';
import { DlStatusCard, DlStatusSelector } from '../../../components/employee/DlStatus';
import {
  dlChoiceBody,
  dlStatusLabel,
  isDlErrorCode,
  type DlCollectionStatus,
  type DlStatusFields,
} from '../../../lib/dlStatus';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { couponRejection, employeeApi } from '../../../lib/api';
import { dlInUseErrorText } from '../../../lib/dlInUse';
import { drivingLicenceError, normalizeDrivingLicence } from '../../../lib/identity';
import { counterCouponCapNote } from '../../../lib/discounts';
import { rangeLengthLabel } from '../../../lib/dates';
import {
  apiErrorMessage,
  handleShiftRequired,
} from '../../../lib/counterErrors';
import type { ReturnSession } from '../../../types/api';
import type { KmAllowance } from '../../../types/return';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// Pickup and return payment sessions share one serialized shape.
type PickupSession = ReturnSession;

// DlStatusFields: the original-licence status (#3) — null until recorded.
interface BookingDetail extends DlStatusFields {
  publicId: string;
  startAt: string;
  endAt: string;
  status: string;
  totalFinal: number;
  isAdvancePayment: boolean;
  advanceAmount: number | null;
  remainingBalance: number | null;
  remainingPaidAt: string | null;
  startOdometer: number | null;
  // "1".."10", recorded when the branch fuel module is enabled
  pickupFuelLevel?: string | null;
  requiresManagerConfirmation?: boolean;
  safetyDeposit?: number | null;
  // Branch "Unified Payments": pickup money goes through a payment session.
  usePaymentSessions?: boolean;
  kmAllowance?: KmAllowance | null;
  frozenChargeConfig?: {
    safetyDepositEnabled?: boolean;
    safetyDepositRequiresApproval?: boolean;
    fuelModuleEnabled?: boolean;
    fastagModuleEnabled?: boolean;
  } | null;
  days: number;
  // drivingLicenceNumber (X2): the full number on file, null when none —
  // absent (undefined) on servers older than the DL-number gate.
  customer: { drivingLicenceNumber?: string | null; user: { name: string; phone: string | null } };
  items: Array<{
    vehicle: {
      make: string;
      model: string;
      regNo: string;
      odo: number | null;
    };
  }>;
}

interface KycDoc {
  publicId: string;
  type: string;
  side?: string | null;
  status: string;
  file: { url: string; mime: string };
}

const KYC_TYPE_LABEL: Record<string, string> = {
  DL: 'Driving licence',
  AADHAAR: 'Aadhaar',
  PAN: 'PAN',
  STUDENT_ID: 'Student ID',
};
// "Driving licence · Front" — never the stored filename.
function kycDocLabel(doc: KycDoc) {
  const base = KYC_TYPE_LABEL[doc.type] ?? doc.type.replace(/_/g, ' ');
  const side = doc.side === 'FRONT' ? 'Front' : doc.side === 'BACK' ? 'Back' : null;
  return side ? `${base} · ${side}` : base;
}

// Settlement methods (#3 / #11): Cash · UPI (photo of the customer's payment
// screen) · Split · Credit — components/employee/CounterPaymentPicker.

type SessionAction = 'deposit' | 'removeDeposit' | 'coupon' | 'removeCoupon';

const LEDGER_LABELS: Record<string, string> = {
  BOOKING_BASE: 'Booking balance',
  EXTENSION: 'Extension charge',
  DEPOSIT: 'Safety deposit',
  DISCOUNT: 'Discount',
  PAYMENT: 'Payment',
  REFUND: 'Refund',
};

// Fuel is recorded on a 1–10 scale (same as the return screen) so the charge
// engine can compare pickup vs return fuel directly. pickupFuelLevel = "1".."10".
const FUEL_STEPS = Array.from({ length: 10 }, (_, i) => i + 1);

const num = (x: unknown) => Number(x ?? 0) || 0;
const inr = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

function InfoRow({ icon, label, value }: { icon: IoniconName; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoRowLeft}>
        <Ionicons name={icon} size={15} color={Colors.ink3} />
        <Text style={styles.infoLabel}>{label}</Text>
      </View>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

// The pickup bill: session ledger lines and what's left to collect.
function SessionBill({ session }: { session: PickupSession }) {
  const net = num(session.netPayable);
  const entries = (session.entries ?? []).filter((e) => !e.isVoided);
  const gst = num(session.gstAmount);
  // The remaining balance is GST-inclusive (its GST is on the booking); the GST
  // row is only the GST split out of a rent line booked without it — an
  // extension (#23, item 17: rent without GST + GST = the extension rent). A
  // counter coupon line is already off the rent incl. GST. Drop / recovery
  // charges carry no GST (item 8).
  const isGstInclusive = (e: { referenceType?: string | null }) => e.referenceType === 'BOOKING_REMAINING';
  const hasGstInclusive = entries.some(isGstInclusive);
  const hasExtensionGst = entries.some((e) => e.entryType === 'EXTENSION' && num(e.gstAmount) > 0);

  return (
    <View style={styles.card}>
      {entries.length === 0 && <Text style={styles.hintInline}>No charges on this pickup.</Text>}
      {entries.map((e) => {
        const amt = num(e.amount);
        const credit = amt < 0 || e.classification === 'DISCOUNT' || e.classification === 'PAYMENT';
        const isDeposit = e.entryType === 'DEPOSIT';
        return (
          <View key={e.publicId} style={styles.billRow}>
            <View style={styles.billLabelWrap}>
              <Text style={styles.billLabel} numberOfLines={2}>
                {isDeposit ? 'Safety deposit (refundable)' : e.description || LEDGER_LABELS[e.entryType] || e.entryType}
              </Text>
              {isDeposit && !!e.description && (
                <Text style={styles.billSub} numberOfLines={1}>{e.description}</Text>
              )}
              {isGstInclusive(e) && <Text style={styles.billSub}>GST already included</Text>}
              {e.classification === 'TAXABLE' && !isGstInclusive(e) && num(e.gstAmount) > 0 && (
                <Text style={styles.billSub}>Rent without GST — its GST is shown below</Text>
              )}
            </View>
            <Text style={[styles.billValue, credit && styles.billCredit]}>
              {amt < 0 ? '−' : ''}{inr(amt)}
            </Text>
          </View>
        );
      })}
      {gst > 0 && (
        <View style={styles.billRow}>
          <Text style={styles.billLabel}>
            {hasExtensionGst ? 'GST on the extension rent' : hasGstInclusive ? 'GST on other charges' : 'GST'}
          </Text>
          <Text style={styles.billValue}>{inr(gst)}</Text>
        </View>
      )}

      <View style={[styles.divider, { marginVertical: 4 }]} />

      <View style={styles.billRow}>
        <Text style={styles.billNetLabel}>
          {net > 0 ? 'Amount to collect' : net < 0 ? 'Refund due' : 'Nothing to collect'}
        </Text>
        <Text style={[styles.billNetValue, net < 0 && styles.billCredit, net === 0 && { color: Colors.ink3 }]}>
          {net === 0 ? '₹0' : `${net < 0 ? '−' : ''}${inr(net)}`}
        </Text>
      </View>
    </View>
  );
}

export default function PickupScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [odo, setOdo] = useState('');
  // No default — staff must read the gauge and pick a level (1..10).
  const [fuelLevel, setFuelLevel] = useState<number | null>(null);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  // Shots still uploading (or failed) — they aren't in `photos` yet.
  const [pendingPhotos, setPendingPhotos] = useState(0);
  // Original driving licence status (#3): optional (X1), nothing pre-selected.
  const [dlStatus, setDlStatus] = useState<DlCollectionStatus | null>(null);
  // The server refused the DL choice — highlight the section.
  const [dlRejected, setDlRejected] = useState(false);
  // Driving licence NUMBER (X2): required for the handover. Typed here when none
  // is on file, or to correct the one on file after checking the card.
  const [dlNumberEditing, setDlNumberEditing] = useState(false);
  const [dlNumberInput, setDlNumberInput] = useState('');
  const [dlNumberTouched, setDlNumberTouched] = useState(false);
  // 422 DL_NUMBER_REQUIRED / 400 INVALID_DL_NUMBER from the server.
  const [dlNumberError, setDlNumberError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // What was settled on the pickup session, for the success screen.
  // `credit`: the bill was put on credit (#11) — owed, not collected.
  const [paid, setPaid] = useState<{ amount: number; method: string; credit?: boolean } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [kycViewer, setKycViewer] = useState<{ url: string; label: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // P4c — the Reschedule sheet (CONFIRMED bookings, not picked up yet).
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  // Legacy flow only (branches without payment sessions)
  const [requireManager, setRequireManager] = useState(false);
  const [requestDeposit, setRequestDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositReason, setDepositReason] = useState('');

  // Payment-session flow
  const [session, setSession] = useState<PickupSession | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [initiating, setInitiating] = useState(false);
  const [sessionAction, setSessionAction] = useState<SessionAction | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [sDepositAmt, setSDepositAmt] = useState('');
  const [sDepositReason, setSDepositReason] = useState('');
  const [depositError, setDepositError] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);
  // Why the applied coupon is smaller than its face value (capped by the server).
  const [couponNote, setCouponNote] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  // How the bill is settled: Cash / UPI (photo) / Split / Credit, or a refund (Cash / UPI)
  const pay = useCounterPayment('CASH');
  const refundPay = useCounterRefund();

  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const odoRef = useRef<View>(null);
  const dlNumberRef = useRef<View>(null);
  const mountedRef = useRef(true);
  const initiateBusyRef = useRef(false);
  const settleBusyRef = useRef(false);
  const restoreTriedRef = useRef(false);
  const odoPrefillRef = useRef<{ vehicle: string; value: string } | null>(null);

  useEffect(() => () => { mountedRef.current = false; }, []);

  // Android is edge-to-edge (SDK 54): scroll the focused field (UTR, deposit,
  // coupon…) above the keyboard.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = Keyboard.addListener('keyboardDidShow', () => {
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
    return () => sub.remove();
  }, []);

  const { data: booking, isLoading, isError, refetch } = useQuery<BookingDetail>({
    queryKey: ['employee', 'pickup', bookingId],
    queryFn: async () => {
      const res = await employeeApi.getPickupDetails(bookingId as string);
      return res.data?.data as BookingDetail;
    },
    enabled: !!bookingId,
    staleTime: 30_000,
    retry: false,
  });

  const { data: captureFields = [] } = useQuery<CaptureField[]>({
    queryKey: ['employee', 'pickup', 'capture-config', bookingId],
    queryFn: async () => {
      const res = await employeeApi.pickupCaptureConfig(bookingId as string);
      const fields = res.data?.config?.fields;
      return Array.isArray(fields) ? (fields as CaptureField[]) : [];
    },
    enabled: !!bookingId,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const { data: kycData, isLoading: kycLoading } = useQuery({
    queryKey: ['employee', 'kyc', bookingId],
    queryFn: async () => {
      const res = await employeeApi.getBookingKyc(bookingId as string);
      return res.data as { customerName: string; kyc: KycDoc[] };
    },
    enabled: !!bookingId,
    staleTime: 30_000,
    retry: false,
  });

  // Start from the vehicle's current odometer (as the web does); follow a
  // vehicle swap unless staff already typed their own reading.
  useEffect(() => {
    const v = booking?.items[0]?.vehicle;
    if (!v || !(num(v.odo) > 0)) return;
    if (odoPrefillRef.current?.vehicle === v.regNo) return;
    const value = String(v.odo);
    const previous = odoPrefillRef.current?.value;
    setOdo((cur) => (cur === '' || cur === previous ? value : cur));
    odoPrefillRef.current = { vehicle: v.regNo, value };
  }, [booking]);

  // Session flow: pick up a pickup session left open (app restart, web).
  useEffect(() => {
    if (!bookingId || !booking?.usePaymentSessions || booking.status !== 'CONFIRMED') return;
    if (restoreTriedRef.current) return;
    restoreTriedRef.current = true;
    setRestoring(true);
    (async () => {
      try {
        const res = await employeeApi.getActivePickupSession(bookingId as string);
        const s = res.data?.data as PickupSession | undefined;
        if (mountedRef.current && s) setSession(s);
      } catch {
        /* 404 — no open session, start fresh */
      } finally {
        if (mountedRef.current) setRestoring(false);
      }
    })();
  }, [bookingId, booking?.usePaymentSessions, booking?.status]);

  const handoverBody = () => {
    const labeled = photos.filter((p) => p.label);
    const generic = photos.filter((p) => !p.label);
    const level = fuelLevel ?? 0;
    return {
      odo: Number(odo),
      // fuelLevel is stored on the vehicle as a percent; derive it from the 1..10 scale.
      fuelLevel: level * 10,
      // 1..10 string for the charge-engine fuel module (required when enabled, ignored otherwise).
      pickupFuelLevel: String(level),
      ...(labeled.length ? { captureImages: labeled.map((p) => ({ fileId: p.fileId, label: p.label! })) } : {}),
      ...(generic.length ? { pickupImageIds: generic.map((p) => p.fileId) } : {}),
    };
  };

  // dlStatus only when one was chosen — it's
  // optional (X1) and left unset otherwise. licenseCollected is no longer sent
  // (the server keeps it for old builds only).
  const dlBody = () => (dlStatus ? dlChoiceBody(dlStatus) : {});

  // The typed DL number (X2), normalised, when it's valid and differs from the
  // one on file; the server saves it to the customer. Nothing otherwise.
  const dlNumberBody = (): { drivingLicenceNumber?: string } => {
    const onFile = booking?.customer?.drivingLicenceNumber ?? null;
    if ((onFile && !dlNumberEditing) || !dlNumberInput.trim() || drivingLicenceError(dlNumberInput)) return {};
    const value = normalizeDrivingLicence(dlNumberInput);
    return value === onFile ? {} : { drivingLicenceNumber: value };
  };

  // 422 DL_NUMBER_REQUIRED / 400 INVALID_DL_NUMBER: open the DL number field,
  // show why under it and bring it into view. True when handled.
  const noteDlNumberError = (err: any): boolean => {
    const code = err?.response?.data?.code;
    if (code !== 'DL_NUMBER_REQUIRED' && code !== 'INVALID_DL_NUMBER') return false;
    setDlNumberEditing(true);
    setDlNumberTouched(true);
    setDlNumberError(apiErrorMessage(err, "Enter the customer's driving licence number."));
    // The number on file may have changed elsewhere — reload it.
    if (code === 'DL_NUMBER_REQUIRED') refetch();
    setTimeout(() => {
      dlNumberRef.current?.measureLayout(
        contentRef.current as any,
        (_x, y) => { scrollRef.current?.scrollTo({ y: Math.max(0, y - 40), animated: true }); },
        () => {},
      );
    }, 150);
    return true;
  };

  const onPickupDone = (settled: { amount: number; method: string; credit?: boolean } | null) => {
    qc.invalidateQueries({ queryKey: ['employee', 'pickups'] });
    qc.invalidateQueries({ queryKey: ['employee', 'dashboard-stats'] });
    qc.invalidateQueries({ queryKey: ['employee', 'pickup', bookingId] });
    qc.invalidateQueries({ queryKey: ['employee', 'financial-state', bookingId] });
    if (!mountedRef.current) return;
    setPaid(settled);
    setDone(true);
  };

  // Legacy (no payment sessions): one call hands the vehicle over.
  const mutation = useMutation({
    mutationFn: () =>
      employeeApi.completePickup(bookingId as string, {
        ...handoverBody(),
        // Escalate to manager confirmation instead of completing directly (#50)
        ...(requireManager ? { requireManagerConfirmation: true } : {}),
        // Optional safety-deposit request, only when the branch config enables it (#49)
        ...(requestDeposit && depositEnabled
          ? { safetyDepositRequest: { requestedAmount: Number(depositAmount), reason: depositReason.trim() } }
          : {}),
        // Re-arms the backend's 402 remaining-balance guard as defense-in-depth behind the UI gate.
        payRemainingAtPickup: true,
        // Original driving licence status — optional choice below.
        ...dlBody(),
        // DL number typed at the counter (X2) — saved to the customer.
        ...dlNumberBody(),
      }),
    onSuccess: () => onPickupDone(null),
    onError: (err: any) => {
      setShowConfirm(false);
      // An auto-approved safety deposit is counter money — it needs an open shift.
      if (handleShiftRequired(err)) return;
      if (isDlErrorCode(err?.response?.data?.code)) setDlRejected(true);
      noteDlNumberError(err);
      // 409: the branch switched to payment sessions — reload so the screen follows.
      if (err?.response?.status === 409) refetch();
      // X3 DL_IN_USE also names the booking holding this driving licence
      setErrorMsg(dlInUseErrorText(err) ?? apiErrorMessage(err, 'Something went wrong.'));
    },
  });

  const kycMutation = useMutation({
    mutationFn: ({ kycId, status }: { kycId: string; status: 'APPROVED' | 'REJECTED' }) =>
      employeeApi.verifyKyc(kycId, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee', 'kyc', bookingId] });
    },
    onError: () => {
      Alert.alert('Error', 'Failed to update document status.');
    },
  });

  // Session flow step 1: save the handover details and open the bill.
  const startSession = async () => {
    if (initiateBusyRef.current) return;
    initiateBusyRef.current = true;
    setInitiating(true);
    setErrorMsg(null);
    setDlRejected(false);
    setDlNumberError(null);
    try {
      const res = await employeeApi.initiatePickupSession(bookingId as string, {
        ...handoverBody(),
        ...dlBody(),
        ...dlNumberBody(),
      });
      const s = res.data?.data as PickupSession | undefined;
      if (!mountedRef.current) return;
      if (s) setSession(s);
      // startOdometer / pickup fuel are saved now — show the server's values.
      refetch();
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200);
    } catch (err: any) {
      if (!mountedRef.current) return;
      if (isDlErrorCode(err?.response?.data?.code)) setDlRejected(true);
      noteDlNumberError(err);
      // 409: payment sessions were switched off for the branch — reload into the legacy flow.
      if (err?.response?.status === 409) refetch();
      setErrorMsg(dlInUseErrorText(err) ?? apiErrorMessage(err, 'Could not start the payment.'));
    } finally {
      initiateBusyRef.current = false;
      if (mountedRef.current) setInitiating(false);
    }
  };

  // The bill changed or the session moved on elsewhere — reload it.
  const reloadSession = async () => {
    try {
      const res = await employeeApi.getActivePickupSession(bookingId as string);
      const s = res.data?.data as PickupSession | undefined;
      if (mountedRef.current && s) setSession(s);
    } catch (err: any) {
      if (err?.response?.status !== 404) return;
      // No open session: either it completed (vehicle handed over) or it was dropped.
      const fresh = await refetch();
      if (!mountedRef.current) return;
      if (fresh.data?.status === 'PICKED_UP') onPickupDone(null);
      else setSession(null);
    }
  };

  // The bill changed: a typed split no longer adds up (the photo and collateral still apply).
  const clearPayInputs = () => {
    pay.setCash('');
    pay.setErrors({});
  };

  const runSessionAction = async (
    kind: SessionAction,
    call: () => Promise<any>,
    onOk: () => void,
    onFail: (message: string) => void,
    fallback: string,
  ) => {
    if (sessionAction) return;
    setSessionAction(kind);
    try {
      const res = await call();
      const s = res.data?.data as PickupSession | undefined;
      if (!mountedRef.current) return;
      if (s) setSession(s);
      clearPayInputs();
      onOk();
    } catch (err: any) {
      if (!mountedRef.current) return;
      onFail(apiErrorMessage(err, fallback));
    } finally {
      if (mountedRef.current) setSessionAction(null);
    }
  };

  const openDepositForm = (entry?: { amount: string; description: string }) => {
    setSDepositAmt(entry ? String(num(entry.amount)) : '');
    setSDepositReason(entry?.description ?? '');
    setDepositError(null);
    setDepositOpen(true);
  };

  const saveDeposit = () => {
    const amount = Number(sDepositAmt);
    if (!(amount > 0)) {
      setDepositError('Enter the deposit amount.');
      return;
    }
    if (!sDepositReason.trim()) {
      setDepositError('Enter a reason for the deposit.');
      return;
    }
    void runSessionAction(
      'deposit',
      () => employeeApi.addDepositToPickupSession(bookingId as string, { amount, reason: sDepositReason.trim() }),
      () => { setDepositOpen(false); setDepositError(null); },
      setDepositError,
      'Could not update the deposit.',
    );
  };

  const removeDeposit = () => {
    void runSessionAction(
      'removeDeposit',
      () => employeeApi.removeDepositFromPickupSession(bookingId as string),
      () => setDepositError(null),
      setDepositError,
      'Could not remove the deposit.',
    );
  };

  // Counter coupon (#20): the server runs the full coupon check. A refusal
  // (already has a coupon, can't stack with the duration discount, nothing
  // left to discount, limits…) comes back with a message saying why.
  const applyCoupon = () => {
    const code = couponCode.trim().toUpperCase();
    if (!code) return;
    let capNote: string | null = null;
    void runSessionAction(
      'coupon',
      async () => {
        const res = await employeeApi.applyDiscountToPickupSession(bookingId as string, { discountCode: code });
        capNote = counterCouponCapNote(res.data?.coupon?.cappedBy);
        return res;
      },
      () => { setCouponCode(''); setCouponError(null); setCouponNote(capNote); },
      (message) => { setCouponError(message); setCouponNote(null); },
      'Invalid coupon code.',
    );
  };

  const removeCoupon = () => {
    void runSessionAction(
      'removeCoupon',
      () => employeeApi.removeDiscountFromPickupSession(bookingId as string),
      () => { setCouponError(null); setCouponNote(null); },
      setCouponError,
      'Could not remove the coupon.',
    );
  };

  // Session flow step 2: record the money; a COMPLETED session means the
  // server has marked the booking PICKED_UP.
  const settleSession = async () => {
    if (!session || settleBusyRef.current || sessionAction) return;
    const net = num(session.netPayable);
    // Cash / UPI (payment-screen photo) / Split / Credit for a balance due (#3 / #11)
    const choice = net > 0 ? pay.resolve(net) : null;
    if (net > 0 && !choice) return;
    // A safety deposit can't go on credit — say so before anything is sent.
    if (
      choice?.method === 'CREDIT' &&
      session.entries?.some((e) => e.entryType === 'DEPOSIT' && !e.isVoided)
    ) {
      pay.setErrors({ method: CREDIT_NOT_FOR_DEPOSIT_MESSAGE });
      return;
    }
    const refundChoice = net < 0 ? refundPay.resolve() : null;
    if (net < 0 && !refundChoice) return;
    settleBusyRef.current = true;
    setSettling(true);
    setErrorMsg(null);
    try {
      let res;
      if (net < 0 && refundChoice) {
        res = await employeeApi.recordSessionRefund(session.publicId, {
          method: refundChoice.method,
          amount: Math.abs(net),
          idempotencyKey: `refund:${session.publicId}`,
          ...(refundChoice.proofFileId ? { proof_file_id: refundChoice.proofFileId } : {}),
        });
      } else if (net === 0 || !choice) {
        res = await employeeApi.recordSessionPayment(session.publicId, {
          method: 'CASH',
          amount: 0,
          idempotencyKey: `zero-balance:${session.publicId}`,
          notes: 'No payment required — zero balance',
        });
      } else {
        const idempotencyKey = `settle:${session.publicId}`;
        res = await employeeApi.recordSessionPayment(
          session.publicId,
          choice.method === 'SPLIT'
            ? {
              method: 'SPLIT',
              amount: net,
              idempotencyKey,
              notes: `Split: ₹${choice.cashAmount.toFixed(2)} cash + ₹${choice.upiAmount.toFixed(2)} UPI`,
              cashAmount: choice.cashAmount,
              onlineAmount: choice.upiAmount,
              onlineGateway: 'UPI',
              proof_file_id: choice.proofFileId,
            }
            : choice.method === 'UPI'
              ? { method: 'UPI', amount: net, idempotencyKey, proof_file_id: choice.proofFileId }
              : choice.method === 'CREDIT'
                ? { method: 'CREDIT', amount: net, idempotencyKey, collateral: choice.collateral }
                : { method: 'CASH', amount: net, idempotencyKey },
        );
      }
      const updated = res.data?.data as PickupSession | undefined;
      if (!mountedRef.current) return;
      if (updated && updated.status !== 'COMPLETED') {
        setSession(updated);
        setErrorMsg('Payment recorded — waiting for the session to complete.');
        return;
      }
      onPickupDone(
        net > 0 && choice
          ? { amount: net, method: counterChoiceLabel(choice), credit: choice.method === 'CREDIT' }
          : net < 0 && refundChoice
            ? { amount: net, method: refundChoice.method === 'UPI' ? 'UPI refund' : 'Cash refund' }
            : null,
      );
    } catch (err: any) {
      if (!mountedRef.current) return;
      if (handleShiftRequired(err)) return;
      // Photo / split / collateral / deposit-on-credit problems show under the picker.
      if (net < 0 ? refundPay.showServerError(err) : pay.showServerError(err)) return;
      // 409 COUPON_NO_LONGER_VALID (the coupon is re-checked when the payment is
      // recorded): nothing was recorded — take the coupon off and collect in full.
      const rejected = couponRejection(err);
      if (rejected) {
        void reloadSession();
        setCouponError(rejected.message);
        setCouponNote(null);
        Alert.alert('Coupon can no longer be used', `${rejected.message}\n\nNo payment was recorded.`, [
          { text: 'Not now', style: 'cancel' },
          { text: 'Remove coupon', style: 'destructive', onPress: removeCoupon },
        ]);
        return;
      }
      // 409 amount mismatch / 400 not awaiting payment: the bill moved on — reload it.
      if (err?.response?.status === 409 || err?.response?.status === 400) void reloadSession();
      // X3 DL_IN_USE: another booking on this licence is out — nothing was recorded
      setErrorMsg(dlInUseErrorText(err) ?? apiErrorMessage(err, 'Could not record the payment.'));
    } finally {
      settleBusyRef.current = false;
      if (mountedRef.current) setSettling(false);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <ActivityIndicator style={styles.loader} color={Colors.orange} size="large" />
      </View>
    );
  }

  if (isError || !booking) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.title}>Pickup</Text>
        </View>
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={44} color={Colors.ink4} />
          <Text style={styles.errorText}>Could not load booking details.</Text>
        </View>
      </View>
    );
  }

  const vehicle = booking.items[0]?.vehicle;
  const customer = booking.customer.user;
  const vehicleName = vehicle ? `${vehicle.make} ${vehicle.model}` : 'the vehicle';
  const sessionMode = !!booking.usePaymentSessions;
  const missingRequiredPhotos = captureFields.filter(
    (f) => f.required && !photos.some((p) => p.label === f.name),
  );
  // Session flow carries the balance on its bill, so it's collected there instead.
  const hasRemainingBalance =
    !sessionMode &&
    booking.isAdvancePayment &&
    booking.remainingBalance &&
    Number(booking.remainingBalance) > 0 &&
    !booking.remainingPaidAt;

  // X2 — the handover needs the customer's DL NUMBER (not a document photo).
  // undefined = an older server that doesn't report it: the server decides.
  const dlOnFile = booking.customer.drivingLicenceNumber;
  const dlNumberReported = dlOnFile !== undefined;
  const dlNumberMissing = dlNumberReported && !dlOnFile;
  // The field is open when there's no number on file, or staff chose to correct it.
  const dlNumberOpen = dlNumberMissing || dlNumberEditing;
  const dlNumberTyped = dlNumberInput.trim();
  const dlNumberInvalid = dlNumberTyped ? drivingLicenceError(dlNumberInput) : null;
  // The number this handover goes ahead with: a valid typed one, else the one on file.
  const handoverDlNumber =
    dlNumberOpen && dlNumberTyped && !dlNumberInvalid ? normalizeDrivingLicence(dlNumberInput) : dlOnFile || null;
  const dlNumberFieldError = dlNumberError ?? (dlNumberTouched ? dlNumberInvalid : null);
  // #49 — safety deposit request only when the branch charge config enables it.
  const depositEnabled = !!booking.frozenChargeConfig?.safetyDepositEnabled;
  const depositInvalid =
    requestDeposit && (!(Number(depositAmount) > 0) || depositReason.trim().length === 0);
  const odoValid = Number(odo) > 0;
  const allowance = booking.kmAllowance ?? null;
  const fuelModuleEnabled = !!booking.frozenChargeConfig?.fuelModuleEnabled;
  const fastagModuleEnabled = !!booking.frozenChargeConfig?.fastagModuleEnabled;
  const termsLine = allowance
    ? `Free km: ${allowance.includedKm.toLocaleString('en-IN')} · Extra km: ${
      allowance.extraKmEnabled ? `${inr(num(allowance.extraKmRate))}/km` : 'not charged'
    }`
    : null;

  // First thing still missing before the handover can go ahead (shown above the button).
  // The DL status (X1) and document photos (X2) are optional; the DL number isn't.
  const handoverBlocker: string | null = hasRemainingBalance
    ? 'Collect the balance due above to continue.'
    : dlNumberMissing && !dlNumberTyped
      ? 'Enter the customer\'s driving licence number.'
      : dlNumberOpen && dlNumberInvalid
        ? dlNumberInvalid
        : !odoValid
          ? 'Enter the odometer reading.'
          : fuelLevel == null
            ? 'Select the fuel level.'
            : missingRequiredPhotos.length > 0
              ? `Take the required photo${missingRequiredPhotos.length > 1 ? 's' : ''}: ${missingRequiredPhotos.map((f) => f.name).join(', ')}.`
              : pendingPhotos > 0
                ? 'Wait for the photos to upload (retry or remove failed ones).'
                : !sessionMode && depositInvalid
                  ? 'Enter the deposit amount and reason, or turn the request off.'
                  : sessionMode && restoring
                    ? 'Checking for an open payment…'
                    : null;

  // What was recorded for the licence: the choice sent from this screen, else the
  // server's value (a pickup session reopened after an app restart).
  const recordedDlStatus = dlStatus ?? booking.dlStatus ?? null;
  const recordedDlNote = dlStatus ? null : booking.dlDepositNote ?? null;
  // Unset is allowed (X1) — say what it is about rather than a bare "Not recorded".
  const dlSummary = recordedDlStatus
    ? `${dlStatusLabel(recordedDlStatus)}${recordedDlStatus === 'DEPOSIT' && recordedDlNote ? ` · ${recordedDlNote}` : ''}`
    : `DL status: ${dlStatusLabel(null).toLowerCase()}`;

  const recordedOdo = booking.startOdometer ?? (odoValid ? Number(odo) : null);
  const recordedFuel = booking.pickupFuelLevel ? Number(booking.pickupFuelLevel) : fuelLevel;

  if (done) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.back, { marginHorizontal: 20, marginTop: 8 }]} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <View style={styles.successBody}>
          <View style={styles.successIcon}>
            <Ionicons name={requireManager ? 'time' : 'checkmark-circle'} size={64} color={requireManager ? '#d97706' : '#10b981'} />
          </View>
          <Text style={styles.successTitle}>{requireManager ? 'Sent for Confirmation' : 'Pickup Complete'}</Text>
          <Text style={styles.successSub}>
            {requireManager
              ? `Sent to a manager to confirm the handover of ${vehicleName} for ${customer.name}. The vehicle has not been handed over yet.`
              : `${vehicle ? vehicleName : 'Vehicle'} has been handed over to ${customer.name}.`}
          </Text>
          <View style={styles.successDetails}>
            {recordedOdo != null && (
              <View style={styles.successRow}>
                <Ionicons name="speedometer-outline" size={15} color={Colors.ink3} />
                <Text style={styles.successRowText}>Odometer recorded: {recordedOdo.toLocaleString('en-IN')} km</Text>
              </View>
            )}
            {recordedFuel != null && (
              <View style={styles.successRow}>
                <Ionicons name="water-outline" size={15} color={Colors.ink3} />
                <Text style={styles.successRowText}>Fuel level: {recordedFuel}/10</Text>
              </View>
            )}
            {handoverDlNumber && (
              <View style={styles.successRow}>
                <Ionicons name="card-outline" size={15} color={Colors.ink3} />
                <Text style={styles.successRowText}>DL number: {handoverDlNumber}</Text>
              </View>
            )}
            <View style={styles.successRow}>
              <Ionicons name="id-card-outline" size={15} color={Colors.ink3} />
              <Text style={styles.successRowText}>{dlSummary}</Text>
            </View>
            {sessionMode && (
              <View style={styles.successRow}>
                <Ionicons name="cash-outline" size={15} color={Colors.ink3} />
                <Text style={styles.successRowText}>
                  {paid
                    ? paid.credit
                      ? `${inr(paid.amount)} ${paid.method.charAt(0).toLowerCase()}${paid.method.slice(1)}`
                      : `${paid.amount < 0 ? 'Refunded' : 'Collected'} ${inr(paid.amount)} · ${paid.method}`
                    : 'Nothing to collect at pickup'}
                </Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => router.replace('/(employee)/bookings')}
            activeOpacity={0.85}
          >
            <Text style={styles.doneBtnText}>Back to Queue</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Nothing to hand over: already picked up / cancelled, or a handover is
  // waiting on a manager (a fresh form would duplicate its photos and deposit).
  const awaitingManager = booking.status === 'CONFIRMED' && !!booking.requiresManagerConfirmation;
  if (awaitingManager || booking.status !== 'CONFIRMED') {
    const pickedUp = booking.status === 'PICKED_UP';
    return (
      <KeyboardAvoidingView
        style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={insets.top}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={Colors.ink} />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.title}>Pickup</Text>
            <Text style={styles.subtitle}>#{booking.publicId.slice(-8).toUpperCase()}</Text>
          </View>
        </View>
        {/* Scrolls so the DL status editor below fits on small screens */}
        <ScrollView
          contentContainerStyle={styles.successBodyScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.successIcon, awaitingManager && styles.waitingIcon]}>
            <Ionicons
              name={awaitingManager ? 'time' : pickedUp ? 'checkmark-circle' : 'information-circle'}
              size={64}
              color={awaitingManager ? '#d97706' : pickedUp ? '#10b981' : Colors.ink3}
            />
          </View>
          <Text style={styles.successTitle}>
            {awaitingManager ? 'Waiting for Manager' : pickedUp ? 'Already Picked Up' : 'No Pickup Due'}
          </Text>
          <Text style={styles.successSub}>
            {awaitingManager
              ? `The handover of ${vehicleName} for ${customer.name} is waiting for a manager to confirm it. The vehicle has not been handed over yet.`
              : pickedUp
                ? `${vehicle ? vehicleName : 'The vehicle'} has already been handed over to ${customer.name}.`
                : `This booking is ${booking.status.replace(/_/g, ' ').toLowerCase()} — there's no pickup to do.`}
          </Text>
          {/* Original driving licence (#3) — Fleet can still change it while CONFIRMED / PICKED_UP */}
          {(awaitingManager || pickedUp || !!booking.dlStatus) && (
            <DlStatusCard booking={booking} onUpdated={() => refetch()} style={styles.dlCardWide} />
          )}
          {awaitingManager && (
            <TouchableOpacity style={styles.refreshBtn} onPress={() => refetch()} activeOpacity={0.85}>
              <Ionicons name="refresh-outline" size={16} color={Colors.ink2} />
              <Text style={styles.refreshBtnText}>Check again</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => router.replace('/(employee)/bookings')}
            activeOpacity={0.85}
          >
            <Text style={styles.doneBtnText}>Back to Queue</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  const net = session ? num(session.netPayable) : 0;
  const depositEntry = session?.entries?.find((e) => e.entryType === 'DEPOSIT' && !e.isVoided);
  const discountEntry = session?.entries?.find((e) => e.classification === 'DISCOUNT' && !e.isVoided);
  const sessionBusy = !!sessionAction || settling;

  const handleConfirm = () => {
    if (handoverBlocker) {
      Alert.alert('Not ready yet', handoverBlocker);
      return;
    }
    setErrorMsg(null);
    setDlRejected(false);
    setShowConfirm(true);
  };

  const openKycDoc = (doc: KycDoc) => {
    if (doc.file.mime?.startsWith('image/')) {
      setKycViewer({ url: doc.file.url, label: kycDocLabel(doc) });
      return;
    }
    // The in-app document viewer renders images only — PDFs open in the browser sheet.
    WebBrowser.openBrowserAsync(doc.file.url).catch(() => {
      Alert.alert('Could not open', 'The document could not be opened on this phone.');
    });
  };

  return (
    <>
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={insets.top}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>Pickup</Text>
          <Text style={styles.subtitle}>#{booking.publicId.slice(-8).toUpperCase()}</Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 150 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View ref={contentRef} collapsable={false} style={styles.contentInner}>
        {/* Remaining balance collection (legacy — unblocks pickup once paid) */}
        {hasRemainingBalance && (
          <RemainingBalanceCollect
            bookingId={booking.publicId}
            amount={Number(booking.remainingBalance)}
            context="pickup"
            onCollected={() => {
              qc.invalidateQueries({ queryKey: ['employee', 'pickup', bookingId] });
              refetch();
            }}
          />
        )}

        {/* Customer */}
        <SectionHeader title="Customer" />
        <View style={styles.card}>
          <View style={styles.customerRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{customer.name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.customerInfo}>
              <Text style={styles.customerName}>{customer.name}</Text>
              {customer.phone && (
                <Text style={styles.customerPhone}>{customer.phone}</Text>
              )}
            </View>
          </View>
        </View>

        {/* Driving licence NUMBER (X2) — required for the handover. Shown in full so
            staff can check it against the card; typed here when none is on file. */}
        {dlNumberReported && (
          <>
            <SectionHeader title="Driving Licence Number" />
            <View
              ref={dlNumberRef}
              collapsable={false}
              style={[styles.card, !session && !!dlNumberFieldError && styles.cardError]}
            >
              {session || !dlNumberOpen ? (
                <View style={styles.dlNumberRow}>
                  <View style={[styles.dlNumberIcon, !handoverDlNumber && styles.dlNumberIconMissing]}>
                    <Ionicons name="card-outline" size={20} color={handoverDlNumber ? Colors.orange : '#d97706'} />
                  </View>
                  <View style={styles.customerInfo}>
                    <Text style={[styles.dlNumberValue, !handoverDlNumber && styles.dlNumberValueMissing]} selectable>
                      {handoverDlNumber ?? 'Not on file'}
                    </Text>
                    <Text style={styles.toggleSub}>
                      {handoverDlNumber
                        ? "Check it against the customer's licence card."
                        : 'No driving licence number was recorded for this customer.'}
                    </Text>
                  </View>
                  {!session && (
                    <TouchableOpacity
                      onPress={() => {
                        setDlNumberEditing(true);
                        setDlNumberInput(dlOnFile ?? '');
                        setDlNumberTouched(false);
                        setDlNumberError(null);
                      }}
                      hitSlop={8}
                    >
                      <Text style={styles.link}>Correct</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <>
                  <View style={styles.toggleTitleRow}>
                    <Text style={styles.toggleTitle}>
                      {dlNumberMissing ? 'No driving licence number on file' : 'Correct the driving licence number'}
                    </Text>
                    {dlNumberMissing && !handoverDlNumber && <Text style={styles.requiredTag}>Required</Text>}
                  </View>
                  <Text style={[styles.toggleSub, styles.dlSub]}>
                    {dlNumberMissing
                      ? "Enter it from the customer's licence card before handing over the vehicle. It's saved to their profile."
                      : "Type it exactly as it is on the card. It replaces the number on the customer's profile."}
                  </Text>
                  <TextInput
                    style={[styles.odoInput, styles.dlNumberInput, !!dlNumberFieldError && styles.inputError]}
                    value={dlNumberInput}
                    onChangeText={(t) => { setDlNumberInput(t.toUpperCase()); setDlNumberError(null); }}
                    onBlur={() => setDlNumberTouched(true)}
                    placeholder="e.g. KA01 20110012345"
                    placeholderTextColor={Colors.ink4}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    autoComplete="off"
                    maxLength={30}
                    returnKeyType="done"
                  />
                  {dlNumberFieldError && <Text style={styles.fieldError}>{dlNumberFieldError}</Text>}
                  {!dlNumberMissing && (
                    <TouchableOpacity
                      style={styles.dlNumberKeep}
                      onPress={() => {
                        setDlNumberEditing(false);
                        setDlNumberInput('');
                        setDlNumberTouched(false);
                        setDlNumberError(null);
                      }}
                      hitSlop={8}
                    >
                      <Text style={styles.link}>Keep {dlOnFile}</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          </>
        )}

        {/* KYC document photos — optional (X2); still viewable and verifiable */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionHeader, styles.sectionHeaderInline]}>Identity Documents</Text>
          <Text style={styles.optionalTag}>Optional</Text>
        </View>
        <View style={styles.card}>
          {kycLoading ? (
            <ActivityIndicator size="small" color={Colors.orange} />
          ) : kycData?.kyc?.length ? (
            kycData.kyc.map((doc, i) => {
              const approved = doc.status === 'APPROVED';
              const rejected = doc.status === 'REJECTED';
              const isImage = !!doc.file.mime?.startsWith('image/');
              return (
                <View key={doc.publicId}>
                  {i > 0 && <View style={styles.divider} />}
                  <View style={styles.kycRow}>
                    <View style={styles.kycRowLeft}>
                      {isImage ? (
                        <TouchableOpacity onPress={() => openKycDoc(doc)} activeOpacity={0.85}>
                          <Image source={{ uri: doc.file.url }} style={styles.kycThumb} resizeMode="cover" />
                        </TouchableOpacity>
                      ) : (
                        <View style={[styles.kycIcon, approved && styles.kycIconApproved, rejected && styles.kycIconRejected]}>
                          <Ionicons name="document-text-outline" size={20} color={Colors.ink3} />
                        </View>
                      )}
                      <View>
                        <Text style={styles.kycType}>{kycDocLabel(doc)}</Text>
                        <Text style={[styles.kycStatus, approved && { color: '#10b981' }, rejected && { color: '#e53e3e' }]}>
                          {doc.status}{isImage ? '' : ' · PDF'}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.kycViewBtn}
                      onPress={() => openKycDoc(doc)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.kycViewBtnText}>
                        {!isImage ? 'Open' : 'View'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Pending or rejected documents can still be approved (e.g. a re-check at the counter). */}
                  {!approved && (
                    <View style={styles.kycActions}>
                      {!rejected && (
                        <TouchableOpacity
                          style={[styles.kycActionBtn, styles.kycRejectBtn]}
                          onPress={() => kycMutation.mutate({ kycId: doc.publicId, status: 'REJECTED' })}
                          disabled={kycMutation.isPending}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="close" size={14} color="#e53e3e" />
                          <Text style={[styles.kycActionText, { color: '#e53e3e' }]}>Reject</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={[styles.kycActionBtn, styles.kycApproveBtn]}
                        onPress={() => kycMutation.mutate({ kycId: doc.publicId, status: 'APPROVED' })}
                        disabled={kycMutation.isPending}
                        activeOpacity={0.8}
                      >
                        {kycMutation.isPending
                          ? <ActivityIndicator size="small" color="#10b981" />
                          : <>
                              <Ionicons name="checkmark" size={14} color="#10b981" />
                              <Text style={[styles.kycActionText, { color: '#10b981' }]}>
                                {rejected ? 'Approve instead' : 'Approve'}
                              </Text>
                            </>
                        }
                      </TouchableOpacity>
                    </View>
                  )}

                  {approved && (
                    <View style={styles.kycApprovedBanner}>
                      <Ionicons name="checkmark-circle" size={14} color="#10b981" />
                      <Text style={styles.kycApprovedBannerText}>Document verified</Text>
                    </View>
                  )}
                </View>
              );
            })
          ) : (
            <View style={styles.kycEmpty}>
              <Ionicons name="document-outline" size={20} color={Colors.ink4} />
              <Text style={styles.kycEmptyText}>
                {dlNumberReported
                  ? "No document photos uploaded. They aren't needed for the handover."
                  : 'No document linked to this booking'}
              </Text>
            </View>
          )}
        </View>

        {/* Vehicle */}
        <SectionHeader title="Vehicle" />
        <View style={styles.card}>
          {vehicle && (
            <>
              <View style={styles.vehicleRow}>
                <View style={styles.vehicleIcon}>
                  <Ionicons name="car-outline" size={22} color={Colors.orange} />
                </View>
                <View>
                  <Text style={styles.vehicleName}>{vehicle.make} {vehicle.model}</Text>
                  <Text style={styles.vehicleReg}>{vehicle.regNo}</Text>
                </View>
              </View>
              {vehicle.odo !== null && (
                <View style={[styles.divider, { marginVertical: 12 }]} />
              )}
              {vehicle.odo !== null && (
                <View style={styles.odoRow}>
                  <Ionicons name="speedometer-outline" size={15} color={Colors.ink3} />
                  <Text style={styles.odoLabel}>Current Odometer</Text>
                  <Text style={styles.odoValue}>{vehicle.odo.toLocaleString('en-IN')} km</Text>
                </View>
              )}
            </>
          )}
        </View>

        {/* Vehicle availability swap (#51) — before the handover details are saved */}
        {!session && (
          <>
            <SectionHeader title="Vehicle Availability" />
            <VehicleSwapSection
              bookingId={booking.publicId}
              onSwapped={() => {
                refetch();
                qc.invalidateQueries({ queryKey: ['employee', 'available-vehicles', booking.publicId] });
              }}
            />
          </>
        )}

        {/* Booking Info */}
        <SectionHeader title="Booking" />
        <View style={styles.card}>
          <InfoRow icon="calendar-outline" label="Pickup" value={formatDate(booking.startAt)} />
          <View style={styles.divider} />
          <InfoRow icon="calendar-outline" label="Return" value={formatDate(booking.endAt)} />
          <View style={styles.divider} />
          <InfoRow
            icon="time-outline"
            label="Duration"
            // "12 hours" under a day (#5) — booking.days rounds a 12 h rental up to 1 day.
            value={
              rangeLengthLabel(new Date(booking.startAt), new Date(booking.endAt)) ??
              `${booking.days} day${booking.days !== 1 ? 's' : ''}`
            }
          />
          <View style={styles.divider} />
          <InfoRow
            icon="cash-outline"
            label="Total"
            value={`₹${Number(booking.totalFinal).toLocaleString('en-IN')}`}
          />
          {booking.isAdvancePayment && (
            <>
              <View style={styles.divider} />
              <InfoRow
                icon="checkmark-circle-outline"
                label="Advance Paid"
                value={`₹${Number(booking.advanceAmount).toLocaleString('en-IN')}`}
              />
              {booking.remainingPaidAt ? (
                <>
                  <View style={styles.divider} />
                  <InfoRow
                    icon="checkmark-done-outline"
                    label="Balance Paid"
                    value={`₹${Number(booking.remainingBalance).toLocaleString('en-IN')}`}
                  />
                </>
              ) : booking.remainingBalance ? (
                <>
                  <View style={styles.divider} />
                  <View style={styles.infoRow}>
                    <View style={styles.infoRowLeft}>
                      <Ionicons name="alert-circle-outline" size={15} color="#f59e0b" />
                      <Text style={[styles.infoLabel, { color: '#f59e0b' }]}>
                        {sessionMode ? 'Balance due at pickup' : 'Balance Due'}
                      </Text>
                    </View>
                    <Text style={[styles.infoValue, { color: '#f59e0b' }]}>
                      ₹{Number(booking.remainingBalance).toLocaleString('en-IN')}
                    </Text>
                  </View>
                </>
              ) : null}
            </>
          )}
        </View>

        {/* Rental terms — the allowance the drop bills extra km against */}
        {(allowance || fuelModuleEnabled || fastagModuleEnabled) && (
          <>
            <SectionHeader title="Rental Terms" />
            <View style={styles.card}>
              {allowance && (
                <>
                  <InfoRow
                    icon="gift-outline"
                    label="Free km"
                    value={`${allowance.includedKm.toLocaleString('en-IN')} km`}
                  />
                  <View style={styles.divider} />
                  <InfoRow
                    icon="trending-up-outline"
                    label="Extra km"
                    value={allowance.extraKmEnabled ? `${inr(num(allowance.extraKmRate))}/km` : 'Not charged'}
                  />
                </>
              )}
              {fuelModuleEnabled && (
                <>
                  {allowance && <View style={styles.divider} />}
                  <InfoRow icon="water-outline" label="Fuel tracking" value="Enabled" />
                </>
              )}
              {fastagModuleEnabled && (
                <>
                  {(allowance || fuelModuleEnabled) && <View style={styles.divider} />}
                  <InfoRow icon="card-outline" label="FASTag charges" value="Enabled" />
                </>
              )}
              <Text style={styles.termsNote}>Tell the customer before handing over the keys.</Text>
            </View>
          </>
        )}

        {/* Booking extension at counter (#53) */}
        <TouchableOpacity
          style={styles.extendBtn}
          onPress={() => router.push({
            pathname: '/employee/extension',
            params: { bookingId: booking.publicId, endAt: booking.endAt, make: vehicle?.make ?? '', model: vehicle?.model ?? '' },
          })}
          activeOpacity={0.85}
        >
          <Ionicons name="calendar-outline" size={18} color={Colors.ink2} />
          <Text style={styles.extendBtnText}>Extend booking</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />
        </TouchableOpacity>
        {/* Reschedule (P4c): a new pickup time, same length and price — the
            sheet says why when it can't move (e.g. a counter payment is open) */}
        <TouchableOpacity
          style={styles.extendBtn}
          onPress={() => setRescheduleOpen(true)}
          activeOpacity={0.85}
        >
          <Ionicons name="time-outline" size={18} color={Colors.ink2} />
          <Text style={styles.extendBtnText}>Reschedule pickup</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />
        </TouchableOpacity>

        {/* Payment ledger */}
        <SectionHeader title="Payment" />
        <CounterPaymentPanel bookingPublicId={booking.publicId} />

        {session ? (
          <>
            {/* Saved with the session — the vehicle goes out when it's settled */}
            <SectionHeader title="Handover Details" />
            {(recordedOdo != null || recordedFuel != null) && (
              <View style={styles.card}>
                {recordedOdo != null && (
                  <InfoRow icon="speedometer-outline" label="Odometer" value={`${recordedOdo.toLocaleString('en-IN')} km`} />
                )}
                {recordedFuel != null && (
                  <>
                    {recordedOdo != null && <View style={styles.divider} />}
                    <InfoRow icon="water-outline" label="Fuel level" value={`${recordedFuel}/10`} />
                  </>
                )}
              </View>
            )}
            {/* Original driving licence (#3), as saved with the session — still changeable */}
            <DlStatusCard
              booking={booking}
              onUpdated={(r) => {
                // Keep this screen's choice in step, so the summary after payment is right.
                if (r?.dlStatus) setDlStatus(r.dlStatus);
                refetch();
              }}
            />

            {/* The bill */}
            <SectionHeader title="Bill" />
            <SessionBill session={session} />

            {/* Safety deposit — a refundable line on the bill */}
            {depositOpen ? (
              <View style={[styles.card, { marginTop: 8 }]}>
                <Text style={styles.fieldLabelSolo}>Safety deposit amount (₹)</Text>
                <TextInput
                  style={styles.odoInput}
                  value={sDepositAmt}
                  onChangeText={(t) => { setSDepositAmt(t.replace(/[^0-9]/g, '')); setDepositError(null); }}
                  placeholder="e.g. 2000"
                  placeholderTextColor={Colors.ink4}
                  keyboardType="numeric"
                />
                <Text style={[styles.fieldLabelSolo, { marginTop: 12 }]}>Reason</Text>
                <TextInput
                  style={[styles.odoInput, styles.reasonInput]}
                  value={sDepositReason}
                  onChangeText={(t) => { setSDepositReason(t); setDepositError(null); }}
                  placeholder="e.g. High-value vehicle"
                  placeholderTextColor={Colors.ink4}
                  multiline
                />
                {depositError && <Text style={styles.fieldError}>{depositError}</Text>}
                <View style={[styles.methodRow, { marginTop: 12 }]}>
                  <TouchableOpacity
                    style={styles.methodBtn}
                    onPress={() => { setDepositOpen(false); setDepositError(null); }}
                    disabled={sessionBusy}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.methodText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.methodBtn, styles.methodBtnActive, sessionBusy && styles.btnDisabled]}
                    onPress={saveDeposit}
                    disabled={sessionBusy}
                    activeOpacity={0.8}
                  >
                    {sessionAction === 'deposit' ? <ActivityIndicator size="small" color={Colors.white} /> : (
                      <Text style={[styles.methodText, styles.methodTextActive]}>
                        {depositEntry ? 'Update deposit' : 'Add to bill'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : depositEntry ? (
              <View style={[styles.card, { marginTop: 8 }]}>
                <View style={styles.toggleRow}>
                  <View style={styles.toggleTextWrap}>
                    <Text style={styles.toggleTitle}>Safety deposit {inr(num(depositEntry.amount))}</Text>
                    {!!depositEntry.description && (
                      <Text style={styles.toggleSub} numberOfLines={2}>{depositEntry.description}</Text>
                    )}
                  </View>
                  <View style={styles.linkRow}>
                    <TouchableOpacity onPress={() => openDepositForm(depositEntry)} disabled={sessionBusy} hitSlop={8}>
                      <Text style={styles.link}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={removeDeposit} disabled={sessionBusy} hitSlop={8}>
                      {sessionAction === 'removeDeposit'
                        ? <ActivityIndicator size="small" color="#dc3545" />
                        : <Text style={styles.linkDanger}>Remove</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
                {depositError && <Text style={styles.fieldError}>{depositError}</Text>}
              </View>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.extendBtn, { marginTop: 8 }, sessionBusy && styles.btnDisabled]}
                  onPress={() => openDepositForm()}
                  disabled={sessionBusy}
                  activeOpacity={0.85}
                >
                  <Ionicons name="shield-checkmark-outline" size={18} color={Colors.ink2} />
                  <Text style={styles.extendBtnText}>Add safety deposit</Text>
                  <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />
                </TouchableOpacity>
                {depositError && <Text style={styles.fieldError}>{depositError}</Text>}
              </>
            )}

            {/* Coupon — a discount line on the bill */}
            <View style={[styles.card, { marginTop: 4 }]}>
              {discountEntry ? (
                <View style={styles.toggleRow}>
                  <View style={styles.toggleTextWrap}>
                    <Text style={styles.toggleTitle}>{discountEntry.description || 'Coupon discount'}</Text>
                    <Text style={[styles.toggleSub, { color: '#10b981' }]}>−{inr(num(discountEntry.amount))} off the bill</Text>
                    {couponNote ? <Text style={styles.toggleSub}>{couponNote}</Text> : null}
                  </View>
                  <TouchableOpacity onPress={removeCoupon} disabled={sessionBusy} hitSlop={8}>
                    {sessionAction === 'removeCoupon'
                      ? <ActivityIndicator size="small" color="#dc3545" />
                      : <Text style={styles.linkDanger}>Remove</Text>}
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={styles.fieldLabelSolo}>Coupon code</Text>
                  <View style={styles.couponRow}>
                    <TextInput
                      style={[styles.odoInput, styles.couponInput]}
                      value={couponCode}
                      onChangeText={(t) => { setCouponCode(t.toUpperCase()); setCouponError(null); }}
                      placeholder="Enter coupon code"
                      placeholderTextColor={Colors.ink4}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      returnKeyType="done"
                      onSubmitEditing={applyCoupon}
                    />
                    <TouchableOpacity
                      style={[styles.couponBtn, (!couponCode.trim() || sessionBusy) && styles.btnDisabled]}
                      onPress={applyCoupon}
                      disabled={!couponCode.trim() || sessionBusy}
                      activeOpacity={0.85}
                    >
                      {sessionAction === 'coupon'
                        ? <ActivityIndicator size="small" color={Colors.white} />
                        : <Text style={styles.couponBtnText}>Apply</Text>}
                    </TouchableOpacity>
                  </View>
                </>
              )}
              {couponError && <Text style={styles.fieldError}>{couponError}</Text>}
            </View>

            {/* How the customer pays */}
            {net > 0 && (
              <View style={[styles.card, { marginTop: 4 }]}>
                {/* Cash / UPI (photo of the payment screen) / Split / Credit (#3 / #11) */}
                <CounterPaymentPicker
                  ctl={pay}
                  amount={net}
                  disabled={sessionBusy}
                  creditNotice={depositEntry ? (
                    <View style={styles.creditDepositNote}>
                      <Text style={styles.creditDepositText}>
                        This bill carries a {inr(num(depositEntry.amount))} safety deposit, which can't go on credit.
                      </Text>
                      <TouchableOpacity onPress={removeDeposit} disabled={sessionBusy} hitSlop={8}>
                        {sessionAction === 'removeDeposit'
                          ? <ActivityIndicator size="small" color="#dc3545" />
                          : <Text style={styles.linkDanger}>Remove deposit</Text>}
                      </TouchableOpacity>
                    </View>
                  ) : undefined}
                />
              </View>
            )}

            {/* Overpaid: pay the difference back — Cash, or UPI with an optional transfer photo */}
            {net < 0 && (
              <View style={[styles.card, { marginTop: 4 }]}>
                <CounterRefundPicker ctl={refundPay} amount={Math.abs(net)} disabled={sessionBusy} />
              </View>
            )}
          </>
        ) : (
          <>
            {/* Vehicle State */}
            <SectionHeader title="Record Vehicle State" />
            <View style={styles.card}>
              {/* Odometer */}
              <View ref={odoRef} style={styles.fieldGroup}>
                <View style={styles.fieldLabel}>
                  <Ionicons name="speedometer-outline" size={16} color={Colors.ink3} />
                  <Text style={styles.fieldLabelText}>Odometer Reading (km)</Text>
                </View>
                <TextInput
                  style={styles.odoInput}
                  value={odo}
                  onChangeText={(t) => setOdo(t.replace(/[^0-9]/g, ''))}
                  placeholder="e.g. 12500"
                  placeholderTextColor={Colors.ink4}
                  keyboardType="numeric"
                  returnKeyType="done"
                  onFocus={() => {
                    setTimeout(() => {
                      odoRef.current?.measureLayout(
                        contentRef.current as any,
                        (_x, y) => { scrollRef.current?.scrollTo({ y: y - 20, animated: true }); },
                        () => {}
                      );
                    }, 150);
                  }}
                />
                {odo !== '' && !odoValid && (
                  <Text style={styles.fieldErrorTight}>Odometer must be more than 0.</Text>
                )}
              </View>

              <View style={styles.divider} />

              {/* Fuel Level (1–10) */}
              <View style={[styles.fieldGroup, { marginBottom: 0 }]}>
                <View style={styles.fieldLabel}>
                  <Ionicons name="water-outline" size={16} color={Colors.ink3} />
                  <Text style={styles.fieldLabelText}>
                    {fuelModuleEnabled ? 'Pickup Fuel Level' : 'Fuel Level'}
                    {fuelLevel != null ? ` (${fuelLevel}/10)` : ''}
                  </Text>
                  {fuelLevel == null && <Text style={styles.requiredTag}>Required</Text>}
                </View>
                <View style={styles.fuelGrid}>
                  {FUEL_STEPS.map((lvl) => (
                    <TouchableOpacity
                      key={lvl}
                      style={[styles.fuelPill, fuelLevel === lvl && styles.fuelPillActive]}
                      onPress={() => setFuelLevel(lvl)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.fuelPillText, fuelLevel === lvl && styles.fuelPillTextActive]}>{lvl}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            {/* Pre-delivery photos */}
            <SectionHeader title="Pre-delivery Photos" />
            <View style={styles.card}>
              {captureFields.length === 0 && (
                <Text style={styles.photoHint}>Capture the vehicle's condition before handover.</Text>
              )}
              <PhotoCaptureSection
                fields={captureFields}
                allowGeneric
                value={photos}
                onChange={setPhotos}
                upload={async (form) => {
                  const res = await employeeApi.uploadPickupImage(form);
                  return { fileId: res.data.fileId, url: res.data.url };
                }}
                genericLabel="Add"
                onPendingChange={setPendingPhotos}
              />
            </View>

            {/* Safety deposit request (#49) — legacy flow, only when the branch enables it.
                With payment sessions the deposit is added to the bill on the next step. */}
            {!sessionMode && depositEnabled && (
              <>
                <SectionHeader title="Safety Deposit" />
                <View style={styles.card}>
                  <TouchableOpacity
                    style={styles.toggleRow}
                    onPress={() => setRequestDeposit((v) => !v)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.toggleTextWrap}>
                      <Text style={styles.toggleTitle}>Request a safety deposit</Text>
                      <Text style={styles.toggleSub}>Collect a refundable hold against damage/fines.</Text>
                    </View>
                    <View style={[styles.switch, requestDeposit && styles.switchOn]}>
                      <View style={[styles.knob, requestDeposit && styles.knobOn]} />
                    </View>
                  </TouchableOpacity>
                  {requestDeposit && (
                    <>
                      <View style={styles.divider} />
                      <View style={styles.fieldGroup}>
                        <View style={styles.fieldLabel}>
                          <Ionicons name="cash-outline" size={16} color={Colors.ink3} />
                          <Text style={styles.fieldLabelText}>Deposit amount (₹)</Text>
                        </View>
                        <TextInput
                          style={styles.odoInput}
                          value={depositAmount}
                          onChangeText={(t) => setDepositAmount(t.replace(/[^0-9]/g, ''))}
                          placeholder="0"
                          placeholderTextColor={Colors.ink4}
                          keyboardType="numeric"
                          returnKeyType="done"
                        />
                      </View>
                      <View style={[styles.fieldGroup, { marginBottom: 0 }]}>
                        <View style={styles.fieldLabel}>
                          <Ionicons name="create-outline" size={16} color={Colors.ink3} />
                          <Text style={styles.fieldLabelText}>Reason</Text>
                        </View>
                        <TextInput
                          style={[styles.odoInput, styles.reasonInput]}
                          value={depositReason}
                          onChangeText={setDepositReason}
                          placeholder="e.g. High-value vehicle"
                          placeholderTextColor={Colors.ink4}
                          multiline
                        />
                      </View>
                      {booking.frozenChargeConfig?.safetyDepositRequiresApproval && (
                        <Text style={styles.depositNote}>This request will need manager approval.</Text>
                      )}
                    </>
                  )}
                </View>
              </>
            )}

            {/* Original driving licence (#3) — optional (X1): nothing pre-selected, and
                the handover goes ahead without it. */}
            <SectionHeader title="Original Licence" />
            <View style={[styles.card, dlRejected && styles.cardError]}>
              <View style={styles.toggleRow}>
                <View style={[styles.toggleTitleRow, styles.toggleTextWrap]}>
                  <Text style={styles.toggleTitle}>What happened to the original licence?</Text>
                  <Text style={styles.optionalTag}>Optional</Text>
                </View>
                {dlStatus && (
                  <TouchableOpacity
                    onPress={() => { setDlStatus(null); setDlRejected(false); }}
                    hitSlop={8}
                  >
                    <Text style={styles.link}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={[styles.toggleSub, styles.dlSub]}>
                Leave it unset if it doesn't apply. It can also be recorded after the handover.
              </Text>
              <DlStatusSelector
                value={dlStatus}
                onChange={(v) => { setDlStatus(v); setDlRejected(false); }}
              />
            </View>

            {/* Manager confirmation escalation (#50) — legacy flow only */}
            {!sessionMode && (
              <>
                <SectionHeader title="Confirmation" />
                <View style={styles.card}>
                  <TouchableOpacity
                    style={styles.toggleRow}
                    onPress={() => setRequireManager((v) => !v)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.toggleTextWrap}>
                      <Text style={styles.toggleTitle}>Require manager confirmation</Text>
                      <Text style={styles.toggleSub}>Send to a manager to confirm instead of completing now.</Text>
                    </View>
                    <View style={[styles.switch, requireManager && styles.switchOn]}>
                      <View style={[styles.knob, requireManager && styles.knobOn]} />
                    </View>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {sessionMode && (
              <Text style={styles.nextStepNote}>
                Next: review the bill, add a safety deposit or coupon, and collect the payment.
              </Text>
            )}
            {/* #20 — the counter coupon lives on the Unified Payments pickup bill only */}
            {!sessionMode && booking.status === 'CONFIRMED' && (
              <Text style={styles.nextStepNote}>
                Counter coupons need Unified Payments, which this branch doesn't use.
              </Text>
            )}
          </>
        )}

        {/* Error */}
        {errorMsg && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color="#e53e3e" />
            <Text style={styles.errorBoxText}>{errorMsg}</Text>
          </View>
        )}
        </View>
      </ScrollView>

      {/* Footer CTA */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        {session ? (
          <TouchableOpacity
            style={[styles.confirmBtn, sessionBusy && styles.confirmBtnDisabled]}
            onPress={settleSession}
            disabled={sessionBusy}
            activeOpacity={0.85}
          >
            {settling ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={20} color={Colors.white} />
                <Text style={styles.confirmBtnText}>
                  {net > 0
                    ? pay.method === 'CREDIT'
                      ? `Put ${inr(net)} on credit & hand over`
                      : `Collect ${inr(net)} & hand over`
                    : net < 0 ? `Refund ${inr(net)} & hand over` : 'Complete Pickup'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <>
            {handoverBlocker && <Text style={styles.footerHint} numberOfLines={2}>{handoverBlocker}</Text>}
            <TouchableOpacity
              style={[styles.confirmBtn, (!!handoverBlocker || mutation.isPending || initiating) && styles.confirmBtnDisabled]}
              onPress={sessionMode ? startSession : handleConfirm}
              disabled={!!handoverBlocker || mutation.isPending || initiating}
              activeOpacity={0.85}
            >
              {mutation.isPending || initiating ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : sessionMode ? (
                <>
                  <Text style={styles.confirmBtnText}>Continue to Payment</Text>
                  <Ionicons name="arrow-forward" size={20} color={Colors.white} />
                </>
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={20} color={Colors.white} />
                  <Text style={styles.confirmBtnText}>Confirm Pickup</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>

    <ConfirmModal
      visible={showConfirm}
      icon="car-outline"
      iconColor={Colors.orange}
      title="Confirm Pickup"
      message={`Odometer: ${odo} km · Fuel: ${fuelLevel ?? '—'}/10\n${termsLine ? `${termsLine}\n` : ''}${handoverDlNumber ? `DL number: ${handoverDlNumber}\n` : ''}${dlSummary}\n\nHand over the vehicle to ${customer.name}?`}
      confirmLabel="Confirm Pickup"
      confirmColor={Colors.orange}
      onConfirm={() => { setShowConfirm(false); mutation.mutate(); }}
      onCancel={() => setShowConfirm(false)}
    />
      <ImageViewer
        visible={!!kycViewer}
        images={kycViewer ? [{ url: kycViewer.url, label: kycViewer.label }] : []}
        onClose={() => setKycViewer(null)}
      />
      {/* P4c — move the pickup (and the return with it) for the customer */}
      <RescheduleSheet
        visible={rescheduleOpen}
        bookingPublicId={booking.publicId}
        onClose={() => setRescheduleOpen(false)}
        onRescheduled={(_result, message) => {
          setRescheduleOpen(false);
          qc.invalidateQueries({ queryKey: ['employee', 'pickups'] });
          qc.invalidateQueries({ queryKey: ['employee', 'pickup', bookingId] });
          refetch();
          Alert.alert('Booking rescheduled', message);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  loader: { marginTop: 100 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 12,
  },
  back: { width: 36, height: 36, justifyContent: 'center' },
  headerText: { gap: 2 },
  title: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  subtitle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },

  content: { paddingHorizontal: 20 },
  contentInner: { gap: 8 },

  sectionHeader: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 4,
  },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 16,
    marginBottom: 4,
  },

  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 4 },
  sectionHeaderInline: { marginTop: 0, marginBottom: 0 },
  optionalTag: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: Colors.ink3,
    backgroundColor: '#0a0a0a0d',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden',
  },

  // Driving licence number (X2)
  dlNumberRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dlNumberIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#ff6a1f12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dlNumberIconMissing: { backgroundColor: '#f59e0b15' },
  dlNumberValue: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink, letterSpacing: 0.6 },
  dlNumberValueMissing: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: '#d97706', letterSpacing: 0 },
  dlNumberInput: { letterSpacing: 1 },
  dlNumberKeep: { alignSelf: 'flex-start', marginTop: 12 },

  customerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.white },
  customerInfo: { flex: 1 },
  customerName: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.ink },
  customerPhone: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, marginTop: 2 },

  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  vehicleIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#ff6a1f12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleName: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.ink },
  vehicleReg: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, marginTop: 2 },

  odoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  odoLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, flex: 1 },
  odoValue: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },

  divider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 12 },

  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  infoValue: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink, flexShrink: 1, textAlign: 'right', marginLeft: 12 },

  termsNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 12 },

  fieldGroup: { gap: 10, marginBottom: 12 },
  fieldLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldLabelText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3 },
  fieldLabelSolo: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3, marginBottom: 8 },
  fieldError: { fontFamily: Fonts.body, fontSize: 12, color: '#e53e3e', marginTop: 8 },
  fieldErrorTight: { fontFamily: Fonts.body, fontSize: 12, color: '#e53e3e' },

  odoInput: {
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 18,
    color: Colors.ink,
  },
  inputError: { borderColor: '#e53e3e' },

  fuelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fuelPill: {
    width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline,
  },
  fuelPillActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  fuelPillText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink3 },
  fuelPillTextActive: { color: Colors.white },

  photoHint: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, marginBottom: 12 },
  hintInline: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },

  extendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 4,
  },
  extendBtnText: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink2 },
  btnDisabled: { opacity: 0.5 },

  reasonInput: { minHeight: 64, textAlignVertical: 'top', fontFamily: Fonts.body, fontSize: 15 },
  depositNote: { fontFamily: Fonts.body, fontSize: 12, color: '#d97706', marginTop: 10 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  toggleTextWrap: { flex: 1 },
  toggleTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  toggleTitleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  requiredTag: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: '#e53e3e',
    backgroundColor: '#e53e3e10',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  cardError: { borderColor: '#e53e3e60' },
  dlSub: { marginBottom: 12 },
  dlCardWide: { width: '100%' },
  toggleSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 2, lineHeight: 16 },
  switch: {
    width: 46, height: 28, borderRadius: 14, backgroundColor: Colors.hairline,
    padding: 3, justifyContent: 'center',
  },
  switchOn: { backgroundColor: Colors.orange },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.white },
  knobOn: { alignSelf: 'flex-end' },

  link: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.orange },
  linkDanger: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: '#dc3545' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },

  nextStepNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17, paddingHorizontal: 4, marginTop: 4 },

  // Session bill
  billRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 },
  billLabelWrap: { flex: 1 },
  billLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, flexShrink: 1 },
  billSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink4, marginTop: 1 },
  billValue: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  billCredit: { color: '#10b981' },
  billNetLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  billNetValue: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },

  couponRow: { flexDirection: 'row', gap: 8 },
  couponInput: { flex: 1, fontSize: 15, letterSpacing: 1 },
  couponBtn: {
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 76,
  },
  couponBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.white },

  methodRow: { flexDirection: 'row', gap: 8 },
  methodBtn: { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline },
  methodBtnActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  methodText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink3 },
  methodTextActive: { color: Colors.white },

  // Credit picked on a bill with a safety deposit (#11)
  creditDepositNote: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  creditDepositText: { flex: 1, fontFamily: Fonts.body, fontSize: 12, color: Colors.ink2, lineHeight: 17 },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#e53e3e10',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e53e3e30',
    marginTop: 4,
  },
  errorBoxText: { fontFamily: Fonts.body, fontSize: 13, color: '#e53e3e', flex: 1 },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink3 },

  // KYC
  kycRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kycRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kycIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kycIconApproved: { backgroundColor: '#10b98112', borderColor: '#10b98130' },
  kycIconRejected: { backgroundColor: '#e53e3e12', borderColor: '#e53e3e30' },
  kycType: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  kycStatus: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 1 },
  kycViewBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  kycViewBtnText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  kycThumb: { width: 48, height: 48, borderRadius: 10, backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: Colors.hairline },
  kycImageWrap: {
    marginTop: 12,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.hairline,
    backgroundColor: '#f5f5f5',
  },
  kycImage: { width: '100%', height: 220 },
  kycZoomHint: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  kycZoomHintText: { fontFamily: Fonts.bodyMedium, fontSize: 11, color: Colors.white },
  kycActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  kycActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  kycApproveBtn: { backgroundColor: '#10b98110', borderColor: '#10b98130' },
  kycRejectBtn: { backgroundColor: '#e53e3e10', borderColor: '#e53e3e30' },
  kycActionText: { fontFamily: Fonts.bodySemiBold, fontSize: 13 },
  kycApprovedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    backgroundColor: '#10b98110',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#10b98130',
  },
  kycApprovedBannerText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: '#10b981' },
  kycEmpty: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kycEmptyText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },

  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: Colors.bg,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
  },
  footerHint: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 12,
    color: Colors.ink3,
    textAlign: 'center',
    marginBottom: 10,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.orange,
    borderRadius: 16,
    paddingVertical: 17,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  confirmBtnDisabled: { opacity: 0.45, shadowOpacity: 0 },
  confirmBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },

  successBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  // successBody inside a ScrollView (the "nothing to hand over" view).
  successBodyScroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 16,
    gap: 16,
  },
  successIcon: {
    width: 100,
    height: 100,
    borderRadius: 30,
    backgroundColor: '#10b98115',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  waitingIcon: { backgroundColor: '#d9770615' },
  successTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 28,
    color: Colors.ink,
    letterSpacing: -0.8,
    textAlign: 'center',
  },
  successSub: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink3,
    textAlign: 'center',
    lineHeight: 22,
  },
  successDetails: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 16,
    width: '100%',
    gap: 10,
    marginTop: 8,
  },
  successRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  successRowText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink2, flexShrink: 1 },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    backgroundColor: Colors.surface,
    paddingVertical: 15,
    width: '100%',
    marginTop: 8,
  },
  refreshBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink2 },
  doneBtn: {
    backgroundColor: Colors.ink,
    borderRadius: 16,
    paddingVertical: 17,
    paddingHorizontal: 40,
    alignItems: 'center',
    marginTop: 8,
    width: '100%',
  },
  doneBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },
});

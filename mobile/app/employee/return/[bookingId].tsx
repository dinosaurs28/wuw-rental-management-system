import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import ConfirmModal from '../../../components/ui/ConfirmModal';
import ImageViewer, { type ViewerImage } from '../../../components/ui/ImageViewer';
import RemainingBalanceCollect from '../../../components/employee/RemainingBalanceCollect';
import LedgerSummaryCard from '../../../components/ui/LedgerSummaryCard';
import PhotoCaptureSection, { type CapturedPhoto } from '../../../components/employee/PhotoCaptureSection';
import CounterPaymentPanel from '../../../components/employee/CounterPaymentPanel';
import CounterPaymentPicker, {
  CounterRefundPicker,
  useCounterPayment,
  useCounterRefund,
} from '../../../components/employee/CounterPaymentPicker';
import SafetyDepositAtDrop from '../../../components/employee/SafetyDepositAtDrop';
import ActiveRentalSwap from '../../../components/employee/ActiveRentalSwap';
import { DlStatusCard } from '../../../components/employee/DlStatus';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import {
  apiErrorMessage,
  handleShiftRequired,
} from '../../../lib/counterErrors';
import {
  SAFETY_DEPOSIT_HANDLING_LABELS,
  counterChoiceLabel,
  type DropDeposit,
  type SafetyDepositHandling,
} from '../../../lib/counterPayment';
import type { FinancialState, ReturnSession } from '../../../types/api';
import type { DropDamage, DropDiscount, ReturnBooking, ReturnKmSummary } from '../../../types/return';
import type {
  CompleteReturnResponse,
  DropBill,
  RentalTimeline,
  ReturnLateSummary,
} from '../../../types/return';
import RentalTimeBlock from '../../../components/employee/drop/RentalTimeBlock';
import LateReturnCard from '../../../components/employee/drop/LateReturnCard';
import DropBillCard, {
  LegacyReturnChargesCard,
  SwapChargesCard,
} from '../../../components/employee/drop/DropBillCard';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// Discount the client keeps and resends with every compute (the server
// re-applies whatever the compute body carries).
interface AppliedDiscount {
  amount: number;
  reason: string;
}

const DAMAGE_DECISION_MESSAGE = 'Choose "No damage", or save the damage you found, before completing the drop.';
const VEHICLE_SWAPPED_KM_NOTE = "Vehicle was swapped without odometer readings — km driven can't be measured.";
const WAIVE_REASON_MESSAGE = 'Give a reason for waiving the late charge (at least 3 characters).';

const num = (x: unknown) => Number(x ?? 0) || 0;
const inr = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const km = (n: number) => `${n.toLocaleString('en-IN')} km`;

// Booking times in IST (the branch's business time), whatever the device zone.
function formatDate(iso: string) {
  const opts: Intl.DateTimeFormatOptions = {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  };
  try {
    return new Date(iso).toLocaleDateString('en-IN', { ...opts, timeZone: 'Asia/Kolkata' });
  } catch {
    return new Date(iso).toLocaleDateString('en-IN', opts);
  }
}

// Odometer readings are whole km (the server rejects decimals).
const isWholeKm = (s: string) => /^\d+$/.test(s.trim());

// Fuel is recorded in bars, "1".."10" (pickup and return).
const FUEL_LEVELS = Array.from({ length: 10 }, (_, i) => String(i + 1));
const fuelBars = (level: string | null | undefined): number | null =>
  level && /^([1-9]|10)$/.test(level) ? Number(level) : null;
const fuelLabel = (level: string) => (fuelBars(level) != null ? `${level}/10` : level);

// Settlement methods (#3 / #11): Cash · UPI (photo of the customer's payment
// screen) · Split · Credit — components/employee/CounterPaymentPicker. Refunds:
// Cash or UPI (optional transfer photo).

interface OtherChargeLine {
  id: string;
  label: string;
  amount: string;
}
const newOtherLine = (): OtherChargeLine => ({ id: String(Date.now() + Math.random()), label: '', amount: '' });

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

function InfoRow({ icon, label, value, valueColor }: { icon: IoniconName; label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoRowLeft}>
        <Ionicons name={icon} size={15} color={Colors.ink3} />
        <Text style={styles.infoLabel}>{label}</Text>
      </View>
      <Text style={[styles.infoValue, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
    </View>
  );
}

function ChargeToggle({
  label, enabled, onToggle, children,
}: { label: string; enabled: boolean; onToggle: (v: boolean) => void; children?: React.ReactNode }) {
  return (
    <View style={styles.toggleBlock}>
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Switch
          value={enabled}
          onValueChange={onToggle}
          trackColor={{ false: Colors.ink4, true: Colors.orange }}
          thumbColor={Colors.white}
        />
      </View>
      {enabled && children}
    </View>
  );
}

export default function ReturnScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [done, setDone] = useState(false);
  const [photoViewer, setPhotoViewer] = useState<{ images: ViewerImage[]; index: number } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [requireManager, setRequireManager] = useState(false);
  // Legacy complete response: return charges the branch manager collects.
  const [legacyResult, setLegacyResult] = useState<CompleteReturnResponse | null>(null);

  // Late return (#12): the MANUAL-grace tick and the waiver are resent with
  // every compute while they should stay.
  const [applyGrace, setApplyGrace] = useState(false);
  const [waiveLate, setWaiveLate] = useState(false);
  const [waiveReason, setWaiveReason] = useState('');
  const [waiveError, setWaiveError] = useState<string | null>(null);
  // Extra km typed by staff — only when a swap left km unmeasurable.
  const [manualKm, setManualKm] = useState('');

  // charge inputs
  const [endOdo, setEndOdo] = useState('');
  const [fuelLevel, setFuelLevel] = useState<string>(''); // '1'..'10'
  const [chargeFuel, setChargeFuel] = useState(false);
  const [fuelAmt, setFuelAmt] = useState('');
  const [chargeFastag, setChargeFastag] = useState(false);
  const [fastagAmt, setFastagAmt] = useState('');
  const [fastagNote, setFastagNote] = useState('');
  const [chargeOther, setChargeOther] = useState(false);
  const [otherLines, setOtherLines] = useState<OtherChargeLine[]>(() => [newOtherLine()]);
  // Explicit damage check, required before settling / completing (like the web).
  const [damageDecision, setDamageDecision] = useState<'NO_DAMAGE' | 'DAMAGE_FOUND' | null>(null);

  // discount (after compute)
  const [discount, setDiscount] = useState<AppliedDiscount | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountAmt, setDiscountAmt] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [discountError, setDiscountError] = useState<string | null>(null);

  const [returnPhotos, setReturnPhotos] = useState<CapturedPhoto[]>([]);
  // Photos taken but still uploading — they'd be missing from returnImageIds.
  const [photosPending, setPhotosPending] = useState(0);
  const [session, setSession] = useState<ReturnSession | null>(null);
  // A drop bill (RETURN session) exists on the server — computed here or found
  // on reload, even when cleared for "Edit charges". No swap from then on.
  const [returnStarted, setReturnStarted] = useState(false);
  const [kmSummary, setKmSummary] = useState<ReturnKmSummary | null>(null);
  // Sticky once the server says extra km can't be auto-calculated (vehicle swap),
  // so the local preview stops showing km math after "Edit charges".
  const [kmAutoSkipped, setKmAutoSkipped] = useState<ReturnKmSummary['autoKmSkipped']>(null);
  const [serverDiscount, setServerDiscount] = useState<DropDiscount | null>(null);
  // Drop bill (no GST on drop charges, item 8) and the late line's summary, from the compute.
  const [bill, setBill] = useState<DropBill | null>(null);
  const [lateSummary, setLateSummary] = useState<ReturnLateSummary | null>(null);
  // Rental timeline from the last compute / restore (late part measured to the
  // bill's frozen return time); the booking's own copy otherwise.
  const [serverTimeline, setServerTimeline] = useState<RentalTimeline | null>(null);
  const [computing, setComputing] = useState(false);
  // Set when damages changed but the bill could not be recomputed yet.
  const [billStale, setBillStale] = useState(false);
  const [recomputeTick, setRecomputeTick] = useState(0);
  const [deletingDamageId, setDeletingDamageId] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  // How the drop bill is settled: Cash / UPI (photo) / Split / Credit for a
  // balance due; Cash / UPI for a refund or the deposit refunded in full.
  const pay = useCounterPayment('CASH');
  const refundPay = useCounterRefund();
  // Safety deposit at drop (#6): set off against the charges (default) or
  // refunded in full — resent on every compute; `dropDeposit` is the split.
  const [depositHandling, setDepositHandling] = useState<SafetyDepositHandling>('SET_OFF');
  const [dropDeposit, setDropDeposit] = useState<DropDeposit | null>(null);
  // What the settlement did, for the success screen (credit / refunds).
  const [settledNote, setSettledNote] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);

  // Android is edge-to-edge (SDK 54): scroll the focused field (UTR, discount,
  // odometer…) above the keyboard.
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
  const computeBusyRef = useRef(false);
  const pendingRecomputeRef = useRef(false);
  const settleBusyRef = useRef(false);
  // True once charges were computed from this screen's inputs — only then can a
  // recompute (after a damage/discount change) rebuild the same body.
  const computedHereRef = useRef(false);
  const restoreTriedRef = useRef(false);
  const damageSigRef = useRef<string | null>(null);

  const { data: booking, isLoading, isError, refetch } = useQuery<ReturnBooking>({
    queryKey: ['employee', 'return', bookingId],
    queryFn: async () => {
      const res = await employeeApi.getReturnDetails(bookingId as string);
      return res.data?.data as ReturnBooking;
    },
    enabled: !!bookingId,
    staleTime: 30_000,
    retry: false,
  });

  // Money position (same cache as the Payment panel): the safety deposit held
  // before the drop bill exists (#6) and any remaining balance on credit (#11).
  const { data: fin } = useQuery<FinancialState | null>({
    queryKey: ['employee', 'financial-state', booking?.publicId],
    queryFn: async () => {
      const res = await employeeApi.financialState(booking!.publicId);
      return (res.data?.data ?? null) as FinancialState | null;
    },
    enabled: !!booking?.publicId,
    staleTime: 15_000,
    retry: false,
  });
  // Deposit taken at pickup and not yet credited back (#6) — before the drop bill exists.
  const depositHeldBefore = num(fin?.safetyDepositHeld);
  // The legacy rental balance was put on credit (#11): still owed, not paid.
  const balanceOnCredit = !!fin?.credit?.pendingSections?.some((s) =>
    s.sectionKey.startsWith('credit:remaining_payment:'),
  );

  // Pre-delivery reference photos captured at pickup (#55) — for condition comparison.
  const { data: pickupCaptures = [] } = useQuery({
    queryKey: ['employee', 'pickup-captures', bookingId],
    queryFn: async () => {
      const res = await employeeApi.getPickupCaptures(bookingId as string);
      return (res.data?.photos ?? []) as Array<{ publicId: string; captureLabel: string | null; url: string; mime: string }>;
    },
    enabled: !!bookingId,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Damages recorded at this drop. Session flow bills charged ones on compute;
  // legacy branches leave the charge to the manager's damage review.
  const {
    data: damages = [],
    isSuccess: damagesLoaded,
    isError: damagesError,
    isFetching: damagesFetching,
    refetch: refetchDamages,
  } = useQuery<DropDamage[]>({
    queryKey: ['employee', 'return-damages', bookingId],
    queryFn: async () => {
      const res = await employeeApi.listDropDamages(bookingId as string);
      return (res.data?.data?.damages ?? []) as DropDamage[];
    },
    enabled: !!bookingId && !!booking,
    retry: false,
  });

  // Back from the damage / extension screens: pick up new damages and the
  // (possibly extended) booking. The first focus is the initial load.
  const focusedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnceRef.current) {
        focusedOnceRef.current = true;
        return;
      }
      // The refetched booking carries the current rental timeline (an extension
      // may have moved the end time).
      setServerTimeline(null);
      refetch();
      refetchDamages();
    }, [refetch, refetchDamages]),
  );

  const applyKm = (k: ReturnKmSummary | null) => {
    setKmSummary(k);
    if (k?.autoKmSkipped) setKmAutoSkipped(k.autoKmSkipped);
  };

  // Restore an in-progress session on reload (session flow only). Runs once —
  // "Edit charges" must not pull the server session straight back in.
  useEffect(() => {
    if (!bookingId || !booking?.usePaymentSessions || restoreTriedRef.current) return;
    restoreTriedRef.current = true;
    (async () => {
      try {
        const res = await employeeApi.getReturnSession(bookingId as string);
        const data = res.data?.data;
        const s = data?.session as ReturnSession | undefined;
        if (!mountedRef.current || computedHereRef.current || !s || s.status === 'COMPLETED') return;
        setReturnStarted(true);
        if (data?.rentalTimeline) setServerTimeline(data.rentalTimeline as RentalTimeline);
        // Keep the late-return choices the bill was computed with for "Edit charges".
        const late = (data?.late ?? null) as ReturnLateSummary | null;
        if (late?.waived) {
          setWaiveLate(true);
          setWaiveReason(late.waiverReason ?? '');
        }
        if (late?.graceType === 'MANUAL' && late.graceApplied) setApplyGrace(true);
        const d = (data?.discount ?? null) as DropDiscount | null;
        if (d) setDiscount({ amount: num(d.amount), reason: d.reason });
        // Keep the deposit choice the bill was computed with (#6); null on older bills.
        const dep = (data?.deposit ?? null) as DropDeposit | null;
        if (dep?.handling) setDepositHandling(dep.handling);
        // An extension moved the end time since this bill was computed, or the
        // bill still carries GST on drop charges (computed before item 8) — the
        // server refuses payment on it, so start from the charges form.
        if (data?.billStale) {
          setNotice(
            data?.billStaleReason === 'DROP_GST_REMOVED'
              ? 'Drop charges no longer carry GST — enter the return details and compute the charges again to update the bill.'
              : 'The rental period changed since the drop bill was computed — enter the return details and compute the charges again.',
          );
          return;
        }
        setSession(s);
        applyKm((data?.km ?? null) as ReturnKmSummary | null);
        setBill((data?.bill ?? null) as DropBill | null);
        setLateSummary(late);
        setServerDiscount(d);
        setDropDeposit(dep);
      } catch {
        /* no active session — start fresh */
      }
    })();
  }, [bookingId, booking?.usePaymentSessions]);

  const vehicle = booking?.items[0]?.vehicle;
  const customer = booking?.customer.user;
  const hasRemainingBalance =
    !!booking &&
    booking.isAdvancePayment &&
    num(booking.remainingBalance) > 0 &&
    !booking.remainingPaidAt;
  // Legacy drop already recorded and sent for the manager's confirmation — the
  // vehicle is back; nothing more to inspect or bill here.
  const awaitingManager = booking?.status === 'PICKED_UP' && !!booking.requiresManagerConfirmation;

  // Odometer at the original pickup (shown under "State at Pickup").
  const pickupOdo = booking?.startOdometer ?? null;
  // Mid-rental swaps with readings are measured segment by segment: km on the
  // vehicles already handed back + this vehicle from its start reading.
  const kmSegments = booking?.kmSegments ?? null;
  const swappedMidRental = (kmSegments?.swapCount ?? 0) > 0;
  const startOdo = kmSegments?.complete
    ? kmSegments.currentStartOdometer ?? pickupOdo
    : pickupOdo;
  const priorKm = kmSegments?.complete ? kmSegments.priorKm : 0;
  const allowance = booking?.kmAllowance ?? null;
  // Swap recorded WITHOUT readings: km can't be measured (no end ≥ start
  // check); only staff-entered extra km is billed.
  const vehicleSwapped =
    allowance?.autoKmSkipped === 'VEHICLE_SWAPPED' ||
    kmAutoSkipped === 'VEHICLE_SWAPPED' ||
    kmSegments?.complete === false;
  const manualKmAllowed = !!allowance?.manualExtraKmAllowed;
  // Read-only preview of the server's extra-km charge (same formula as compute),
  // at face value — no GST on drop charges (item 8).
  const kmPreview = useMemo(() => {
    const e = parseFloat(endOdo);
    if (!Number.isFinite(e)) return null;
    const driven = priorKm + Math.max(0, e - (startOdo ?? e));
    if (!allowance) return { driven, belowStart: startOdo != null && e < startOdo, allowance: null };
    const rate = num(allowance.extraKmRate);
    const extra = Math.max(0, driven - allowance.includedKm);
    return {
      driven,
      belowStart: startOdo != null && e < startOdo,
      allowance: {
        included: allowance.includedKm,
        extra,
        rate,
        enabled: allowance.extraKmEnabled,
        charge: allowance.extraKmEnabled ? Math.ceil(extra * rate) : 0,
      },
    };
  }, [endOdo, startOdo, priorKm, allowance]);
  // Staff-entered extra km preview (swap without readings), at the allowance rate.
  const manualKmPreview = useMemo(() => {
    if (!manualKmAllowed || !allowance || !isWholeKm(manualKm)) return null;
    const extra = Number(manualKm);
    const rate = num(allowance.extraKmRate);
    return { extra, rate, enabled: allowance.extraKmEnabled, charge: allowance.extraKmEnabled ? Math.ceil(extra * rate) : 0 };
  }, [manualKmAllowed, allowance, manualKm]);

  // Rental timeline (#7) — the compute's copy once there is one.
  const timeline = serverTimeline ?? booking?.rentalTimeline ?? null;
  // Late-return controls apply only while the vehicle is out and late.
  const lateShown = !!timeline && booking?.status === 'PICKED_UP' && timeline.lateMinutes > 0;
  const manualGrace =
    !!timeline && timeline.gracePolicyEnabled && timeline.graceType === 'MANUAL' && timeline.graceMinutes > 0;

  // Late return / manual km fields of a compute or legacy-complete body.
  // Returns an error message when a field is invalid.
  const dropExtras = (): { error: string } | {
    applyGrace?: boolean;
    waiveLateCharge?: { reason: string };
    manualExtraKm?: number;
  } => {
    const extras: { applyGrace?: boolean; waiveLateCharge?: { reason: string }; manualExtraKm?: number } = {};
    if (lateShown && waiveLate) {
      const reason = waiveReason.trim();
      if (reason.length < 3) {
        setWaiveError(WAIVE_REASON_MESSAGE);
        return { error: WAIVE_REASON_MESSAGE };
      }
      extras.waiveLateCharge = { reason };
    }
    if (manualGrace && applyGrace) extras.applyGrace = true;
    if (manualKmAllowed && manualKm.trim()) {
      if (!isWholeKm(manualKm)) return { error: 'Enter the extra km as a whole number.' };
      extras.manualExtraKm = Number(manualKm);
    }
    setWaiveError(null);
    return extras;
  };

  const fuelModuleEnabled = !!booking?.frozenChargeConfig?.fuelModuleEnabled;
  // FASTag tolls only when the branch module is on AND the vehicle has a tag.
  const fastagEnabled = !!booking?.frozenChargeConfig?.fastagModuleEnabled && !!vehicle?.hasFastag;

  // Fuel: return level defaults to the pickup level; a lower level is a deficit,
  // priced at the vehicle's ₹-per-bar rate (still editable) — same as the web.
  const pickupBars = fuelBars(booking?.pickupFuelLevel);
  const fuelBarRate = num(vehicle?.fuelBar);
  const returnBars = fuelBars(fuelLevel);
  const fuelDeficitBars = pickupBars != null && returnBars != null ? pickupBars - returnBars : 0;

  useEffect(() => {
    if (booking?.pickupFuelLevel && fuelBars(booking.pickupFuelLevel) != null) {
      setFuelLevel((cur) => cur || booking.pickupFuelLevel!);
    }
  }, [booking?.pickupFuelLevel]);

  // A mid-rental swap (#13) changes the vehicle being handed back: readings
  // typed for the previous car no longer apply (its odometer would be measured
  // against the replacement's start), and the fuel default is the new car's.
  const vehicleSig = booking
    ? `${booking.items[0]?.vehicle.publicId ?? ''}|${booking.kmSegments?.swapCount ?? 0}`
    : null;
  const vehicleSigRef = useRef<string | null>(null);
  useEffect(() => {
    if (vehicleSig == null) return;
    const prev = vehicleSigRef.current;
    vehicleSigRef.current = vehicleSig;
    if (prev === null || prev === vehicleSig) return;
    setEndOdo('');
    setManualKm('');
    setKmAutoSkipped(null);
    const startFuel = booking?.pickupFuelLevel;
    setFuelLevel(startFuel && fuelBars(startFuel) != null ? startFuel : '');
    setChargeFuel(false);
    setFuelAmt('');
    setNotice('Vehicle swapped — enter the end odometer and fuel level of the vehicle being returned now.');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleSig]);

  const selectFuelLevel = (level: string) => {
    setFuelLevel(level);
    const deficit = pickupBars != null ? pickupBars - Number(level) : 0;
    if (deficit > 0 && fuelBarRate > 0) {
      setChargeFuel(true);
      setFuelAmt(String(Math.ceil(deficit * fuelBarRate)));
    } else {
      setChargeFuel(false);
      setFuelAmt('');
    }
  };

  // Damage recorded at drop means damage was found (e.g. after a reload).
  useEffect(() => {
    if (damages.length > 0) setDamageDecision('DAMAGE_FOUND');
  }, [damages.length]);
  const damageStepDone =
    damageDecision === 'NO_DAMAGE' || (damageDecision === 'DAMAGE_FOUND' && damages.length > 0);

  // Leaves the computed view for the charges form (a restored session's
  // inputs aren't on this screen, so it can't be recomputed in place).
  const backToForm = (message: string) => {
    setSession(null);
    setKmSummary(null);
    setServerDiscount(null);
    setBill(null);
    setDropDeposit(null);
    setLateSummary(null);
    setBillStale(false);
    setNotice(message);
  };

  const runCompute = async (
    nextDiscount: AppliedDiscount | null,
    source: 'form' | 'discount' | 'auto',
    // #6 — a new deposit choice to compute with (the current one otherwise)
    nextHandling?: SafetyDepositHandling,
  ): Promise<boolean> => {
    if (!booking || photosPending > 0) return false;
    if (computeBusyRef.current) {
      if (source === 'auto') pendingRecomputeRef.current = true;
      return false;
    }
    if (!isWholeKm(endOdo)) {
      setErrorMsg('Enter the end odometer reading in whole km.');
      return false;
    }
    const endOdoNum = Number(endOdo.trim());
    if (fuelModuleEnabled && fuelBars(fuelLevel) == null) {
      setErrorMsg('Select the return fuel level.');
      return false;
    }
    if (returnPhotos.length === 0) {
      setErrorMsg('Take at least one return photo.');
      return false;
    }
    const extras = dropExtras();
    if ('error' in extras) {
      setErrorMsg(extras.error);
      return false;
    }
    setErrorMsg(null);
    if (source !== 'auto') setDiscountError(null);
    computeBusyRef.current = true;
    setComputing(true);
    try {
      const body: Parameters<typeof employeeApi.computeReturnSession>[1] = {
        endOdometer: endOdoNum,
        returnImageIds: returnPhotos.map((p) => p.fileId),
      };
      if (fuelBars(fuelLevel) != null) body.returnFuelLevel = fuelLevel;
      if (chargeFuel && num(fuelAmt) > 0) body.fuelCharge = num(fuelAmt);
      if (chargeFastag && num(fastagAmt) > 0) {
        body.fastagAmount = num(fastagAmt);
        if (fastagNote.trim()) body.fastagNotes = fastagNote.trim();
      }
      if (chargeOther) {
        const lines = otherLines
          .filter((l) => l.label.trim() && num(l.amount) > 0)
          .map((l) => ({ label: l.label.trim(), amount: num(l.amount) }));
        if (lines.length > 0) body.otherCharges = lines;
      }
      if (nextDiscount) body.discount = nextDiscount;
      // Safety deposit at drop (#6) — resent on every compute
      const handling = nextHandling ?? depositHandling;
      body.safetyDepositHandling = handling;
      Object.assign(body, extras);
      const res = await employeeApi.computeReturnSession(bookingId as string, body);
      const data = res.data?.data;
      computedHereRef.current = true;
      if (mountedRef.current) {
        setReturnStarted(true);
        setSession(data?.session as ReturnSession);
        applyKm((data?.km ?? null) as ReturnKmSummary | null);
        setBill((data?.bill ?? null) as DropBill | null);
        setLateSummary((data?.late ?? null) as ReturnLateSummary | null);
        if (data?.rentalTimeline) setServerTimeline(data.rentalTimeline as RentalTimeline);
        setServerDiscount((data?.discount ?? null) as DropDiscount | null);
        setDiscount(nextDiscount);
        setDiscountError(null);
        setDepositHandling(handling);
        setDropDeposit((data?.deposit ?? null) as DropDeposit | null);
        setBillStale(false);
        setNotice(null);
      }
      return true;
    } catch (err: any) {
      if (!mountedRef.current) return false;
      const code = err?.response?.data?.code;
      const message = apiErrorMessage(err, 'Could not compute charges.');
      if (source === 'auto') setBillStale(true);
      if (code === 'EXTENSION_PENDING' || code === 'LATE_RATE_UNAVAILABLE' || code === 'RETURN_AWAITING_MANAGER') {
        // An extension is unpaid / awaiting the manager, or the car became late
        // since the screen opened (no extra-hour rate: the late card with its
        // waive control appears once the timeline is fresh) — refresh it.
        setServerTimeline(null);
        refetch();
        setErrorMsg(message);
      } else if (code === 'DISCOUNT_EXCEEDS_CHARGES' && session) {
        setDiscountError(message);
      } else {
        setErrorMsg(message);
      }
      return false;
    } finally {
      computeBusyRef.current = false;
      if (mountedRef.current) {
        if (pendingRecomputeRef.current) {
          pendingRecomputeRef.current = false;
          // Re-run after the next render so it reads the latest state; stays
          // "computing" until then so the stale bill can't be settled.
          setRecomputeTick((t) => t + 1);
        } else {
          setComputing(false);
        }
      }
    }
  };

  // Damages changed after charges were computed → the bill must be recomputed.
  const recomputeForDamages = () => {
    if (!session || session.status === 'COMPLETED') return;
    if (!computedHereRef.current) {
      backToForm('Damages changed — enter the return details and compute the charges again.');
      return;
    }
    setBillStale(true);
    void runCompute(discount, 'auto');
  };
  const recomputeRef = useRef(recomputeForDamages);
  recomputeRef.current = recomputeForDamages;

  useEffect(() => {
    if (recomputeTick === 0) return;
    setComputing(false);
    recomputeRef.current();
  }, [recomputeTick]);

  const damageSig = damages.map((d) => `${d.publicId}:${d.amount}:${d.chargeCustomer}`).join('|');
  useEffect(() => {
    if (!damagesLoaded) return;
    const prev = damageSigRef.current;
    damageSigRef.current = damageSig;
    if (prev !== null && prev !== damageSig) recomputeRef.current();
  }, [damagesLoaded, damageSig]);

  const compute = () => { void runCompute(discount, 'form'); };

  const applyDiscount = async () => {
    const amount = Number(discountAmt);
    const reason = discountReason.trim();
    if (!Number.isFinite(amount) || amount <= 0) {
      setDiscountError('Enter a discount amount.');
      return;
    }
    if (reason.length < 3) {
      setDiscountError('Enter a reason (at least 3 characters).');
      return;
    }
    setDiscountError(null);
    if (!computedHereRef.current) {
      setDiscount({ amount, reason });
      setDiscountOpen(false);
      backToForm('Enter the return details and compute the charges again to apply the discount.');
      return;
    }
    const ok = await runCompute({ amount, reason }, 'discount');
    if (ok && mountedRef.current) {
      setDiscountOpen(false);
      setDiscountAmt('');
      setDiscountReason('');
    }
  };

  const removeDiscount = () => {
    setDiscountError(null);
    if (!session) {
      setDiscount(null);
      return;
    }
    if (!computedHereRef.current) {
      setDiscount(null);
      backToForm('Enter the return details and compute the charges again to remove the discount.');
      return;
    }
    void runCompute(null, 'discount');
  };

  // Safety deposit at drop (#6): before the bill exists the choice just rides
  // along; on a computed bill it is recomputed (a restored bill's inputs aren't
  // on this screen, so it goes back to the form like the discount does).
  const changeDepositHandling = (next: SafetyDepositHandling) => {
    if (next === depositHandling) return;
    if (!session) {
      setDepositHandling(next);
      return;
    }
    if (!computedHereRef.current) {
      setDepositHandling(next);
      backToForm(`Enter the return details and compute the charges again to ${next === 'REFUND_IN_FULL' ? 'refund the deposit in full' : 'set the deposit off against the charges'}.`);
      return;
    }
    void runCompute(discount, 'discount', next);
  };

  const openDiscountForm = () => {
    setDiscountAmt(serverDiscount ? String(num(serverDiscount.amount)) : '');
    setDiscountReason(serverDiscount?.reason ?? '');
    setDiscountError(null);
    setDiscountOpen(true);
  };

  const deleteDamage = async (d: DropDamage) => {
    if (deletingDamageId) return;
    setDeletingDamageId(d.publicId);
    setErrorMsg(null);
    try {
      await employeeApi.deleteDropDamage(bookingId as string, d.publicId);
      // The damage-list change triggers the recompute.
      await refetchDamages();
    } catch (err: any) {
      if (mountedRef.current) setErrorMsg(apiErrorMessage(err, 'Could not remove the damage.'));
    } finally {
      if (mountedRef.current) setDeletingDamageId(null);
    }
  };

  const confirmDeleteDamage = (d: DropDamage) => {
    Alert.alert('Remove damage?', `${d.area} (${d.severity}) will be removed from this drop.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { void deleteDamage(d); } },
    ]);
  };

  const onSettled = () => {
    qc.invalidateQueries({ queryKey: ['employee', 'returns'] });
    qc.invalidateQueries({ queryKey: ['employee', 'dashboard-stats'] });
    qc.invalidateQueries({ queryKey: ['employee', 'financial-state', booking?.publicId] });
    if (mountedRef.current) setDone(true);
  };

  const settleSession = async () => {
    if (!session || settleBusyRef.current) return;
    if (!damageStepDone) {
      setErrorMsg(DAMAGE_DECISION_MESSAGE);
      return;
    }
    const net = num(session.netPayable);
    // Deposit refunded in full (#6): paid back in the same settlement.
    const depositRefundAmt = dropDeposit?.refundVia === 'PAYMENT_DEPOSIT_REFUND' ? num(dropDeposit.refund) : 0;
    // Cash / UPI (payment-screen photo) / Split / Credit for a balance due (#3 / #11)
    const choice = net > 0 ? pay.resolve(net) : null;
    if (net > 0 && !choice) return;
    // Cash / UPI for money going back: the bill's refund, or the deposit in full
    const refundChoice = net < 0 || depositRefundAmt > 0 ? refundPay.resolve() : null;
    if ((net < 0 || depositRefundAmt > 0) && !refundChoice) return;
    const depositRefund = depositRefundAmt > 0 && refundChoice
      ? {
        depositRefund: {
          method: refundChoice.method,
          ...(refundChoice.proofFileId ? { proof_file_id: refundChoice.proofFileId } : {}),
        },
      }
      : {};
    settleBusyRef.current = true;
    setSettling(true);
    setErrorMsg(null);
    try {
      if (net < 0 && refundChoice) {
        await employeeApi.recordSessionRefund(session.publicId, {
          method: refundChoice.method,
          amount: Math.abs(net),
          idempotencyKey: `refund:${session.publicId}`,
          ...(refundChoice.proofFileId ? { proof_file_id: refundChoice.proofFileId } : {}),
        });
      } else if (net === 0 || !choice) {
        await employeeApi.recordSessionPayment(session.publicId, {
          method: 'CASH',
          amount: 0,
          idempotencyKey: `zero-balance:${session.publicId}`,
          ...depositRefund,
        });
      } else {
        const idempotencyKey = `settle:${session.publicId}`;
        await employeeApi.recordSessionPayment(
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
              ...depositRefund,
            }
            : choice.method === 'UPI'
              ? { method: 'UPI', amount: net, idempotencyKey, proof_file_id: choice.proofFileId, ...depositRefund }
              : choice.method === 'CREDIT'
                ? { method: 'CREDIT', amount: net, idempotencyKey, collateral: choice.collateral, ...depositRefund }
                : { method: 'CASH', amount: net, idempotencyKey, ...depositRefund },
        );
      }
      // What happened to the money, for the success screen.
      const refundedAmt = net < 0 ? Math.abs(net) : depositRefundAmt;
      const notes = [
        choice?.method === 'CREDIT' ? `${inr(net)} ${counterChoiceLabel(choice).charAt(0).toLowerCase()}${counterChoiceLabel(choice).slice(1)} — the branch manager clears it when the customer pays.` : null,
        refundedAmt > 0 && refundChoice
          ? refundChoice.method === 'CASH'
            ? `${inr(refundedAmt)} ${depositRefundAmt > 0 ? 'deposit ' : ''}refunded in cash — the branch manager acknowledges it.`
            : `${inr(refundedAmt)} ${depositRefundAmt > 0 ? 'deposit ' : ''}refunded by UPI.`
          : null,
      ].filter(Boolean);
      if (mountedRef.current) setSettledNote(notes.length ? notes.join('\n') : null);
      onSettled();
    } catch (err: any) {
      if (!mountedRef.current) return;
      if (handleShiftRequired(err)) return;
      // Photo / split / collateral problems show under the picker they belong to:
      // the payment's photo is checked first, the deposit refund's after it.
      const paymentHasPhoto = choice?.method === 'UPI' || choice?.method === 'SPLIT';
      if (net > 0 && (paymentHasPhoto || !refundChoice) && pay.showServerError(err)) return;
      if (refundChoice && refundPay.showServerError(err)) return;
      if (net > 0 && pay.showServerError(err)) return;
      // The bill now refunds the deposit in full (computed elsewhere) — reload it
      // so the refund method can be chosen.
      if (err?.response?.data?.code === 'DEPOSIT_REFUND_METHOD_REQUIRED') {
        if (computedHereRef.current) void runCompute(discount, 'auto');
        else backToForm('The deposit is refunded in full on this bill — enter the return details and compute the charges again.');
      }
      // 409 (DROP_BILL_STALE): the bill changed since the last compute (a damage
      // was added or removed, an extension moved the end time, or the amount
      // drifted) — recompute so staff collect the new amount on the next tap.
      if (err?.response?.status === 409) {
        refetch();
        refetchDamages();
        if (!computedHereRef.current) {
          backToForm('The bill changed — enter the return details and compute the charges again.');
          return;
        }
        void runCompute(discount, 'auto');
      }
      setErrorMsg(apiErrorMessage(err, 'Could not settle the return.'));
    } finally {
      settleBusyRef.current = false;
      if (mountedRef.current) setSettling(false);
    }
  };

  const requestLegacyComplete = () => {
    if (photosPending > 0) return;
    if (returnPhotos.length === 0) {
      setErrorMsg('Take at least one return photo.');
      return;
    }
    if (!damageStepDone) {
      setErrorMsg(DAMAGE_DECISION_MESSAGE);
      return;
    }
    // The server bills extra km from this reading (manager collects it).
    if (!isWholeKm(endOdo)) {
      setErrorMsg('Enter the end odometer reading in whole km.');
      return;
    }
    const extras = dropExtras();
    if ('error' in extras) {
      setErrorMsg(extras.error);
      return;
    }
    setErrorMsg(null);
    setShowConfirm(true);
  };

  // Legacy (no payment sessions): the server records km and bills extra km /
  // late return for the branch manager to collect.
  const completeLegacy = async () => {
    if (settleBusyRef.current) return;
    const extras = dropExtras();
    if ('error' in extras || !isWholeKm(endOdo)) {
      setErrorMsg('error' in extras ? extras.error : 'Enter the end odometer reading in whole km.');
      return;
    }
    settleBusyRef.current = true;
    setSettling(true);
    setErrorMsg(null);
    try {
      const res = await employeeApi.completeReturn(bookingId as string, {
        returnImageIds: returnPhotos.map((p) => p.fileId),
        ...(requireManager ? { requireManagerConfirmation: true } : {}),
        endOdometer: Number(endOdo.trim()),
        ...extras,
        // #6 — recorded for the branch manager's settlement when a deposit is held
        ...(depositHeldBefore > 0 ? { safetyDepositHandling: depositHandling } : {}),
      });
      if (mountedRef.current) setLegacyResult((res.data ?? null) as CompleteReturnResponse | null);
      onSettled();
    } catch (err: any) {
      if (!mountedRef.current) return;
      // 409: the branch now uses payment sessions (or pricing / GST isn't set
      // up) — refetch so the screen shows the current state.
      if (err?.response?.status === 409) {
        setServerTimeline(null);
        refetch();
      }
      setErrorMsg(apiErrorMessage(err, 'Could not complete the return.'));
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

  if (isError || !booking || !vehicle || !customer) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.title}>Return</Text>
        </View>
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={44} color={Colors.ink4} />
          <Text style={styles.errorText}>Could not load booking details.</Text>
        </View>
      </View>
    );
  }

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
          <Text style={styles.successTitle}>{requireManager ? 'Sent for Confirmation' : 'Return Complete'}</Text>
          <Text style={styles.successSub}>
            {requireManager
              ? `${vehicle.make} ${vehicle.model}'s return for ${customer.name} was sent to a manager for confirmation. It is not RETURNED yet.`
              : `${vehicle.make} ${vehicle.model} has been returned by ${customer.name}. Status updated to RETURNED.`}
            {!requireManager && damages.length > 0 ? ' The vehicle is with the manager for a damage check.' : ''}
          </Text>
          {/* Credit / refunds recorded with the drop bill (#6 / #11) */}
          {settledNote && <Text style={styles.settledNote}>{settledNote}</Text>}
          {legacyResult && <LegacyReturnChargesCard result={legacyResult} />}
          {legacyResult?.safetyDeposit && (
            <Text style={styles.settledNote}>
              Safety deposit {inr(num(legacyResult.safetyDeposit.amount))}:{' '}
              {SAFETY_DEPOSIT_HANDLING_LABELS[legacyResult.safetyDeposit.handling]?.toLowerCase() ?? legacyResult.safetyDeposit.handling}
              {' '}— the branch manager settles it.
            </Text>
          )}
          <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/(employee)/bookings')} activeOpacity={0.85}>
            <Text style={styles.doneBtnText}>Back to Queue</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const net = session ? num(session.netPayable) : 0;
  const sessionDone = session?.status === 'COMPLETED';
  const safetyDeposit = num(booking.safetyDeposit);
  // Deposit refunded in full on this bill (#6): paid back with the settlement.
  const depositRefundDue = dropDeposit?.refundVia === 'PAYMENT_DEPOSIT_REFUND' ? num(dropDeposit.refund) : 0;
  // Footer action, e.g. "Collect ₹300, refund ₹2,000 deposit & complete".
  const settleParts = [
    net > 0 ? (pay.method === 'CREDIT' ? `Put ${inr(net)} on credit` : `Collect ${inr(net)}`) : null,
    net < 0 ? `Refund ${inr(net)}` : null,
    depositRefundDue > 0 ? `${net > 0 ? 'refund' : 'Refund'} ${inr(depositRefundDue)} deposit` : null,
  ].filter(Boolean);
  const settleLabel = settleParts.length ? `${settleParts.join(', ')} & complete` : 'Complete Return';
  const showDamages = !hasRemainingBalance && !sessionDone && !awaitingManager;
  // The bill on screen may not include the latest damages yet.
  const billBusy = computing || billStale || damagesFetching || !!deletingDamageId;

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
            <Text style={styles.title}>Return</Text>
            <Text style={styles.subtitle}>#{booking.publicId.slice(-8).toUpperCase()}</Text>
          </View>
          <View style={styles.returnBadge}>
            <Text style={styles.returnBadgeText}>RETURN</Text>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          innerViewRef={contentRef as React.RefObject<View>}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Remaining rental balance — must be collected first */}
          {hasRemainingBalance && (
            <RemainingBalanceCollect
              bookingId={booking.publicId}
              amount={num(booking.remainingBalance)}
              context="return"
              onCollected={() => {
                qc.invalidateQueries({ queryKey: ['employee', 'return', bookingId] });
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
                {customer.phone && <Text style={styles.customerPhone}>{customer.phone}</Text>}
              </View>
            </View>
          </View>

          {/* Original driving licence status (#3, D6): what to hand back; Fleet can change it */}
          <DlStatusCard booking={booking} context="return" onUpdated={() => refetch()} />

          {/* Vehicle */}
          <SectionHeader title="Vehicle" />
          <View style={styles.card}>
            {booking.items.map(({ vehicle: v }, i) => (
              <View key={v.publicId ?? i}>
                {i > 0 && <View style={styles.divider} />}
                <View style={styles.vehicleRow}>
                  <View style={styles.vehicleIcon}>
                    <Ionicons name="car-outline" size={22} color="#3b82f6" />
                  </View>
                  <View>
                    <Text style={styles.vehicleName}>{v.make} {v.model}</Text>
                    <Text style={styles.vehicleReg}>{v.regNo}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>

          {/* Booking */}
          <SectionHeader title="Booking" />
          <View style={styles.card}>
            <InfoRow icon="calendar-outline" label="Pickup" value={formatDate(booking.startAt)} />
            <View style={styles.divider} />
            {timeline && timeline.extendedMinutes > 0 && (
              <>
                <InfoRow icon="calendar-outline" label="Originally due" value={formatDate(timeline.originalEndAt)} />
                <View style={styles.divider} />
              </>
            )}
            <InfoRow icon="calendar-outline" label="Return Due" value={formatDate(booking.endAt)} />
            <View style={styles.divider} />
            {/* Original / extended / late / total rental time (#7) */}
            {timeline && (
              <>
                <RentalTimeBlock timeline={timeline} />
                <View style={styles.divider} />
              </>
            )}
            <InfoRow icon="cash-outline" label="Total" value={inr(num(booking.totalFinal))} />
            {safetyDeposit > 0 && (
              <>
                <View style={styles.divider} />
                <InfoRow icon="shield-checkmark-outline" label="Security deposit" value={inr(safetyDeposit)} valueColor="#10b981" />
              </>
            )}
            {booking.isAdvancePayment && (
              <>
                <View style={styles.divider} />
                <InfoRow
                  icon={booking.remainingPaidAt ? 'checkmark-done-outline' : 'alert-circle-outline'}
                  label="Rental balance"
                  value={booking.remainingPaidAt ? (balanceOnCredit ? 'On credit' : 'Paid') : `${inr(num(booking.remainingBalance))} due`}
                  valueColor={booking.remainingPaidAt && !balanceOnCredit ? '#10b981' : '#f59e0b'}
                />
              </>
            )}
          </View>

          {/* Sent to the manager earlier — show it instead of the drop steps */}
          {awaitingManager && (
            <View style={styles.noticeBox}>
              <Ionicons name="time-outline" size={16} color="#d97706" />
              <Text style={styles.noticeText}>
                This return was recorded{booking.returnedAt ? ` at ${formatDate(booking.returnedAt)}` : ''} and sent to the branch manager to confirm. Nothing more to do here.
              </Text>
            </View>
          )}

          {/* Extend an active rental (before charges are computed) */}
          {booking.status === 'PICKED_UP' && !session && !awaitingManager && (
            <TouchableOpacity
              style={styles.extendBtn}
              onPress={() => router.push({
                pathname: '/employee/extension',
                params: { bookingId: booking.publicId, endAt: booking.endAt, make: vehicle.make, model: vehicle.model },
              })}
              activeOpacity={0.85}
            >
              <Ionicons name="calendar-outline" size={18} color={Colors.ink2} />
              <Text style={styles.extendBtnText}>Extend rental</Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />
            </TouchableOpacity>
          )}

          {/* Swap the car mid-rental (#13, before the drop bill) + this booking's swap history */}
          <ActiveRentalSwap
            bookingId={booking.publicId}
            canSwap={booking.status === 'PICKED_UP' && !session && !returnStarted && !awaitingManager}
          />

          {/* Payment ledger */}
          <SectionHeader title="Payment" />
          <CounterPaymentPanel bookingPublicId={booking.publicId} />

          {/* State at pickup */}
          {(pickupOdo != null || booking.pickupFuelLevel) && (
            <>
              <SectionHeader title="State at Pickup" />
              <View style={styles.card}>
                {pickupOdo != null && (
                  <InfoRow icon="speedometer-outline" label="Odometer" value={km(pickupOdo)} />
                )}
                {(() => {
                  // After a mid-rental swap pickupFuelLevel is the replacement's fuel at the swap.
                  const pickupFuel = swappedMidRental
                    ? booking.originalPickupFuelLevel ?? null
                    : booking.pickupFuelLevel;
                  return pickupFuel ? (
                    <>
                      {pickupOdo != null && <View style={styles.divider} />}
                      <InfoRow icon="water-outline" label="Fuel level" value={fuelLabel(pickupFuel)} />
                    </>
                  ) : null;
                })()}
                {/* Mid-rental swap (#13): km is measured per vehicle */}
                {swappedMidRental && kmSegments && (
                  kmSegments.complete ? (
                    <>
                      <View style={styles.divider} />
                      <InfoRow
                        icon="swap-horizontal-outline"
                        label={kmSegments.swapCount > 1 ? 'Km on swapped-out vehicles' : 'Km on swapped-out vehicle'}
                        value={km(kmSegments.priorKm)}
                      />
                      {kmSegments.currentStartOdometer != null && (
                        <>
                          <View style={styles.divider} />
                          <InfoRow
                            icon="speedometer-outline"
                            label="Current vehicle at swap"
                            value={km(kmSegments.currentStartOdometer)}
                          />
                        </>
                      )}
                      {booking.pickupFuelLevel && (
                        <>
                          <View style={styles.divider} />
                          <InfoRow
                            icon="water-outline"
                            label="Fuel at swap"
                            value={fuelLabel(booking.pickupFuelLevel)}
                          />
                        </>
                      )}
                    </>
                  ) : (
                    <Text style={styles.hint}>{VEHICLE_SWAPPED_KM_NOTE}</Text>
                  )
                )}
              </View>
            </>
          )}

          {/* Pre-delivery reference photos (#55) */}
          {pickupCaptures.length > 0 && (
            <>
              <SectionHeader title="Pre-delivery Condition" />
              <View style={styles.card}>
                <Text style={styles.hint}>Photos from pickup — compare against the vehicle's current condition.</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.captureStrip}
                >
                  {pickupCaptures.map((p, i) => (
                    <TouchableOpacity
                      key={p.publicId}
                      style={styles.captureThumbWrap}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel="View pickup photo"
                      onPress={() =>
                        setPhotoViewer({
                          images: pickupCaptures.map((c) => ({ url: c.url, label: c.captureLabel })),
                          index: i,
                        })
                      }
                    >
                      <Image source={{ uri: p.url }} style={styles.captureThumb} resizeMode="cover" />
                      {p.captureLabel ? (
                        <Text style={styles.captureLabel} numberOfLines={1}>{p.captureLabel}</Text>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </>
          )}

          {/* Return condition photos — required before compute / complete (like the web) */}
          {!hasRemainingBalance && !session && !awaitingManager && (
            <>
              <SectionHeader title="Return Condition Photos" />
              <View style={styles.card}>
                <Text style={styles.hintInline}>
                  Photograph the vehicle's condition at return — at least one photo is required (4–6 recommended).
                </Text>
                <View style={{ height: 12 }} />
                <PhotoCaptureSection
                  value={returnPhotos}
                  onChange={setReturnPhotos}
                  upload={async (form) => {
                    const res = await employeeApi.uploadReturnImage(form);
                    return { fileId: res.data.fileId, url: res.data.url };
                  }}
                  genericLabel="Add"
                  onPendingChange={setPhotosPending}
                />
              </View>
            </>
          )}

          {/* === Charges / settlement (only once rental balance is clear) === */}
          {/* Odometer on every branch: legacy drops bill extra km too (#21) */}
          {!hasRemainingBalance && !session && !awaitingManager && (
            <>
              <SectionHeader title="Return Inspection" />
              <View style={styles.card}>
                {/* Odometer */}
                <Text style={styles.fieldLabel}>End odometer (km)</Text>
                <TextInput
                  style={styles.input}
                  value={endOdo}
                  onChangeText={setEndOdo}
                  placeholder={startOdo != null && !vehicleSwapped ? `≥ ${startOdo}` : '0'}
                  placeholderTextColor={Colors.ink4}
                  keyboardType="number-pad"
                  returnKeyType="done"
                />
                {vehicleSwapped ? (
                  <View style={styles.kmPreview}>
                    <Text style={styles.kmPreviewText}>{VEHICLE_SWAPPED_KM_NOTE}</Text>
                  </View>
                ) : kmPreview && (
                  <View style={styles.kmPreview}>
                    <Text style={styles.kmPreviewText}>
                      Km driven {kmPreview.driven.toLocaleString('en-IN')}
                      {priorKm > 0 ? ` (incl. ${priorKm.toLocaleString('en-IN')} on the swapped-out vehicle)` : ''}
                      {kmPreview.allowance
                        ? ` · Included ${kmPreview.allowance.included.toLocaleString('en-IN')}`
                          + (kmPreview.allowance.enabled
                            ? ` · Extra ${kmPreview.allowance.extra.toLocaleString('en-IN')} km × ${inr(kmPreview.allowance.rate)} = ${inr(kmPreview.allowance.charge)} (no GST)`
                            : ' · Extra km not charged')
                        : ''}
                    </Text>
                    {kmPreview.allowance && allowance?.freeKmOriginal != null && (allowance.freeKmExtensions ?? 0) > 0 && (
                      <Text style={styles.kmPreviewText}>
                        Included = original {km(allowance.freeKmOriginal)} + extensions {km(allowance.freeKmExtensions ?? 0)}
                      </Text>
                    )}
                    {!booking.usePaymentSessions && !!kmPreview.allowance?.charge && (
                      <Text style={styles.kmPreviewText}>Billed at face value (no GST) — the branch manager collects it.</Text>
                    )}
                    {kmPreview.belowStart && (
                      <Text style={styles.kmPreviewWarn}>
                        Lower than the {swappedMidRental ? "current vehicle's reading at the swap" : 'pickup reading'} ({km(startOdo ?? 0)}).
                      </Text>
                    )}
                  </View>
                )}

                {/* Swap without readings: staff enter the extra km (billed at the plan rate) */}
                {manualKmAllowed && (
                  <>
                    <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Extra km driven (entered by staff)</Text>
                    <TextInput
                      style={styles.input}
                      value={manualKm}
                      onChangeText={(t) => setManualKm(t.replace(/[^\d]/g, ''))}
                      placeholder="0"
                      placeholderTextColor={Colors.ink4}
                      keyboardType="number-pad"
                      returnKeyType="done"
                    />
                    <Text style={styles.hint}>
                      Km beyond the {allowance ? `${allowance.includedKm.toLocaleString('en-IN')} km ` : ''}included in the plan, across every vehicle used. Leave blank if none.
                      {manualKmPreview && manualKmPreview.extra > 0
                        ? manualKmPreview.enabled
                          ? ` ${manualKmPreview.extra.toLocaleString('en-IN')} km × ${inr(manualKmPreview.rate)} = ${inr(manualKmPreview.charge)} (no GST).`
                          : ' Extra km is not charged at this branch.'
                        : ''}
                    </Text>
                  </>
                )}

                {/* Return fuel level — defaults to the pickup level (drop bill branches) */}
                {booking.usePaymentSessions && (
                  <>
                    <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Return fuel level (bars)</Text>
                    <View style={styles.fuelGrid}>
                      {FUEL_LEVELS.map((lvl) => (
                        <TouchableOpacity
                          key={lvl}
                          style={[styles.fuelPill, fuelLevel === lvl && styles.fuelPillActive]}
                          onPress={() => selectFuelLevel(lvl)}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.fuelPillText, fuelLevel === lvl && styles.fuelPillTextActive]}>{lvl}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {booking.pickupFuelLevel && (
                      <Text style={styles.hint}>
                        {swappedMidRental ? 'Level at swap' : 'Pickup level'} {fuelLabel(booking.pickupFuelLevel)}
                        {fuelDeficitBars > 0 ? ` · ${fuelDeficitBars} bar${fuelDeficitBars > 1 ? 's' : ''} short` : ''}
                      </Text>
                    )}
                  </>
                )}
              </View>

              {/* Late return without an extension — billed automatically (#12) */}
              {lateShown && timeline && (
                <LateReturnCard
                  timeline={timeline}
                  legacy={!booking.usePaymentSessions}
                  applyGrace={applyGrace}
                  onApplyGraceChange={setApplyGrace}
                  waive={waiveLate}
                  onWaiveChange={(v) => { setWaiveLate(v); setWaiveError(null); }}
                  waiveReason={waiveReason}
                  onWaiveReasonChange={(t) => { setWaiveReason(t); setWaiveError(null); }}
                  waiveError={waiveError}
                  disabled={computing || settling}
                />
              )}

              {/* Vehicle-swap price difference billed at drop (#13) */}
              <SwapChargesCard charges={booking.swapCharges ?? []} legacy={!booking.usePaymentSessions} />
            </>
          )}

          {!hasRemainingBalance && booking.usePaymentSessions && !session && !awaitingManager && (
            <>
              <SectionHeader title="Additional Charges" />
              <View style={styles.card}>
                <ChargeToggle
                  label="Fuel deficit charge"
                  enabled={chargeFuel}
                  onToggle={(v) => {
                    setChargeFuel(v);
                    if (v && !fuelAmt && fuelDeficitBars > 0 && fuelBarRate > 0) {
                      setFuelAmt(String(Math.ceil(fuelDeficitBars * fuelBarRate)));
                    }
                  }}
                >
                  <TextInput
                    style={styles.input}
                    value={fuelAmt}
                    onChangeText={setFuelAmt}
                    placeholder="Amount ₹"
                    placeholderTextColor={Colors.ink4}
                    keyboardType="numeric"
                  />
                  {fuelDeficitBars > 0 && fuelBarRate > 0 && (
                    <Text style={styles.hintTight}>
                      {fuelDeficitBars} bar{fuelDeficitBars > 1 ? 's' : ''} × {inr(fuelBarRate)} = {inr(Math.ceil(fuelDeficitBars * fuelBarRate))} (editable)
                    </Text>
                  )}
                  <Text style={styles.hintTight}>Charged at face value — no GST.</Text>
                </ChargeToggle>
                {fuelDeficitBars > 0 && !chargeFuel && (
                  <Text style={styles.hint}>Return fuel is lower than pickup — turn this on to charge.</Text>
                )}
                <View style={styles.divider} />

                {fastagEnabled && (
                  <>
                    <ChargeToggle label="FASTag / toll charge" enabled={chargeFastag} onToggle={setChargeFastag}>
                      <TextInput
                        style={styles.input}
                        value={fastagAmt}
                        onChangeText={setFastagAmt}
                        placeholder="Amount ₹"
                        placeholderTextColor={Colors.ink4}
                        keyboardType="numeric"
                      />
                      <TextInput
                        style={[styles.input, { marginTop: 8 }]}
                        value={fastagNote}
                        onChangeText={setFastagNote}
                        placeholder="Note (optional)"
                        placeholderTextColor={Colors.ink4}
                      />
                      <Text style={styles.hintTight}>Tolls are passed on at cost — no GST.</Text>
                    </ChargeToggle>
                    <View style={styles.divider} />
                  </>
                )}

                <ChargeToggle label="Other charges" enabled={chargeOther} onToggle={setChargeOther}>
                  {otherLines.map((line) => (
                    <View key={line.id} style={styles.otherLine}>
                      <TextInput
                        style={[styles.input, styles.otherLabelInput]}
                        value={line.label}
                        onChangeText={(t) => setOtherLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, label: t } : l)))}
                        placeholder="Description (e.g. Cleaning)"
                        placeholderTextColor={Colors.ink4}
                      />
                      <TextInput
                        style={[styles.input, styles.otherAmtInput]}
                        value={line.amount}
                        onChangeText={(t) => setOtherLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, amount: t.replace(/[^\d.]/g, '') } : l)))}
                        placeholder="₹"
                        placeholderTextColor={Colors.ink4}
                        keyboardType="decimal-pad"
                      />
                      {otherLines.length > 1 && (
                        <TouchableOpacity
                          onPress={() => setOtherLines((prev) => prev.filter((l) => l.id !== line.id))}
                          hitSlop={8}
                          style={styles.otherRemove}
                        >
                          <Ionicons name="close" size={18} color={Colors.ink3} />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                  <TouchableOpacity onPress={() => setOtherLines((prev) => [...prev, newOtherLine()])} hitSlop={8}>
                    <Text style={styles.link}>+ Add another charge</Text>
                  </TouchableOpacity>
                  <Text style={styles.hintTight}>
                    Charged at face value — no GST. Late return is billed automatically; record damage under Vehicle Condition.
                  </Text>
                </ChargeToggle>

                {discount && (
                  <>
                    <View style={styles.divider} />
                    <View style={styles.toggleRow}>
                      <View style={{ flex: 1, paddingRight: 12 }}>
                        <Text style={styles.toggleLabel}>Discount −{inr(discount.amount)}</Text>
                        <Text style={styles.hint} numberOfLines={2}>{discount.reason} · applied on compute</Text>
                      </View>
                      <TouchableOpacity onPress={removeDiscount} hitSlop={8}>
                        <Text style={styles.linkDanger}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>

              {/* Safety deposit at drop (#6): set off against the charges, or refund in full */}
              {depositHeldBefore > 0 ? (
                <SafetyDepositAtDrop
                  held={depositHeldBefore}
                  handling={depositHandling}
                  onChange={changeDepositHandling}
                  legacy={!booking.usePaymentSessions}
                  disabled={computing || settling}
                />
              ) : safetyDeposit > 0 && !fin ? (
                <Text style={styles.depositNote}>
                  Security deposit of {inr(safetyDeposit)} will be credited against the charges below.
                </Text>
              ) : null}
            </>
          )}

          {/* Damage found at drop — billed on the return session, or by the manager on review (legacy) */}
          {showDamages && (
            <>
              <SectionHeader title="Vehicle Condition" />
              <View style={styles.card}>
                {damageDecision === null ? (
                  <>
                    <Text style={styles.toggleLabel}>Does the vehicle have any new damage?</Text>
                    <View style={[styles.methodRow, { marginTop: 12 }]}>
                      <TouchableOpacity
                        style={styles.decisionBtn}
                        onPress={() => setDamageDecision('NO_DAMAGE')}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="checkmark-circle-outline" size={18} color="#10b981" />
                        <Text style={styles.decisionText}>No damage</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.decisionBtn}
                        onPress={() => setDamageDecision('DAMAGE_FOUND')}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="warning-outline" size={18} color="#dc3545" />
                        <Text style={styles.decisionText}>Damage found</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : damageDecision === 'NO_DAMAGE' ? (
                  <View style={styles.toggleRow}>
                    <View style={styles.noDamageRow}>
                      <Ionicons name="checkmark-circle" size={18} color="#10b981" />
                      <Text style={styles.noDamageText}>No new damage found.</Text>
                    </View>
                    {!settling && (
                      <TouchableOpacity onPress={() => setDamageDecision(null)} hitSlop={8}>
                        <Text style={styles.link}>Change</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : (
                  <>
                    <View style={[styles.toggleRow, { marginBottom: 12 }]}>
                      <Text style={styles.damageHeading}>Damage found</Text>
                      {damagesLoaded && damages.length === 0 && !settling && (
                        <TouchableOpacity onPress={() => setDamageDecision(null)} hitSlop={8}>
                          <Text style={styles.link}>Change</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {damagesError ? (
                      <View style={styles.toggleRow}>
                        <Text style={[styles.hintInline, { flex: 1 }]}>Could not load damages.</Text>
                        <TouchableOpacity onPress={() => refetchDamages()} hitSlop={8}>
                          <Text style={styles.link}>Retry</Text>
                        </TouchableOpacity>
                      </View>
                    ) : damages.length === 0 ? (
                      <Text style={styles.hintInline}>
                        {damagesLoaded ? 'No damage saved yet.' : 'Loading damages…'}
                      </Text>
                    ) : (
                      damages.map((d, i) => (
                        <View key={d.publicId}>
                          {i > 0 && <View style={styles.divider} />}
                          <View style={styles.damageRow}>
                            {d.photos[0] ? (
                              <TouchableOpacity
                                activeOpacity={0.85}
                                accessibilityRole="button"
                                accessibilityLabel="View damage photos"
                                onPress={() =>
                                  setPhotoViewer({
                                    images: d.photos.map((ph) => ({ url: ph.url, label: d.area })),
                                    index: 0,
                                  })
                                }
                              >
                                <Image source={{ uri: d.photos[0].url }} style={styles.damageThumb} resizeMode="cover" />
                              </TouchableOpacity>
                            ) : (
                              <View style={[styles.damageThumb, styles.damageThumbEmpty]}>
                                <Ionicons name="image-outline" size={18} color={Colors.ink4} />
                              </View>
                            )}
                            <View style={styles.damageInfo}>
                              <Text style={styles.damageArea} numberOfLines={1}>{d.area}</Text>
                              <Text style={styles.damageMeta} numberOfLines={1}>
                                {d.severity}{d.photos.length > 1 ? ` · ${d.photos.length} photos` : ''}
                              </Text>
                              {booking.items.length > 1 && d.vehicle && (
                                <Text style={styles.damageMeta} numberOfLines={1}>
                                  {d.vehicle.make} {d.vehicle.model} · {d.vehicle.regNo}
                                </Text>
                              )}
                            </View>
                            <Text style={[styles.damageAmt, !d.billedAtDrop && styles.damageAmtMuted]}>
                              {d.billedAtDrop
                                ? `${inr(num(d.amount))} · on this bill`
                                : d.chargeCustomer
                                  ? `${inr(num(d.amount))} · manager will charge`
                                  : 'Company expense'}
                            </Text>
                            <TouchableOpacity
                              onPress={() => confirmDeleteDamage(d)}
                              disabled={!!deletingDamageId || settling}
                              hitSlop={8}
                              style={styles.damageDelete}
                            >
                              {deletingDamageId === d.publicId ? (
                                <ActivityIndicator size="small" color={Colors.ink3} />
                              ) : (
                                <Ionicons name="close" size={18} color={Colors.ink3} />
                              )}
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))
                    )}

                    <TouchableOpacity
                      style={[styles.addDamageBtn, settling && styles.btnDisabled]}
                      onPress={() => router.push({
                        pathname: '/employee/damage/[bookingId]',
                        params: { bookingId: booking.publicId },
                      })}
                      disabled={settling}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="add-circle-outline" size={18} color="#dc3545" />
                      <Text style={styles.addDamageText}>Add damage</Text>
                    </TouchableOpacity>
                    {damagesLoaded && damages.length === 0 && (
                      <Text style={styles.hintWarn}>Save at least one damage (or choose "No damage") to continue.</Text>
                    )}
                  </>
                )}
              </View>
            </>
          )}

          {/* Manager confirmation escalation (#50) — legacy (non-session) returns only */}
          {!hasRemainingBalance && !booking.usePaymentSessions && !awaitingManager && (
            <>
              <SectionHeader title="Confirmation" />
              <View style={styles.card}>
                <View style={styles.toggleRow}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={styles.toggleLabel}>Require manager confirmation</Text>
                    <Text style={styles.hint}>Send to a manager to confirm instead of completing now.</Text>
                  </View>
                  <Switch
                    value={requireManager}
                    onValueChange={setRequireManager}
                    trackColor={{ false: Colors.ink4, true: Colors.orange }}
                    thumbColor={Colors.white}
                  />
                </View>
              </View>
            </>
          )}

          {/* Computed ledger + settlement */}
          {session && (
            <>
              {kmSummary && (
                <>
                  <SectionHeader title="Kilometres" />
                  {kmSummary.autoKmSkipped === 'VEHICLE_SWAPPED' ? (
                    <View style={styles.card}>
                      <InfoRow icon="speedometer-outline" label="End odometer" value={km(kmSummary.endOdometer)} />
                      {kmSummary.kmSource === 'STAFF_ENTERED' ? (
                        <>
                          <View style={styles.divider} />
                          <InfoRow
                            icon="create-outline"
                            label="Extra km (entered by staff)"
                            value={kmSummary.extraKmEnabled
                              ? `${km(kmSummary.extraKm)} × ${inr(num(kmSummary.extraKmRate))} = ${inr(num(kmSummary.extraKmCharge))}`
                              : `${km(kmSummary.extraKm)} · not charged`}
                            valueColor={num(kmSummary.extraKmCharge) > 0 ? '#f59e0b' : undefined}
                          />
                          <Text style={styles.hint}>No GST. {VEHICLE_SWAPPED_KM_NOTE}</Text>
                        </>
                      ) : (
                        <Text style={styles.hint}>{VEHICLE_SWAPPED_KM_NOTE}</Text>
                      )}
                    </View>
                  ) : (
                    <View style={styles.card}>
                      <InfoRow
                        icon="speedometer-outline"
                        label={(kmSummary.priorKm ?? 0) > 0 ? 'Current vehicle' : 'Odometer'}
                        value={kmSummary.startOdometer != null
                          ? `${kmSummary.startOdometer.toLocaleString('en-IN')} → ${km(kmSummary.endOdometer)}`
                          : km(kmSummary.endOdometer)}
                      />
                      {(kmSummary.priorKm ?? 0) > 0 && (
                        <>
                          <View style={styles.divider} />
                          <InfoRow
                            icon="swap-horizontal-outline"
                            label="Swapped-out vehicle"
                            value={km(kmSummary.priorKm ?? 0)}
                          />
                        </>
                      )}
                      <View style={styles.divider} />
                      <InfoRow icon="navigate-outline" label="Km driven" value={km(kmSummary.kmDriven)} />
                      <View style={styles.divider} />
                      <InfoRow icon="gift-outline" label="Included" value={km(kmSummary.includedKm)} />
                      {kmSummary.freeKmOriginal != null && (kmSummary.freeKmExtensions ?? 0) > 0 && (
                        <>
                          <View style={styles.divider} />
                          <InfoRow
                            icon="add-circle-outline"
                            label="Included from"
                            value={`original ${km(kmSummary.freeKmOriginal)} + extensions ${km(kmSummary.freeKmExtensions ?? 0)}`}
                          />
                        </>
                      )}
                      <View style={styles.divider} />
                      <InfoRow
                        icon="trending-up-outline"
                        label="Extra km (no GST)"
                        value={kmSummary.extraKmEnabled
                          ? `${km(kmSummary.extraKm)} × ${inr(num(kmSummary.extraKmRate))} = ${inr(num(kmSummary.extraKmCharge))}`
                          : `${km(kmSummary.extraKm)} · not charged`}
                        valueColor={num(kmSummary.extraKmCharge) > 0 ? '#f59e0b' : undefined}
                      />
                    </View>
                  )}
                </>
              )}

              <SectionHeader title="Settlement" />
              {/* Drop bill (no GST on drop charges, item 8); sessions computed before it fall back to the ledger */}
              {bill ? (
                <DropBillCard bill={bill} session={session} late={lateSummary} />
              ) : (
                <LedgerSummaryCard session={session} />
              )}

              {/* Drop discount — part of the compute body, re-sent on every recompute */}
              {!sessionDone && (
                discountOpen ? (
                  <View style={[styles.card, { marginTop: 8 }]}>
                    <Text style={styles.fieldLabel}>Discount amount (₹)</Text>
                    <Text style={[styles.hintTight, { marginBottom: 8 }]}>
                      Taken off the drop charges (they carry no GST). It can't exceed the drop charges.
                    </Text>
                    <TextInput
                      style={styles.input}
                      value={discountAmt}
                      onChangeText={(t) => { setDiscountAmt(t.replace(/[^\d.]/g, '')); setDiscountError(null); }}
                      placeholder="0"
                      placeholderTextColor={Colors.ink4}
                      keyboardType="decimal-pad"
                    />
                    <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Reason</Text>
                    <TextInput
                      style={styles.input}
                      value={discountReason}
                      onChangeText={(t) => { setDiscountReason(t); setDiscountError(null); }}
                      placeholder="Why is the customer getting a discount?"
                      placeholderTextColor={Colors.ink4}
                    />
                    {discountError && <Text style={styles.fieldError}>{discountError}</Text>}
                    <View style={[styles.methodRow, { marginTop: 12 }]}>
                      <TouchableOpacity
                        style={styles.methodBtn}
                        onPress={() => { setDiscountOpen(false); setDiscountError(null); }}
                        disabled={computing}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.methodText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.methodBtn, styles.methodBtnActive, computing && styles.btnDisabled]}
                        onPress={applyDiscount}
                        disabled={computing}
                        activeOpacity={0.8}
                      >
                        {computing ? <ActivityIndicator size="small" color={Colors.white} /> : (
                          <Text style={[styles.methodText, styles.methodTextActive]}>Apply discount</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : serverDiscount ? (
                  <View style={[styles.card, { marginTop: 8 }]}>
                    <View style={styles.toggleRow}>
                      <View style={{ flex: 1, paddingRight: 12 }}>
                        <Text style={styles.toggleLabel}>Discount −{inr(num(serverDiscount.amount))}</Text>
                        <Text style={styles.hint} numberOfLines={2}>{serverDiscount.reason}</Text>
                      </View>
                      <View style={styles.linkRow}>
                        <TouchableOpacity onPress={openDiscountForm} disabled={computing || settling} hitSlop={8}>
                          <Text style={styles.link}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={removeDiscount} disabled={computing || settling} hitSlop={8}>
                          <Text style={styles.linkDanger}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    {discountError && <Text style={styles.fieldError}>{discountError}</Text>}
                  </View>
                ) : (
                  <>
                    <TouchableOpacity
                      style={[styles.extendBtn, { marginTop: 8 }, (computing || settling) && styles.btnDisabled]}
                      onPress={openDiscountForm}
                      disabled={computing || settling}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="pricetag-outline" size={18} color={Colors.ink2} />
                      <Text style={styles.extendBtnText}>Add discount</Text>
                      <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />
                    </TouchableOpacity>
                    {discountError && <Text style={styles.fieldError}>{discountError}</Text>}
                  </>
                )
              )}

              {/* Safety deposit at drop (#6): the choice, and how it splits on this bill */}
              {!sessionDone && num(dropDeposit?.held) > 0 && (
                <View style={{ marginTop: 8 }}>
                  <SafetyDepositAtDrop
                    held={num(dropDeposit?.held)}
                    handling={depositHandling}
                    onChange={changeDepositHandling}
                    deposit={dropDeposit}
                    disabled={computing || settling}
                  />
                </View>
              )}

              {/* Shortfall / charges: Cash / UPI (photo) / Split / Credit (#3 / #11) */}
              {!sessionDone && net > 0 && (
                <View style={[styles.card, { marginTop: 8 }]}>
                  <CounterPaymentPicker
                    ctl={pay}
                    amount={net}
                    title={`Collect ${inr(net)} by`}
                    disabled={computing || settling}
                  />
                </View>
              )}

              {/* Money going back: the deposit refunded in full, or the bill's refund */}
              {!sessionDone && (net < 0 || depositRefundDue > 0) && (
                <View style={[styles.card, { marginTop: 8 }]}>
                  <CounterRefundPicker
                    ctl={refundPay}
                    amount={net < 0 ? Math.abs(net) : depositRefundDue}
                    title={depositRefundDue > 0 ? `Refund the ${inr(depositRefundDue)} deposit by` : undefined}
                    disabled={computing || settling}
                  />
                </View>
              )}

              {!sessionDone && (
                <TouchableOpacity
                  style={styles.recomputeBtn}
                  onPress={() => {
                    setSession(null);
                    setKmSummary(null);
                    setServerDiscount(null);
                    setBill(null);
                    setDropDeposit(null);
                    setLateSummary(null);
                    setDiscountOpen(false);
                    setBillStale(false);
                    setErrorMsg(null);
                    setDiscountError(null);
                  }}
                  disabled={computing || settling}
                  activeOpacity={0.8}
                >
                  <Ionicons name="refresh-outline" size={15} color={Colors.ink2} />
                  <Text style={styles.recomputeText}>Edit charges</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {notice && (
            <View style={styles.noticeBox}>
              <Ionicons name="information-circle-outline" size={16} color={Colors.ink2} />
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          )}

          {errorMsg && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={16} color="#e53e3e" />
              <Text style={styles.errorBoxText}>{errorMsg}</Text>
            </View>
          )}
        </ScrollView>

        {/* Footer CTA */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          {awaitingManager ? (
            <View style={styles.footerNote}>
              <Ionicons name="time-outline" size={16} color={Colors.ink3} />
              <Text style={styles.footerNoteText}>Waiting for the branch manager to confirm this return.</Text>
            </View>
          ) : hasRemainingBalance ? (
            <View style={styles.footerNote}>
              <Ionicons name="lock-closed-outline" size={16} color={Colors.ink3} />
              <Text style={styles.footerNoteText}>Collect the rental balance to continue.</Text>
            </View>
          ) : photosPending > 0 && !session ? (
            <View style={styles.footerNote}>
              <Ionicons name="cloud-upload-outline" size={16} color={Colors.ink3} />
              <Text style={styles.footerNoteText}>Finish uploading photos above (retry or remove failed ones)</Text>
            </View>
          ) : returnPhotos.length === 0 && !session ? (
            <View style={styles.footerNote}>
              <Ionicons name="camera-outline" size={16} color={Colors.ink3} />
              <Text style={styles.footerNoteText}>Take at least one return photo to continue.</Text>
            </View>
          ) : !booking.usePaymentSessions && !damageStepDone ? (
            <View style={styles.footerNote}>
              <Ionicons name="car-outline" size={16} color={Colors.ink3} />
              <Text style={styles.footerNoteText}>Record the vehicle condition above to continue.</Text>
            </View>
          ) : !booking.usePaymentSessions ? (
            <TouchableOpacity
              style={[styles.confirmBtn, (settling || !!deletingDamageId || !endOdo.trim()) && styles.confirmBtnDisabled]}
              onPress={requestLegacyComplete}
              disabled={settling || !!deletingDamageId || !endOdo.trim()}
              activeOpacity={0.85}
            >
              {settling ? <ActivityIndicator size="small" color={Colors.white} /> : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={20} color={Colors.white} />
                  <Text style={styles.confirmBtnText}>Complete Return</Text>
                </>
              )}
            </TouchableOpacity>
          ) : !session ? (
            <TouchableOpacity
              style={[styles.confirmBtn, (computing || !endOdo.trim()) && styles.confirmBtnDisabled]}
              onPress={compute}
              disabled={computing || !endOdo.trim()}
              activeOpacity={0.85}
            >
              {computing ? <ActivityIndicator size="small" color={Colors.white} /> : (
                <>
                  <Ionicons name="calculator-outline" size={20} color={Colors.white} />
                  <Text style={styles.confirmBtnText}>Compute Charges</Text>
                </>
              )}
            </TouchableOpacity>
          ) : billBusy && !sessionDone ? (
            <View style={styles.footerNote}>
              {billStale && !computing ? (
                <>
                  <Ionicons name="alert-circle-outline" size={16} color={Colors.ink3} />
                  <Text style={styles.footerNoteText}>Bill is out of date — fix the error above or tap Edit charges.</Text>
                </>
              ) : (
                <>
                  <ActivityIndicator size="small" color={Colors.ink3} />
                  <Text style={styles.footerNoteText}>Updating the bill…</Text>
                </>
              )}
            </View>
          ) : !damageStepDone && !sessionDone ? (
            <View style={styles.footerNote}>
              <Ionicons name="car-outline" size={16} color={Colors.ink3} />
              <Text style={styles.footerNoteText}>Record the vehicle condition above to continue.</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.confirmBtn, settling && styles.confirmBtnDisabled]}
              onPress={settleSession}
              disabled={settling}
              activeOpacity={0.85}
            >
              {settling ? <ActivityIndicator size="small" color={Colors.white} /> : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={20} color={Colors.white} />
                  <Text style={styles.confirmBtnText}>
                    {settleLabel}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>

      <ConfirmModal
        visible={showConfirm}
        icon="arrow-down-circle-outline"
        iconColor="#3b82f6"
        title="Complete Return"
        message={(damages.length > 0
          ? `Confirm that ${customer.name} has returned the vehicle? The recorded damage goes to the branch manager, who charges it and sets the vehicle's status.`
          : `Confirm that ${customer.name} has returned the vehicle with no new damage?`)
          + ' Any extra km or late-return charge is billed at face value (no GST) and collected by the branch manager.'}
        confirmLabel="Complete Return"
        confirmColor="#3b82f6"
        onConfirm={() => { setShowConfirm(false); completeLegacy(); }}
        onCancel={() => setShowConfirm(false)}
      />

      <ImageViewer
        visible={!!photoViewer}
        images={photoViewer?.images ?? []}
        startIndex={photoViewer?.index ?? 0}
        onClose={() => setPhotoViewer(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  loader: { marginTop: 100 },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, gap: 12 },
  back: { width: 36, height: 36, justifyContent: 'center' },
  headerText: { flex: 1, gap: 2 },
  title: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  subtitle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  returnBadge: { backgroundColor: '#3b82f615', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#3b82f630' },
  returnBadgeText: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: '#3b82f6' },

  content: { paddingHorizontal: 20, gap: 8 },

  sectionHeader: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8, marginBottom: 4 },

  card: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.hairline, padding: 16, marginBottom: 4 },

  customerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.white },
  customerInfo: { flex: 1 },
  customerName: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.ink },
  customerPhone: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, marginTop: 2 },

  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  vehicleIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#3b82f612', alignItems: 'center', justifyContent: 'center' },
  vehicleName: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.ink },
  vehicleReg: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, marginTop: 2 },

  divider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 12 },

  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  infoValue: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink, flexShrink: 1, textAlign: 'right', marginLeft: 12 },

  fieldLabel: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3, marginBottom: 8 },
  fieldError: { fontFamily: Fonts.body, fontSize: 12, color: '#e53e3e', marginTop: 8 },
  input: {
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.ink,
  },
  hint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 8 },
  hintInline: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  hintTight: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  hintWarn: { fontFamily: Fonts.body, fontSize: 12, color: '#d97706', marginTop: 10 },

  kmPreview: { backgroundColor: Colors.bg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10, gap: 4 },
  kmPreviewText: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink2, lineHeight: 17 },
  kmPreviewWarn: { fontFamily: Fonts.body, fontSize: 12, color: '#d97706' },

  fuelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fuelPill: {
    width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline,
  },
  fuelPillActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  fuelPillText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink3 },
  fuelPillTextActive: { color: Colors.white },

  toggleBlock: { gap: 10 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleLabel: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },

  link: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.orange },
  linkDanger: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: '#dc3545' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },

  captureStrip: { gap: 10, paddingTop: 12, paddingRight: 4 },
  captureThumbWrap: { width: 110, gap: 4 },
  captureThumb: { width: 110, height: 84, borderRadius: 10, backgroundColor: Colors.bg },
  captureLabel: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3 },

  depositNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17, marginTop: 4, paddingHorizontal: 4 },

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

  damageRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  damageThumb: { width: 48, height: 48, borderRadius: 10, backgroundColor: Colors.bg },
  damageThumbEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.hairline },
  damageInfo: { flex: 1, gap: 2 },
  damageArea: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  damageMeta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  damageAmt: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: '#dc3545', maxWidth: 130, textAlign: 'right' },
  damageAmtMuted: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink3 },
  damageDelete: { width: 24, alignItems: 'center' },
  addDamageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fff5f5',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
    paddingVertical: 12,
    marginTop: 14,
  },
  addDamageText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: '#dc3545' },

  methodRow: { flexDirection: 'row', gap: 8 },

  decisionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12, backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline,
  },
  decisionText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink2 },
  noDamageRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 12 },
  noDamageText: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: '#047857' },
  damageHeading: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: '#c2410c' },

  otherLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  otherLabelInput: { flex: 1 },
  otherAmtInput: { width: 96 },
  otherRemove: { width: 24, alignItems: 'center' },
  methodBtn: { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline },
  methodBtnActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  methodText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink3 },
  methodTextActive: { color: Colors.white },

  recomputeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginTop: 4 },
  recomputeText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },

  noticeBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.hairline, marginTop: 8 },
  noticeText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, flex: 1 },

  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#e53e3e10', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e53e3e30', marginTop: 8 },
  errorBoxText: { fontFamily: Fonts.body, fontSize: 13, color: '#e53e3e', flex: 1 },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink3 },

  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 12, backgroundColor: Colors.bg, borderTopWidth: 1, borderTopColor: Colors.hairline },
  footerNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  footerNoteText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3, flexShrink: 1 },
  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#3b82f6', borderRadius: 16, paddingVertical: 17,
    shadowColor: '#3b82f6', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  confirmBtnDisabled: { opacity: 0.45, shadowOpacity: 0 },
  confirmBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },

  successBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  successIcon: { width: 100, height: 100, borderRadius: 30, backgroundColor: '#10b98115', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  successTitle: { fontFamily: Fonts.displayBold, fontSize: 28, color: Colors.ink, letterSpacing: -0.8 },
  successSub: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink3, textAlign: 'center', lineHeight: 22 },
  // Credit / refunds / deposit recorded with the return (#6 / #11)
  settledNote: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, textAlign: 'center', lineHeight: 19 },
  doneBtn: { backgroundColor: Colors.ink, borderRadius: 16, paddingVertical: 17, paddingHorizontal: 40, alignItems: 'center', marginTop: 8, width: '100%' },
  doneBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },
});

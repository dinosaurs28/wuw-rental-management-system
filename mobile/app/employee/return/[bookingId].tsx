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
import RemainingBalanceCollect from '../../../components/employee/RemainingBalanceCollect';
import LedgerSummaryCard from '../../../components/ui/LedgerSummaryCard';
import PhotoCaptureSection, { type CapturedPhoto } from '../../../components/employee/PhotoCaptureSection';
import CounterPaymentPanel from '../../../components/employee/CounterPaymentPanel';
import UtrInput from '../../../components/employee/UtrInput';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import {
  apiErrorMessage,
  cleanUtr,
  counterErrorCode,
  handleShiftRequired,
  isValidUtr,
} from '../../../lib/counterErrors';
import type { ReturnSession } from '../../../types/api';
import type { DropDamage, DropDiscount, ReturnBooking, ReturnKmSummary } from '../../../types/return';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// Discount the client keeps and resends with every compute (the server
// re-applies whatever the compute body carries).
interface AppliedDiscount {
  amount: number;
  reason: string;
}

const LICENSE_NOT_RETURNED_MESSAGE = "Return the customer's original driving licence before closing the drop.";
const VEHICLE_SWAPPED_KM_NOTE = "Vehicle was swapped during the rental — extra km isn't calculated automatically.";

const num = (x: unknown) => Number(x ?? 0) || 0;
const inr = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const km = (n: number) => `${n.toLocaleString('en-IN')} km`;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

const FUEL_LEVEL_LABELS: Record<string, string> = {
  EMPTY: 'Empty', QUARTER: '¼ Tank', HALF: '½ Tank', THREE_QUARTER: '¾ Tank', FULL: 'Full',
};

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
  const [showConfirm, setShowConfirm] = useState(false);
  const [requireManager, setRequireManager] = useState(false);
  const [licenseReturned, setLicenseReturned] = useState(false);

  // charge inputs
  const [endOdo, setEndOdo] = useState('');
  const [fuelLevel, setFuelLevel] = useState<string>(''); // '1'..'10'
  const [chargeFuel, setChargeFuel] = useState(false);
  const [fuelAmt, setFuelAmt] = useState('');
  const [chargeFastag, setChargeFastag] = useState(false);
  const [fastagAmt, setFastagAmt] = useState('');
  const [fastagNote, setFastagNote] = useState('');
  const [chargeOther, setChargeOther] = useState(false);
  const [otherLabel, setOtherLabel] = useState('');
  const [otherAmt, setOtherAmt] = useState('');

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
  const [kmSummary, setKmSummary] = useState<ReturnKmSummary | null>(null);
  // Sticky once the server says extra km can't be auto-calculated (vehicle swap),
  // so the local preview stops showing km math after "Edit charges".
  const [kmAutoSkipped, setKmAutoSkipped] = useState<ReturnKmSummary['autoKmSkipped']>(null);
  const [serverDiscount, setServerDiscount] = useState<DropDiscount | null>(null);
  const [computing, setComputing] = useState(false);
  // Set when damages changed but the bill could not be recomputed yet.
  const [billStale, setBillStale] = useState(false);
  const [recomputeTick, setRecomputeTick] = useState(0);
  const [deletingDamageId, setDeletingDamageId] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [payMethod, setPayMethod] = useState<'CASH' | 'UPI'>('CASH');
  const [utr, setUtr] = useState('');
  const [utrError, setUtrError] = useState<string | undefined>(undefined);
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
        setSession(s);
        applyKm((data?.km ?? null) as ReturnKmSummary | null);
        const d = (data?.discount ?? null) as DropDiscount | null;
        setServerDiscount(d);
        if (d) setDiscount({ amount: num(d.amount), reason: d.reason });
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
  const licenseRequired = !!booking?.licenseCollectedAt && !booking?.licenseReturnedAt;

  const startOdo = booking?.startOdometer ?? null;
  const allowance = booking?.kmAllowance ?? null;
  // Vehicle swapped mid-rental: pickup and drop odometers belong to different
  // vehicles, so there's no km math (and no end ≥ start check).
  const vehicleSwapped = allowance?.autoKmSkipped === 'VEHICLE_SWAPPED' || kmAutoSkipped === 'VEHICLE_SWAPPED';
  // Read-only preview of the server's extra-km charge (same formula as compute).
  const kmPreview = useMemo(() => {
    const e = parseFloat(endOdo);
    if (!Number.isFinite(e)) return null;
    const driven = Math.max(0, e - (startOdo ?? e));
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
  }, [endOdo, startOdo, allowance]);

  const fuelModuleEnabled = !!booking?.frozenChargeConfig?.fuelModuleEnabled;
  const fastagEnabled = !!booking?.frozenChargeConfig?.fastagModuleEnabled || !!vehicle?.hasFastag;

  // Leaves the computed view for the charges form (a restored session's
  // inputs aren't on this screen, so it can't be recomputed in place).
  const backToForm = (message: string) => {
    setSession(null);
    setKmSummary(null);
    setServerDiscount(null);
    setBillStale(false);
    setNotice(message);
  };

  const runCompute = async (
    nextDiscount: AppliedDiscount | null,
    source: 'form' | 'discount' | 'auto',
  ): Promise<boolean> => {
    if (!booking || photosPending > 0) return false;
    if (computeBusyRef.current) {
      if (source === 'auto') pendingRecomputeRef.current = true;
      return false;
    }
    const endOdoNum = parseFloat(endOdo);
    if (!Number.isFinite(endOdoNum) || endOdoNum < 0) {
      setErrorMsg('Enter a valid odometer reading.');
      return false;
    }
    if (fuelModuleEnabled && !/^([1-9]|10)$/.test(fuelLevel)) {
      setErrorMsg('Select the return fuel level.');
      return false;
    }
    if (licenseRequired && !licenseReturned) {
      setErrorMsg(LICENSE_NOT_RETURNED_MESSAGE);
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
      if (fuelModuleEnabled && fuelLevel) body.returnFuelLevel = fuelLevel;
      if (chargeFuel && num(fuelAmt) > 0) body.fuelCharge = num(fuelAmt);
      if (chargeFastag && num(fastagAmt) > 0) {
        body.fastagAmount = num(fastagAmt);
        if (fastagNote.trim()) body.fastagNotes = fastagNote.trim();
      }
      if (chargeOther && otherLabel.trim() && num(otherAmt) > 0) {
        body.otherCharges = [{ label: otherLabel.trim(), amount: num(otherAmt) }];
      }
      if (licenseReturned) body.licenseReturned = true;
      if (nextDiscount) body.discount = nextDiscount;
      const res = await employeeApi.computeReturnSession(bookingId as string, body);
      const data = res.data?.data;
      computedHereRef.current = true;
      if (mountedRef.current) {
        setSession(data?.session as ReturnSession);
        applyKm((data?.km ?? null) as ReturnKmSummary | null);
        setServerDiscount((data?.discount ?? null) as DropDiscount | null);
        setDiscount(nextDiscount);
        setDiscountError(null);
        setBillStale(false);
        setNotice(null);
      }
      return true;
    } catch (err: any) {
      if (!mountedRef.current) return false;
      const code = err?.response?.data?.code;
      const message = apiErrorMessage(err, 'Could not compute charges.');
      if (source === 'auto') setBillStale(true);
      if (code === 'LICENSE_NOT_RETURNED') {
        // Booking data was stale — refetch so the licence toggle shows.
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
    if (mountedRef.current) setDone(true);
  };

  const settleSession = async () => {
    if (!session || settleBusyRef.current) return;
    const net = num(session.netPayable);
    if (net > 0 && payMethod === 'UPI' && !isValidUtr(utr)) {
      setUtrError('Enter the 12-digit UTR number.');
      return;
    }
    settleBusyRef.current = true;
    setSettling(true);
    setErrorMsg(null);
    setUtrError(undefined);
    try {
      if (net < 0) {
        await employeeApi.recordSessionRefund(session.publicId, {
          method: 'CASH',
          amount: Math.abs(net),
          idempotencyKey: `refund:${session.publicId}`,
        });
      } else if (net === 0) {
        await employeeApi.recordSessionPayment(session.publicId, {
          method: 'CASH',
          amount: 0,
          idempotencyKey: `zero-balance:${session.publicId}`,
        });
      } else {
        await employeeApi.recordSessionPayment(session.publicId, {
          method: payMethod === 'UPI' ? 'ONLINE' : 'CASH',
          amount: net,
          idempotencyKey: `settle:${session.publicId}`,
          ...(payMethod === 'UPI' ? { onlineGateway: 'UPI', onlineTransactionRef: cleanUtr(utr) } : {}),
        });
      }
      onSettled();
    } catch (err: any) {
      if (!mountedRef.current) return;
      if (handleShiftRequired(err)) return;
      const code = counterErrorCode(err);
      if (code === 'INVALID_UTR' || code === 'DUPLICATE_UTR') {
        setUtrError(apiErrorMessage(err, 'Check the UTR number.'));
        return;
      }
      // 409 (DROP_BILL_STALE): the bill changed since the last compute (a damage
      // was added or removed, an extension moved the end time, or the amount
      // drifted) — recompute so staff collect the new amount on the next tap.
      if (err?.response?.status === 409) {
        // DROP_BILL_STALE also covers an extension moving the booking's end time.
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
    if (licenseRequired && !licenseReturned) {
      setErrorMsg(LICENSE_NOT_RETURNED_MESSAGE);
      return;
    }
    setErrorMsg(null);
    setShowConfirm(true);
  };

  // Legacy (no payment sessions): plain complete.
  const completeLegacy = async () => {
    if (settleBusyRef.current) return;
    settleBusyRef.current = true;
    setSettling(true);
    setErrorMsg(null);
    try {
      await employeeApi.completeReturn(bookingId as string, {
        returnImageIds: returnPhotos.map((p) => p.fileId),
        ...(requireManager ? { requireManagerConfirmation: true } : {}),
        ...(licenseReturned ? { licenseReturned: true } : {}),
      });
      onSettled();
    } catch (err: any) {
      if (!mountedRef.current) return;
      // 409: the branch now uses payment sessions — refetch so the screen switches flow.
      if (err?.response?.data?.code === 'LICENSE_NOT_RETURNED' || err?.response?.status === 409) refetch();
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
  const showDamages = !hasRemainingBalance && !sessionDone;
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
            <InfoRow icon="calendar-outline" label="Return Due" value={formatDate(booking.endAt)} />
            <View style={styles.divider} />
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
                  value={booking.remainingPaidAt ? 'Paid' : `${inr(num(booking.remainingBalance))} due`}
                  valueColor={booking.remainingPaidAt ? '#10b981' : '#f59e0b'}
                />
              </>
            )}
          </View>

          {/* Extend an active rental (before charges are computed) */}
          {booking.status === 'PICKED_UP' && !session && (
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

          {/* Payment ledger */}
          <SectionHeader title="Payment" />
          <CounterPaymentPanel bookingPublicId={booking.publicId} />

          {/* State at pickup */}
          {(startOdo != null || booking.pickupFuelLevel) && (
            <>
              <SectionHeader title="State at Pickup" />
              <View style={styles.card}>
                {startOdo != null && (
                  <InfoRow icon="speedometer-outline" label="Odometer" value={km(startOdo)} />
                )}
                {startOdo != null && booking.pickupFuelLevel && <View style={styles.divider} />}
                {booking.pickupFuelLevel && (
                  <InfoRow icon="water-outline" label="Fuel level" value={FUEL_LEVEL_LABELS[booking.pickupFuelLevel] ?? booking.pickupFuelLevel} />
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
                  {pickupCaptures.map((p) => (
                    <View key={p.publicId} style={styles.captureThumbWrap}>
                      <Image source={{ uri: p.url }} style={styles.captureThumb} resizeMode="cover" />
                      {p.captureLabel ? (
                        <Text style={styles.captureLabel} numberOfLines={1}>{p.captureLabel}</Text>
                      ) : null}
                    </View>
                  ))}
                </ScrollView>
              </View>
            </>
          )}

          {/* Original driving licence held since pickup */}
          {!hasRemainingBalance && licenseRequired && !session && (
            <>
              <SectionHeader title="Driving Licence" />
              <View style={styles.card}>
                <View style={styles.toggleRow}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={styles.toggleLabel}>Original driving licence returned to customer</Text>
                    <Text style={styles.hint}>Hand back the physical licence collected at pickup.</Text>
                  </View>
                  <Switch
                    value={licenseReturned}
                    onValueChange={setLicenseReturned}
                    trackColor={{ false: Colors.ink4, true: Colors.orange }}
                    thumbColor={Colors.white}
                  />
                </View>
              </View>
            </>
          )}

          {/* === Charges / settlement (only once rental balance is clear) === */}
          {!hasRemainingBalance && booking.usePaymentSessions && !session && (
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
                  keyboardType="numeric"
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
                      {kmPreview.allowance
                        ? ` · Included ${kmPreview.allowance.included.toLocaleString('en-IN')}`
                          + (kmPreview.allowance.enabled
                            ? ` · Extra ${kmPreview.allowance.extra.toLocaleString('en-IN')} km × ${inr(kmPreview.allowance.rate)} = ${inr(kmPreview.allowance.charge)}`
                            : ' · Extra km not charged')
                        : ''}
                    </Text>
                    {kmPreview.belowStart && (
                      <Text style={styles.kmPreviewWarn}>Lower than the pickup reading ({km(startOdo ?? 0)}).</Text>
                    )}
                  </View>
                )}

                {/* Fuel level (fuel module) */}
                {fuelModuleEnabled && (
                  <>
                    <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Return fuel level</Text>
                    <View style={styles.fuelGrid}>
                      {Array.from({ length: 10 }, (_, i) => String(i + 1)).map((lvl) => (
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
                  </>
                )}
              </View>

              <SectionHeader title="Additional Charges" />
              <View style={styles.card}>
                {fuelModuleEnabled && (
                  <>
                    <ChargeToggle label="Fuel deficit charge" enabled={chargeFuel} onToggle={setChargeFuel}>
                      <TextInput
                        style={styles.input}
                        value={fuelAmt}
                        onChangeText={setFuelAmt}
                        placeholder="Amount ₹"
                        placeholderTextColor={Colors.ink4}
                        keyboardType="numeric"
                      />
                    </ChargeToggle>
                    <View style={styles.divider} />
                  </>
                )}

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
                    </ChargeToggle>
                    <View style={styles.divider} />
                  </>
                )}

                <ChargeToggle label="Other charge" enabled={chargeOther} onToggle={setChargeOther}>
                  <TextInput
                    style={styles.input}
                    value={otherLabel}
                    onChangeText={setOtherLabel}
                    placeholder="Description"
                    placeholderTextColor={Colors.ink4}
                  />
                  <TextInput
                    style={[styles.input, { marginTop: 8 }]}
                    value={otherAmt}
                    onChangeText={setOtherAmt}
                    placeholder="Amount ₹"
                    placeholderTextColor={Colors.ink4}
                    keyboardType="numeric"
                  />
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

              {safetyDeposit > 0 && (
                <Text style={styles.depositNote}>
                  Security deposit of {inr(safetyDeposit)} will be credited against the charges below.
                </Text>
              )}
            </>
          )}

          {/* Return condition photos (before settlement) */}
          {!hasRemainingBalance && !session && (
            <>
              <SectionHeader title="Return Condition Photos" />
              <View style={styles.card}>
                <Text style={styles.hint}>Capture the vehicle's condition at return (optional).</Text>
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

          {/* Damage found at drop — billed on the return session, or by the manager on review (legacy) */}
          {showDamages && (
            <>
              <SectionHeader title="Damage" />
              <View style={styles.card}>
                {damagesError ? (
                  <View style={styles.toggleRow}>
                    <Text style={[styles.hintInline, { flex: 1 }]}>Could not load damages.</Text>
                    <TouchableOpacity onPress={() => refetchDamages()} hitSlop={8}>
                      <Text style={styles.link}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                ) : damages.length === 0 ? (
                  <Text style={styles.hintInline}>
                    {damagesLoaded ? 'No damage recorded at this drop.' : 'Loading damages…'}
                  </Text>
                ) : (
                  damages.map((d, i) => (
                    <View key={d.publicId}>
                      {i > 0 && <View style={styles.divider} />}
                      <View style={styles.damageRow}>
                        {d.photos[0] ? (
                          <Image source={{ uri: d.photos[0].url }} style={styles.damageThumb} resizeMode="cover" />
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
              </View>
            </>
          )}

          {/* Manager confirmation escalation (#50) — legacy (non-session) returns only */}
          {!hasRemainingBalance && !booking.usePaymentSessions && (
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
                      <Text style={styles.hint}>{VEHICLE_SWAPPED_KM_NOTE}</Text>
                    </View>
                  ) : (
                    <View style={styles.card}>
                      <InfoRow
                        icon="speedometer-outline"
                        label="Odometer"
                        value={kmSummary.startOdometer != null
                          ? `${kmSummary.startOdometer.toLocaleString('en-IN')} → ${km(kmSummary.endOdometer)}`
                          : km(kmSummary.endOdometer)}
                      />
                      <View style={styles.divider} />
                      <InfoRow icon="navigate-outline" label="Km driven" value={km(kmSummary.kmDriven)} />
                      <View style={styles.divider} />
                      <InfoRow icon="gift-outline" label="Included" value={km(kmSummary.includedKm)} />
                      <View style={styles.divider} />
                      <InfoRow
                        icon="trending-up-outline"
                        label="Extra km"
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
              <LedgerSummaryCard session={session} />

              {/* Drop discount — part of the compute body, re-sent on every recompute */}
              {!sessionDone && (
                discountOpen ? (
                  <View style={[styles.card, { marginTop: 8 }]}>
                    <Text style={styles.fieldLabel}>Discount amount (₹)</Text>
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

              {!sessionDone && net > 0 && (
                <View style={[styles.card, { marginTop: 8 }]}>
                  <Text style={styles.fieldLabel}>Payment method</Text>
                  <View style={styles.methodRow}>
                    {(['CASH', 'UPI'] as const).map((m) => (
                      <TouchableOpacity
                        key={m}
                        style={[styles.methodBtn, payMethod === m && styles.methodBtnActive]}
                        onPress={() => { setPayMethod(m); setUtrError(undefined); }}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.methodText, payMethod === m && styles.methodTextActive]}>
                          {m === 'CASH' ? 'Cash' : 'UPI (UTR)'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {payMethod === 'UPI' && (
                    <UtrInput
                      value={utr}
                      onChangeText={(t) => { setUtr(t); setUtrError(undefined); }}
                      error={utrError}
                    />
                  )}
                </View>
              )}

              {!sessionDone && (
                <TouchableOpacity
                  style={styles.recomputeBtn}
                  onPress={() => {
                    setSession(null);
                    setKmSummary(null);
                    setServerDiscount(null);
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
          {hasRemainingBalance ? (
            <View style={styles.footerNote}>
              <Ionicons name="lock-closed-outline" size={16} color={Colors.ink3} />
              <Text style={styles.footerNoteText}>Collect the rental balance to continue.</Text>
            </View>
          ) : photosPending > 0 && !session ? (
            <View style={styles.footerNote}>
              <Ionicons name="cloud-upload-outline" size={16} color={Colors.ink3} />
              <Text style={styles.footerNoteText}>Finish uploading photos above (retry or remove failed ones)</Text>
            </View>
          ) : !booking.usePaymentSessions ? (
            <TouchableOpacity
              style={[styles.confirmBtn, (settling || !!deletingDamageId) && styles.confirmBtnDisabled]}
              onPress={requestLegacyComplete}
              disabled={settling || !!deletingDamageId}
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
                    {net > 0 ? `Collect ${inr(net)} & complete` : net < 0 ? `Refund ${inr(net)} & complete` : 'Complete Return'}
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
        message={`Confirm that ${customer.name} has returned the vehicle?`}
        confirmLabel="Complete Return"
        confirmColor="#3b82f6"
        onConfirm={() => { setShowConfirm(false); completeLegacy(); }}
        onCancel={() => setShowConfirm(false)}
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
  doneBtn: { backgroundColor: Colors.ink, borderRadius: 16, paddingVertical: 17, paddingHorizontal: 40, alignItems: 'center', marginTop: 8, width: '100%' },
  doneBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },
});

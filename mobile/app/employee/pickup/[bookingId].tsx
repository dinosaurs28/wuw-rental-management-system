import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import ConfirmModal from '../../../components/ui/ConfirmModal';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import SectionCard from '../../../components/employee/return/SectionCard';
import PhotoUploader, { type UploadedPhoto } from '../../../components/employee/return/PhotoUploader';
import LedgerSummary from '../../../components/employee/return/LedgerSummary';
import RecordPaymentSheet from '../../../components/employee/return/RecordPaymentSheet';
import type {
  ChargeBreakdown,
  ChargeEntry,
  FuelLevel,
  PaymentSession,
} from '../../../types/return';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface BookingDetail {
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
  days: number;
  usePaymentSessions?: boolean;
  customer: { user: { name: string; phone: string | null } };
  items: Array<{
    vehicle: {
      make: string;
      model: string;
      regNo: string;
      odo: number | null;
    };
  }>;
}

interface CaptureField {
  name: string;
  required: boolean;
}
interface CaptureConfig {
  publicId: string;
  fields: CaptureField[];
  category: { publicId: string; name: string };
}

const FUEL_LEVELS: { label: string; value: number; flag: FuelLevel; icon: IoniconName }[] = [
  { label: 'Empty', value: 0,   flag: 'EMPTY',         icon: 'battery-dead-outline' },
  { label: '¼',     value: 25,  flag: 'QUARTER',       icon: 'battery-half-outline' },
  { label: '½',     value: 50,  flag: 'HALF',          icon: 'battery-half-outline' },
  { label: '¾',     value: 75,  flag: 'THREE_QUARTER', icon: 'battery-full-outline' },
  { label: 'Full',  value: 100, flag: 'FULL',          icon: 'battery-full-outline' },
];

// Convert backend slot key like "left_side" / "fuel_gauge" to "Left Side" / "Fuel Gauge".
function humanizeSlotName(s: string): string {
  return s
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

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

// Build a ChargeBreakdown shape that LedgerSummary can render directly from a
// PICKUP PaymentSession (which only exposes ledger entries, not chargeBreakdown).
function deriveBreakdownFromSession(session: PaymentSession): ChargeBreakdown {
  const charges: ChargeEntry[] = session.entries
    .filter((e: any) => e.entryType !== 'PAYMENT' && e.entryType !== 'REFUND')
    .map((e: any) => ({
      chargeType: e.entryType,
      moduleKey: e.entryType,
      label: e.description ?? e.entryType,
      originalAmount: e.amount,
      finalAmount: e.amount,
      quantity: null,
      unitRate: null,
      isOverridden: false,
      notes: null,
    }));

  // Subtotal = totalCharges (positive); waivedTotal = absolute totalDiscounts.
  const subtotal = session.totalCharges;
  const waivedTotal = String(Math.abs(parseFloat(session.totalDiscounts || '0')).toFixed(2));
  const finalTotal = session.netPayable;

  return { subtotal, waivedTotal, finalTotal, charges };
}

export default function PickupScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  // Vehicle-state inputs
  const [odo, setOdo] = useState('');
  const [fuelIdx, setFuelIdx] = useState<number>(2); // default ½

  // KYC
  const [kycExpanded, setKycExpanded] = useState<Record<string, boolean>>({});

  // Photos — legacy single-list
  const [legacyPhotos, setLegacyPhotos] = useState<UploadedPhoto[]>([]);
  // Photos — capture-config slots (keyed by field.name)
  const [captureSlots, setCaptureSlots] = useState<Record<string, UploadedPhoto | null>>({});

  // Session state
  const [session, setSession] = useState<PaymentSession | null>(null);
  const [initiating, setInitiating] = useState(false);
  const [paymentSheetOpen, setPaymentSheetOpen] = useState(false);
  const [zeroBalSubmitting, setZeroBalSubmitting] = useState(false);
  const [zeroBalKey] = useState(() => `pkzero_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

  // Deposit
  const [depositOn, setDepositOn] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositReason, setDepositReason] = useState('');
  const [depositSubmitting, setDepositSubmitting] = useState(false);

  // Discount
  const [discountInput, setDiscountInput] = useState('');
  const [discountSubmitting, setDiscountSubmitting] = useState(false);

  // Legacy completion path
  const [showConfirm, setShowConfirm] = useState(false);
  const [done, setDone] = useState(false);

  // ── Booking ────────────────────────────────────────────────────────────────
  const { data: booking, isLoading, isError } = useQuery<BookingDetail>({
    queryKey: ['employee', 'pickup', bookingId],
    queryFn: async () => {
      const res = await employeeApi.getPickupDetails(bookingId as string);
      return res.data?.data as BookingDetail;
    },
    enabled: !!bookingId,
    staleTime: 30_000,
    retry: false,
  });

  const useSessionFlow = booking?.usePaymentSessions === true;

  // ── KYC ────────────────────────────────────────────────────────────────────
  const { data: kycData, isLoading: kycLoading } = useQuery({
    queryKey: ['employee', 'kyc', bookingId],
    queryFn: async () => {
      const res = await employeeApi.getBookingKyc(bookingId as string);
      return res.data as {
        customerName: string;
        kyc: Array<{ publicId: string; type: string; status: string; file: { url: string; mime: string } }>;
      };
    },
    enabled: !!bookingId,
    staleTime: 30_000,
    retry: false,
  });

  const kycMutation = useMutation({
    mutationFn: ({ kycId, status }: { kycId: string; status: 'APPROVED' | 'REJECTED' }) =>
      employeeApi.verifyKyc(kycId, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employee', 'kyc', bookingId] }),
    onError: () => Alert.alert('Error', 'Failed to update document status.'),
  });

  // ── Capture config ─────────────────────────────────────────────────────────
  const { data: captureConfig } = useQuery<CaptureConfig | null>({
    queryKey: ['employee', 'pickup', bookingId, 'capture-config'],
    queryFn: async () => {
      const res = await employeeApi.getPickupCaptureConfig(bookingId as string);
      return (res.data?.config ?? null) as CaptureConfig | null;
    },
    enabled: !!bookingId,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // ── Resume active session (404 = no session yet) ───────────────────────────
  useQuery({
    queryKey: ['employee', 'pickup', bookingId, 'session'],
    queryFn: async () => {
      try {
        const res = await employeeApi.getActivePickupSession(bookingId as string);
        const data = res.data?.data as PaymentSession | null;
        if (data) setSession(data);
        return data ?? null;
      } catch (err: any) {
        if (err?.response?.status === 404) return null;
        throw err;
      }
    },
    enabled: !!bookingId && useSessionFlow,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // ── Legacy completion mutation ─────────────────────────────────────────────
  const legacyMutation = useMutation({
    mutationFn: () =>
      employeeApi.completePickup(bookingId as string, {
        odo: Number(odo),
        fuelLevel: FUEL_LEVELS[fuelIdx]!.value,
        pickupImageIds: legacyPhotos.map((p) => p.publicId),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee', 'pickups'] });
      qc.invalidateQueries({ queryKey: ['employee', 'dashboard-stats'] });
      setDone(true);
    },
    onError: () => setShowConfirm(false),
  });

  // ── Photo upload helpers ───────────────────────────────────────────────────
  const uploadLegacyPhoto = async (form: FormData): Promise<UploadedPhoto> => {
    const res = await employeeApi.uploadPickupImage(form);
    const photo: UploadedPhoto = { publicId: res.data.fileId, url: res.data.url };
    setLegacyPhotos((prev) => [...prev, photo]);
    return photo;
  };

  const uploadSlotPhoto = async (label: string, form: FormData): Promise<UploadedPhoto> => {
    const res = await employeeApi.uploadPickupImage(form);
    const photo: UploadedPhoto = { publicId: res.data.fileId, url: res.data.url };
    setCaptureSlots((prev) => ({ ...prev, [label]: photo }));
    return photo;
  };

  const removeSlotPhoto = async (label: string, photo: UploadedPhoto) => {
    try {
      await employeeApi.deletePickupImage(photo.publicId);
    } catch {
      /* even if delete fails server-side we drop client-side */
    }
    setCaptureSlots((prev) => ({ ...prev, [label]: null }));
  };

  const removeLegacyPhoto = (photo: UploadedPhoto) => {
    setLegacyPhotos((prev) => prev.filter((p) => p.publicId !== photo.publicId));
  };

  // ── Refresh session ────────────────────────────────────────────────────────
  const refreshSession = async () => {
    try {
      const res = await employeeApi.getActivePickupSession(bookingId as string);
      const data = res.data?.data as PaymentSession | null;
      if (data) setSession(data);
    } catch {
      /* noop */
    }
  };

  // ── Initiate session ───────────────────────────────────────────────────────
  const handleInitiateSession = async () => {
    if (!booking) return;
    if (!odo.trim() || Number(odo) < 0) {
      Alert.alert('Missing odometer', 'Please record the odometer reading.');
      return;
    }

    // Required-photos gate
    if (captureConfig) {
      const missing = captureConfig.fields
        .filter((f) => f.required && !captureSlots[f.name])
        .map((f) => f.name);
      if (missing.length > 0) {
        Alert.alert('Missing required photos', missing.join(', '));
        return;
      }
    }

    const fuel = FUEL_LEVELS[fuelIdx]!;
    const captureImages = captureConfig
      ? Object.entries(captureSlots)
          .filter(([, p]) => p !== null)
          .map(([label, p]) => ({ fileId: p!.publicId, label }))
      : undefined;
    const pickupImageIds = !captureConfig
      ? legacyPhotos.map((p) => p.publicId)
      : undefined;

    setInitiating(true);
    try {
      const res = await employeeApi.initiatePickupSession(bookingId as string, {
        odo: Number(odo),
        fuelLevel: fuel.value,
        pickupFuelLevel: fuel.flag,
        pickupImageIds,
        captureImages,
      });
      const data = res.data?.data as PaymentSession;
      setSession(data);
    } catch (err: any) {
      Alert.alert(
        'Could not start session',
        err?.response?.data?.message ?? 'Please try again.',
      );
    } finally {
      setInitiating(false);
    }
  };

  // ── Deposit handlers ───────────────────────────────────────────────────────
  const submitDeposit = async () => {
    const amt = parseFloat(depositAmount || '0');
    if (!session) return;
    if (amt <= 0) {
      Alert.alert('Invalid amount', 'Enter a positive deposit amount.');
      return;
    }
    if (!depositReason.trim()) {
      Alert.alert('Missing reason', 'A reason is required for the deposit.');
      return;
    }
    setDepositSubmitting(true);
    try {
      const res = await employeeApi.addDepositToPickupSession(bookingId as string, {
        amount: amt,
        reason: depositReason.trim(),
      });
      const data = res.data?.data as PaymentSession;
      setSession(data);
    } catch (err: any) {
      Alert.alert('Deposit failed', err?.response?.data?.message ?? 'Please try again.');
    } finally {
      setDepositSubmitting(false);
    }
  };

  const removeDeposit = async () => {
    if (!session) return;
    setDepositSubmitting(true);
    try {
      const res = await employeeApi.removeDepositFromPickupSession(bookingId as string);
      const data = res.data?.data as PaymentSession;
      setSession(data);
      setDepositOn(false);
      setDepositAmount('');
      setDepositReason('');
    } catch (err: any) {
      Alert.alert('Could not remove deposit', err?.response?.data?.message ?? 'Please try again.');
    } finally {
      setDepositSubmitting(false);
    }
  };

  // ── Discount handlers ──────────────────────────────────────────────────────
  const applyDiscount = async () => {
    const code = discountInput.trim();
    if (!session || !code) return;
    setDiscountSubmitting(true);
    try {
      const res = await employeeApi.applyDiscountToPickupSession(bookingId as string, {
        discountCode: code,
      });
      const data = res.data?.data as PaymentSession;
      setSession(data);
      setDiscountInput('');
    } catch (err: any) {
      Alert.alert('Invalid code', err?.response?.data?.message ?? 'Please try again.');
    } finally {
      setDiscountSubmitting(false);
    }
  };

  const removeDiscount = async () => {
    if (!session) return;
    setDiscountSubmitting(true);
    try {
      const res = await employeeApi.removeDiscountFromPickupSession(bookingId as string);
      const data = res.data?.data as PaymentSession;
      setSession(data);
    } catch (err: any) {
      Alert.alert('Could not remove discount', err?.response?.data?.message ?? 'Please try again.');
    } finally {
      setDiscountSubmitting(false);
    }
  };

  // ── Payment / refund ───────────────────────────────────────────────────────
  const submitPayment = async (input: {
    method: 'CASH' | 'ONLINE';
    amount: number;
    notes: string;
    onlineTransactionRef?: string;
    onlineGateway?: string;
    idempotencyKey: string;
  }) => {
    if (!session) throw new Error('Session not ready.');
    const isRefund = session.isRefund;
    const fn = isRefund ? employeeApi.recordRefund : employeeApi.recordPayment;
    const payload = isRefund
      ? {
          method: input.method,
          amount: input.amount,
          idempotencyKey: input.idempotencyKey,
          notes: input.notes || undefined,
        }
      : {
          method: input.method,
          amount: input.amount,
          idempotencyKey: input.idempotencyKey,
          notes: input.notes || undefined,
          onlineTransactionRef: input.onlineTransactionRef,
          onlineGateway: input.onlineGateway,
        };
    await fn(session.publicId, payload as any);
    await refreshSession();
    qc.invalidateQueries({ queryKey: ['employee', 'pickups'] });
    qc.invalidateQueries({ queryKey: ['employee', 'dashboard-stats'] });
    setPaymentSheetOpen(false);
  };

  // ── Derived state ──────────────────────────────────────────────────────────
  const vehicle = booking?.items?.[0]?.vehicle;
  const customer = booking?.customer?.user;

  const hasRemainingBalance =
    !!booking &&
    booking.isAdvancePayment &&
    booking.remainingBalance != null &&
    Number(booking.remainingBalance) > 0 &&
    !booking.remainingPaidAt;

  const allKycApproved = useMemo(() => {
    if (!kycData?.kyc?.length) return false;
    return kycData.kyc.every((k) => k.status === 'APPROVED');
  }, [kycData]);

  const requiredPhotosOk = useMemo(() => {
    if (captureConfig) {
      return captureConfig.fields
        .filter((f) => f.required)
        .every((f) => !!captureSlots[f.name]);
    }
    return true;
  }, [captureConfig, captureSlots]);

  const handoverReady =
    allKycApproved &&
    odo.trim() !== '' &&
    Number(odo) >= 0 &&
    requiredPhotosOk;

  const sessionCompleted = session?.status === 'COMPLETED';
  const netPayable = session ? parseFloat(session.netPayable) : 0;
  const showPaymentBtn =
    !!session && !sessionCompleted && Math.abs(netPayable) > 0;
  const showSettleBtn =
    !!session && !sessionCompleted && Math.abs(netPayable) === 0;
  const breakdown = session ? deriveBreakdownFromSession(session) : null;

  const depositEntry = session?.entries.find(
    (e: any) => e.entryType === 'DEPOSIT',
  ) as any;
  const discountEntry = session?.entries.find(
    (e: any) => e.entryType === 'DISCOUNT',
  ) as any;

  // Auto-show success when session completes (for session flow)
  useEffect(() => {
    if (useSessionFlow && sessionCompleted) setDone(true);
  }, [useSessionFlow, sessionCompleted]);

  // ── Loading / error ────────────────────────────────────────────────────────
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
          <Text style={styles.title}>Pickup</Text>
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
            <Ionicons name="checkmark-circle" size={64} color="#10b981" />
          </View>
          <Text style={styles.successTitle}>Pickup Complete</Text>
          <Text style={styles.successSub}>
            {vehicle.make} {vehicle.model} has been handed over to {customer.name}.
          </Text>
          <View style={styles.successDetails}>
            <View style={styles.successRow}>
              <Ionicons name="speedometer-outline" size={15} color={Colors.ink3} />
              <Text style={styles.successRowText}>
                Odometer: {odo || vehicle.odo} km
              </Text>
            </View>
            <View style={styles.successRow}>
              <Ionicons name="water-outline" size={15} color={Colors.ink3} />
              <Text style={styles.successRowText}>
                Fuel: {FUEL_LEVELS[fuelIdx]!.label}
              </Text>
            </View>
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
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {/* Legacy-flow payment warning */}
          {!useSessionFlow && hasRemainingBalance && (
            <View style={styles.warningCard}>
              <Ionicons name="warning-outline" size={18} color="#f59e0b" />
              <View style={styles.warningTextWrap}>
                <Text style={styles.warningTitle}>Remaining Balance Due</Text>
                <Text style={styles.warningBody}>
                  ₹{Number(booking.remainingBalance).toLocaleString('en-IN')} must be collected before pickup.
                </Text>
              </View>
            </View>
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

          {/* KYC */}
          <SectionHeader title="Identity Document" />
          {kycLoading ? (
            <View style={styles.card}>
              <ActivityIndicator size="small" color={Colors.orange} />
            </View>
          ) : kycData?.kyc?.length ? (
            kycData.kyc.map((doc) => {
              const approved = doc.status === 'APPROVED';
              const rejected = doc.status === 'REJECTED';
              const expanded = !!kycExpanded[doc.publicId];
              return (
                <View
                  key={doc.publicId}
                  style={[
                    styles.kycDocCard,
                    approved && styles.kycDocCardApproved,
                    rejected && styles.kycDocCardRejected,
                  ]}
                >
                  <View style={styles.kycRow}>
                    <View style={styles.kycRowLeft}>
                      <View style={[styles.kycIcon, approved && styles.kycIconApproved, rejected && styles.kycIconRejected]}>
                        <Ionicons
                          name={approved ? 'checkmark-circle' : rejected ? 'close-circle' : 'card-outline'}
                          size={20}
                          color={approved ? '#10b981' : rejected ? '#e53e3e' : Colors.ink3}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.kycType}>{doc.type.replace(/_/g, ' ')}</Text>
                        <Text style={[styles.kycStatus, approved && { color: '#10b981' }, rejected && { color: '#e53e3e' }]}>
                          {approved ? 'Verified' : rejected ? 'Rejected' : 'Pending review'}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.kycViewBtn}
                      onPress={() => setKycExpanded((v) => ({ ...v, [doc.publicId]: !v[doc.publicId] }))}
                      activeOpacity={0.8}
                    >
                      <Ionicons name={expanded ? 'eye-off-outline' : 'eye-outline'} size={14} color={Colors.ink2} />
                      <Text style={styles.kycViewBtnText}>{expanded ? 'Hide' : 'View'}</Text>
                    </TouchableOpacity>
                  </View>

                  {expanded && (
                    <View style={styles.kycImageWrap}>
                      <Image source={{ uri: doc.file.url }} style={styles.kycImage} resizeMode="contain" />
                    </View>
                  )}

                  {!approved && !rejected && (
                    <View style={styles.kycActions}>
                      <TouchableOpacity
                        style={[styles.kycActionBtn, styles.kycRejectBtn]}
                        onPress={() => kycMutation.mutate({ kycId: doc.publicId, status: 'REJECTED' })}
                        disabled={kycMutation.isPending}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="close" size={14} color="#e53e3e" />
                        <Text style={[styles.kycActionText, { color: '#e53e3e' }]}>Reject</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.kycActionBtn, styles.kycApproveBtn]}
                        onPress={() => kycMutation.mutate({ kycId: doc.publicId, status: 'APPROVED' })}
                        disabled={kycMutation.isPending}
                        activeOpacity={0.8}
                      >
                        {kycMutation.isPending ? (
                          <ActivityIndicator size="small" color="#10b981" />
                        ) : (
                          <>
                            <Ionicons name="checkmark" size={14} color="#10b981" />
                            <Text style={[styles.kycActionText, { color: '#10b981' }]}>Approve</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })
          ) : (
            <View style={styles.card}>
              <View style={styles.kycEmpty}>
                <Ionicons name="document-outline" size={20} color={Colors.ink4} />
                <Text style={styles.kycEmptyText}>No document linked to this booking</Text>
              </View>
            </View>
          )}

          {/* Vehicle */}
          <SectionHeader title="Vehicle" />
          <View style={styles.card}>
            <View style={styles.vehicleRow}>
              <View style={styles.vehicleIcon}>
                <Ionicons name="car-outline" size={22} color={Colors.orange} />
              </View>
              <View style={styles.vehicleInfo}>
                <Text style={styles.vehicleName} numberOfLines={2}>
                  {vehicle.make} {vehicle.model}
                </Text>
                <Text style={styles.vehicleReg} numberOfLines={1}>{vehicle.regNo}</Text>
              </View>
            </View>
            {vehicle.odo !== null && (
              <>
                <View style={[styles.divider, { marginVertical: 12 }]} />
                <View style={styles.odoRow}>
                  <Ionicons name="speedometer-outline" size={15} color={Colors.ink3} />
                  <Text style={styles.odoLabel}>Current Odometer</Text>
                  <Text style={styles.odoValue}>{vehicle.odo.toLocaleString('en-IN')} km</Text>
                </View>
              </>
            )}
          </View>

          {/* Booking summary */}
          <SectionHeader title="Booking" />
          <View style={styles.card}>
            <InfoRow icon="calendar-outline" label="Pickup" value={formatDate(booking.startAt)} />
            <View style={styles.divider} />
            <InfoRow icon="calendar-outline" label="Return" value={formatDate(booking.endAt)} />
            <View style={styles.divider} />
            <InfoRow
              icon="time-outline"
              label="Duration"
              value={`${booking.days} day${booking.days !== 1 ? 's' : ''}`}
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
                  value={`₹${Number(booking.advanceAmount ?? 0).toLocaleString('en-IN')}`}
                />
                {booking.remainingBalance != null && Number(booking.remainingBalance) > 0 && !booking.remainingPaidAt ? (
                  <>
                    <View style={styles.divider} />
                    <View style={styles.infoRow}>
                      <View style={styles.infoRowLeft}>
                        <Ionicons name="alert-circle-outline" size={15} color="#f59e0b" />
                        <Text style={[styles.infoLabel, { color: '#f59e0b' }]}>Balance Due</Text>
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

          {/* ── Capture-config photo slots OR legacy single uploader ── */}
          <SectionCard
            title={captureConfig ? `Required photos · ${captureConfig.category.name}` : 'Pickup photos'}
            subtitle={
              captureConfig
                ? 'Capture each angle below'
                : 'Capture the vehicle condition at handover'
            }
            state={requiredPhotosOk && (captureConfig || legacyPhotos.length > 0) ? 'completed' : 'active'}
            icon="camera-outline"
          >
            {captureConfig ? (
              <View>
                <View style={styles.slotGrid}>
                  {captureConfig.fields.map((field) => {
                    const photo = captureSlots[field.name] ?? null;
                    return (
                      <View key={field.name} style={styles.slotCell}>
                        <View style={styles.slotHeader}>
                          <Text style={styles.slotLabel} numberOfLines={1}>
                            {humanizeSlotName(field.name)}
                            {field.required ? <Text style={styles.slotRequired}> *</Text> : null}
                          </Text>
                          {photo ? (
                            <View style={styles.slotDoneBadge}>
                              <Ionicons name="checkmark" size={10} color={Colors.white} />
                            </View>
                          ) : null}
                        </View>
                        <PhotoUploader
                          photos={photo ? [photo] : []}
                          onUpload={(form) => uploadSlotPhoto(field.name, form)}
                          onRemove={(p) => removeSlotPhoto(field.name, p)}
                          fileNamePrefix={`pickup_${field.name.replace(/\s+/g, '_')}`}
                          maxPhotos={1}
                          disabled={!!session}
                          tileSize="fill"
                        />
                      </View>
                    );
                  })}
                </View>
                {!requiredPhotosOk && (
                  <View style={[styles.blockerBanner, { marginTop: 14 }]}>
                    <Ionicons name="alert-circle" size={16} color="#856404" />
                    <Text style={styles.blockerText}>
                      Capture all required photos before starting payment.
                    </Text>
                  </View>
                )}
              </View>
            ) : (
              <PhotoUploader
                photos={legacyPhotos}
                onUpload={uploadLegacyPhoto}
                onRemove={removeLegacyPhoto}
                fileNamePrefix="pickup"
                maxPhotos={8}
                disabled={!!session}
              />
            )}
          </SectionCard>

          {/* ── Vehicle state inputs ── */}
          <SectionCard
            title="Vehicle state"
            subtitle="Record odometer and fuel level"
            state={odo.trim() && Number(odo) >= 0 ? 'completed' : 'active'}
            icon="speedometer-outline"
          >
            <Text style={styles.fieldLabel}>Odometer reading (km)</Text>
            <TextInput
              style={styles.input}
              value={odo}
              onChangeText={setOdo}
              placeholder={vehicle.odo ? String(vehicle.odo) : '0'}
              placeholderTextColor={Colors.ink4}
              keyboardType="numeric"
              returnKeyType="done"
              editable={!session}
            />

            <Text style={styles.fieldLabel}>Fuel level</Text>
            <View style={styles.fuelRow}>
              {FUEL_LEVELS.map((level, i) => {
                const active = i === fuelIdx;
                return (
                  <TouchableOpacity
                    key={level.flag}
                    style={[styles.fuelBtn, active && styles.fuelBtnActive]}
                    onPress={() => !session && setFuelIdx(i)}
                    activeOpacity={0.8}
                    disabled={!!session}
                  >
                    <Text style={[styles.fuelBtnText, active && styles.fuelBtnTextActive]}>
                      {level.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </SectionCard>

          {/* ──────────────────── SESSION FLOW ──────────────────── */}
          {useSessionFlow && !session && (
            <SectionCard
              title="Start payment session"
              subtitle="Begin the ledger flow"
              icon="play-circle-outline"
            >
              {!handoverReady && (
                <View style={styles.blockerBanner}>
                  <Ionicons name="alert-circle" size={16} color="#856404" />
                  <Text style={styles.blockerText}>
                    Approve all KYC documents, record the odometer, and complete required photos to start.
                  </Text>
                </View>
              )}
              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  (!handoverReady || initiating) && styles.primaryBtnDisabled,
                ]}
                onPress={handleInitiateSession}
                disabled={!handoverReady || initiating}
                activeOpacity={0.9}
              >
                {initiating ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <>
                    <Ionicons name="arrow-forward-circle-outline" size={18} color={Colors.white} />
                    <Text style={styles.primaryBtnText}>Confirm & start session</Text>
                  </>
                )}
              </TouchableOpacity>
            </SectionCard>
          )}

          {useSessionFlow && session && breakdown && (
            <>
              {/* Deposit */}
              <SectionCard
                title="Safety deposit"
                subtitle={depositEntry ? 'Deposit captured in this session' : 'Optional — collect a refundable deposit'}
                icon="shield-outline"
                state={depositEntry ? 'completed' : 'active'}
              >
                {depositEntry ? (
                  <View>
                    <View style={styles.appliedRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.appliedTitle}>
                          ₹{parseFloat(depositEntry.amount).toLocaleString('en-IN')}
                        </Text>
                        <Text style={styles.appliedSub} numberOfLines={2}>
                          {depositEntry.description ?? 'Safety deposit'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.removeChip}
                        onPress={removeDeposit}
                        disabled={depositSubmitting || sessionCompleted}
                        activeOpacity={0.85}
                      >
                        {depositSubmitting ? (
                          <ActivityIndicator size="small" color="#dc2626" />
                        ) : (
                          <>
                            <Ionicons name="close-circle-outline" size={14} color="#dc2626" />
                            <Text style={styles.removeChipText}>Remove</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <>
                    <View style={styles.fuelRow}>
                      <TouchableOpacity
                        style={[styles.toggleBtn, !depositOn && styles.toggleBtnActive]}
                        onPress={() => setDepositOn(false)}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.toggleBtnText, !depositOn && styles.toggleBtnTextActive]}>No</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.toggleBtn, depositOn && styles.toggleBtnActive]}
                        onPress={() => setDepositOn(true)}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.toggleBtnText, depositOn && styles.toggleBtnTextActive]}>Yes</Text>
                      </TouchableOpacity>
                    </View>
                    {depositOn && (
                      <>
                        <Text style={styles.fieldLabel}>Amount (₹)</Text>
                        <TextInput
                          style={styles.input}
                          value={depositAmount}
                          onChangeText={setDepositAmount}
                          placeholder="e.g. 2000"
                          placeholderTextColor={Colors.ink4}
                          keyboardType="decimal-pad"
                        />
                        <Text style={styles.fieldLabel}>Reason</Text>
                        <TextInput
                          style={styles.input}
                          value={depositReason}
                          onChangeText={setDepositReason}
                          placeholder="e.g. Standard refundable deposit"
                          placeholderTextColor={Colors.ink4}
                        />
                        <TouchableOpacity
                          style={[
                            styles.secondaryBtn,
                            depositSubmitting && styles.primaryBtnDisabled,
                          ]}
                          onPress={submitDeposit}
                          disabled={depositSubmitting || sessionCompleted}
                          activeOpacity={0.9}
                        >
                          {depositSubmitting ? (
                            <ActivityIndicator size="small" color={Colors.white} />
                          ) : (
                            <Text style={styles.secondaryBtnText}>Add deposit</Text>
                          )}
                        </TouchableOpacity>
                      </>
                    )}
                  </>
                )}
              </SectionCard>

              {/* Discount */}
              <SectionCard
                title="Discount / coupon"
                subtitle={discountEntry ? 'Coupon applied' : 'Apply a coupon code (optional)'}
                icon="pricetag-outline"
                state={discountEntry ? 'completed' : 'active'}
              >
                {discountEntry ? (
                  <View style={styles.appliedRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.appliedTitle}>
                        −₹{Math.abs(parseFloat(discountEntry.amount)).toLocaleString('en-IN')}
                      </Text>
                      <Text style={styles.appliedSub} numberOfLines={1}>
                        {discountEntry.description ?? 'Coupon discount'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.removeChip}
                      onPress={removeDiscount}
                      disabled={discountSubmitting || sessionCompleted}
                      activeOpacity={0.85}
                    >
                      {discountSubmitting ? (
                        <ActivityIndicator size="small" color="#dc2626" />
                      ) : (
                        <>
                          <Ionicons name="close-circle-outline" size={14} color="#dc2626" />
                          <Text style={styles.removeChipText}>Remove</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <View style={styles.discountRow}>
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        value={discountInput}
                        onChangeText={setDiscountInput}
                        placeholder="Coupon code"
                        placeholderTextColor={Colors.ink4}
                        autoCapitalize="characters"
                        editable={!sessionCompleted}
                      />
                      <TouchableOpacity
                        style={[
                          styles.applyBtn,
                          (discountSubmitting || !discountInput.trim()) && styles.primaryBtnDisabled,
                        ]}
                        onPress={applyDiscount}
                        disabled={discountSubmitting || !discountInput.trim() || sessionCompleted}
                        activeOpacity={0.9}
                      >
                        {discountSubmitting ? (
                          <ActivityIndicator size="small" color={Colors.white} />
                        ) : (
                          <Text style={styles.applyBtnText}>Apply</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </SectionCard>

              {/* Ledger summary */}
              <SectionCard
                title="Charge summary"
                subtitle="Review with the customer"
                icon="receipt-outline"
              >
                <LedgerSummary breakdown={breakdown} session={session} />
              </SectionCard>

              {/* Payment / settle */}
              {showPaymentBtn ? (
                <SectionCard
                  title={session.isRefund ? 'Issue refund' : 'Collect payment'}
                  subtitle={
                    session.isRefund
                      ? `₹${Math.abs(netPayable).toLocaleString('en-IN')} refundable to customer`
                      : `₹${netPayable.toLocaleString('en-IN')} payable by customer`
                  }
                  icon="cash-outline"
                >
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={() => setPaymentSheetOpen(true)}
                    activeOpacity={0.9}
                  >
                    <Ionicons
                      name={session.isRefund ? 'arrow-undo-outline' : 'cash-outline'}
                      size={18}
                      color={Colors.white}
                    />
                    <Text style={styles.primaryBtnText}>
                      {session.isRefund ? 'Issue refund' : 'Record payment'}
                    </Text>
                  </TouchableOpacity>
                </SectionCard>
              ) : null}

              {showSettleBtn ? (
                <SectionCard
                  title="No balance"
                  subtitle="Nothing left to settle. Mark complete below."
                  icon="checkmark-done-outline"
                >
                  <TouchableOpacity
                    style={[styles.primaryBtn, zeroBalSubmitting && styles.primaryBtnDisabled]}
                    onPress={async () => {
                      setZeroBalSubmitting(true);
                      try {
                        await submitPayment({
                          method: 'CASH',
                          amount: 0,
                          notes: 'Zero-balance settlement',
                          idempotencyKey: zeroBalKey,
                        });
                      } catch (err: any) {
                        Alert.alert(
                          'Settle failed',
                          err?.response?.data?.message ?? 'Please try again.',
                        );
                      } finally {
                        setZeroBalSubmitting(false);
                      }
                    }}
                    disabled={zeroBalSubmitting}
                    activeOpacity={0.9}
                  >
                    {zeroBalSubmitting ? (
                      <ActivityIndicator size="small" color={Colors.white} />
                    ) : (
                      <>
                        <Ionicons name="checkmark-circle-outline" size={18} color={Colors.white} />
                        <Text style={styles.primaryBtnText}>Settle &amp; complete</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </SectionCard>
              ) : null}
            </>
          )}

          {/* Legacy mutation error */}
          {!useSessionFlow && legacyMutation.isError && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={16} color="#e53e3e" />
              <Text style={styles.errorBoxText}>
                {(legacyMutation.error as any)?.response?.data?.message ?? 'Something went wrong.'}
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Legacy footer CTA */}
        {!useSessionFlow && (
          <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
            <TouchableOpacity
              style={[
                styles.confirmBtn,
                (legacyMutation.isPending ||
                  hasRemainingBalance ||
                  !odo.trim() ||
                  !allKycApproved) && styles.confirmBtnDisabled,
              ]}
              onPress={() => {
                if (!odo.trim() || Number(odo) < 0) return;
                setShowConfirm(true);
              }}
              disabled={
                legacyMutation.isPending ||
                !!hasRemainingBalance ||
                !odo.trim() ||
                !allKycApproved
              }
              activeOpacity={0.85}
            >
              {legacyMutation.isPending ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={20} color={Colors.white} />
                  <Text style={styles.confirmBtnText}>Confirm Pickup</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>

      <ConfirmModal
        visible={showConfirm}
        icon="car-outline"
        iconColor={Colors.orange}
        title="Confirm Pickup"
        message={`Odometer: ${odo} km · Fuel: ${FUEL_LEVELS[fuelIdx]!.label}\n\nHand over the vehicle to ${customer.name}?`}
        confirmLabel="Confirm Pickup"
        confirmColor={Colors.orange}
        onConfirm={() => {
          setShowConfirm(false);
          legacyMutation.mutate();
        }}
        onCancel={() => setShowConfirm(false)}
      />

      <RecordPaymentSheet
        visible={paymentSheetOpen}
        onClose={() => setPaymentSheetOpen(false)}
        amount={Math.abs(netPayable)}
        isRefund={!!session?.isRefund}
        onSubmit={submitPayment}
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

  content: { paddingHorizontal: 20, gap: 8 },

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

  warningCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#f59e0b10',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#f59e0b30',
    marginBottom: 8,
  },
  warningTextWrap: { flex: 1 },
  warningTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: '#d97706' },
  warningBody: { fontFamily: Fonts.body, fontSize: 13, color: '#b45309', marginTop: 2, lineHeight: 18 },

  customerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.orange,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.white },
  customerInfo: { flex: 1 },
  customerName: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.ink },
  customerPhone: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, marginTop: 2 },

  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  vehicleIcon: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: '#ff6a1f12',
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  vehicleInfo: { flex: 1, minWidth: 0 },
  vehicleName: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.ink, lineHeight: 21 },
  vehicleReg: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, marginTop: 2 },

  odoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  odoLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, flex: 1 },
  odoValue: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },

  divider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 12 },

  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  infoValue: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },

  fieldLabel: {
    fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3,
    textTransform: 'uppercase', letterSpacing: 1,
    marginTop: 16, marginBottom: 8,
  },
  input: {
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1, borderColor: Colors.hairline,
    paddingHorizontal: 14, paddingVertical: 12,
    fontFamily: Fonts.body, fontSize: 14, color: Colors.ink,
  },

  fuelRow: { flexDirection: 'row', gap: 6 },
  fuelBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
    backgroundColor: Colors.bg,
    borderWidth: 1, borderColor: Colors.hairline,
  },
  fuelBtnActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  fuelBtnText: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink3 },
  fuelBtnTextActive: { color: Colors.white },

  toggleBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center',
    backgroundColor: Colors.bg,
    borderWidth: 1, borderColor: Colors.hairline,
  },
  toggleBtnActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  toggleBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink2 },
  toggleBtnTextActive: { color: Colors.white },

  // Capture-config slots
  slotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  slotCell: {
    width: '47%',
    gap: 8,
  },
  slotHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 6,
  },
  slotLabel: {
    fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.ink,
    flex: 1, flexShrink: 1,
  },
  slotRequired: { color: '#dc2626' },
  slotDoneBadge: {
    width: 16, height: 16, borderRadius: 999,
    backgroundColor: '#10b981',
    alignItems: 'center', justifyContent: 'center',
  },

  // Buttons
  primaryBtn: {
    marginTop: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.orange, borderRadius: 14, paddingVertical: 14,
  },
  primaryBtnDisabled: { backgroundColor: Colors.ink4 },
  primaryBtnText: {
    fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.white, letterSpacing: 0.2,
  },
  secondaryBtn: {
    marginTop: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.ink, borderRadius: 14, paddingVertical: 13,
  },
  secondaryBtnText: {
    fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.white,
  },

  // Discount row
  discountRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  applyBtn: {
    paddingHorizontal: 18, height: 44,
    borderRadius: 12, backgroundColor: Colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  applyBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.white },

  // Applied (deposit/discount) row
  appliedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.bg, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: Colors.hairline,
  },
  appliedTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  appliedSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 2 },
  removeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999, backgroundColor: '#fef2f2',
    borderWidth: 1, borderColor: '#fecaca',
  },
  removeChipText: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: '#dc2626' },

  // Banners
  blockerBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff3cd',
    borderWidth: 1, borderColor: '#ffc107',
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
    marginTop: 10,
  },
  blockerText: {
    fontFamily: Fonts.bodyMedium, fontSize: 12.5, color: '#856404', flex: 1,
  },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#e53e3e10', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#e53e3e30',
  },
  errorBoxText: { fontFamily: Fonts.body, fontSize: 13, color: '#e53e3e', flex: 1 },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink3 },

  // KYC
  kycDocCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 14,
    marginBottom: 8,
  },
  kycDocCardApproved: {
    backgroundColor: '#10b98108',
    borderColor: '#10b98130',
  },
  kycDocCardRejected: {
    backgroundColor: '#e53e3e08',
    borderColor: '#e53e3e30',
  },
  kycRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  kycRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  kycIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: Colors.bg,
    borderWidth: 1, borderColor: Colors.hairline,
    alignItems: 'center', justifyContent: 'center',
  },
  kycIconApproved: { backgroundColor: '#10b98112', borderColor: '#10b98130' },
  kycIconRejected: { backgroundColor: '#e53e3e12', borderColor: '#e53e3e30' },
  kycType: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  kycStatus: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 1 },
  kycViewBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 10, backgroundColor: Colors.bg,
    borderWidth: 1, borderColor: Colors.hairline,
  },
  kycViewBtnText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  kycImageWrap: {
    marginTop: 12, borderRadius: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.hairline,
    backgroundColor: '#f5f5f5',
  },
  kycImage: { width: '100%', height: 220 },
  kycActions: {
    flexDirection: 'row', gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
  },
  kycActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 10, borderWidth: 1,
  },
  kycApproveBtn: { backgroundColor: '#10b98110', borderColor: '#10b98130' },
  kycRejectBtn: { backgroundColor: '#e53e3e10', borderColor: '#e53e3e30' },
  kycActionText: { fontFamily: Fonts.bodySemiBold, fontSize: 13 },
  kycEmpty: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kycEmptyText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },

  // Legacy footer
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingTop: 12,
    backgroundColor: Colors.bg,
    borderTopWidth: 1, borderTopColor: Colors.hairline,
  },
  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.orange, borderRadius: 16, paddingVertical: 17,
    shadowColor: Colors.black, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
  },
  confirmBtnDisabled: { opacity: 0.45, shadowOpacity: 0 },
  confirmBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },

  successBody: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32, gap: 16,
  },
  successIcon: {
    width: 100, height: 100, borderRadius: 30,
    backgroundColor: '#10b98115',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  successTitle: {
    fontFamily: Fonts.displayBold, fontSize: 28,
    color: Colors.ink, letterSpacing: -0.8,
  },
  successSub: {
    fontFamily: Fonts.body, fontSize: 15,
    color: Colors.ink3, textAlign: 'center', lineHeight: 22,
  },
  successDetails: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1, borderColor: Colors.hairline,
    padding: 16, width: '100%', gap: 10, marginTop: 8,
  },
  successRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  successRowText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink2 },
  doneBtn: {
    backgroundColor: Colors.ink,
    borderRadius: 16, paddingVertical: 17, paddingHorizontal: 40,
    alignItems: 'center', marginTop: 8, width: '100%',
  },
  doneBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },
});

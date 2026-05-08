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
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import SectionCard from '../../../components/employee/return/SectionCard';
import PhotoUploader, { type UploadedPhoto } from '../../../components/employee/return/PhotoUploader';
import FuelLevelPicker from '../../../components/employee/return/FuelLevelPicker';
import LedgerSummary from '../../../components/employee/return/LedgerSummary';
import RecordPaymentSheet from '../../../components/employee/return/RecordPaymentSheet';
import DamageEntryEditor from '../../../components/employee/return/DamageEntryEditor';
import {
  CAR_DAMAGE_ZONES,
  TWO_WHEELER_DAMAGE_ZONES,
  type DamageEntry,
  type DamageChargeType,
  type FuelLevel,
  type ReturnSessionResponse,
  fuelLevelToPct,
  pctToFuelLevel,
} from '../../../types/return';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface BookingDetail {
  publicId: string;
  startAt: string;
  endAt: string;
  status: string;
  totalFinal: number | string;
  isAdvancePayment: boolean;
  remainingBalance: number | string | null;
  remainingPaidAt: string | null;
  days: number;
  startOdometer: number | null;
  pickupFuelLevel: FuelLevel | null;
  customer: { user: { name: string; phone: string | null } };
  items: Array<{
    vehicle: {
      publicId: string;
      make: string;
      model: string;
      regNo: string;
      category: string;
      odo: number | null;
      hasFastag?: boolean | null;
    };
  }>;
  pricingDetails?: {
    freeKmLimit?: number | null;
    extraKmRate?: number | null;
  } | null;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

const fmtNum = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface OtherCharge { label: string; amount: string; }

export default function ReturnProcess() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [returnPhotos, setReturnPhotos] = useState<UploadedPhoto[]>([]);
  const [endOdometerStr, setEndOdometerStr] = useState('');
  const [returnFuel, setReturnFuel] = useState<FuelLevel | null>(null);
  const [extraKmChargeStr, setExtraKmChargeStr] = useState('');
  const [extraKmEdited, setExtraKmEdited] = useState(false);
  const [fuelChargeStr, setFuelChargeStr] = useState('');
  const [fastagAmountStr, setFastagAmountStr] = useState('');
  const [fastagNotes, setFastagNotes] = useState('');
  const [otherCharges, setOtherCharges] = useState<OtherCharge[]>([]);

  const [computing, setComputing] = useState(false);
  const [breakdown, setBreakdown] = useState<ReturnSessionResponse['chargeBreakdown'] | null>(null);
  const [session, setSession] = useState<ReturnSessionResponse['session'] | null>(null);

  const [paymentSheetOpen, setPaymentSheetOpen] = useState(false);

  const [hasDamage, setHasDamage] = useState<boolean | null>(null);
  const [damageEntries, setDamageEntries] = useState<DamageEntry[]>([]);
  const [damageChargeType, setDamageChargeType] = useState<DamageChargeType>('PENALTY');
  const [damagePhotos, setDamagePhotos] = useState<Record<string, UploadedPhoto>>({});
  const [submittingDamage, setSubmittingDamage] = useState(false);
  const [damageSubmitted, setDamageSubmitted] = useState(false);
  const [zeroBalSubmitting, setZeroBalSubmitting] = useState(false);
  const [zeroBalKey] = useState(() => `zerobal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

  // Booking
  const { data: booking, isLoading: bookingLoading, isError: bookingError } = useQuery<BookingDetail>({
    queryKey: ['employee', 'return', bookingId],
    queryFn: async () => {
      const res = await employeeApi.getReturnDetails(bookingId as string);
      return res.data?.data as BookingDetail;
    },
    enabled: !!bookingId,
    staleTime: 30_000,
    retry: false,
  });

  // Pickup-time reference photos (read-only)
  const { data: pickupCaptures } = useQuery({
    queryKey: ['employee', 'return', bookingId, 'pickup-captures'],
    queryFn: async () => {
      const res = await employeeApi.getPickupCaptures(bookingId as string);
      return (res.data?.photos ?? res.data?.data?.photos ?? []) as { publicId: string; url: string }[];
    },
    enabled: !!bookingId,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Existing return session (resume case)
  useQuery({
    queryKey: ['employee', 'return', bookingId, 'session'],
    queryFn: async () => {
      const res = await employeeApi.getReturnSession(bookingId as string);
      const data = res.data?.data as ReturnSessionResponse | null;
      if (data?.session) {
        setSession(data.session);
        setBreakdown(data.chargeBreakdown);
      }
      return data ?? null;
    },
    enabled: !!bookingId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const vehicle = booking?.items?.[0]?.vehicle;
  const customer = booking?.customer?.user;

  // Auto-suggest km-exceeded charge
  const endOdometer = useMemo(() => {
    const n = parseFloat(endOdometerStr || '0');
    return Number.isFinite(n) ? n : 0;
  }, [endOdometerStr]);

  const startOdo = booking?.startOdometer ?? 0;
  const freeKmLimit = booking?.pricingDetails?.freeKmLimit ?? 0;
  const extraKmRate = booking?.pricingDetails?.extraKmRate ?? 0;
  const allowedKm = freeKmLimit * (booking?.days ?? 0);
  const distanceDriven = Math.max(0, endOdometer - startOdo);
  const kmOverrun = Math.max(0, distanceDriven - allowedKm);
  const suggestedExtraKm = Math.round(kmOverrun * extraKmRate);

  useEffect(() => {
    if (!extraKmEdited) {
      setExtraKmChargeStr(suggestedExtraKm > 0 ? String(suggestedExtraKm) : '');
    }
  }, [suggestedExtraKm, extraKmEdited]);

  // Fuel deficit pct (for display)
  const pickupPct = fuelLevelToPct(booking?.pickupFuelLevel ?? null);
  const returnPct = fuelLevelToPct(returnFuel);
  const fuelDeficitPct = Math.max(0, pickupPct - returnPct);

  const computeMutation = useMutation({
    mutationFn: async () => {
      if (!booking || !returnFuel || endOdometer <= 0) {
        throw new Error('Please enter the end odometer and select the return fuel level.');
      }
      const body = {
        endOdometer,
        returnFuelLevel: returnFuel,
        extraKmCharge: parseFloat(extraKmChargeStr || '0') || 0,
        fuelCharge: parseFloat(fuelChargeStr || '0') || 0,
        fastagAmount: parseFloat(fastagAmountStr || '0') || 0,
        fastagNotes: fastagNotes.trim() || undefined,
        otherCharges: otherCharges
          .map((c) => ({ label: c.label.trim(), amount: parseFloat(c.amount || '0') || 0 }))
          .filter((c) => c.label && c.amount > 0),
        returnImageIds: returnPhotos.map((p) => p.publicId),
      };
      const res = await employeeApi.computeReturnSession(bookingId as string, body);
      return res.data?.data as ReturnSessionResponse;
    },
    onMutate: () => setComputing(true),
    onSuccess: (data) => {
      setSession(data.session);
      setBreakdown(data.chargeBreakdown);
    },
    onError: (err: any) => {
      Alert.alert('Compute failed', err.response?.data?.message ?? err.message ?? 'Please try again.');
    },
    onSettled: () => setComputing(false),
  });

  const refreshSession = async () => {
    try {
      const res = await employeeApi.getReturnSession(bookingId as string);
      const data = res.data?.data as ReturnSessionResponse | null;
      if (data) {
        setSession(data.session);
        setBreakdown(data.chargeBreakdown);
      }
    } catch {
      /* noop */
    }
  };

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
    qc.invalidateQueries({ queryKey: ['employee', 'returns'] });
    qc.invalidateQueries({ queryKey: ['employee', 'dashboard-stats'] });
    setPaymentSheetOpen(false);
  };

  const submitDamage = async () => {
    if (!booking || !vehicle || !returnFuel || endOdometer <= 0) {
      Alert.alert('Missing info', 'Please complete the charges section first.');
      return;
    }
    if (damageEntries.length === 0) {
      Alert.alert('No damage entries', 'Add at least one damage entry or mark "No damage".');
      return;
    }
    setSubmittingDamage(true);
    try {
      // Highest severity wins for the top-level severity field
      const severityRank = { MINOR: 1, MODERATE: 2, SEVERE: 3 } as const;
      const topSeverity = damageEntries.reduce(
        (acc, e) => (severityRank[e.severity] > severityRank[acc] ? e.severity : acc),
        'MINOR' as DamageEntry['severity'],
      );
      const allDamageImageIds = Array.from(new Set(damageEntries.flatMap((e) => e.imageIds)));
      const notes = {
        chargeType: damageChargeType,
        entries: damageEntries.map((e) => ({
          area: e.area,
          severity: e.severity,
          description: e.description,
          imageIds: e.imageIds,
        })),
      };
      await employeeApi.reportDamage({
        bookingId: bookingId as string,
        odo: endOdometer,
        fuelLevel: fuelLevelToPct(returnFuel),
        severity: topSeverity,
        damageImageIds: allDamageImageIds,
        notes,
        returnImageIds: returnPhotos.map((p) => p.publicId),
      });
      Alert.alert('Damage reported', 'A manager will review the damage report.');
      setDamageSubmitted(true);
    } catch (err: any) {
      Alert.alert('Failed to report damage', err.response?.data?.message ?? 'Please try again.');
    } finally {
      setSubmittingDamage(false);
    }
  };

  // Backend returns { message, fileId, url } at top level (not wrapped in data).
  const uploadReturnPhoto = async (form: FormData): Promise<UploadedPhoto> => {
    const res = await employeeApi.uploadReturnImage(form);
    const photo: UploadedPhoto = {
      publicId: res.data.fileId,
      url: res.data.url,
    };
    setReturnPhotos((prev) => [...prev, photo]);
    return photo;
  };

  const uploadDamagePhoto = async (form: FormData): Promise<UploadedPhoto> => {
    const res = await employeeApi.uploadDamageImage(form);
    const photo: UploadedPhoto = {
      publicId: res.data.fileId,
      url: res.data.url,
    };
    setDamagePhotos((prev) => ({ ...prev, [photo.publicId]: photo }));
    return photo;
  };

  // Section gating
  const photosOk = returnPhotos.length > 0;
  const chargesOk = endOdometer > 0 && returnFuel != null;
  const computed = !!breakdown && !!session;
  const isCompleted = session?.status === 'COMPLETED';

  // Damage must be submitted before payment can finalize the return.
  // Otherwise an executive flagging damage but tapping payment first would
  // hit the COMPLETED branch and unmount the unsubmitted damage entries.
  const damagePending =
    hasDamage === true && damageEntries.length > 0 && !damageSubmitted;
  const damageResolved = hasDamage === false || damageSubmitted;

  // ──────────────── Loading / error / completed states ────────────────
  if (bookingLoading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <ActivityIndicator style={styles.loader} color={Colors.orange} size="large" />
      </View>
    );
  }
  if (bookingError || !booking || !vehicle || !customer) {
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

  // Only show success when the session is COMPLETED *and* damage has been
  // resolved (either marked "No damage" or the damage report submitted).
  // This prevents premature unmount that would lose unsubmitted damage data.
  if (isCompleted && damageResolved) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.back, { margin: 12 }]} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <View style={styles.successBody}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={64} color="#10b981" />
          </View>
          <Text style={styles.successTitle}>Return Complete</Text>
          <Text style={styles.successSub}>
            {vehicle.make} {vehicle.model} has been returned by {customer.name}.
          </Text>
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

  const cat = (vehicle.category ?? '').toUpperCase();
  const isTwoWheeler =
    cat.includes('TWO_WHEELER') || cat.includes('TWO WHEELER') || cat === 'BIKE'
    || cat === 'SCOOTER' || cat === 'MOTORCYCLE';
  const damageZones = isTwoWheeler ? TWO_WHEELER_DAMAGE_ZONES : CAR_DAMAGE_ZONES;
  const netPayable = session ? parseFloat(session.netPayable) : 0;
  const showPayment = computed && session && session.status !== 'COMPLETED' && Math.abs(netPayable) > 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
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

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Customer */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{customer.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.customerName}>{customer.name}</Text>
                {customer.phone ? (
                  <Text style={styles.customerPhone}>{customer.phone}</Text>
                ) : null}
              </View>
            </View>
          </View>

          {/* Vehicle */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <View style={styles.vehicleIcon}>
                <Ionicons name="car-outline" size={20} color="#3b82f6" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.vehicleName} numberOfLines={1}>
                  {vehicle.make} {vehicle.model}
                </Text>
                <Text style={styles.vehicleSub}>{vehicle.regNo} · {vehicle.category}</Text>
              </View>
            </View>
          </View>

          {/* Booking summary */}
          <View style={styles.summaryCard}>
            <Row icon="calendar-outline" label="Pickup" value={fmtDate(booking.startAt)} />
            <View style={styles.divider} />
            <Row icon="calendar-outline" label="Return due" value={fmtDate(booking.endAt)} />
            <View style={styles.divider} />
            <Row icon="time-outline" label="Duration" value={`${booking.days} day${booking.days !== 1 ? 's' : ''}`} />
            {booking.startOdometer != null ? (
              <>
                <View style={styles.divider} />
                <Row icon="speedometer-outline" label="Start odometer" value={`${fmtNum(booking.startOdometer)} km`} />
              </>
            ) : null}
            {booking.pickupFuelLevel ? (
              <>
                <View style={styles.divider} />
                <Row icon="water-outline" label="Pickup fuel" value={`${pickupPct}%`} />
              </>
            ) : null}
          </View>

          {/* ─────────── Section 1: Pickup reference photos ─────────── */}
          <SectionCard
            step={1}
            title="Pickup reference photos"
            subtitle="Captured at delivery — read-only"
            state={pickupCaptures && pickupCaptures.length > 0 ? 'completed' : 'active'}
          >
            {pickupCaptures && pickupCaptures.length > 0 ? (
              <View style={styles.refGrid}>
                {pickupCaptures.map((p) => (
                  <Image key={p.publicId} source={{ uri: p.url }} style={styles.refThumb} />
                ))}
              </View>
            ) : (
              <Text style={styles.muted}>No pickup photos available.</Text>
            )}
          </SectionCard>

          {/* ─────────── Section 2: Return condition photos ─────────── */}
          <SectionCard
            step={2}
            title="Return condition photos"
            subtitle="Capture how the vehicle returned"
            state={photosOk ? 'completed' : 'active'}
          >
            <PhotoUploader
              photos={returnPhotos}
              onUpload={uploadReturnPhoto}
              onRemove={(p) => setReturnPhotos((prev) => prev.filter((x) => x.publicId !== p.publicId))}
              fileNamePrefix="return"
              maxPhotos={8}
            />
          </SectionCard>

          {/* ─────────── Section 3: Charges ─────────── */}
          <SectionCard
            step={3}
            title="Charge details"
            subtitle="Capture odometer, fuel, and any extra charges"
            state={computed ? 'completed' : photosOk ? 'active' : 'locked'}
          >
            <Text style={styles.fieldLabel}>End odometer (km)</Text>
            <TextInput
              style={styles.input}
              value={endOdometerStr}
              onChangeText={setEndOdometerStr}
              keyboardType="number-pad"
              placeholder={booking.startOdometer ? `≥ ${booking.startOdometer}` : 'e.g. 12500'}
              placeholderTextColor={Colors.ink3}
            />
            {endOdometer > 0 && booking.startOdometer != null && endOdometer < booking.startOdometer && (
              <Text style={styles.warnText}>End odometer can't be less than start ({booking.startOdometer} km).</Text>
            )}
            {endOdometer > 0 && distanceDriven > 0 && (
              <Text style={styles.helperText}>
                Distance: {fmtNum(distanceDriven)} km · Allowed: {fmtNum(allowedKm)} km
                {kmOverrun > 0 ? ` · Overrun: ${fmtNum(kmOverrun)} km` : ''}
              </Text>
            )}

            <Text style={styles.fieldLabel}>Return fuel level</Text>
            <FuelLevelPicker value={returnFuel} onChange={setReturnFuel} />
            {fuelDeficitPct > 0 && (
              <Text style={styles.helperText}>Fuel deficit: {fuelDeficitPct}%</Text>
            )}

            <Text style={styles.fieldLabel}>Extra-km charge (₹)</Text>
            <TextInput
              style={styles.input}
              value={extraKmChargeStr}
              onChangeText={(t) => { setExtraKmChargeStr(t); setExtraKmEdited(true); }}
              keyboardType="decimal-pad"
              placeholder={suggestedExtraKm > 0 ? `Suggested ₹${suggestedExtraKm}` : '0'}
              placeholderTextColor={Colors.ink3}
            />

            <Text style={styles.fieldLabel}>Fuel-deficit charge (₹)</Text>
            <TextInput
              style={styles.input}
              value={fuelChargeStr}
              onChangeText={setFuelChargeStr}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={Colors.ink3}
            />

            {vehicle.hasFastag ? (
              <>
                <Text style={styles.fieldLabel}>FASTag toll (₹)</Text>
                <TextInput
                  style={styles.input}
                  value={fastagAmountStr}
                  onChangeText={setFastagAmountStr}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={Colors.ink3}
                />
                <Text style={styles.fieldLabel}>FASTag notes</Text>
                <TextInput
                  style={[styles.input, styles.notes]}
                  value={fastagNotes}
                  onChangeText={setFastagNotes}
                  placeholder="Toll booth, route, etc."
                  placeholderTextColor={Colors.ink3}
                  multiline
                />
              </>
            ) : null}

            <Text style={styles.fieldLabel}>Other charges</Text>
            {otherCharges.map((c, i) => (
              <View key={i} style={styles.otherRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={c.label}
                  onChangeText={(t) =>
                    setOtherCharges((prev) => prev.map((x, idx) => (idx === i ? { ...x, label: t } : x)))
                  }
                  placeholder="Label"
                  placeholderTextColor={Colors.ink3}
                />
                <TextInput
                  style={[styles.input, { width: 100 }]}
                  value={c.amount}
                  onChangeText={(t) =>
                    setOtherCharges((prev) => prev.map((x, idx) => (idx === i ? { ...x, amount: t } : x)))
                  }
                  keyboardType="decimal-pad"
                  placeholder="₹"
                  placeholderTextColor={Colors.ink3}
                />
                <TouchableOpacity
                  style={styles.removeOther}
                  onPress={() => setOtherCharges((prev) => prev.filter((_, idx) => idx !== i))}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={16} color="#dc2626" />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity
              style={styles.addOther}
              onPress={() => setOtherCharges((prev) => [...prev, { label: '', amount: '' }])}
              activeOpacity={0.8}
            >
              <Ionicons name="add-circle-outline" size={16} color={Colors.orange} />
              <Text style={styles.addOtherText}>Add charge</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.computeBtn,
                (!chargesOk || !photosOk || computing) && styles.computeBtnDisabled,
              ]}
              onPress={() => computeMutation.mutate()}
              disabled={!chargesOk || !photosOk || computing}
              activeOpacity={0.9}
            >
              {computing ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <>
                  <Text style={styles.computeBtnText}>
                    {computed ? 'Re-compute charges' : 'Compute charges'}
                  </Text>
                  <Ionicons name="arrow-forward" size={16} color={Colors.white} />
                </>
              )}
            </TouchableOpacity>
            {!photosOk && (
              <Text style={styles.helperText}>Add at least one return photo before computing.</Text>
            )}
          </SectionCard>

          {/* ─────────── Section 4: Charge breakdown ─────────── */}
          {computed && breakdown ? (
            <SectionCard
              step={4}
              title="Charge breakdown"
              subtitle="Review charges with the customer"
              state="active"
            >
              <LedgerSummary breakdown={breakdown} session={session ?? undefined} />
            </SectionCard>
          ) : null}

          {/* ─────────── Section 5: Payment / refund ─────────── */}
          {showPayment ? (
            <SectionCard
              step={5}
              title={session?.isRefund ? 'Issue refund' : 'Collect payment'}
              subtitle={
                session?.isRefund
                  ? `Refund ₹${fmtNum(Math.abs(netPayable))} due to customer`
                  : `₹${fmtNum(netPayable)} payable by customer`
              }
              state="active"
            >
              {damagePending ? (
                <View style={styles.blockerBanner}>
                  <Ionicons name="alert-circle" size={16} color="#856404" />
                  <Text style={styles.blockerText}>
                    Submit the damage report below before recording payment.
                  </Text>
                </View>
              ) : null}
              <TouchableOpacity
                style={[styles.paymentBtn, damagePending && styles.paymentBtnDisabled]}
                onPress={() => {
                  if (damagePending) {
                    Alert.alert(
                      'Damage report pending',
                      'Submit the damage report before recording payment so it isn\'t lost when the return completes.',
                    );
                    return;
                  }
                  setPaymentSheetOpen(true);
                }}
                activeOpacity={0.9}
                disabled={damagePending}
              >
                <Ionicons
                  name={session?.isRefund ? 'arrow-undo-outline' : 'cash-outline'}
                  size={18}
                  color={Colors.white}
                />
                <Text style={styles.paymentBtnText}>
                  {session?.isRefund ? 'Issue refund' : 'Record payment'}
                </Text>
              </TouchableOpacity>
            </SectionCard>
          ) : null}

          {computed && session && Math.abs(netPayable) === 0 && session.status !== 'COMPLETED' ? (
            <SectionCard
              step={5}
              title="No balance"
              subtitle="Nothing left to settle. Mark as complete below."
              state="active"
            >
              {damagePending ? (
                <View style={styles.blockerBanner}>
                  <Ionicons name="alert-circle" size={16} color="#856404" />
                  <Text style={styles.blockerText}>
                    Submit the damage report below before settling.
                  </Text>
                </View>
              ) : null}
              <TouchableOpacity
                style={[
                  styles.paymentBtn,
                  (damagePending || zeroBalSubmitting) && styles.paymentBtnDisabled,
                ]}
                onPress={async () => {
                  if (damagePending) {
                    Alert.alert(
                      'Damage report pending',
                      'Submit the damage report below before settling.',
                    );
                    return;
                  }
                  setZeroBalSubmitting(true);
                  try {
                    await submitPayment({
                      method: 'CASH',
                      amount: 0,
                      notes: 'Zero-balance settlement',
                      idempotencyKey: zeroBalKey,
                    });
                  } catch (err: any) {
                    Alert.alert('Settle failed', err.response?.data?.message ?? 'Please try again.');
                  } finally {
                    setZeroBalSubmitting(false);
                  }
                }}
                activeOpacity={0.9}
                disabled={damagePending || zeroBalSubmitting}
              >
                {zeroBalSubmitting ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={18} color={Colors.white} />
                    <Text style={styles.paymentBtnText}>Settle &amp; complete</Text>
                  </>
                )}
              </TouchableOpacity>
            </SectionCard>
          ) : null}

          {/* ─────────── Section 6: Damage report ─────────── */}
          <SectionCard
            step={6}
            title="Vehicle condition"
            subtitle={
              damageSubmitted
                ? 'Damage report submitted — pending manager review'
                : 'Report any damage for manager review'
            }
            state={hasDamage === false || damageSubmitted ? 'completed' : 'active'}
          >
            {damageSubmitted ? (
              <View style={styles.successBanner}>
                <Ionicons name="checkmark-circle" size={16} color="#059669" />
                <Text style={styles.successBannerText}>
                  Damage report sent to manager. You can now record payment.
                </Text>
              </View>
            ) : null}
            <Text style={styles.fieldLabel}>Any damage to report?</Text>
            <View style={styles.yesNoRow}>
              <TouchableOpacity
                style={[styles.yesNoPill, hasDamage === false && styles.yesNoPillActive]}
                onPress={() => {
                  if (damageSubmitted) return;
                  setHasDamage(false);
                  setDamageEntries([]);
                }}
                activeOpacity={0.85}
                disabled={damageSubmitted}
              >
                <Ionicons name="checkmark-circle-outline" size={16} color={hasDamage === false ? Colors.white : Colors.ink2} />
                <Text style={[styles.yesNoLabel, hasDamage === false && styles.yesNoLabelActive]}>No damage</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.yesNoPill, hasDamage === true && styles.yesNoPillDanger]}
                onPress={() => {
                  if (damageSubmitted) return;
                  setHasDamage(true);
                  if (damageEntries.length === 0) {
                    setDamageEntries([{ area: '', severity: 'MINOR', description: '', imageIds: [] }]);
                  }
                }}
                activeOpacity={0.85}
                disabled={damageSubmitted}
              >
                <Ionicons name="alert-circle-outline" size={16} color={hasDamage === true ? Colors.white : Colors.ink2} />
                <Text style={[styles.yesNoLabel, hasDamage === true && styles.yesNoLabelActive]}>Damage</Text>
              </TouchableOpacity>
            </View>

            {hasDamage === true && (
              <>
                {damageEntries.map((entry, idx) => (
                  <DamageEntryEditor
                    key={idx}
                    index={idx}
                    entry={entry}
                    onChange={(next) =>
                      setDamageEntries((prev) => prev.map((e, i) => (i === idx ? next : e)))
                    }
                    onRemove={() =>
                      setDamageEntries((prev) => prev.filter((_, i) => i !== idx))
                    }
                    zones={damageZones}
                    photoMap={damagePhotos}
                    onUploadPhoto={uploadDamagePhoto}
                  />
                ))}

                <TouchableOpacity
                  style={styles.addDamage}
                  onPress={() =>
                    setDamageEntries((prev) => [
                      ...prev,
                      { area: '', severity: 'MINOR', description: '', imageIds: [] },
                    ])
                  }
                  activeOpacity={0.8}
                >
                  <Ionicons name="add-circle-outline" size={16} color={Colors.orange} />
                  <Text style={styles.addDamageText}>Add another damage</Text>
                </TouchableOpacity>

                <Text style={styles.fieldLabel}>Charge type</Text>
                <View style={styles.chargeTypeRow}>
                  {(['PENALTY', 'COMPENSATION'] as DamageChargeType[]).map((t) => {
                    const active = damageChargeType === t;
                    return (
                      <TouchableOpacity
                        key={t}
                        style={[styles.chargeTypePill, active && styles.chargeTypePillActive]}
                        onPress={() => setDamageChargeType(t)}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.chargeTypeLabel, active && styles.chargeTypeLabelActive]}>
                          {t === 'PENALTY' ? 'Penalty' : 'Compensation'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TouchableOpacity
                  style={[styles.submitDamageBtn, submittingDamage && { opacity: 0.6 }]}
                  onPress={submitDamage}
                  disabled={submittingDamage}
                  activeOpacity={0.9}
                >
                  {submittingDamage ? (
                    <ActivityIndicator size="small" color={Colors.white} />
                  ) : (
                    <>
                      <Ionicons name="cloud-upload-outline" size={16} color={Colors.white} />
                      <Text style={styles.submitDamageText}>Submit damage report</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </SectionCard>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Payment sheet */}
      <RecordPaymentSheet
        visible={paymentSheetOpen}
        onClose={() => setPaymentSheetOpen(false)}
        amount={Math.abs(netPayable)}
        isRefund={!!session?.isRefund}
        onSubmit={submitPayment}
      />
    </View>
  );
}

function Row({ icon, label, value }: { icon: IoniconName; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoLeft}>
        <Ionicons name={icon} size={15} color={Colors.ink3} />
        <Text style={styles.infoLabel}>{label}</Text>
      </View>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  loader: { flex: 1, alignSelf: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.hairline,
  },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1 },
  title: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink, letterSpacing: -0.4 },
  subtitle: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.ink3, marginTop: 1 },
  returnBadge: {
    backgroundColor: '#fff5f0',
    borderWidth: 1, borderColor: '#ff6a1f33',
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999,
  },
  returnBadgeText: {
    fontFamily: Fonts.bodyBold, fontSize: 10, color: Colors.orange, letterSpacing: 0.6,
  },

  content: { padding: 12 },

  errorState: { alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12 },
  errorText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },

  successBody: { alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12, padding: 24 },
  successIcon: { marginBottom: 8 },
  successTitle: { fontFamily: Fonts.displayBold, fontSize: 22, color: Colors.ink, letterSpacing: -0.4 },
  successSub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, textAlign: 'center', lineHeight: 20 },
  doneBtn: {
    marginTop: 16, paddingHorizontal: 24, paddingVertical: 14,
    borderRadius: 14, backgroundColor: Colors.ink,
  },
  doneBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.white },

  // Summary cards (customer/vehicle/booking)
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1, borderColor: Colors.hairline,
    padding: 14, marginBottom: 10,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 38, height: 38, borderRadius: 999,
    backgroundColor: '#fff5f0', borderWidth: 1, borderColor: '#ff6a1f33',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.orange },
  customerName: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  customerPhone: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 1 },
  vehicleIcon: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: '#eff6ff',
    alignItems: 'center', justifyContent: 'center',
  },
  vehicleName: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  vehicleSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 1 },

  divider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 10 },

  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoLabel: { fontFamily: Fonts.body, fontSize: 12.5, color: Colors.ink3 },
  infoValue: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink },

  refGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  refThumb: { width: 78, height: 78, borderRadius: 10, backgroundColor: '#f0f0ee' },
  muted: { fontFamily: Fonts.body, fontSize: 12.5, color: Colors.ink3 },

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
  notes: { minHeight: 60, textAlignVertical: 'top' },
  helperText: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.ink3, marginTop: 6 },
  warnText: { fontFamily: Fonts.bodyMedium, fontSize: 11.5, color: '#dc2626', marginTop: 6 },

  otherRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  removeOther: {
    width: 36, height: 40, alignItems: 'center', justifyContent: 'center',
    borderRadius: 10, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca',
  },
  addOther: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, alignSelf: 'flex-start',
  },
  addOtherText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.orange },

  computeBtn: {
    marginTop: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.ink, borderRadius: 14, paddingVertical: 14,
  },
  computeBtnDisabled: { backgroundColor: Colors.ink4 },
  computeBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.white, letterSpacing: 0.2 },

  paymentBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.orange, borderRadius: 14, paddingVertical: 14,
  },
  paymentBtnDisabled: { backgroundColor: Colors.ink4 },
  paymentBtnText: {
    fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.white, letterSpacing: 0.2,
  },
  blockerBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff3cd', borderWidth: 1, borderColor: '#ffc107',
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
    marginBottom: 12,
  },
  blockerText: {
    fontFamily: Fonts.bodyMedium, fontSize: 12.5, color: '#856404', flex: 1,
  },
  successBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#a7f3d0',
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
    marginBottom: 12,
  },
  successBannerText: {
    fontFamily: Fonts.bodyMedium, fontSize: 12.5, color: '#065f46', flex: 1,
  },

  // Damage section
  yesNoRow: { flexDirection: 'row', gap: 8 },
  yesNoPill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 12,
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline,
  },
  yesNoPillActive: { backgroundColor: '#059669', borderColor: '#059669' },
  yesNoPillDanger: { backgroundColor: '#dc2626', borderColor: '#dc2626' },
  yesNoLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink2 },
  yesNoLabelActive: { color: Colors.white },

  addDamage: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 12,
    backgroundColor: '#fff5f0', borderWidth: 1, borderColor: '#ff6a1f33', borderStyle: 'dashed',
    marginBottom: 4,
  },
  addDamageText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.orange },

  chargeTypeRow: { flexDirection: 'row', gap: 8 },
  chargeTypePill: {
    flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center',
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline,
  },
  chargeTypePillActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  chargeTypeLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink2 },
  chargeTypeLabelActive: { color: Colors.white },

  submitDamageBtn: {
    marginTop: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.ink, borderRadius: 14, paddingVertical: 14,
  },
  submitDamageText: {
    fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.white, letterSpacing: 0.2,
  },
});

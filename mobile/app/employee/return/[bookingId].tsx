import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import type { ReturnSession } from '../../../types/api';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface ReturnBooking {
  publicId: string;
  startAt: string;
  endAt: string;
  status: string;
  totalFinal: string | number;
  isAdvancePayment: boolean;
  remainingBalance: string | number | null;
  remainingPaidAt: string | null;
  days: number | null;
  startOdometer: number | null;
  pickupFuelLevel: string | null;
  safetyDeposit: string | number | null;
  freeKmLimit: number | null;
  effectiveFreeKmLimit: number | null;
  extraKmRate: number | null;
  usePaymentSessions: boolean;
  frozenChargeConfig: { fuelModuleEnabled?: boolean; fastagModuleEnabled?: boolean } | null;
  customer: { user: { name: string; phone: string | null } };
  items: Array<{ vehicle: { make: string; model: string; regNo: string; odo: number | null; hasFastag?: boolean } }>;
}

const num = (x: unknown) => Number(x ?? 0) || 0;
const inr = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

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

  // charge inputs
  const [endOdo, setEndOdo] = useState('');
  const [fuelLevel, setFuelLevel] = useState<string>(''); // '1'..'10'
  const [chargeExtraKm, setChargeExtraKm] = useState(false);
  const [extraKmAmt, setExtraKmAmt] = useState('');
  const [chargeFuel, setChargeFuel] = useState(false);
  const [fuelAmt, setFuelAmt] = useState('');
  const [chargeFastag, setChargeFastag] = useState(false);
  const [fastagAmt, setFastagAmt] = useState('');
  const [fastagNote, setFastagNote] = useState('');
  const [chargeOther, setChargeOther] = useState(false);
  const [otherLabel, setOtherLabel] = useState('');
  const [otherAmt, setOtherAmt] = useState('');

  const [returnPhotos, setReturnPhotos] = useState<CapturedPhoto[]>([]);
  const [session, setSession] = useState<ReturnSession | null>(null);
  const [computing, setComputing] = useState(false);
  const [settling, setSettling] = useState(false);
  const [onlineRef, setOnlineRef] = useState('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'ONLINE'>('CASH');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

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

  // Restore an in-progress session on reload (session flow only).
  useEffect(() => {
    if (!bookingId || !booking?.usePaymentSessions || session) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await employeeApi.getReturnSession(bookingId as string);
        const s = res.data?.data?.session as ReturnSession | undefined;
        if (!cancelled && s && s.status !== 'COMPLETED') {
          setSession(s);
        }
      } catch {
        /* no active session — start fresh */
      }
    })();
    return () => { cancelled = true; };
  }, [bookingId, booking?.usePaymentSessions, session]);

  const vehicle = booking?.items[0]?.vehicle;
  const customer = booking?.customer.user;
  const hasRemainingBalance =
    !!booking &&
    booking.isAdvancePayment &&
    num(booking.remainingBalance) > 0 &&
    !booking.remainingPaidAt;

  const freeKm = booking ? (booking.effectiveFreeKmLimit ?? booking.freeKmLimit ?? 0) : 0;
  const extraKmRate = num(booking?.extraKmRate);
  const startOdo = booking?.startOdometer ?? null;
  const kmDriven = useMemo(() => {
    const e = parseFloat(endOdo);
    if (!Number.isFinite(e) || startOdo == null) return null;
    return Math.max(0, e - startOdo);
  }, [endOdo, startOdo]);
  const overKm = kmDriven != null && freeKm ? Math.max(0, kmDriven - freeKm) : 0;
  const suggestedExtra = Math.round(overKm * extraKmRate);

  const fuelModuleEnabled = !!booking?.frozenChargeConfig?.fuelModuleEnabled;
  const fastagEnabled = !!booking?.frozenChargeConfig?.fastagModuleEnabled || !!vehicle?.hasFastag;

  // keep the suggested extra-km amount populated when toggled on
  useEffect(() => {
    if (chargeExtraKm && !extraKmAmt && suggestedExtra > 0) setExtraKmAmt(String(suggestedExtra));
  }, [chargeExtraKm, suggestedExtra]); // eslint-disable-line react-hooks/exhaustive-deps

  const compute = async () => {
    if (!booking) return;
    const endOdoNum = parseFloat(endOdo);
    if (!Number.isFinite(endOdoNum) || endOdoNum < 0) {
      setErrorMsg('Enter a valid odometer reading.');
      return;
    }
    if (fuelModuleEnabled && !/^([1-9]|10)$/.test(fuelLevel)) {
      setErrorMsg('Select the return fuel level.');
      return;
    }
    setErrorMsg(null);
    setComputing(true);
    try {
      const body: Parameters<typeof employeeApi.computeReturnSession>[1] = {
        endOdometer: endOdoNum,
        returnImageIds: returnPhotos.map((p) => p.fileId),
      };
      if (fuelModuleEnabled && fuelLevel) body.returnFuelLevel = fuelLevel;
      if (chargeExtraKm && num(extraKmAmt) > 0) body.extraKmCharge = num(extraKmAmt);
      if (chargeFuel && num(fuelAmt) > 0) body.fuelCharge = num(fuelAmt);
      if (chargeFastag && num(fastagAmt) > 0) {
        body.fastagAmount = num(fastagAmt);
        if (fastagNote.trim()) body.fastagNotes = fastagNote.trim();
      }
      if (chargeOther && otherLabel.trim() && num(otherAmt) > 0) {
        body.otherCharges = [{ label: otherLabel.trim(), amount: num(otherAmt) }];
      }
      const res = await employeeApi.computeReturnSession(bookingId as string, body);
      const s = res.data?.data?.session as ReturnSession;
      if (mountedRef.current) setSession(s);
    } catch (err: any) {
      if (mountedRef.current) setErrorMsg(err?.response?.data?.message ?? 'Could not compute charges.');
    } finally {
      if (mountedRef.current) setComputing(false);
    }
  };

  const onSettled = () => {
    qc.invalidateQueries({ queryKey: ['employee', 'returns'] });
    qc.invalidateQueries({ queryKey: ['employee', 'dashboard-stats'] });
    if (mountedRef.current) setDone(true);
  };

  const settleSession = async () => {
    if (!session) return;
    const net = num(session.netPayable);
    setSettling(true);
    setErrorMsg(null);
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
        if (payMethod === 'ONLINE' && !onlineRef.trim()) {
          setErrorMsg('Enter the online payment reference.');
          setSettling(false);
          return;
        }
        await employeeApi.recordSessionPayment(session.publicId, {
          method: payMethod,
          amount: net,
          idempotencyKey: `settle:${session.publicId}`,
          ...(payMethod === 'ONLINE' ? { onlineTransactionRef: onlineRef.trim() } : {}),
        });
      }
      onSettled();
    } catch (err: any) {
      // On amount drift (409) re-fetch the session so the next attempt matches.
      if (err?.response?.status === 409) {
        try {
          const res = await employeeApi.getReturnSession(bookingId as string);
          const s = res.data?.data?.session as ReturnSession | undefined;
          if (s && mountedRef.current) setSession(s);
        } catch { /* ignore */ }
      }
      if (mountedRef.current) setErrorMsg(err?.response?.data?.message ?? 'Could not settle the return.');
    } finally {
      if (mountedRef.current) setSettling(false);
    }
  };

  // Legacy (no payment sessions): plain complete.
  const completeLegacy = async () => {
    setSettling(true);
    setErrorMsg(null);
    try {
      await employeeApi.completeReturn(bookingId as string, {
        returnImageIds: returnPhotos.map((p) => p.fileId),
        ...(requireManager ? { requireManagerConfirmation: true } : {}),
      });
      onSettled();
    } catch (err: any) {
      if (mountedRef.current) setErrorMsg(err?.response?.data?.message ?? 'Could not complete the return.');
    } finally {
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

  return (
    <>
      <KeyboardAvoidingView
        style={[styles.root, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
            <View style={styles.vehicleRow}>
              <View style={styles.vehicleIcon}>
                <Ionicons name="car-outline" size={22} color="#3b82f6" />
              </View>
              <View>
                <Text style={styles.vehicleName}>{vehicle.make} {vehicle.model}</Text>
                <Text style={styles.vehicleReg}>{vehicle.regNo}</Text>
              </View>
            </View>
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

          {/* Payment ledger */}
          <SectionHeader title="Payment" />
          <CounterPaymentPanel bookingPublicId={booking.publicId} />

          {/* State at pickup */}
          {(startOdo != null || booking.pickupFuelLevel) && (
            <>
              <SectionHeader title="State at Pickup" />
              <View style={styles.card}>
                {startOdo != null && (
                  <InfoRow icon="speedometer-outline" label="Odometer" value={`${startOdo.toLocaleString('en-IN')} km`} />
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
                  placeholder={startOdo != null ? `≥ ${startOdo}` : '0'}
                  placeholderTextColor={Colors.ink4}
                  keyboardType="numeric"
                  returnKeyType="done"
                />
                {kmDriven != null && (
                  <Text style={styles.hint}>
                    {kmDriven.toLocaleString('en-IN')} km driven
                    {freeKm ? ` · ${freeKm.toLocaleString('en-IN')} km free` : ''}
                    {overKm > 0 ? ` · ${overKm.toLocaleString('en-IN')} km over` : ''}
                  </Text>
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
                <ChargeToggle label="Extra km charge" enabled={chargeExtraKm} onToggle={setChargeExtraKm}>
                  <TextInput
                    style={styles.input}
                    value={extraKmAmt}
                    onChangeText={setExtraKmAmt}
                    placeholder={suggestedExtra > 0 ? `Suggested ₹${suggestedExtra}` : 'Amount ₹'}
                    placeholderTextColor={Colors.ink4}
                    keyboardType="numeric"
                  />
                  {overKm > 0 && extraKmRate > 0 && (
                    <Text style={styles.hint}>{overKm} km over × ₹{extraKmRate}/km = ₹{suggestedExtra}</Text>
                  )}
                </ChargeToggle>

                {fuelModuleEnabled && (
                  <>
                    <View style={styles.divider} />
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
                  </>
                )}

                {fastagEnabled && (
                  <>
                    <View style={styles.divider} />
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
                  </>
                )}

                <View style={styles.divider} />
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
              </View>

              {safetyDeposit > 0 && (
                <Text style={styles.depositNote}>
                  Security deposit of {inr(safetyDeposit)} will be credited against the charges below.
                </Text>
              )}
            </>
          )}

          {/* Return condition photos + damage (before settlement) */}
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
                />
              </View>

              <TouchableOpacity
                style={styles.damageBtn}
                onPress={() => router.push({
                  pathname: '/employee/damage/[bookingId]',
                  params: {
                    bookingId: booking.publicId,
                    odo: endOdo,
                    // Carry the captured return-condition photos so they're persisted with the report.
                    returnImageIds: JSON.stringify(returnPhotos.map((p) => p.fileId)),
                  },
                })}
                activeOpacity={0.85}
              >
                <Ionicons name="warning-outline" size={18} color="#dc3545" />
                <Text style={styles.damageBtnText}>Vehicle damaged? Report it</Text>
                <Ionicons name="chevron-forward" size={16} color="#dc3545" />
              </TouchableOpacity>
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
              <SectionHeader title="Settlement" />
              <LedgerSummaryCard session={session} />

              {!sessionDone && net > 0 && (
                <View style={[styles.card, { marginTop: 8 }]}>
                  <Text style={styles.fieldLabel}>Payment method</Text>
                  <View style={styles.methodRow}>
                    {(['CASH', 'ONLINE'] as const).map((m) => (
                      <TouchableOpacity
                        key={m}
                        style={[styles.methodBtn, payMethod === m && styles.methodBtnActive]}
                        onPress={() => setPayMethod(m)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.methodText, payMethod === m && styles.methodTextActive]}>
                          {m === 'CASH' ? 'Cash' : 'Online'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {payMethod === 'ONLINE' && (
                    <TextInput
                      style={[styles.input, { marginTop: 10 }]}
                      value={onlineRef}
                      onChangeText={setOnlineRef}
                      placeholder="Online transaction reference"
                      placeholderTextColor={Colors.ink4}
                    />
                  )}
                </View>
              )}

              {!sessionDone && (
                <TouchableOpacity
                  style={styles.recomputeBtn}
                  onPress={() => { setSession(null); setErrorMsg(null); }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="refresh-outline" size={15} color={Colors.ink2} />
                  <Text style={styles.recomputeText}>Edit charges</Text>
                </TouchableOpacity>
              )}
            </>
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
          ) : !booking.usePaymentSessions ? (
            <TouchableOpacity
              style={[styles.confirmBtn, settling && styles.confirmBtnDisabled]}
              onPress={() => setShowConfirm(true)}
              disabled={settling}
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
  infoValue: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },

  fieldLabel: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3, marginBottom: 8 },
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

  captureStrip: { gap: 10, paddingTop: 12, paddingRight: 4 },
  captureThumbWrap: { width: 110, gap: 4 },
  captureThumb: { width: 110, height: 84, borderRadius: 10, backgroundColor: Colors.bg },
  captureLabel: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3 },

  depositNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17, marginTop: 4, paddingHorizontal: 4 },

  damageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff5f5',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 4,
    marginBottom: 4,
  },
  damageBtnText: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 14, color: '#dc3545' },

  methodRow: { flexDirection: 'row', gap: 8 },
  methodBtn: { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline },
  methodBtnActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  methodText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink3 },
  methodTextActive: { color: Colors.white },

  recomputeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginTop: 4 },
  recomputeText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },

  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#e53e3e10', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e53e3e30', marginTop: 8 },
  errorBoxText: { fontFamily: Fonts.body, fontSize: 13, color: '#e53e3e', flex: 1 },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink3 },

  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 12, backgroundColor: Colors.bg, borderTopWidth: 1, borderTopColor: Colors.hairline },
  footerNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  footerNoteText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3 },
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

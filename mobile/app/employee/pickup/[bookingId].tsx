import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

const FUEL_LEVELS = [
  { label: 'Empty', value: 0, icon: 'battery-dead-outline' as IoniconName },
  { label: '¼', value: 25, icon: 'battery-half-outline' as IoniconName },
  { label: '½', value: 50, icon: 'battery-half-outline' as IoniconName },
  { label: '¾', value: 75, icon: 'battery-full-outline' as IoniconName },
  { label: 'Full', value: 100, icon: 'battery-full-outline' as IoniconName },
];

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

export default function PickupScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [odo, setOdo] = useState('');
  const [fuelLevel, setFuelLevel] = useState<number>(50);
  const [done, setDone] = useState(false);

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

  const mutation = useMutation({
    mutationFn: () =>
      employeeApi.completePickup(bookingId as string, {
        odo: Number(odo),
        fuelLevel,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee', 'pickups'] });
      qc.invalidateQueries({ queryKey: ['employee', 'dashboard-stats'] });
      setDone(true);
    },
    onError: (err: any) => {
      const msg = err.response?.data?.message ?? 'Failed to complete pickup. Please try again.';
      Alert.alert('Pickup Failed', msg);
    },
  });

  const handleConfirm = () => {
    if (!odo.trim() || Number(odo) < 0) {
      Alert.alert('Missing Info', 'Please enter a valid odometer reading.');
      return;
    }
    Alert.alert(
      'Confirm Pickup',
      `Odometer: ${odo} km\nFuel Level: ${fuelLevel}%\n\nConfirm that the vehicle has been handed over to the customer?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', style: 'default', onPress: () => mutation.mutate() },
      ],
    );
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
  const hasRemainingBalance =
    booking.isAdvancePayment &&
    booking.remainingBalance &&
    Number(booking.remainingBalance) > 0 &&
    !booking.remainingPaidAt;

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
            {vehicle ? `${vehicle.make} ${vehicle.model}` : 'Vehicle'} has been handed over to {customer.name}.
          </Text>
          <View style={styles.successDetails}>
            <View style={styles.successRow}>
              <Ionicons name="speedometer-outline" size={15} color={Colors.ink3} />
              <Text style={styles.successRowText}>Odometer recorded: {odo} km</Text>
            </View>
            <View style={styles.successRow}>
              <Ionicons name="water-outline" size={15} color={Colors.ink3} />
              <Text style={styles.successRowText}>Fuel level: {fuelLevel}%</Text>
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
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Payment Warning */}
        {hasRemainingBalance && (
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
              {customer.phone && (
                <Text style={styles.customerPhone}>{customer.phone}</Text>
              )}
            </View>
          </View>
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

        {/* Booking Info */}
        <SectionHeader title="Booking" />
        <View style={styles.card}>
          <InfoRow icon="calendar-outline" label="Pickup" value={formatDate(booking.startAt)} />
          <View style={styles.divider} />
          <InfoRow icon="calendar-outline" label="Return" value={formatDate(booking.endAt)} />
          <View style={styles.divider} />
          <InfoRow icon="time-outline" label="Duration" value={`${booking.days} day${booking.days !== 1 ? 's' : ''}`} />
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

        {/* Vehicle State */}
        <SectionHeader title="Record Vehicle State" />
        <View style={styles.card}>
          {/* Odometer */}
          <View style={styles.fieldGroup}>
            <View style={styles.fieldLabel}>
              <Ionicons name="speedometer-outline" size={16} color={Colors.ink3} />
              <Text style={styles.fieldLabelText}>Odometer Reading (km)</Text>
            </View>
            <TextInput
              style={styles.odoInput}
              value={odo}
              onChangeText={setOdo}
              placeholder={vehicle?.odo ? String(vehicle.odo) : '0'}
              placeholderTextColor={Colors.ink4}
              keyboardType="numeric"
              returnKeyType="done"
            />
          </View>

          <View style={styles.divider} />

          {/* Fuel Level */}
          <View style={[styles.fieldGroup, { marginBottom: 0 }]}>
            <View style={styles.fieldLabel}>
              <Ionicons name="water-outline" size={16} color={Colors.ink3} />
              <Text style={styles.fieldLabelText}>Fuel Level</Text>
            </View>
            <View style={styles.fuelRow}>
              {FUEL_LEVELS.map((level) => (
                <TouchableOpacity
                  key={level.value}
                  style={[
                    styles.fuelBtn,
                    fuelLevel === level.value && styles.fuelBtnActive,
                  ]}
                  onPress={() => setFuelLevel(level.value)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.fuelBtnText,
                      fuelLevel === level.value && styles.fuelBtnTextActive,
                    ]}
                  >
                    {level.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Error */}
        {mutation.isError && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color="#e53e3e" />
            <Text style={styles.errorBoxText}>
              {(mutation.error as any)?.response?.data?.message ?? 'Something went wrong.'}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Confirm CTA */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.confirmBtn, (mutation.isPending || !!hasRemainingBalance) && styles.confirmBtnDisabled]}
          onPress={handleConfirm}
          disabled={mutation.isPending || !!hasRemainingBalance}
          activeOpacity={0.85}
        >
          {mutation.isPending ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <>
              <Ionicons name="checkmark-circle-outline" size={20} color={Colors.white} />
              <Text style={styles.confirmBtnText}>Confirm Pickup</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
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
  infoValue: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },

  fieldGroup: { gap: 10, marginBottom: 12 },
  fieldLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldLabelText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3 },

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

  fuelRow: { flexDirection: 'row', gap: 6 },
  fuelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  fuelBtnActive: {
    backgroundColor: Colors.orange,
    borderColor: Colors.orange,
  },
  fuelBtnText: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink3 },
  fuelBtnTextActive: { color: Colors.white },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#e53e3e10',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e53e3e30',
  },
  errorBoxText: { fontFamily: Fonts.body, fontSize: 13, color: '#e53e3e', flex: 1 },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink3 },

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
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.orange,
    borderRadius: 16,
    paddingVertical: 17,
    shadowColor: Colors.orange,
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
  successIcon: {
    width: 100,
    height: 100,
    borderRadius: 30,
    backgroundColor: '#10b98115',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  successTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 28,
    color: Colors.ink,
    letterSpacing: -0.8,
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
  successRowText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink2 },
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

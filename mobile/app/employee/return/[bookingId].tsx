import { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import ConfirmModal from '../../../components/ui/ConfirmModal';
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
  remainingBalance: number | null;
  remainingPaidAt: string | null;
  days: number;
  startOdometer: number | null;
  pickupFuelLevel: string | null;
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

function InfoRow({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: IoniconName;
  label: string;
  value: string;
  valueColor?: string;
}) {
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

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

const FUEL_LEVEL_LABELS: Record<string, string> = {
  EMPTY: 'Empty',
  QUARTER: '¼ Tank',
  HALF: '½ Tank',
  THREE_QUARTER: '¾ Tank',
  FULL: 'Full',
};

export default function ReturnScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [done, setDone] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const { data: booking, isLoading, isError } = useQuery<BookingDetail>({
    queryKey: ['employee', 'return', bookingId],
    queryFn: async () => {
      const res = await employeeApi.getReturnDetails(bookingId as string);
      return res.data?.data as BookingDetail;
    },
    enabled: !!bookingId,
    staleTime: 30_000,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: () => employeeApi.completeReturn(bookingId as string),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee', 'returns'] });
      qc.invalidateQueries({ queryKey: ['employee', 'dashboard-stats'] });
      setDone(true);
    },
    onError: () => {
      setShowConfirm(false);
    },
  });

  const handleConfirm = () => setShowConfirm(true);

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
          <Text style={styles.title}>Return</Text>
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
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.back, { marginHorizontal: 20, marginTop: 8 }]}
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <View style={styles.successBody}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={64} color="#10b981" />
          </View>
          <Text style={styles.successTitle}>Return Complete</Text>
          <Text style={styles.successSub}>
            {vehicle ? `${vehicle.make} ${vehicle.model}` : 'Vehicle'} has been returned by {customer.name}. Status updated to RETURNED.
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

  return (
    <>
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

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Payment Warning */}
        {hasRemainingBalance && (
          <View style={styles.warningCard}>
            <Ionicons name="warning-outline" size={18} color="#f59e0b" />
            <View style={styles.warningTextWrap}>
              <Text style={styles.warningTitle}>Balance Not Collected</Text>
              <Text style={styles.warningBody}>
                ₹{Number(booking.remainingBalance).toLocaleString('en-IN')} remaining balance must be collected before completing the return.
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

        {/* Vehicle */}
        <SectionHeader title="Vehicle" />
        <View style={styles.card}>
          {vehicle && (
            <View style={styles.vehicleRow}>
              <View style={styles.vehicleIcon}>
                <Ionicons name="car-outline" size={22} color="#3b82f6" />
              </View>
              <View>
                <Text style={styles.vehicleName}>{vehicle.make} {vehicle.model}</Text>
                <Text style={styles.vehicleReg}>{vehicle.regNo}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Booking Details */}
        <SectionHeader title="Booking" />
        <View style={styles.card}>
          <InfoRow icon="calendar-outline" label="Pickup" value={formatDate(booking.startAt)} />
          <View style={styles.divider} />
          <InfoRow icon="calendar-outline" label="Return Due" value={formatDate(booking.endAt)} />
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
                icon={booking.remainingPaidAt ? 'checkmark-done-outline' : 'alert-circle-outline'}
                label="Balance"
                value={
                  booking.remainingPaidAt
                    ? 'Paid'
                    : `₹${Number(booking.remainingBalance).toLocaleString('en-IN')} Due`
                }
                valueColor={booking.remainingPaidAt ? '#10b981' : '#f59e0b'}
              />
            </>
          )}
        </View>

        {/* Vehicle State at Pickup */}
        {(booking.startOdometer !== null || booking.pickupFuelLevel) && (
          <>
            <SectionHeader title="State at Pickup" />
            <View style={styles.card}>
              {booking.startOdometer !== null && (
                <>
                  <InfoRow
                    icon="speedometer-outline"
                    label="Odometer"
                    value={`${booking.startOdometer.toLocaleString('en-IN')} km`}
                  />
                  {booking.pickupFuelLevel && <View style={styles.divider} />}
                </>
              )}
              {booking.pickupFuelLevel && (
                <InfoRow
                  icon="water-outline"
                  label="Fuel Level"
                  value={FUEL_LEVEL_LABELS[booking.pickupFuelLevel] ?? booking.pickupFuelLevel}
                />
              )}
            </View>
          </>
        )}

        {/* Current Odometer */}
        {vehicle?.odo !== null && vehicle?.odo !== undefined && (
          <>
            <SectionHeader title="Current Vehicle State" />
            <View style={styles.card}>
              <InfoRow
                icon="speedometer-outline"
                label="Current Odometer"
                value={`${vehicle.odo.toLocaleString('en-IN')} km`}
              />
              {booking.startOdometer !== null && (
                <>
                  <View style={styles.divider} />
                  <InfoRow
                    icon="navigate-outline"
                    label="Distance Driven"
                    value={`${(vehicle.odo - booking.startOdometer).toLocaleString('en-IN')} km`}
                  />
                </>
              )}
            </View>
          </>
        )}

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
          style={[
            styles.confirmBtn,
            (mutation.isPending || !!hasRemainingBalance) && styles.confirmBtnDisabled,
          ]}
          onPress={handleConfirm}
          disabled={mutation.isPending || !!hasRemainingBalance}
          activeOpacity={0.85}
        >
          {mutation.isPending ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <>
              <Ionicons name="checkmark-circle-outline" size={20} color={Colors.white} />
              <Text style={styles.confirmBtnText}>Complete Return</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>

    <ConfirmModal
      visible={showConfirm}
      icon="arrow-down-circle-outline"
      iconColor="#3b82f6"
      title="Complete Return"
      message={`Confirm that ${booking?.customer?.user?.name ?? 'the customer'} has returned the vehicle?`}
      confirmLabel="Complete Return"
      confirmColor="#3b82f6"
      onConfirm={() => { setShowConfirm(false); mutation.mutate(); }}
      onCancel={() => setShowConfirm(false)}
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
  headerText: { flex: 1, gap: 2 },
  title: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  subtitle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  returnBadge: {
    backgroundColor: '#3b82f615',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#3b82f630',
  },
  returnBadgeText: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: '#3b82f6' },

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
    backgroundColor: '#3b82f612',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleName: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.ink },
  vehicleReg: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, marginTop: 2 },

  divider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 12 },

  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  infoValue: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },

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
    backgroundColor: '#3b82f6',
    borderRadius: 16,
    paddingVertical: 17,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
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

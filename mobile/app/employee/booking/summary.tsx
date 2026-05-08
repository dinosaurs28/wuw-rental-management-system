import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';

interface BookingDetail {
  publicId: string;
  startAt: string;
  endAt: string;
  status: string;
  totalFinal: string | number;
  days?: number;
  customer: { user: { publicId: string; name: string; phone?: string } };
  items: {
    vehicle: {
      publicId: string;
      make: string;
      model: string;
      regNo: string;
      images?: { file: { url: string } }[];
    };
  }[];
}

const formatPrice = (n: number | string | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

function formatRemaining(ms: number) {
  if (ms <= 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function EmployeeBookingSummary() {
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    bookingId: string;
    transactionId?: string;
    expiresAt?: string;
    paymentURL?: string;
    rehold_id?: string;
    rehold_isGroup?: string;
    rehold_customer?: string;
    rehold_kyc?: string;
    rehold_start?: string;
    rehold_end?: string;
    rehold_paymentType?: string;
  }>();
  const { bookingId, transactionId, expiresAt, paymentURL } = params;
  const canReHold =
    !!params.rehold_id &&
    !!params.rehold_customer &&
    !!params.rehold_kyc &&
    !!params.rehold_start &&
    !!params.rehold_end;

  const [currentBookingId, setCurrentBookingId] = useState<string>(
    String(bookingId ?? ''),
  );
  const [currentTxnId, setCurrentTxnId] = useState<string>(
    String(transactionId ?? ''),
  );
  const [currentExpiresAt, setCurrentExpiresAt] = useState<string>(
    String(expiresAt ?? ''),
  );
  const [currentPaymentURL, setCurrentPaymentURL] = useState<string>(
    String(paymentURL ?? ''),
  );

  const expiresAtMs = useMemo(
    () => (currentExpiresAt ? new Date(currentExpiresAt).getTime() : 0),
    [currentExpiresAt],
  );
  const [now, setNow] = useState(() => Date.now());
  const [cancelling, setCancelling] = useState(false);
  const [paying, setPaying] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [reholding, setReholding] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Live countdown
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = Math.max(0, expiresAtMs - now);
  const expired = expiresAtMs > 0 && remainingMs <= 0;

  const { data: booking, isLoading: bookingLoading } = useQuery<BookingDetail>({
    queryKey: ['employee', 'booking-detail', currentBookingId],
    queryFn: async () => {
      const res = await employeeApi.getPickupDetails(currentBookingId);
      return res.data?.data as BookingDetail;
    },
    enabled: !!currentBookingId,
    staleTime: 5_000,
  });

  const txnId = currentTxnId;
  const isCash = txnId.startsWith('CASH_');
  const isOnline = !!currentPaymentURL && !isCash;

  const handleCancel = async () => {
    if (!currentBookingId) return;
    setCancelling(true);
    try {
      await employeeApi.cancelEmployeeHold(currentBookingId);
      qc.invalidateQueries({ queryKey: ['employee', 'booking-detail', currentBookingId] });
      router.replace('/employee' as any);
    } catch (err: any) {
      Alert.alert(
        'Cancel failed',
        err?.response?.data?.message ?? 'Could not cancel the hold.',
      );
    } finally {
      setCancelling(false);
    }
  };

  const handleReHold = async () => {
    if (!canReHold) return;
    setReholding(true);
    try {
      const isGroup = params.rehold_isGroup === '1';
      const body: any = {
        customer_public_id: String(params.rehold_customer),
        customer_kyc_id: String(params.rehold_kyc),
        start: String(params.rehold_start),
        end: String(params.rehold_end),
        payment_type: (params.rehold_paymentType as 'CASH' | 'ONLINE') ?? 'CASH',
      };
      if (isGroup) {
        body.group_key = String(params.rehold_id);
      } else {
        body.vehicles = [String(params.rehold_id)];
      }
      const res = await employeeApi.createEmployeeBooking(body);
      const data = res.data?.data;
      if (!data?.bookingId) throw new Error('Missing bookingId');
      setCurrentBookingId(String(data.bookingId));
      setCurrentTxnId(String(data.transactionId ?? ''));
      setCurrentExpiresAt(String(data.expiresAt ?? ''));
      setCurrentPaymentURL(String(data.paymentURL ?? ''));
      setCompleted(false);
      qc.invalidateQueries({
        queryKey: ['employee', 'booking-detail', data.bookingId],
      });
    } catch (err: any) {
      Alert.alert(
        'Re-hold failed',
        err?.response?.data?.message ?? 'Could not re-create the booking hold.',
      );
    } finally {
      setReholding(false);
    }
  };

  const promptCancel = () => {
    Alert.alert(
      'Cancel booking hold?',
      'The vehicle will be released for the selected dates. This cannot be undone.',
      [
        { text: 'Stay here', style: 'cancel' },
        { text: 'Cancel hold', style: 'destructive', onPress: handleCancel },
      ],
    );
  };

  const pollStatus = async (txn: string): Promise<'Success' | 'Failed' | 'Pending'> => {
    const POLL_DELAYS = [2000, 3000, 3000, 5000, 5000, 5000, 5000, 5000, 5000, 5000];
    for (let attempt = 0; attempt < POLL_DELAYS.length + 1; attempt++) {
      if (!mountedRef.current) return 'Pending';
      try {
        const res = await employeeApi.verifyOnlinePayment(txn);
        const status = res.data?.status as 'Success' | 'Failed' | 'Pending' | undefined;
        if (status === 'Success') return 'Success';
        if (status === 'Failed') return 'Failed';
      } catch {
        // ignore and retry
      }
      const delay = POLL_DELAYS[attempt] ?? 5000;
      if (attempt < POLL_DELAYS.length) await new Promise((r) => setTimeout(r, delay));
    }
    return 'Pending';
  };

  const handlePayCash = async () => {
    if (!txnId) {
      Alert.alert('Error', 'Missing transaction id.');
      return;
    }
    if (expired) {
      Alert.alert('Hold expired', 'Please re-create the booking hold.');
      return;
    }
    setPaying(true);
    setVerifying(true);
    try {
      const status = await pollStatus(txnId);
      if (!mountedRef.current) return;
      if (status === 'Success') {
        setCompleted(true);
        qc.invalidateQueries({ queryKey: ['employee', 'pickups'] });
        Alert.alert('Booking confirmed', 'Cash collection logged successfully.');
      } else if (status === 'Failed') {
        Alert.alert('Failed', 'Booking confirmation failed. Try again.');
      } else {
        Alert.alert(
          'Pending',
          'Confirmation is still processing. Check the dashboard in a moment.',
        );
      }
    } finally {
      setPaying(false);
      setVerifying(false);
    }
  };

  const handlePayOnline = async () => {
    if (!paymentURL || !txnId) {
      Alert.alert('Error', 'Online payment link unavailable.');
      return;
    }
    if (expired) {
      Alert.alert('Hold expired', 'Please re-create the booking hold.');
      return;
    }
    setPaying(true);
    try {
      const browserResult = await WebBrowser.openAuthSessionAsync(
        String(paymentURL),
        'wuw://payment/callback',
      );
      if (browserResult.type === 'cancel' || browserResult.type === 'dismiss') {
        Alert.alert(
          'Payment cancelled',
          'Payment page closed. The booking hold will expire shortly if not paid.',
        );
        return;
      }
      setVerifying(true);
      const status = await pollStatus(txnId);
      if (!mountedRef.current) return;
      if (status === 'Success') {
        setCompleted(true);
        qc.invalidateQueries({ queryKey: ['employee', 'pickups'] });
        Alert.alert('Payment received', 'Booking confirmed.');
      } else if (status === 'Failed') {
        Alert.alert('Payment failed', 'Please retry or use cash.');
      } else {
        Alert.alert('Pending', 'Payment is still processing. Check dashboard later.');
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not open payment page.');
    } finally {
      setPaying(false);
      setVerifying(false);
    }
  };

  const handleReturnToDashboard = () => {
    router.replace('/employee' as any);
  };

  if (bookingLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.orange} size="large" />
      </View>
    );
  }

  const item = booking?.items?.[0];
  const totalFinal = booking?.totalFinal;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (completed ? router.replace('/employee' as any) : promptCancel())}
          style={styles.back}
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <View style={styles.headerTitles}>
          <Text style={styles.title}>Booking Summary</Text>
          <Text style={styles.subtitle}>
            {completed ? 'Confirmed' : `Hold #${currentBookingId.slice(0, 8)}`}
          </Text>
        </View>
        {expiresAtMs > 0 && !completed && (
          <View style={[styles.timerPill, expired && styles.timerExpired]}>
            <Ionicons
              name="time-outline"
              size={14}
              color={expired ? '#ef4444' : Colors.ink2}
            />
            <Text style={[styles.timerText, expired && styles.timerTextExpired]}>
              {formatRemaining(remainingMs)}
            </Text>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Vehicle card */}
        {item && (
          <View style={styles.card}>
            <View style={styles.vehicleRow}>
              <View style={styles.vehicleIcon}>
                <Ionicons name="car-sport-outline" size={26} color={Colors.orange} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.vehicleName}>
                  {item.vehicle.make} {item.vehicle.model}
                </Text>
                <Text style={styles.vehicleMeta}>
                  {item.vehicle.regNo}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Customer card */}
        {booking?.customer && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Customer</Text>
            <Text style={styles.cardValue}>{booking.customer.user.name}</Text>
            {booking.customer.user.phone && (
              <Text style={styles.cardSub}>{booking.customer.user.phone}</Text>
            )}
          </View>
        )}

        {/* Rental period */}
        {booking?.startAt && booking?.endAt && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Rental period</Text>
            <View style={styles.periodRow}>
              <View style={styles.periodCol}>
                <Text style={styles.periodLabel}>PICKUP</Text>
                <Text style={styles.periodValue}>
                  {new Date(booking.startAt).toLocaleString('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </Text>
              </View>
              <Ionicons name="arrow-forward" size={16} color={Colors.ink4} />
              <View style={styles.periodCol}>
                <Text style={styles.periodLabel}>RETURN</Text>
                <Text style={styles.periodValue}>
                  {new Date(booking.endAt).toLocaleString('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </Text>
              </View>
            </View>
            {booking.days != null && (
              <Text style={styles.daysNote}>
                {booking.days} day{booking.days > 1 ? 's' : ''}
              </Text>
            )}
          </View>
        )}

        {/* Total */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Total to collect</Text>
          <Text style={styles.totalValue}>{formatPrice(totalFinal)}</Text>
          <Text style={styles.cardSub}>
            Includes deposit. {isCash ? 'Cash on counter.' : 'Online via PhonePe.'}
          </Text>
        </View>

        {/* Status */}
        {completed ? (
          <View style={[styles.statusBox, styles.statusGreenBg]}>
            <Ionicons name="checkmark-circle" size={20} color="#10b981" />
            <Text style={styles.statusGreenText}>Booking confirmed and collected.</Text>
          </View>
        ) : expired ? (
          <View style={[styles.statusBox, styles.statusRedBg]}>
            <Ionicons name="alert-circle-outline" size={20} color="#ef4444" />
            <Text style={styles.statusRedText}>
              Hold expired. {canReHold ? 'Tap Re-hold to extend.' : 'Cancel and start again.'}
            </Text>
          </View>
        ) : verifying ? (
          <View style={[styles.statusBox, styles.statusAmberBg]}>
            <ActivityIndicator size="small" color="#f59e0b" />
            <Text style={styles.statusAmberText}>Verifying payment...</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* CTA */}
      <View style={[styles.cta, { paddingBottom: insets.bottom + 14 }]}>
        {completed ? (
          <TouchableOpacity
            style={[styles.ctaBtn, styles.ctaPrimary]}
            onPress={handleReturnToDashboard}
            activeOpacity={0.85}
          >
            <Text style={styles.ctaPrimaryText}>Return to dashboard</Text>
          </TouchableOpacity>
        ) : expired && canReHold ? (
          <>
            <TouchableOpacity
              style={[styles.ctaBtn, styles.ctaPrimary, reholding && styles.ctaDisabled]}
              onPress={handleReHold}
              disabled={reholding}
              activeOpacity={0.85}
            >
              {reholding ? (
                <ActivityIndicator color={Colors.white} size="small" />
              ) : (
                <Text style={styles.ctaPrimaryText}>Re-hold booking</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.ctaBtn, styles.ctaSecondary]}
              onPress={() => router.replace('/employee' as any)}
              activeOpacity={0.85}
            >
              <Text style={styles.ctaSecondaryText}>Return to dashboard</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {isOnline ? (
              <TouchableOpacity
                style={[
                  styles.ctaBtn,
                  styles.ctaPrimary,
                  (paying || expired) && styles.ctaDisabled,
                ]}
                onPress={handlePayOnline}
                disabled={paying || expired}
                activeOpacity={0.85}
              >
                {paying ? (
                  <ActivityIndicator color={Colors.white} size="small" />
                ) : (
                  <Text style={styles.ctaPrimaryText}>
                    Pay online · {formatPrice(totalFinal)}
                  </Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[
                  styles.ctaBtn,
                  styles.ctaPrimary,
                  (paying || expired) && styles.ctaDisabled,
                ]}
                onPress={handlePayCash}
                disabled={paying || expired}
                activeOpacity={0.85}
              >
                {paying ? (
                  <ActivityIndicator color={Colors.white} size="small" />
                ) : (
                  <Text style={styles.ctaPrimaryText}>
                    Confirm cash · {formatPrice(totalFinal)}
                  </Text>
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.ctaBtn, styles.ctaSecondary]}
              onPress={promptCancel}
              disabled={cancelling}
              activeOpacity={0.85}
            >
              {cancelling ? (
                <ActivityIndicator color={Colors.ink} size="small" />
              ) : (
                <Text style={styles.ctaSecondaryText}>Cancel hold</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  center: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 12,
  },
  back: { width: 36, height: 36, justifyContent: 'center' },
  headerTitles: { flex: 1 },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 20,
    color: Colors.ink,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink3,
    marginTop: 2,
  },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  timerExpired: { borderColor: '#ef4444' },
  timerText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink2,
  },
  timerTextExpired: { color: '#ef4444' },

  scroll: { paddingHorizontal: 20, paddingBottom: 200, gap: 12 },

  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    borderRadius: 16,
    padding: 16,
    gap: 4,
  },
  cardLabel: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginBottom: 4,
  },
  cardValue: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.ink,
  },
  cardSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 2 },

  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  vehicleIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.orangeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleName: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.ink },
  vehicleMeta: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, marginTop: 2 },

  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 4,
  },
  periodCol: { flex: 1 },
  periodLabel: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 9,
    color: Colors.ink3,
    letterSpacing: 0.9,
  },
  periodValue: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
    marginTop: 2,
  },
  daysNote: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 12,
    color: Colors.orange,
    marginTop: 8,
  },

  totalValue: {
    fontFamily: Fonts.displayBold,
    fontSize: 28,
    color: Colors.ink,
    letterSpacing: -0.6,
    marginTop: 4,
  },

  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    padding: 14,
  },
  statusGreenBg: { backgroundColor: '#10b98115' },
  statusRedBg: { backgroundColor: '#fee2e2' },
  statusAmberBg: { backgroundColor: '#fef3c7' },
  statusGreenText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: '#10b981', flex: 1 },
  statusRedText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: '#b91c1c', flex: 1 },
  statusAmberText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: '#92400e', flex: 1 },

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
    gap: 10,
  },
  ctaBtn: {
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPrimary: { backgroundColor: Colors.orange },
  ctaPrimaryText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
    letterSpacing: 0.2,
  },
  ctaSecondary: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  ctaSecondaryText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink2 },
  ctaDisabled: { opacity: 0.55 },
});

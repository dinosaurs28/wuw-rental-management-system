import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { userApi } from '../../lib/api';

type Phase = 'polling' | 'success' | 'failed' | 'timeout';

const POLL_INTERVAL_MS = 2000;
const MAX_ATTEMPTS = 30; // 30 × 2s = 60s

// Public /api/payment/status/:transactionId returns capitalized strings
// per apps/backend/src/controller/payment/checkPayment.controller.ts.
interface PublicPaymentStatusResponse {
  status: 'Success' | 'Pending' | 'Failed';
  message?: string;
  redirectURL?: string;
}

export default function BookingPaymentStatus() {
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    transactionId?: string;
    holdId?: string;
  }>();
  const transactionId = params.transactionId ?? '';
  const holdId = params.holdId ?? '';

  const [phase, setPhase] = useState<Phase>('polling');
  const [errorMessage, setErrorMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const attemptRef = useRef(0);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goToConfirmation = useCallback(() => {
    if (holdId) {
      router.replace({ pathname: '/booking/confirmation', params: { holdId } });
    } else {
      router.replace('/booking/confirmation');
    }
  }, [holdId, router]);

  const checkStatus = useCallback(async () => {
    if (cancelledRef.current || !transactionId) return;
    try {
      const res = await userApi.verifyPayment(transactionId);
      const data = (res.data ?? {}) as PublicPaymentStatusResponse;

      if (data.status === 'Success') {
        setPhase('success');
        await qc.invalidateQueries({ queryKey: ['bookings'] });
        // brief delay so the success state is visible
        timerRef.current = setTimeout(() => {
          if (!cancelledRef.current) goToConfirmation();
        }, 800);
        return;
      }

      if (data.status === 'Failed') {
        setPhase('failed');
        setErrorMessage(data.message ?? 'Payment failed. Please try again.');
        return;
      }

      // Pending — continue polling
      attemptRef.current += 1;
      setAttempt(attemptRef.current);

      if (attemptRef.current >= MAX_ATTEMPTS) {
        setPhase('timeout');
        return;
      }

      timerRef.current = setTimeout(checkStatus, POLL_INTERVAL_MS);
    } catch (err: any) {
      attemptRef.current += 1;
      setAttempt(attemptRef.current);
      if (attemptRef.current >= MAX_ATTEMPTS) {
        setPhase('failed');
        setErrorMessage(
          err?.response?.data?.message ?? 'Could not verify payment status.',
        );
        return;
      }
      // transient — keep polling
      timerRef.current = setTimeout(checkStatus, POLL_INTERVAL_MS);
    }
  }, [transactionId, qc, goToConfirmation]);

  useEffect(() => {
    cancelledRef.current = false;
    attemptRef.current = 0;
    setAttempt(0);

    if (!transactionId) {
      setPhase('failed');
      setErrorMessage('Missing transaction id.');
      return;
    }

    setPhase('polling');
    timerRef.current = setTimeout(checkStatus, POLL_INTERVAL_MS);

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [transactionId, checkStatus]);

  const handleRetry = () => {
    cancelledRef.current = false;
    attemptRef.current = 0;
    setAttempt(0);
    setErrorMessage('');
    setPhase('polling');
    timerRef.current = setTimeout(checkStatus, POLL_INTERVAL_MS);
  };

  const handleHome = () => {
    router.replace('/(tabs)');
  };

  const handleViewTrips = () => {
    router.replace('/(tabs)/trips');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.center}>
        <View style={styles.card}>
          {phase === 'polling' && (
            <>
              <View style={[styles.iconWrap, styles.iconWrapPolling]}>
                <ActivityIndicator size="large" color={Colors.orange} />
              </View>
              <Text style={styles.title}>Verifying with PhonePe</Text>
              <Text style={styles.body}>
                Please don't close the app while we confirm your payment.
              </Text>
              <View style={styles.metaRow}>
                <Ionicons name="time-outline" size={14} color={Colors.ink3} />
                <Text style={styles.metaText}>Estimated: up to 60 seconds</Text>
              </View>
              {attempt > 0 && (
                <Text style={styles.subMeta}>
                  Checking… ({attempt}/{MAX_ATTEMPTS})
                </Text>
              )}
              {transactionId ? (
                <View style={styles.txnPill}>
                  <Text style={styles.txnLabel}>Transaction</Text>
                  <Text style={styles.txnValue} numberOfLines={1}>
                    {transactionId}
                  </Text>
                </View>
              ) : null}
            </>
          )}

          {phase === 'success' && (
            <>
              <View style={[styles.iconWrap, styles.iconWrapSuccess]}>
                <Ionicons name="checkmark-circle" size={56} color="#10b981" />
              </View>
              <Text style={styles.title}>Payment Successful</Text>
              <Text style={styles.body}>
                Your booking is confirmed. Redirecting…
              </Text>
            </>
          )}

          {phase === 'failed' && (
            <>
              <View style={[styles.iconWrap, styles.iconWrapFailed]}>
                <Ionicons name="close-circle" size={56} color="#e53e3e" />
              </View>
              <Text style={styles.title}>Payment Failed</Text>
              <Text style={styles.body}>
                {errorMessage || 'Something went wrong with the transaction.'}
              </Text>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.retryBtn}
                  onPress={handleRetry}
                  activeOpacity={0.85}
                >
                  <Ionicons name="refresh" size={16} color={Colors.white} />
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={handleHome}
                  activeOpacity={0.85}
                >
                  <Text style={styles.secondaryText}>Back to home</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {phase === 'timeout' && (
            <>
              <View style={[styles.iconWrap, styles.iconWrapTimeout]}>
                <Ionicons name="time-outline" size={48} color="#f59e0b" />
              </View>
              <Text style={styles.title}>Still Processing</Text>
              <Text style={styles.body}>
                The payment is taking longer than usual. You can retry verification
                or check the booking status from My Trips.
              </Text>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.retryBtn}
                  onPress={handleRetry}
                  activeOpacity={0.85}
                >
                  <Ionicons name="refresh" size={16} color={Colors.white} />
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={handleViewTrips}
                  activeOpacity={0.85}
                >
                  <Text style={styles.secondaryText}>View My Trips</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  iconWrapPolling: { backgroundColor: '#ff6a1f12' },
  iconWrapSuccess: { backgroundColor: '#10b98115' },
  iconWrapFailed: { backgroundColor: '#e53e3e15' },
  iconWrapTimeout: { backgroundColor: '#f59e0b15' },

  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 22,
    color: Colors.ink,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink3,
    textAlign: 'center',
    lineHeight: 21,
    paddingHorizontal: 6,
  },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  metaText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink3,
  },
  subMeta: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink4,
  },

  txnPill: {
    marginTop: 8,
    backgroundColor: Colors.bg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
  },
  txnLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  txnValue: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink2,
    flexShrink: 1,
  },

  actions: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  retryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.orange,
    paddingVertical: 14,
    borderRadius: 14,
  },
  retryText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
  secondaryBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  secondaryText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink2,
  },
});

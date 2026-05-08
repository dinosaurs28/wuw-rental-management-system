import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';

type Phase = 'polling' | 'success' | 'failed' | 'timeout';

const POLL_INTERVAL_MS = 2000;
const MAX_DURATION_MS = 60_000;
const MAX_ATTEMPTS = Math.floor(MAX_DURATION_MS / POLL_INTERVAL_MS);

interface RemainingPaymentResponse {
  status: 'SUCCESS' | 'PENDING' | 'FAILED';
  message?: string;
  bookingPublicId?: string;
  context?: 'pickup' | 'return';
}

export default function RemainingPaymentStatus() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ transactionId?: string; context?: string }>();
  const transactionId = params.transactionId ?? '';
  const fallbackContext: 'pickup' | 'return' =
    params.context === 'return' ? 'return' : 'pickup';

  const [phase, setPhase] = useState<Phase>('polling');
  const [errorMessage, setErrorMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const attemptRef = useRef(0);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goToBooking = useCallback(
    (bookingId: string, ctx: 'pickup' | 'return') => {
      if (ctx === 'pickup') {
        router.replace(`/employee/pickup/${bookingId}`);
      } else {
        router.replace(`/employee/return/${bookingId}`);
      }
    },
    [router],
  );

  const checkStatus = useCallback(async () => {
    if (cancelledRef.current || !transactionId) return;
    try {
      const res = await employeeApi.verifyRemainingPayment(transactionId);
      const data = (res.data ?? {}) as RemainingPaymentResponse;

      if (data.status === 'SUCCESS' && data.bookingPublicId) {
        setPhase('success');
        const ctx = data.context ?? fallbackContext;
        // brief delay so the success state is visible
        timerRef.current = setTimeout(() => {
          if (!cancelledRef.current) goToBooking(data.bookingPublicId!, ctx);
        }, 800);
        return;
      }

      if (data.status === 'FAILED') {
        setPhase('failed');
        setErrorMessage(data.message ?? 'Payment failed. Please try again.');
        return;
      }

      // PENDING — continue polling
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
        setErrorMessage(err?.response?.data?.message ?? 'Could not verify payment status.');
        return;
      }
      // transient — keep polling
      timerRef.current = setTimeout(checkStatus, POLL_INTERVAL_MS);
    }
  }, [transactionId, fallbackContext, goToBooking]);

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

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(employee)/dashboard');
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
              <Text style={styles.title}>Verifying Payment</Text>
              <Text style={styles.body}>
                Please wait while we confirm the transaction. Do not close this page.
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
                  <Text style={styles.txnValue} numberOfLines={1}>{transactionId}</Text>
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
                The remaining balance has been collected. Redirecting…
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
                  onPress={handleBack}
                  activeOpacity={0.85}
                >
                  <Text style={styles.secondaryText}>Go Back</Text>
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
                The payment is taking longer than usual. You can retry verification or
                check the booking status from the dashboard.
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
                  onPress={handleBack}
                  activeOpacity={0.85}
                >
                  <Text style={styles.secondaryText}>Go Back</Text>
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

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { paymentApi, userApi } from '../../lib/api';

type Phase = 'verifying' | 'success' | 'failed' | 'pending';

// Same backoff schedule the inline checkout poll used, now isolated to this screen.
const POLL_DELAYS = [2000, 3000, 3000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000];

function mmss(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function PaymentStatus() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const params = useLocalSearchParams<Record<string, string>>();
  const { transactionId, holdId } = params;
  // Forward everything except transactionId to confirmation (keep holdId — it's the booking ref).
  const confirmParams: Record<string, string> = { ...params };
  delete confirmParams.transactionId;

  const [phase, setPhase] = useState<Phase>('verifying');
  const [secondsLeft, setSecondsLeft] = useState(600); // ~10 min hold window (#43)
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  // Approximate hold countdown — communicates the 10-minute reservation window.
  useEffect(() => {
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  // Poll the payment status (#38).
  useEffect(() => {
    if (!transactionId) { setPhase('failed'); return; }
    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt <= POLL_DELAYS.length; attempt++) {
        if (cancelled) return;
        try {
          const res = await paymentApi.status(transactionId);
          const status = res.data?.status;
          if (status === 'Success') {
            if (cancelled) return;
            setPhase('success');
            await qc.invalidateQueries({ queryKey: ['bookings'] });
            setTimeout(() => {
              if (!cancelled) router.replace({ pathname: '/booking/confirmation', params: confirmParams });
            }, 1000);
            return;
          }
          if (status === 'Failed') { if (!cancelled) setPhase('failed'); return; }
        } catch {
          /* transient — keep polling */
        }
        const delay = POLL_DELAYS[attempt] ?? 5000;
        await new Promise((r) => setTimeout(r, delay));
      }
      if (!cancelled) setPhase('pending');
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId]);

  const releaseAndLeave = async (dest: '/(tabs)/trips' | 'back') => {
    if (holdId) {
      try { await userApi.cancelHold(holdId); } catch { /* best-effort */ }
    }
    if (dest === 'back') router.back();
    else router.replace('/(tabs)/trips');
  };

  const ICON: Record<Phase, { name: React.ComponentProps<typeof Ionicons>['name']; color: string }> = {
    verifying: { name: 'sync-outline', color: Colors.orange },
    success: { name: 'checkmark-circle', color: '#10b981' },
    failed: { name: 'close-circle', color: '#e53e3e' },
    pending: { name: 'time-outline', color: '#d97706' },
  };

  const TITLE: Record<Phase, string> = {
    verifying: 'Verifying payment…',
    success: 'Payment successful',
    failed: 'Payment failed',
    pending: 'Still processing',
  };

  const SUB: Record<Phase, string> = {
    verifying: 'Hang tight while we confirm your payment with the gateway. This usually takes a few seconds.',
    success: 'Your booking is confirmed. Taking you to your booking details…',
    failed: 'We couldn’t confirm your payment. No charge is captured for a failed payment.',
    pending: 'Your payment is taking longer than usual. If money was deducted, your booking will appear in My Trips shortly.',
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.body}>
        <View style={[styles.iconWrap, { backgroundColor: ICON[phase].color + '18' }]}>
          {phase === 'verifying' ? (
            <ActivityIndicator size="large" color={Colors.orange} />
          ) : (
            <Ionicons name={ICON[phase].name} size={56} color={ICON[phase].color} />
          )}
        </View>

        <Text style={styles.title}>{TITLE[phase]}</Text>
        <Text style={styles.sub}>{SUB[phase]}</Text>

        {(phase === 'verifying' || phase === 'pending') && secondsLeft > 0 && (
          <View style={styles.holdPill}>
            <Ionicons name="hourglass-outline" size={14} color={Colors.ink3} />
            <Text style={styles.holdText}>Hold reserved · ~{mmss(secondsLeft)} left</Text>
          </View>
        )}
      </View>

      {/* Actions */}
      {phase === 'failed' && (
        <View style={[styles.actions, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => releaseAndLeave('back')} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/contact')} activeOpacity={0.85}>
            <Text style={styles.secondaryBtnText}>Contact support</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'pending' && (
        <View style={[styles.actions, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/(tabs)/trips')} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>View My Trips</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/contact')} activeOpacity={0.85}>
            <Text style={styles.secondaryBtnText}>Contact support</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 },
  iconWrap: {
    width: 104,
    height: 104,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: { fontFamily: Fonts.displayBold, fontSize: 26, color: Colors.ink, letterSpacing: -0.6, textAlign: 'center' },
  sub: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink3, textAlign: 'center', lineHeight: 22 },
  holdPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 4,
  },
  holdText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3 },
  actions: { paddingHorizontal: 24, gap: 10 },
  primaryBtn: { backgroundColor: Colors.orange, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  primaryBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },
  secondaryBtn: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  secondaryBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink2 },
});

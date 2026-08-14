import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';

interface Props {
  bookingId: string;
  amount: number;
  context: 'pickup' | 'return';
  /** Called after the balance is settled (CASH) or verified SUCCESS (ONLINE). Parent should refetch the booking. */
  onCollected: () => void;
}

// Mirror the customer checkout polling cadence (2s settle, then back off).
const POLL_DELAYS = [2000, 3000, 3000, 5000, 5000, 5000, 5000, 5000, 5000, 5000];

export default function RemainingBalanceCollect({ bookingId, amount, context, onCollected }: Props) {
  const [busy, setBusy] = useState<null | 'CASH' | 'ONLINE'>(null);
  const [verifying, setVerifying] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const initiate = (method: 'CASH' | 'ONLINE_RAZORPAY') =>
    context === 'pickup'
      ? employeeApi.initiateRemainingPaymentPickup(bookingId, { method, paidDuring: 'PICKUP' })
      : employeeApi.initiateRemainingPaymentReturn(bookingId, { method, paidDuring: 'RETURN' });

  const collectCash = () => {
    Alert.alert(
      'Collect cash',
      `Confirm ₹${amount.toLocaleString('en-IN')} received in cash from the customer?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setBusy('CASH');
            try {
              await initiate('CASH'); // settles synchronously server-side
              if (mountedRef.current) onCollected();
            } catch (err: any) {
              Alert.alert('Failed', err?.response?.data?.message ?? 'Could not record cash payment.');
            } finally {
              if (mountedRef.current) setBusy(null);
            }
          },
        },
      ],
    );
  };

  const collectOnline = async () => {
    setBusy('ONLINE');
    try {
      const res = await initiate('ONLINE_RAZORPAY');
      const data = res.data?.data ?? {};
      const paymentURL: string | undefined = data.paymentURL;
      const transactionId: string | undefined = data.transactionId;
      if (!paymentURL || !transactionId) {
        Alert.alert('Error', 'Could not start the online payment. Try cash instead.');
        return;
      }

      await WebBrowser.openAuthSessionAsync(paymentURL, 'wuw://payment/callback');

      // Poll regardless of how the browser closed — the customer may have paid before dismissing.
      setVerifying(true);
      let confirmed = false;
      for (let i = 0; i < POLL_DELAYS.length; i++) {
        if (!mountedRef.current) return;
        try {
          const s = await employeeApi.remainingPaymentStatus(transactionId);
          const status = s.data?.status;
          if (status === 'SUCCESS') { confirmed = true; break; }
          if (status === 'FAILED') break;
        } catch {
          // transient — keep polling
        }
        await new Promise((r) => setTimeout(r, POLL_DELAYS[i]));
      }

      if (!mountedRef.current) return;
      if (confirmed) onCollected();
      else
        Alert.alert(
          'Payment not confirmed',
          'The online payment could not be verified yet. Ask the customer to retry, or collect cash.',
        );
    } catch (err: any) {
      Alert.alert('Failed', err?.response?.data?.message ?? 'Could not start the online payment.');
    } finally {
      if (mountedRef.current) { setBusy(null); setVerifying(false); }
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="cash-outline" size={18} color="#d97706" />
        <View style={styles.headText}>
          <Text style={styles.title}>Collect remaining balance</Text>
          <Text style={styles.amount}>₹{amount.toLocaleString('en-IN')} due before continuing</Text>
        </View>
      </View>

      <View style={styles.btnRow}>
        <TouchableOpacity
          style={[styles.btn, styles.btnCash, !!busy && styles.btnDisabled]}
          onPress={collectCash}
          disabled={!!busy}
          activeOpacity={0.85}
        >
          {busy === 'CASH' ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <>
              <Ionicons name="wallet-outline" size={16} color={Colors.white} />
              <Text style={styles.btnText}>Cash</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnOnline, !!busy && styles.btnDisabled]}
          onPress={collectOnline}
          disabled={!!busy}
          activeOpacity={0.85}
        >
          {busy === 'ONLINE' ? (
            <View style={styles.btnInner}>
              <ActivityIndicator size="small" color={Colors.white} />
              {verifying && <Text style={styles.btnVerifying}>Verifying…</Text>}
            </View>
          ) : (
            <>
              <Ionicons name="qr-code-outline" size={16} color={Colors.white} />
              <Text style={styles.btnText}>Online</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fffbeb',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#fde68a',
    marginBottom: 8,
    gap: 12,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headText: { flex: 1 },
  title: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: '#92400e' },
  amount: { fontFamily: Fonts.body, fontSize: 13, color: '#b45309', marginTop: 2 },
  btnRow: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    minHeight: 46,
  },
  btnCash: { backgroundColor: '#10b981' },
  btnOnline: { backgroundColor: Colors.ink },
  btnDisabled: { opacity: 0.6 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btnText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.white },
  btnVerifying: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.white, opacity: 0.9 },
});

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi, verifyRazorpaySignature, type RazorpayOrder } from '../../lib/api';
import {
  CHECKING_PAYMENT_TEXT,
  QR_CANCEL_POLL_DELAYS,
  openRazorpayCheckout,
  isCheckoutCancelled,
  type CheckoutMode,
} from '../../lib/razorpay';
import {
  apiErrorMessage,
  cleanUtr,
  counterErrorCode,
  handleShiftRequired,
  isValidUtr,
} from '../../lib/counterErrors';
import RazorpayPayOptions from '../payments/RazorpayPayOptions';
import UtrInput from './UtrInput';

interface Props {
  bookingId: string;
  amount: number;
  context: 'pickup' | 'return';
  /** Called after the balance is settled (CASH / UPI) or verified SUCCESS (Razorpay). Parent should refetch the booking. */
  onCollected: () => void;
}

type Method = 'CASH' | 'UPI' | 'ONLINE';

const METHODS: { key: Method; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'CASH', label: 'Cash', icon: 'wallet-outline' },
  { key: 'UPI', label: 'UPI (UTR)', icon: 'keypad-outline' },
  { key: 'ONLINE', label: 'Online', icon: 'card-outline' },
];

// Mirror the customer checkout polling cadence (2s settle, then back off).
const POLL_DELAYS = [2000, 3000, 3000, 5000, 5000, 5000, 5000, 5000, 5000, 5000];

export default function RemainingBalanceCollect({ bookingId, amount, context, onCollected }: Props) {
  const [method, setMethod] = useState<Method>('CASH');
  const [busy, setBusy] = useState<null | 'CASH' | 'UPI' | CheckoutMode>(null);
  const [verifyingText, setVerifyingText] = useState<string | null>(null);
  const [utr, setUtr] = useState('');
  const [utrError, setUtrError] = useState<string | undefined>();
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const amountText = `₹${amount.toLocaleString('en-IN')}`;

  const initiate = (m: 'CASH' | 'ONLINE_RAZORPAY' | 'UPI', upiUtr?: string) => {
    const extra = upiUtr ? { utr: upiUtr } : {};
    return context === 'pickup'
      ? employeeApi.initiateRemainingPaymentPickup(bookingId, { method: m, paidDuring: 'PICKUP', ...extra })
      : employeeApi.initiateRemainingPaymentReturn(bookingId, { method: m, paidDuring: 'RETURN', ...extra });
  };

  const collectCash = () => {
    Alert.alert(
      'Collect cash',
      `Confirm ${amountText} received in cash from the customer?`,
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
              if (!handleShiftRequired(err)) {
                Alert.alert('Failed', apiErrorMessage(err, 'Could not record cash payment.'));
              }
            } finally {
              if (mountedRef.current) setBusy(null);
            }
          },
        },
      ],
    );
  };

  const collectUpi = async () => {
    if (!isValidUtr(utr)) {
      setUtrError("Enter the 12-digit UTR from the customer's UPI app.");
      return;
    }
    setBusy('UPI');
    setUtrError(undefined);
    try {
      await initiate('UPI', cleanUtr(utr)); // settles synchronously server-side, like CASH
      if (mountedRef.current) onCollected();
    } catch (err: any) {
      if (handleShiftRequired(err)) return;
      const code = counterErrorCode(err);
      if (code === 'INVALID_UTR' || code === 'DUPLICATE_UTR') {
        if (mountedRef.current) setUtrError(apiErrorMessage(err, 'Check the UTR number.'));
      } else {
        Alert.alert('Failed', apiErrorMessage(err, 'Could not record the UPI payment.'));
      }
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const collectOnline = async (mode: CheckoutMode) => {
    setBusy(mode);
    try {
      const res = await initiate('ONLINE_RAZORPAY');
      const data = res.data?.data ?? {};
      const transactionId: string | undefined = data.transactionId;
      // The CASH branch returns { amountCollected, method, paidDuring } with no
      // order at all, so guard on the order rather than on what we requested.
      const rzp: RazorpayOrder | null = data.razorpay ?? null;
      if (!rzp?.orderId || !rzp?.keyId || !transactionId) {
        Alert.alert('Error', 'Could not start the online payment. Try cash instead.');
        return;
      }

      // Polls until SUCCESS / FAILED or the delays run out.
      const pollConfirmed = async (delays: number[]) => {
        for (let i = 0; i < delays.length; i++) {
          if (!mountedRef.current) return false;
          try {
            const s = await employeeApi.remainingPaymentStatus(transactionId);
            const status = s.data?.status;
            if (status === 'SUCCESS') return true;
            if (status === 'FAILED') return false;
          } catch {
            // transient — keep polling
          }
          await new Promise((r) => setTimeout(r, delays[i]));
        }
        return false;
      };

      try {
        const payment = await openRazorpayCheckout(
          {
            key: rzp.keyId,
            order_id: rzp.orderId,
            amount: rzp.amount,
            currency: rzp.currency,
            description: `Remaining balance · ${amountText}`,
          },
          { mode },
        );
        // Staff session → /api/payment/staff/verify, resolved by role in lib/api.
        try {
          await verifyRazorpaySignature({
            razorpay_order_id: payment.razorpay_order_id ?? rzp.orderId,
            razorpay_payment_id: payment.razorpay_payment_id,
            razorpay_signature: payment.razorpay_signature ?? '',
          });
        } catch { /* fall through — the poll below is the fallback */ }
      } catch (rzpErr: any) {
        // Cancelled or failed. Failures still poll below: the webhook may
        // confirm late. A QR cancel is often this phone's sheet being closed
        // after the customer paid on their own phone — check before giving up.
        if (isCheckoutCancelled(rzpErr)) {
          if (mode === 'qr') {
            setVerifyingText(CHECKING_PAYMENT_TEXT);
            const paid = await pollConfirmed(QR_CANCEL_POLL_DELAYS);
            if (!mountedRef.current) return;
            if (paid) { onCollected(); return; }
          }
          Alert.alert('Payment cancelled', 'The payment sheet was closed. Retry, or collect cash / UPI.');
          return;
        }
      }

      // Poll regardless of how the sheet closed — the customer may have paid before dismissing.
      setVerifyingText('Verifying…');
      const confirmed = await pollConfirmed(POLL_DELAYS);

      if (!mountedRef.current) return;
      if (confirmed) onCollected();
      else
        Alert.alert(
          'Payment not confirmed',
          'The online payment could not be verified yet. Ask the customer to retry, or collect cash / UPI.',
        );
    } catch (err: any) {
      Alert.alert('Failed', apiErrorMessage(err, 'Could not start the online payment.'));
    } finally {
      if (mountedRef.current) { setBusy(null); setVerifyingText(null); }
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="cash-outline" size={18} color="#d97706" />
        <View style={styles.headText}>
          <Text style={styles.title}>Collect remaining balance</Text>
          <Text style={styles.amount}>{amountText} due before continuing</Text>
        </View>
      </View>

      <View style={styles.methodRow}>
        {METHODS.map((m) => {
          const active = method === m.key;
          return (
            <TouchableOpacity
              key={m.key}
              style={[styles.methodBtn, active && styles.methodBtnActive, !!busy && !active && styles.btnDisabled]}
              onPress={() => setMethod(m.key)}
              disabled={!!busy}
              activeOpacity={0.85}
            >
              <Ionicons name={m.icon} size={15} color={active ? Colors.white : Colors.ink2} />
              <Text style={[styles.methodText, active && styles.methodTextActive]}>{m.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {method === 'CASH' && (
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
              <Text style={styles.btnText}>Collect {amountText} cash</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {method === 'UPI' && (
        <>
          <UtrInput
            value={utr}
            onChangeText={(t) => { setUtr(t); setUtrError(undefined); }}
            error={utrError}
          />
          <TouchableOpacity
            style={[styles.btn, styles.btnUpi, !!busy && styles.btnDisabled]}
            onPress={collectUpi}
            disabled={!!busy}
            activeOpacity={0.85}
          >
            {busy === 'UPI' ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={16} color={Colors.white} />
                <Text style={styles.btnText}>Record {amountText} UPI payment</Text>
              </>
            )}
          </TouchableOpacity>
        </>
      )}

      {method === 'ONLINE' && (
        <RazorpayPayOptions
          payLabel={`Pay ${amountText} online`}
          onPay={collectOnline}
          busyMode={busy === 'default' || busy === 'qr' ? busy : null}
          busyLabel={verifyingText ?? undefined}
          disabled={!!busy}
          buttonStyle={styles.rzpBtn}
        />
      )}
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
  methodRow: { flexDirection: 'row', gap: 8 },
  methodBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  methodBtnActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  methodText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink2 },
  methodTextActive: { color: Colors.white },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    minHeight: 46,
  },
  btnCash: { backgroundColor: '#10b981' },
  btnUpi: { backgroundColor: Colors.ink },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.white },
  rzpBtn: { borderRadius: 12, paddingVertical: 12, minHeight: 46 },
});

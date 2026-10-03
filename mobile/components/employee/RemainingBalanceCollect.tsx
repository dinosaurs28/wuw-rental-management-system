import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi, verifyRazorpaySignature, type RazorpayOrder, type RemainingPaymentBody } from '../../lib/api';
import {
  CHECKING_PAYMENT_TEXT,
  QR_CANCEL_POLL_DELAYS,
  openRazorpayCheckout,
  isCheckoutCancelled,
  type CheckoutMode,
} from '../../lib/razorpay';
import { apiErrorMessage, handleShiftRequired } from '../../lib/counterErrors';
import { COUNTER_PAYMENT_METHODS, type CounterPaymentChoice, type PaymentMethodKey } from '../../lib/counterPayment';
import RazorpayPayOptions from '../payments/RazorpayPayOptions';
import CounterPaymentPicker, { useCounterPayment } from './CounterPaymentPicker';

interface Props {
  bookingId: string;
  amount: number;
  context: 'pickup' | 'return';
  /** Called after the balance is settled (CASH / UPI / SPLIT / CREDIT) or verified SUCCESS (Razorpay). Parent should refetch the booking. */
  onCollected: () => void;
}

// Counter methods (#3 / #11) plus Razorpay checkout.
const METHODS: readonly PaymentMethodKey[] = [...COUNTER_PAYMENT_METHODS, 'ONLINE'];

// Mirror the customer checkout polling cadence (2s settle, then back off).
const POLL_DELAYS = [2000, 3000, 3000, 5000, 5000, 5000, 5000, 5000, 5000, 5000];

export default function RemainingBalanceCollect({ bookingId, amount, context, onCollected }: Props) {
  const pay = useCounterPayment('CASH');
  const method = pay.method;
  const [busy, setBusy] = useState<null | 'COUNTER' | CheckoutMode>(null);
  const [verifyingText, setVerifyingText] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const amountText = `₹${amount.toLocaleString('en-IN')}`;

  const initiate = (body: RemainingPaymentBody) =>
    context === 'pickup'
      ? employeeApi.initiateRemainingPaymentPickup(bookingId, { ...body, paidDuring: 'PICKUP' })
      : employeeApi.initiateRemainingPaymentReturn(bookingId, { ...body, paidDuring: 'RETURN' });

  // Cash, UPI (payment-screen photo), split or credit — all settle synchronously
  // server-side; credit leaves the balance owed against the collateral (#11).
  const record = async (choice: CounterPaymentChoice) => {
    const body: RemainingPaymentBody =
      choice.method === 'UPI'
        ? { method: 'UPI', proof_file_id: choice.proofFileId }
        : choice.method === 'SPLIT'
          ? { method: 'SPLIT', cashAmount: choice.cashAmount, onlineAmount: choice.upiAmount, proof_file_id: choice.proofFileId }
          : choice.method === 'CREDIT'
            ? { method: 'CREDIT', collateral: choice.collateral }
            : { method: 'CASH' };
    setBusy('COUNTER');
    try {
      await initiate(body);
      if (mountedRef.current) onCollected();
    } catch (err: any) {
      if (handleShiftRequired(err)) return;
      if (mountedRef.current && pay.showServerError(err)) return;
      Alert.alert('Failed', apiErrorMessage(err, 'Could not record the payment.'));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const collectCounter = () => {
    const choice = pay.resolve(amount);
    if (!choice) return;
    if (choice.method === 'CASH') {
      Alert.alert('Collect cash', `Confirm ${amountText} received in cash from the customer?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => void record(choice) },
      ]);
      return;
    }
    if (choice.method === 'CREDIT') {
      Alert.alert(
        'Put on credit',
        `${amountText} stays owed by the customer against: ${choice.collateral}. The branch manager clears it when they pay.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Put on credit', onPress: () => void record(choice) },
        ],
      );
      return;
    }
    void record(choice);
  };

  const counterLabel =
    method === 'CASH'
      ? `Collect ${amountText} cash`
      : method === 'UPI'
        ? `Record ${amountText} UPI payment`
        : method === 'SPLIT'
          ? `Record ${amountText} split payment`
          : `Put ${amountText} on credit`;
  const counterIcon: React.ComponentProps<typeof Ionicons>['name'] =
    method === 'CASH' ? 'wallet-outline' : method === 'CREDIT' ? 'hourglass-outline' : 'checkmark-circle-outline';

  const collectOnline = async (mode: CheckoutMode) => {
    setBusy(mode);
    try {
      const res = await initiate({ method: 'ONLINE_RAZORPAY' });
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
          Alert.alert('Payment cancelled', 'The payment sheet was closed. Retry, or take it at the counter (cash, UPI, split or credit).');
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

      <CounterPaymentPicker ctl={pay} amount={amount} methods={METHODS} disabled={!!busy} title={null} />

      {method !== 'ONLINE' && (
        <TouchableOpacity
          style={[styles.btn, method === 'CASH' ? styles.btnCash : styles.btnUpi, !!busy && styles.btnDisabled]}
          onPress={collectCounter}
          disabled={!!busy}
          activeOpacity={0.85}
        >
          {busy === 'COUNTER' ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <>
              <Ionicons name={counterIcon} size={16} color={Colors.white} />
              <Text style={styles.btnText}>{counterLabel}</Text>
            </>
          )}
        </TouchableOpacity>
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

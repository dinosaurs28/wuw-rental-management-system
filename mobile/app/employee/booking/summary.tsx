import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import RazorpayCheckout from 'react-native-razorpay';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi, verifyRazorpaySignature, type RazorpayOrder } from '../../../lib/api';
import { useEmployeeBookingStore } from '../../../store/employeeBooking';

const POLL_DELAYS = [2000, 3000, 3000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000];

function Line({ label, value, bold, credit }: { label: string; value: string; bold?: boolean; credit?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, bold && styles.lineLabelBold]}>{label}</Text>
      <Text style={[styles.lineValue, bold && styles.lineValueBold, credit && styles.credit]}>{value}</Text>
    </View>
  );
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

export default function WalkinSummaryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { customer, vehicle, start, end, customerKycId, reset } = useEmployeeBookingStore();

  const [payMethod, setPayMethod] = useState<'CASH' | 'ONLINE'>('CASH');
  const [phase, setPhase] = useState<'REVIEW' | 'PAYING' | 'DONE'>('REVIEW');
  const [statusText, setStatusText] = useState('');
  const [bookingRef, setBookingRef] = useState('');
  const holdRef = useRef<{ holdId: string; transactionId: string } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Hold countdown
  useEffect(() => {
    if (secondsLeft == null) return;
    if (secondsLeft <= 0) return;
    const t = setInterval(() => setSecondsLeft((s) => (s == null ? null : Math.max(0, s - 1))), 1000);
    return () => clearInterval(t);
  }, [secondsLeft]);

  if (!customer || !vehicle || !start || !end || !customerKycId) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.replace('/employee/customer/search')} style={styles.back} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.title}>Summary</Text>
        </View>
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={40} color={Colors.ink4} />
          <Text style={styles.emptyTitle}>Booking details incomplete</Text>
          <TouchableOpacity onPress={() => router.replace('/employee/booking/vehicles')}>
            <Text style={styles.retry}>Back to vehicle selection</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const pd = vehicle.pricingDetails;
  const days = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000));
  const deposit = pd?.deposit ?? vehicle.deposit ?? 0;
  const base = pd ? pd.basePrice : (vehicle.dailyPrice ?? 0) * days;
  const discount = pd?.discountAmount ?? 0;
  const tax = pd?.taxAmount ?? 0;
  const finalTotal = pd ? pd.finalTotal : base + tax;
  const grandTotal = finalTotal + deposit;

  const poll = async (transactionId: string) => {
    for (let i = 0; i < POLL_DELAYS.length; i++) {
      if (!mountedRef.current) return false;
      try {
        const res = await employeeApi.bookingPaymentStatus(transactionId);
        const status = res.data?.status;
        if (status === 'Success') return true;
        if (status === 'Failed') return false;
      } catch {
        /* transient */
      }
      await new Promise((r) => setTimeout(r, POLL_DELAYS[i]));
    }
    return false;
  };

  const confirm = async () => {
    setPhase('PAYING');
    // Retrying after a failed attempt: release the previous hold so we don't orphan it.
    if (holdRef.current) {
      setStatusText('Releasing previous hold…');
      try { await employeeApi.cancelBookingHold(holdRef.current.holdId); } catch { /* ignore */ }
      holdRef.current = null;
      setSecondsLeft(null);
    }
    setStatusText('Creating booking…');
    try {
      const res = await employeeApi.createBooking({
        group_key: vehicle.groupKey,
        customer_public_id: customer.publicId,
        customer_kyc_id: customerKycId,
        start,
        end,
        payment_type: payMethod,
      });
      const data = res.data?.data ?? {};
      const holdId: string = data.bookingId;
      const transactionId: string = data.transactionId;
      // Null on the CASH branch (where transactionId is a CASH_xxx ref), so the
      // presence of the order — not payMethod — decides whether Checkout opens.
      const rzp: RazorpayOrder | null = data.razorpay ?? null;
      holdRef.current = { holdId, transactionId };
      if (typeof data.expiresIn === 'number') setSecondsLeft(data.expiresIn);
      setBookingRef(holdId);

      if (rzp?.orderId && rzp?.keyId) {
        setStatusText('Waiting for payment…');
        let payment;
        try {
          payment = await RazorpayCheckout.open({
            key: rzp.keyId,
            order_id: rzp.orderId,
            amount: rzp.amount,
            currency: rzp.currency || 'INR',
            name: 'WUW Rentals',
            description: `${vehicle.make} ${vehicle.model} · ${days} day${days !== 1 ? 's' : ''}`,
            prefill: {
              name: customer.name,
              contact: customer.phone ?? '',
            },
            theme: { color: Colors.orange },
          });
        } catch (rzpErr: any) {
          // Cancelled or failed. Keep the hold so the counter can retry or
          // switch to cash before it expires — `cancel` releases it explicitly.
          if (!mountedRef.current) return;
          setPhase('REVIEW');
          const description: string = rzpErr?.description ?? '';
          Alert.alert(
            /cancel/i.test(description) ? 'Payment cancelled' : 'Payment failed',
            /cancel/i.test(description)
              ? 'The payment sheet was closed. Retry, switch to cash, or cancel the hold.'
              : description || 'The payment could not be completed. Retry or collect cash.',
          );
          return;
        }

        // Staff session → /api/payment/staff/verify, resolved by role in lib/api.
        setStatusText('Verifying payment…');
        try {
          await verifyRazorpaySignature({
            razorpay_order_id: payment.razorpay_order_id ?? rzp.orderId,
            razorpay_payment_id: payment.razorpay_payment_id,
            razorpay_signature: payment.razorpay_signature ?? '',
          });
        } catch { /* fall through — the poll below is the fallback */ }
      } else {
        setStatusText('Confirming cash payment…');
      }

      const ok = await poll(transactionId);
      if (!mountedRef.current) return;
      if (ok) {
        setPhase('DONE');
      } else {
        setPhase('REVIEW');
        Alert.alert(
          'Payment not completed',
          payMethod === 'ONLINE'
            ? 'The online payment was not confirmed. Retry, switch to cash, or cancel the hold.'
            : 'Could not confirm the booking. Please retry.',
        );
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      setPhase('REVIEW');
      Alert.alert('Booking failed', err?.response?.data?.message ?? 'Could not create the booking.');
    }
  };

  const cancel = async () => {
    const hold = holdRef.current;
    const finish = () => { reset(); router.replace('/(employee)/dashboard'); };
    if (!hold) { finish(); return; }
    Alert.alert('Cancel booking', 'Discard this booking hold?', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel booking',
        style: 'destructive',
        onPress: async () => {
          try { await employeeApi.cancelBookingHold(hold.holdId); } catch { /* ignore */ }
          finish();
        },
      },
    ]);
  };

  if (phase === 'DONE') {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.successBody}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={64} color="#10b981" />
          </View>
          <Text style={styles.successTitle}>Booking Confirmed</Text>
          <Text style={styles.successSub}>
            {vehicle.make} {vehicle.model} booked for {customer.name}.
          </Text>
          <Text style={styles.successRef}>#{bookingRef.slice(-8).toUpperCase()}</Text>
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => { reset(); router.replace('/(employee)/dashboard'); }}
            activeOpacity={0.85}
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const paying = phase === 'PAYING';
  const mm = secondsLeft != null ? String(Math.floor(secondsLeft / 60)).padStart(2, '0') : null;
  const ss = secondsLeft != null ? String(secondsLeft % 60).padStart(2, '0') : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (paying ? null : router.back())} style={styles.back} hitSlop={8} disabled={paying}>
          <Ionicons name="arrow-back" size={22} color={paying ? Colors.ink4 : Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>Review &amp; Confirm</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 140 }]} showsVerticalScrollIndicator={false}>
        {holdRef.current && secondsLeft != null && secondsLeft > 0 && (
          <View style={styles.holdBanner}>
            <Ionicons name="time-outline" size={16} color="#d97706" />
            <Text style={styles.holdText}>Hold expires in {mm}:{ss} — complete payment</Text>
          </View>
        )}

        {/* Customer */}
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{customer.name.charAt(0).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardName}>{customer.name}</Text>
              {customer.phone && <Text style={styles.cardMeta}>{customer.phone}</Text>}
            </View>
          </View>
        </View>

        {/* Vehicle + dates */}
        <View style={styles.card}>
          <Text style={styles.cardName}>{vehicle.make} {vehicle.model}</Text>
          <Text style={styles.cardMeta}>{vehicle.category} · {vehicle.branch}</Text>
          <View style={styles.divider} />
          <Line label="Pickup" value={fmtDateTime(start)} />
          <Line label="Return" value={fmtDateTime(end)} />
          <Line label="Duration" value={`${days} day${days !== 1 ? 's' : ''}`} />
        </View>

        {/* Price breakdown */}
        <Text style={styles.sectionLabel}>Price breakdown</Text>
        <View style={styles.card}>
          <Line label={`Base (${days} day${days !== 1 ? 's' : ''})`} value={`₹${base.toLocaleString('en-IN')}`} />
          {discount > 0 && <Line label="Discount" value={`−₹${discount.toLocaleString('en-IN')}`} credit />}
          <Line label={`GST${pd ? ` (${pd.taxRate}%)` : ''}`} value={`₹${tax.toLocaleString('en-IN')}`} />
          <Line label="Deposit (refundable)" value={`₹${deposit.toLocaleString('en-IN')}`} />
          <View style={styles.divider} />
          <Line label="Grand total" value={`₹${grandTotal.toLocaleString('en-IN')}`} bold />
        </View>

        {/* Payment method */}
        <Text style={styles.sectionLabel}>Payment method</Text>
        <View style={styles.methodRow}>
          {(['CASH', 'ONLINE'] as const).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.methodBtn, payMethod === m && styles.methodBtnActive]}
              onPress={() => !paying && setPayMethod(m)}
              activeOpacity={0.8}
              disabled={paying}
            >
              <Ionicons
                name={m === 'CASH' ? 'wallet-outline' : 'qr-code-outline'}
                size={18}
                color={payMethod === m ? Colors.white : Colors.ink2}
              />
              <Text style={[styles.methodText, payMethod === m && styles.methodTextActive]}>
                {m === 'CASH' ? 'Cash' : 'Online'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        {paying ? (
          <View style={styles.payingRow}>
            <ActivityIndicator size="small" color={Colors.orange} />
            <Text style={styles.payingText}>{statusText}</Text>
          </View>
        ) : (
          <>
            <TouchableOpacity style={styles.cta} onPress={confirm} activeOpacity={0.85}>
              <Text style={styles.ctaText}>
                {holdRef.current ? 'Retry payment' : `Confirm & ${payMethod === 'CASH' ? 'collect cash' : 'pay online'}`}
              </Text>
              <Text style={styles.ctaTotal}>₹{grandTotal.toLocaleString('en-IN')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={cancel} activeOpacity={0.8}>
              <Text style={styles.cancelText}>{holdRef.current ? 'Cancel booking' : 'Discard'}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 12 },
  back: { width: 36, height: 36, justifyContent: 'center' },
  title: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },

  content: { paddingHorizontal: 20, gap: 10 },

  holdBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fffbeb', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#fde68a',
  },
  holdText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: '#92400e' },

  card: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.hairline, padding: 16, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.white },
  cardName: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.ink },
  cardMeta: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, marginTop: 2 },

  divider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 8 },

  sectionLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8 },

  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 },
  lineLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },
  lineLabelBold: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  lineValue: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  lineValueBold: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink },
  credit: { color: '#10b981' },

  methodRow: { flexDirection: 'row', gap: 10 },
  methodBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.hairline,
  },
  methodBtnActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  methodText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink2 },
  methodTextActive: { color: Colors.white },

  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 12, backgroundColor: Colors.bg, borderTopWidth: 1, borderTopColor: Colors.hairline, gap: 8 },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.orange, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 20,
    shadowColor: Colors.black, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  ctaText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white },
  ctaTotal: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.white },
  cancelBtn: { alignItems: 'center', paddingVertical: 10 },
  cancelText: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink3 },
  payingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  payingText: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink2 },

  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink2, letterSpacing: -0.4 },
  retry: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange, marginTop: 6 },

  successBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 },
  successIcon: { width: 100, height: 100, borderRadius: 30, backgroundColor: '#10b98115', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  successTitle: { fontFamily: Fonts.displayBold, fontSize: 28, color: Colors.ink, letterSpacing: -0.8 },
  successSub: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink3, textAlign: 'center', lineHeight: 22 },
  successRef: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink3, letterSpacing: 1 },
  doneBtn: { backgroundColor: Colors.ink, borderRadius: 16, paddingVertical: 17, paddingHorizontal: 40, alignItems: 'center', marginTop: 16, width: '100%' },
  doneBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },
});

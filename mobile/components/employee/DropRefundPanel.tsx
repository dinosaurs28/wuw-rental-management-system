import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import { inrCounter } from '../../lib/counterPayment';
import { CounterRefundPicker, useCounterRefund } from './CounterPaymentPicker';

/**
 * Fleet refund at the drop (Oct 25 2026, client: "Refund during drop should be
 * given to fleet members") — shown once a legacy drop (no drop bill) is recorded.
 * What is owed back (the deposit under the drop's choice, or money paid beyond
 * what the booking owes) is paid out now — Cash / UPI / Bank, the UPI / bank
 * success-screen photo required — against the executive's open shift. "Refund
 * later" leaves it to the branch manager's Pending Settlements.
 */
export default function DropRefundPanel({ bookingPublicId }: { bookingPublicId: string }) {
  const qc = useQueryClient();
  const refundPay = useCounterRefund();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneNote, setDoneNote] = useState<string | null>(null);
  const [later, setLater] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['employee', 'drop-refund', bookingPublicId],
    queryFn: async () => (await employeeApi.getDropRefund(bookingPublicId)).data.data,
  });

  if (isLoading) return <ActivityIndicator color={Colors.ink3} style={{ marginTop: 12 }} />;
  if (doneNote) return <Text style={styles.note}>{doneNote}</Text>;
  if (!data) return null;
  const owed = Number(data.owedBack) || 0;
  if (owed <= 0) return null;
  if (later) {
    return <Text style={styles.note}>{inrCounter(owed)} refund left to the branch manager (Pending Settlements).</Text>;
  }
  if (!data.canRefund) {
    return (
      <Text style={styles.note}>
        {inrCounter(owed)} is owed back to the customer — the branch manager settles it.
        {data.blockedReason ? ` ${data.blockedReason}` : ''}
      </Text>
    );
  }

  const submit = async () => {
    const choice = refundPay.resolve();
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      const res = await employeeApi.recordDropRefund(bookingPublicId, {
        method: choice.method,
        ...(choice.proofFileId ? { proof_file_id: choice.proofFileId } : {}),
      });
      qc.invalidateQueries({ queryKey: ['employee', 'financial-state', bookingPublicId] });
      setDoneNote(
        choice.method === 'CASH'
          ? `${inrCounter(Number(res.data.data.amount))} refunded in cash — the branch manager acknowledges it.`
          : `${inrCounter(Number(res.data.data.amount))} refunded by ${choice.method === 'UPI' ? 'UPI' : 'bank transfer'}.`,
      );
    } catch (err: any) {
      if (refundPay.showServerError(err)) return;
      setError(err?.response?.data?.message ?? 'Could not record the refund. Try again.');
      void refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="return-down-back-outline" size={16} color={Colors.ink2} />
        <Text style={styles.title}>Refund {inrCounter(owed)} to the customer</Text>
      </View>
      {Number(data.depositToRefund) > 0 && (
        <Text style={styles.sub}>Safety deposit {inrCounter(Number(data.depositToRefund))}</Text>
      )}
      <CounterRefundPicker ctl={refundPay} amount={owed} disabled={busy} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={[styles.btn, busy && { opacity: 0.6 }]} onPress={() => void submit()} disabled={busy} activeOpacity={0.85}>
        {busy ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.btnText}>Refund now</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.link} onPress={() => setLater(true)} disabled={busy} activeOpacity={0.8}>
        <Text style={styles.linkText}>Refund later (send to branch manager)</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    gap: 10,
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    backgroundColor: Colors.white,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  sub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  note: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, textAlign: 'center', lineHeight: 19, marginTop: 8 },
  error: { fontFamily: Fonts.body, fontSize: 12, color: Colors.availNone },
  btn: { backgroundColor: Colors.ink, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  btnText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.white },
  link: { alignItems: 'center', paddingVertical: 6 },
  linkText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2, textDecorationLine: 'underline' },
});

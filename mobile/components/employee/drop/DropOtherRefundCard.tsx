// Client TODO 9 (Nov 2026): "Refund to customer (other reasons)" during the drop.
// Money paid back for anything other than rent adjustments or discounts — cash
// or UPI (UPI: 1–3 payment-success photos), a required reason. Recorded on its own
// (POST …/refund-to-customer with kind DROP_OTHER): never set against the extra
// charges, the rent or the drop bill, which stay as they are, and usable before or
// after the bill is settled. Cash comes out of the Fleet Executive's drawer (open
// cash shift). Each refund here can be voided like any other refund.
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import Toast from '../../ui/Toast';
import CustomerRefundHistory from '../CustomerRefundHistory';
import { RefundToCustomerSheet } from '../payments/RefundToCustomerSheet';
import { VoidPaymentSheet, type VoidTarget } from '../payments/VoidPaymentSheet';

export default function DropOtherRefundCard({ bookingPublicId }: { bookingPublicId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);
  const [done, setDone] = useState<{ title: string; message: string } | null>(null);

  const query = useQuery({
    queryKey: ['employee', 'drop-other-refunds', bookingPublicId],
    queryFn: async () => (await employeeApi.refundToCustomerOptions(bookingPublicId)).data.data,
    enabled: !!bookingPublicId,
    staleTime: 15_000,
    retry: false,
  });
  const refunds = (query.data?.refunds ?? []).filter((r) => r.kind === 'DROP_OTHER');

  const changed = () => {
    void query.refetch();
    void queryClient.invalidateQueries({ queryKey: ['employee', 'financial-state', bookingPublicId] });
  };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name="arrow-undo-outline" size={18} color={Colors.orange} />
        <Text style={styles.title}>Refund to customer (other reasons)</Text>
      </View>
      <Text style={styles.body}>
        For money paid back for anything other than rent adjustments or discounts. It doesn't change the drop bill, the
        charges or the amount due.
      </Text>

      <CustomerRefundHistory
        refunds={refunds}
        onVoid={(r, label) => setVoidTarget({ transactionPublicId: r.publicId, amount: r.amount, label, isRefund: true })}
      />

      <TouchableOpacity style={styles.btn} onPress={() => setOpen(true)} activeOpacity={0.85}>
        <Ionicons name="add-circle-outline" size={16} color={Colors.orange} />
        <Text style={styles.btnText}>Record a refund</Text>
      </TouchableOpacity>

      <RefundToCustomerSheet
        visible={open}
        kind="DROP_OTHER"
        bookingPublicId={bookingPublicId}
        onClose={() => setOpen(false)}
        onDone={(message) => {
          setOpen(false);
          setDone({ title: 'Refund recorded', message });
          changed();
        }}
      />
      <VoidPaymentSheet
        target={voidTarget}
        onClose={() => setVoidTarget(null)}
        onDone={(message, result) => {
          setVoidTarget(null);
          setDone({ title: result.shiftClosed ? 'Voided — shift already closed' : 'Voided', message });
          changed();
        }}
      />
      <Toast visible={!!done} title={done?.title ?? ''} message={done?.message} type="success" onDismiss={() => setDone(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 16,
    marginTop: 12,
    marginBottom: 4,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  body: { fontFamily: Fonts.body, fontSize: 12.5, color: Colors.ink3, marginTop: 6, lineHeight: 18 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12,
    paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: Colors.orange, backgroundColor: Colors.orangeSoft,
  },
  btnText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange },
});

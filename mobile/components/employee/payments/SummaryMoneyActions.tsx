// Completed pickup / drop summaries (Oct 2026): the booking's "Refund to
// customer" history with Void on each refund that can be voided, and the
// "Refund to customer" action — the same rules as the branch manager's.
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Colors, Fonts } from '../../../constants/colors';
import Toast from '../../ui/Toast';
import CustomerRefundHistory from '../CustomerRefundHistory';
import type { CustomerRefundRow } from '../../../types/completedOperation';
import { RefundToCustomerSheet } from './RefundToCustomerSheet';
import { VoidPaymentSheet, type VoidTarget } from './VoidPaymentSheet';

export default function SummaryMoneyActions({
  bookingPublicId,
  refunds,
  onChanged,
}: {
  bookingPublicId: string;
  refunds?: CustomerRefundRow[];
  /** After a refund or a void: reload the summary */
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [refundOpen, setRefundOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);
  const [done, setDone] = useState<{ title: string; message: string } | null>(null);

  const changed = () => {
    void queryClient.invalidateQueries({ queryKey: ['employee', 'financial-state', bookingPublicId] });
    onChanged();
  };

  return (
    <>
      <CustomerRefundHistory
        refunds={refunds}
        onVoid={(r, label) => setVoidTarget({ transactionPublicId: r.publicId, amount: r.amount, label, isRefund: true })}
      />
      <TouchableOpacity style={styles.refundBtn} onPress={() => setRefundOpen(true)} activeOpacity={0.85}>
        <Ionicons name="arrow-undo-outline" size={16} color={Colors.orange} />
        <Text style={styles.refundText}>Refund to customer</Text>
      </TouchableOpacity>

      <RefundToCustomerSheet
        visible={refundOpen}
        bookingPublicId={bookingPublicId}
        onClose={() => setRefundOpen(false)}
        onDone={(message) => {
          setRefundOpen(false);
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
    </>
  );
}

const styles = StyleSheet.create({
  refundBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12,
    paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: Colors.orange, backgroundColor: Colors.orangeSoft,
  },
  refundText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange },
});

// "Refund to customer" (Oct 2026): money the branch manager / admin / Fleet paid
// back to the customer on the booking, shown in the booking's money history on
// the completed pickup / drop summaries. A voided refund is struck through;
// onVoid (own branch) adds the Void action to a refund that can be voided.
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { fmtDateTime } from '../../lib/dates';
import type { CustomerRefundRow } from '../../types/completedOperation';

const num = (x: unknown) => Number(x ?? 0) || 0;
const inr = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const methodLabel = (r: CustomerRefundRow) =>
  r.method === 'CASH' ? 'Cash' : r.onlineGateway === 'BANK_TRANSFER' ? 'Bank transfer' : 'UPI';

export default function CustomerRefundHistory({
  refunds,
  onVoid,
}: {
  refunds?: CustomerRefundRow[];
  onVoid?: (refund: CustomerRefundRow, label: string) => void;
}) {
  if (!refunds || refunds.length === 0) return null;
  return (
    <View style={styles.wrap}>
      {refunds.map((r) => (
        <View key={r.publicId} style={styles.item}>
          <View style={styles.row}>
            <Text style={[styles.label, r.voided && styles.struck]}>Refund to customer · {methodLabel(r)}</Text>
            <Text style={[styles.amount, r.voided && styles.struck]}>− {inr(num(r.amount))}</Text>
          </View>
          <Text style={styles.note}>
            {fmtDateTime(r.at)}
            {r.by ? ` · by ${r.by}` : ''}
            {r.reference ? ` · Ref ${r.reference}` : ''}
          </Text>
          {r.cashOutsideShift ? <Text style={[styles.note, styles.warn]}>Cash paid out with no cash shift open</Text> : null}
          {r.notes ? <Text style={styles.note}>{r.notes}</Text> : null}
          {r.voided ? (
            <Text style={styles.note}>
              Voided{r.voidReason ? `: ${r.voidReason}` : ''}
              {r.voidedBy ? ` · by ${r.voidedBy}` : ''}
              {r.voidedAt ? ` · ${fmtDateTime(r.voidedAt)}` : ''}
            </Text>
          ) : null}
          {onVoid && r.voidable ? (
            <TouchableOpacity
              style={styles.voidBtn}
              onPress={() => onVoid(r, `Refund to customer · ${methodLabel(r)}`)}
              hitSlop={6}
              activeOpacity={0.7}
            >
              <Ionicons name="ban-outline" size={14} color={Colors.availNone} />
              <Text style={styles.voidText}>Void</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8 },
  item: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.hairline, paddingTop: 8, marginTop: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  label: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  amount: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  note: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 2 },
  warn: { color: Colors.availLow, fontFamily: Fonts.bodyMedium },
  struck: { textDecorationLine: 'line-through', color: Colors.ink3 },
  voidBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 4, marginTop: 4 },
  voidText: { fontFamily: Fonts.bodySemiBold, fontSize: 12.5, color: Colors.availNone },
});

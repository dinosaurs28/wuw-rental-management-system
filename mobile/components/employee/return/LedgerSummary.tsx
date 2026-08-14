import { StyleSheet, Text, View } from 'react-native';
import { Colors, Fonts } from '../../../constants/colors';
import type { ChargeBreakdown, PaymentSession } from '../../../types/return';

interface Props {
  breakdown: ChargeBreakdown;
  session?: PaymentSession;
}

const fmt = (s?: string | number | null) => {
  if (s == null || s === '') return '0';
  const n = typeof s === 'string' ? parseFloat(s) : s;
  return Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

export default function LedgerSummary({ breakdown, session }: Props) {
  const netPayable = session ? parseFloat(session.netPayable) : parseFloat(breakdown.finalTotal);
  const isRefund = session?.isRefund ?? netPayable < 0;

  return (
    <View>
      {breakdown.charges.length > 0 && (
        <View style={styles.list}>
          {breakdown.charges.map((c, i) => (
            <View
              key={`${c.moduleKey}-${i}`}
              style={[styles.row, i === breakdown.charges.length - 1 && styles.rowLast]}
            >
              <Text style={styles.rowLabel} numberOfLines={1}>
                {c.label}
                {c.quantity ? <Text style={styles.rowQty}>  · {c.quantity}{c.unitRate ? ` × ₹${c.unitRate}` : ''}</Text> : null}
              </Text>
              <Text style={[styles.rowValue, c.isOverridden && styles.rowValueOverridden]}>
                ₹{fmt(c.finalAmount)}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.totals}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Subtotal</Text>
          <Text style={styles.totalValue}>₹{fmt(breakdown.subtotal)}</Text>
        </View>
        {parseFloat(breakdown.waivedTotal) > 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Waived</Text>
            <Text style={[styles.totalValue, styles.discount]}>−₹{fmt(breakdown.waivedTotal)}</Text>
          </View>
        )}
        {session && parseFloat(session.totalPaymentsRecorded) > 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Already paid</Text>
            <Text style={[styles.totalValue, styles.discount]}>−₹{fmt(session.totalPaymentsRecorded)}</Text>
          </View>
        )}
        <View style={[styles.totalRow, styles.netRow]}>
          <Text style={styles.netLabel}>{isRefund ? 'Refund due' : 'Net payable'}</Text>
          <Text style={[styles.netValue, isRefund && styles.refundValue]}>
            ₹{fmt(netPayable)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    backgroundColor: Colors.bg,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
    gap: 10,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, flex: 1 },
  rowQty: { color: Colors.ink3, fontSize: 11 },
  rowValue: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  rowValueOverridden: { color: Colors.orange },
  totals: { marginTop: 12, gap: 6 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  totalValue: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink },
  discount: { color: '#059669' },
  netRow: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
  },
  netLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  netValue: {
    fontFamily: Fonts.displayBold,
    fontSize: 18,
    color: Colors.ink,
    letterSpacing: -0.4,
  },
  refundValue: { color: '#059669' },
});

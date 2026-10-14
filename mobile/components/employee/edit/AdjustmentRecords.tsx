// Edits of a completed pickup / drop that moved money (client item 1, full
// edit), on the read-only summaries: the difference still to settle, and the
// ones settled.
import { StyleSheet, Text, View } from 'react-native';
import { Colors, Fonts } from '../../../constants/colors';
import { fmtDateTime } from '../../../lib/dates';
import AdjustmentSettle, { AdjustmentLines } from './AdjustmentSettle';
import type { AdjustmentRecord } from '../../../types/completedOperation';

const num = (x: unknown) => Number(x ?? 0) || 0;
const inr = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// The difference of the last edit, settled from here when it wasn't at the edit.
export function PendingAdjustmentCard({ record, onSettled }: { record: AdjustmentRecord; onSettled: () => void }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Difference to settle</Text>
      <Text style={styles.sub}>From the edit on {fmtDateTime(record.createdAt)}.</Text>
      <AdjustmentSettle
        session={record.session}
        lines={record.lines}
        collectMethods={record.lines.some((l) => l.entryType === 'DEPOSIT' && num(l.delta) > 0) ? ['CASH', 'UPI', 'SPLIT'] : undefined}
        onSettled={onSettled}
      />
    </View>
  );
}

// Edits whose difference was settled, oldest first.
export function AdjustmentHistory({ records }: { records: AdjustmentRecord[] }) {
  if (records.length === 0) return null;
  return (
    <View style={styles.card}>
      {records.map((r, i) => {
        // The edit's difference: its corrected charges less discounts (part may have come off credit)
        const net = num(r.session.totalCharges) + num(r.session.totalDiscounts);
        const offCredit = r.lines.filter((l) => l.entryType === 'CREDIT').reduce((sum, l) => sum + num(l.delta), 0);
        return (
          <View key={r.session.publicId} style={i > 0 ? styles.divided : undefined}>
            <Text style={styles.recordTitle}>
              Edited {r.completedAt ? fmtDateTime(r.completedAt) : fmtDateTime(r.createdAt)}
              {' · '}
              {net > 0
                ? `${inr(net)} more, settled`
                : net < 0
                  ? offCredit > 0
                    ? `${inr(net)} less, ${inr(offCredit)} of it off the credit`
                    : `${inr(net)} less, refunded`
                  : 'no change in money'}
            </Text>
            <View style={{ marginTop: 8 }}>
              <AdjustmentLines lines={r.lines} />
            </View>
          </View>
        );
      })}
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
    marginBottom: 4,
    gap: 10,
  },
  title: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  sub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  recordTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  divided: { borderTopWidth: 1, borderTopColor: Colors.hairline, paddingTop: 12, marginTop: 4 },
});

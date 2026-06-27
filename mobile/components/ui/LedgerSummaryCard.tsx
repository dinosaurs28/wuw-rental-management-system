import { StyleSheet, Text, View } from 'react-native';
import { Colors, Fonts } from '../../constants/colors';
import type { ReturnSession } from '../../types/api';

function inr(n: number) {
  return `₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export default function LedgerSummaryCard({ session }: { session: ReturnSession }) {
  const net = Number(session.netPayable);
  const entries = (session.entries ?? []).filter((e) => !e.isVoided);

  return (
    <View style={styles.card}>
      {entries.map((e) => {
        const amt = Number(e.amount);
        const credit = amt < 0; // payments / deposit credits are negative
        return (
          <View key={e.publicId} style={styles.row}>
            <Text style={styles.label} numberOfLines={2}>{e.description}</Text>
            <Text style={[styles.value, credit && styles.credit]}>
              {credit ? '−' : ''}{inr(amt)}
            </Text>
          </View>
        );
      })}

      <View style={styles.divider} />

      <View style={styles.row}>
        <Text style={styles.netLabel}>
          {net > 0 ? 'Amount payable' : net < 0 ? 'Refund due' : 'Settled'}
        </Text>
        <Text
          style={[
            styles.netValue,
            net < 0 && styles.credit,
            net === 0 && styles.balanced,
          ]}
        >
          {net === 0 ? '₹0' : `${net < 0 ? '−' : ''}${inr(net)}`}
        </Text>
      </View>
      {net === 0 && (
        <Text style={styles.note}>Security deposit covers all charges — nothing to collect.</Text>
      )}
      {net < 0 && (
        <Text style={styles.note}>Refund the difference to the customer to complete the return.</Text>
      )}
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
    gap: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, flex: 1 },
  value: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  credit: { color: '#10b981' },
  balanced: { color: Colors.ink3 },
  divider: { height: 1, backgroundColor: Colors.hairline },
  netLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  netValue: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  note: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17 },
});

import { StyleSheet, Text, View } from 'react-native';
import { Colors, Fonts } from '../../constants/colors';
import type { LedgerEntry, ReturnSession } from '../../types/api';
import { gstNumber, gstSplitText, inrExact, round2 } from '../../lib/gst';

// Paise shown when present: drop-line GST is rounded to the paisa (#23).
function inr(n: number) {
  return inrExact(n);
}

function EntryRow({ e }: { e: LedgerEntry }) {
  const amt = Number(e.amount);
  const credit = amt < 0; // discounts / payments / deposit credits are negative
  return (
    <View style={styles.row}>
      <Text style={styles.label} numberOfLines={2}>{e.description}</Text>
      <Text style={[styles.value, credit && styles.credit]}>
        {credit ? '−' : ''}{inr(amt)}
      </Text>
    </View>
  );
}

export default function LedgerSummaryCard({ session }: { session: ReturnSession }) {
  const net = Number(session.netPayable);
  const entries = (session.entries ?? []).filter((e) => !e.isVoided);
  // The bill reads charges (and discounts) → GST → deposit credit / payments.
  const charges = entries.filter((e) => e.classification !== 'PAYMENT');
  const payments = entries.filter((e) => e.classification === 'PAYMENT');

  // CGST / SGST as frozen on each taxable line; shown only when they add up to
  // the session's GST (sessions computed before the per-line split have none).
  const taxableLines = entries.filter((e) => e.classification === 'TAXABLE');
  const gst = gstNumber(session.gstAmount) ?? 0;
  const cgst = round2(taxableLines.reduce((s, e) => s + (gstNumber(e.cgst) ?? 0), 0));
  const sgst = round2(taxableLines.reduce((s, e) => s + (gstNumber(e.sgst) ?? 0), 0));
  const showSplit = gst > 0 && Math.abs(round2(cgst + sgst) - gst) < 0.005;
  const taxableBase = gstNumber(session.taxableBase);

  return (
    <View style={styles.card}>
      {charges.map((e) => <EntryRow key={e.publicId} e={e} />)}

      {/* Taxable lines carry their GST on top (netPayable includes it) */}
      {Number(session.gstAmount) > 0 && (
        <View style={styles.row}>
          <Text style={styles.label}>GST (CGST + SGST)</Text>
          <Text style={styles.value}>{inr(Number(session.gstAmount))}</Text>
        </View>
      )}
      {showSplit && (
        <Text style={styles.subNote}>
          {taxableBase != null && taxableBase > 0 ? `On ${inr(taxableBase)} taxable · ` : ''}
          {gstSplitText(cgst, sgst)}
        </Text>
      )}

      {payments.map((e) => <EntryRow key={e.publicId} e={e} />)}

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
  subNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, textAlign: 'right', marginTop: -6 },
});

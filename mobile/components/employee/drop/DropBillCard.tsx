import { StyleSheet, Text, View } from 'react-native';
import { Colors, Fonts } from '../../../constants/colors';
import { fmtIstShort, rentalMinutesLabel } from '../../../lib/dates';
import type { ReturnSession } from '../../../types/api';
import type {
  CompleteReturnResponse,
  DropBill,
  ReturnLateSummary,
  SwapChargePreview,
} from '../../../types/return';
import { inr2, num, pct } from './format';

// Drop bill with GST (#23): each line's taxable value and GST, then the
// discount (before GST), taxable value, CGST / SGST and the drop total; the
// session's credits (safety deposit, payments) take it to the amount payable.
// Taxable: extra km, late return, fuel, vehicle swap, other charges.
// Not taxable: damage compensation, FASTag / tolls.

function Row({
  label, value, strong, credit, sub,
}: { label: string; value: string; strong?: boolean; credit?: boolean; sub?: string | null }) {
  return (
    <View>
      <View style={styles.row}>
        <Text style={[styles.label, strong && styles.labelStrong]} numberOfLines={2}>{label}</Text>
        <Text style={[styles.value, strong && styles.valueStrong, credit && styles.credit]}>{value}</Text>
      </View>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
}

function lateNote(late: ReturnLateSummary | null | undefined): string | null {
  if (!late || late.lateMinutes <= 0) return null;
  const by = rentalMinutesLabel(late.lateMinutes);
  switch (late.status) {
    case 'WAIVED':
      return `Late return (${by}): ${inr2(num(late.waivedAmount))} waived${late.waiverReason ? ` — ${late.waiverReason}` : ''}.`;
    case 'WITHIN_GRACE':
      return `Returned ${by} late — within the grace period, no charge.`;
    case 'DISABLED':
      return `Returned ${by} late — late-return charges are off for this branch.`;
    case 'CHARGED':
      return `Late return measured to ${fmtIstShort(late.returnedAt)} (fixed for this bill).`;
    default:
      return null;
  }
}

export default function DropBillCard({
  bill,
  session,
  late,
}: {
  bill: DropBill;
  session: ReturnSession;
  late?: ReturnLateSummary | null;
}) {
  const net = num(session.netPayable);
  const credits = (session.entries ?? []).filter((e) => !e.isVoided && e.classification === 'PAYMENT');
  const hasTaxable = num(bill.taxableTotal) > 0;
  const note = lateNote(late);

  return (
    <View style={styles.card}>
      {bill.lines.length === 0 ? (
        <Text style={styles.sub}>No drop charges.</Text>
      ) : (
        bill.lines.map((line, i) => (
          <Row
            key={`${line.referenceType}:${line.referenceId ?? ''}:${i}`}
            label={line.label}
            value={inr2(num(line.amount))}
            sub={line.taxable ? `+ GST ${inr2(num(line.gst))} = ${inr2(num(line.total))}` : 'No GST'}
          />
        ))
      )}
      {note && <Text style={styles.note}>{note}</Text>}

      <View style={styles.divider} />

      <Row label="Subtotal (before GST)" value={inr2(num(bill.subtotal))} />
      {bill.discount && (
        <Row
          label="Discount (before GST)"
          value={`−${inr2(num(bill.discount.amount))}`}
          credit
          sub={num(bill.discount.gst) > 0 ? `Also takes ${inr2(num(bill.discount.gst))} GST off` : null}
        />
      )}
      {hasTaxable && (
        <>
          <Row label="Taxable value" value={inr2(num(bill.taxableValue))} />
          <Row
            label={`CGST${bill.gstRates ? ` ${pct(bill.gstRates.cgstRate)}` : ''}`}
            value={inr2(num(bill.cgst))}
          />
          <Row
            label={`SGST${bill.gstRates ? ` ${pct(bill.gstRates.sgstRate)}` : ''}`}
            value={inr2(num(bill.sgst))}
          />
        </>
      )}
      {num(bill.nonTaxableValue) > 0 && (
        <Row label="Not taxable (damage, tolls)" value={inr2(num(bill.nonTaxableValue))} />
      )}
      <Row label="Drop charges" value={inr2(num(bill.total))} strong />

      {credits.length > 0 && (
        <>
          <View style={styles.divider} />
          {credits.map((e) => {
            const amt = num(e.amount);
            return (
              <Row
                key={e.publicId}
                label={e.description}
                value={`${amt < 0 ? '−' : ''}${inr2(amt)}`}
                credit={amt < 0}
              />
            );
          })}
        </>
      )}

      <View style={styles.divider} />

      <View style={styles.row}>
        <Text style={styles.netLabel}>
          {net > 0 ? 'Amount payable' : net < 0 ? 'Refund due' : 'Settled'}
        </Text>
        <Text style={[styles.netValue, net < 0 && styles.credit, net === 0 && styles.balanced]}>
          {net === 0 ? '₹0' : `${net < 0 ? '−' : ''}${inr2(net)}`}
        </Text>
      </View>
      {net === 0 && (
        <Text style={styles.sub}>Security deposit covers all charges — nothing to collect.</Text>
      )}
      {net < 0 && (
        <Text style={styles.sub}>Refund the difference to the customer to complete the return.</Text>
      )}
    </View>
  );
}

// Vehicle-swap differences (#13) staff chose to bill at the swap — previewed
// before the drop bill is computed.
export function SwapChargesCard({ charges, legacy }: { charges: SwapChargePreview[]; legacy: boolean }) {
  if (charges.length === 0) return null;
  return (
    <>
      <Text style={styles.sectionHeader}>Vehicle Swap</Text>
      <View style={styles.card}>
        {charges.map((c) => (
          <Row
            key={c.swapPublicId}
            label={c.label}
            value={inr2(num(c.taxable))}
            sub={c.gst != null && c.total != null
              ? `+ GST ${inr2(num(c.gst))} = ${inr2(num(c.total))} · swapped ${fmtIstShort(c.swappedAt)}`
              : `+ GST (branch GST rule missing) · swapped ${fmtIstShort(c.swappedAt)}`}
          />
        ))}
        <Text style={styles.sub}>
          {legacy
            ? 'Recorded with GST when you complete the return — the branch manager collects it.'
            : 'Added to the drop bill as a taxable line.'}
        </Text>
      </View>
    </>
  );
}

// Legacy drop (no Unified Payments): what the server billed for the branch
// manager to collect, shown after the return completes.
export function LegacyReturnChargesCard({ result }: { result: CompleteReturnResponse }) {
  const charges = result.returnCharges;
  const lines = charges?.lines ?? [];
  const late = result.late ?? null;
  const lateUnbilled = late != null && late.lateMinutes > 0 && late.status === 'RATE_UNAVAILABLE';
  const lateWaived = late != null && late.status === 'WAIVED';
  if (lines.length === 0 && !lateUnbilled && !lateWaived) return null;

  return (
    <View style={[styles.card, styles.fullWidth]}>
      {lines.length > 0 && (
        <>
          <Text style={styles.cardTitle}>Return charges</Text>
          {lines.map((l, i) => (
            <Row
              key={`${l.type}:${i}`}
              label={l.label}
              value={inr2(num(l.amount))}
              sub={l.taxable ? `+ GST ${inr2(num(l.gst))} = ${inr2(num(l.total))}` : 'No GST'}
            />
          ))}
          <View style={styles.divider} />
          <Row label="Total (incl. GST)" value={inr2(num(charges?.total))} strong />
          <Text style={styles.sub}>Collected by the branch manager.</Text>
        </>
      )}
      {lateUnbilled && (
        <Text style={styles.note}>
          Late return ({rentalMinutesLabel(late!.lateMinutes)}) wasn't billed — the vehicle has no extra-hour rate set.
        </Text>
      )}
      {lateWaived && (
        <Text style={styles.note}>
          Late charge of {inr2(num(late!.waivedAmount))} waived{late!.waiverReason ? ` — ${late!.waiverReason}` : ''}.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8, marginBottom: 4 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 16,
    gap: 10,
    marginBottom: 4,
  },
  fullWidth: { alignSelf: 'stretch' },
  cardTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, flex: 1 },
  labelStrong: { fontFamily: Fonts.bodySemiBold, color: Colors.ink },
  value: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  valueStrong: { fontFamily: Fonts.bodySemiBold, fontSize: 15 },
  sub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17, marginTop: 2 },
  note: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink2, lineHeight: 17 },
  credit: { color: '#10b981' },
  balanced: { color: Colors.ink3 },
  divider: { height: 1, backgroundColor: Colors.hairline },
  netLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  netValue: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
});

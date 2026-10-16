import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';

// Manual pickup discount: a flat ₹ off the rent payable at pickup (GST
// included, never the safety deposit). Same look as the drop discount.

const inr = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Typed amount → the problem with it, or null. `max` null = the server decides. */
export function pickupDiscountInputError(text: string, max: number | null): string | null {
  const t = text.trim();
  if (!t) return 'Enter the discount amount.';
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'Enter the discount in ₹ with up to 2 decimals.';
  const amount = Number(t);
  if (!(amount > 0)) return 'The discount must be more than ₹0.';
  if (max != null && amount > max + 1e-9) return `The discount can't be more than the rental balance payable at pickup (${inr(max)}).`;
  return null;
}

/** Keeps digits and one decimal point with at most 2 decimals. */
export function cleanDiscountInput(text: string): string {
  const cleaned = text.replace(/[^\d.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
}

interface Props {
  /** The discount on the bill now (null = none) */
  applied: { amount: number; reason: string | null } | null;
  /** The most it may be (rent payable at pickup, after a coupon); null = unknown */
  max: number | null;
  /** What the customer pays with the discount taken off */
  finalPayable: number;
  open: boolean;
  setOpen: (open: boolean) => void;
  amount: string;
  setAmount: (v: string) => void;
  reason: string;
  setReason: (v: string) => void;
  error: string | null;
  setError: (v: string | null) => void;
  busy: boolean;
  applying: boolean;
  removing: boolean;
  onApply: (amount: number, reason: string | null) => void;
  onRemove: () => void;
}

export default function PickupDiscountCard(p: Props) {
  // Nothing payable for the rent: nothing to discount
  if (!p.applied && p.max != null && p.max <= 0) return null;

  const openForm = () => {
    p.setAmount(p.applied ? String(p.applied.amount) : '');
    p.setReason(p.applied?.reason ?? '');
    p.setError(null);
    p.setOpen(true);
  };
  const apply = () => {
    const problem = pickupDiscountInputError(p.amount, p.max);
    if (problem) {
      p.setError(problem);
      return;
    }
    p.onApply(Number(p.amount.trim()), p.reason.trim() || null);
  };

  if (p.open) {
    return (
      <View style={[styles.card, { marginTop: 8 }]}>
        <Text style={styles.fieldLabel}>Discount (₹)</Text>
        <Text style={styles.hint}>
          A flat amount off the rent (GST included){p.max != null ? `, up to ${inr(p.max)}` : ''}. It never comes off the safety deposit.
        </Text>
        <TextInput
          style={styles.input}
          value={p.amount}
          onChangeText={(t) => { p.setAmount(cleanDiscountInput(t)); p.setError(null); }}
          placeholder="0"
          placeholderTextColor={Colors.ink4}
          keyboardType="decimal-pad"
        />
        <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Reason (optional)</Text>
        <TextInput
          style={[styles.input, styles.reasonInput]}
          value={p.reason}
          onChangeText={(t) => { p.setReason(t); p.setError(null); }}
          placeholder="Why is the customer getting a discount?"
          placeholderTextColor={Colors.ink4}
          maxLength={200}
          multiline
        />
        {p.error && <Text style={styles.fieldError}>{p.error}</Text>}
        <View style={[styles.methodRow, { marginTop: 12 }]}>
          <TouchableOpacity
            style={styles.methodBtn}
            onPress={() => { p.setOpen(false); p.setError(null); }}
            disabled={p.busy}
            activeOpacity={0.8}
          >
            <Text style={styles.methodText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.methodBtn, styles.methodBtnActive, p.busy && styles.btnDisabled]}
            onPress={apply}
            disabled={p.busy}
            activeOpacity={0.8}
          >
            {p.applying ? <ActivityIndicator size="small" color={Colors.white} /> : (
              <Text style={[styles.methodText, styles.methodTextActive]}>Apply discount</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (p.applied) {
    return (
      <View style={[styles.card, { marginTop: 8 }]}>
        <View style={styles.row}>
          <Text style={styles.label}>Total charges</Text>
          <Text style={styles.value}>{inr(p.finalPayable + p.applied.amount)}</Text>
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Discount</Text>
            {!!p.applied.reason && <Text style={styles.sub} numberOfLines={2}>{p.applied.reason}</Text>}
          </View>
          <Text style={[styles.value, styles.credit]}>−{inr(p.applied.amount)}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.netLabel}>Final payable</Text>
          <Text style={styles.netValue}>{inr(Math.max(0, p.finalPayable))}</Text>
        </View>
        <View style={[styles.linkRow, { marginTop: 4 }]}>
          <TouchableOpacity onPress={openForm} disabled={p.busy} hitSlop={8}>
            <Text style={styles.link}>Edit discount</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={p.onRemove} disabled={p.busy} hitSlop={8}>
            {p.removing ? <ActivityIndicator size="small" color="#dc3545" /> : <Text style={styles.linkDanger}>Remove</Text>}
          </TouchableOpacity>
        </View>
        {p.error && <Text style={styles.fieldError}>{p.error}</Text>}
      </View>
    );
  }

  return (
    <>
      <TouchableOpacity
        style={[styles.addBtn, { marginTop: 8 }, p.busy && styles.btnDisabled]}
        onPress={openForm}
        disabled={p.busy}
        activeOpacity={0.85}
      >
        <Ionicons name="pricetag-outline" size={18} color={Colors.ink2} />
        <Text style={styles.addBtnText}>Add discount</Text>
        <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />
      </TouchableOpacity>
      {p.error && <Text style={styles.fieldError}>{p.error}</Text>}
    </>
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
  },
  fieldLabel: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3, marginBottom: 6 },
  hint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17, marginBottom: 8 },
  input: {
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 18,
    color: Colors.ink,
  },
  reasonInput: { minHeight: 64, textAlignVertical: 'top', fontFamily: Fonts.body, fontSize: 15 },
  fieldError: { fontFamily: Fonts.body, fontSize: 12, color: '#e53e3e', marginTop: 8 },
  methodRow: { flexDirection: 'row', gap: 8 },
  methodBtn: { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline },
  methodBtnActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  methodText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink3 },
  methodTextActive: { color: Colors.white },
  btnDisabled: { opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 },
  label: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },
  sub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink4, marginTop: 1 },
  value: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  credit: { color: '#10b981' },
  divider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 4, marginBottom: 8 },
  netLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  netValue: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  link: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.orange },
  linkDanger: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: '#dc3545' },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 4,
  },
  addBtnText: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink2 },
});

import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import {
  SAFETY_DEPOSIT_HANDLING,
  SAFETY_DEPOSIT_HANDLING_LABELS,
  inrCounter,
  type DropDeposit,
  type SafetyDepositHandling,
} from '../../lib/counterPayment';

// Safety deposit at drop (#6): the deposit taken at pickup is either set off
// against the drop charges (default — any remainder is refunded) or refunded
// in full with the charges collected on their own. On a drop bill the split
// comes from the server's compute (`deposit`); legacy branches record the
// choice and the branch manager settles it.

const HELP: Record<SafetyDepositHandling, string> = {
  SET_OFF: 'The deposit pays the drop charges; anything left over is refunded.',
  REFUND_IN_FULL: 'The whole deposit goes back; the drop charges are collected separately.',
};

const num = (x: unknown) => Number(x ?? 0) || 0;

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'good' | 'warn' }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && styles.rowLabelStrong]}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          strong && styles.rowValueStrong,
          tone === 'good' && { color: Colors.availGood },
          tone === 'warn' && { color: Colors.availLow },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

export default function SafetyDepositAtDrop({
  held,
  handling,
  onChange,
  deposit,
  legacy = false,
  disabled = false,
}: {
  /** Deposit held (taken at pickup, not yet credited back). */
  held: number;
  handling: SafetyDepositHandling;
  onChange: (next: SafetyDepositHandling) => void;
  /** The computed split once the drop bill exists. */
  deposit?: DropDeposit | null;
  /** No drop bill: the branch manager settles the deposit with the return charges. */
  legacy?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="shield-checkmark-outline" size={16} color={Colors.availGood} />
        <Text style={styles.title}>Safety deposit</Text>
        <Text style={styles.held}>{inrCounter(held)} held</Text>
      </View>

      <View style={styles.options}>
        {SAFETY_DEPOSIT_HANDLING.map((h) => {
          const active = h === handling;
          return (
            <TouchableOpacity
              key={h}
              style={[styles.option, active && styles.optionActive, disabled && !active && styles.dim]}
              onPress={() => !active && onChange(h)}
              disabled={disabled}
              activeOpacity={0.85}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled }}
            >
              <Ionicons
                name={active ? 'radio-button-on' : 'radio-button-off'}
                size={18}
                color={active ? Colors.orange : Colors.ink4}
              />
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>
                  {SAFETY_DEPOSIT_HANDLING_LABELS[h]}
                  {h === 'SET_OFF' ? <Text style={styles.defaultTag}>  Default</Text> : null}
                </Text>
                <Text style={styles.optionHelp}>{HELP[h]}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {deposit && num(deposit.held) > 0 ? (
        <View style={styles.summary}>
          <Row label="Deposit held" value={inrCounter(num(deposit.held))} />
          {deposit.handling === 'SET_OFF' && (
            <Row label="Used against charges" value={inrCounter(num(deposit.setOff))} />
          )}
          <Row
            label="Refund to customer"
            value={inrCounter(num(deposit.refund))}
            tone={num(deposit.refund) > 0 ? 'good' : undefined}
          />
          <Row
            label="To collect"
            value={inrCounter(num(deposit.toCollect))}
            strong
            tone={num(deposit.toCollect) > 0 ? 'warn' : undefined}
          />
        </View>
      ) : legacy ? (
        <Text style={styles.note}>The branch manager settles the deposit with the return charges.</Text>
      ) : (
        <Text style={styles.note}>Applied when the charges are computed.</Text>
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
    gap: 12,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  held: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.availGood },
  options: { gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    backgroundColor: Colors.bg,
    padding: 12,
  },
  optionActive: { borderColor: Colors.orange, backgroundColor: Colors.orangeSoft },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  defaultTag: { fontFamily: Fonts.bodyMedium, fontSize: 11, color: Colors.ink3 },
  optionHelp: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17 },
  dim: { opacity: 0.5 },
  summary: { gap: 6, borderTopWidth: 1, borderTopColor: Colors.hairline, paddingTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  rowLabelStrong: { fontFamily: Fonts.bodySemiBold, color: Colors.ink },
  rowValue: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  rowValueStrong: { fontFamily: Fonts.bodySemiBold, fontSize: 15 },
  note: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17 },
});

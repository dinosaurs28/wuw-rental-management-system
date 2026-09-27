import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Colors, Fonts } from '../../constants/colors';
import { cleanUtr, isValidUtr } from '../../lib/counterErrors';

interface Props {
  value: string;
  onChangeText: (utr: string) => void;
  /** Server-side error to show under the field (e.g. duplicate UTR). */
  error?: string;
}

/**
 * The 12-digit UPI UTR field used wherever staff take a UPI payment at the
 * counter. No screenshot is needed — the UTR is the proof.
 */
export default function UtrInput({ value, onChangeText, error }: Props) {
  const digits = cleanUtr(value);
  const showFormatHint = digits.length > 0 && !isValidUtr(value);

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>UTR number</Text>
      <TextInput
        style={[styles.input, (error || showFormatHint) && styles.inputError]}
        value={value}
        onChangeText={(t) => onChangeText(t.replace(/[^\d\s-]/g, ''))}
        placeholder="12-digit UTR from the customer's UPI app"
        placeholderTextColor={Colors.ink4}
        keyboardType="number-pad"
        maxLength={16}
        autoCorrect={false}
      />
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : showFormatHint ? (
        <Text style={styles.error}>UTR must be exactly 12 digits ({digits.length}/12)</Text>
      ) : (
        <Text style={styles.hint}>No screenshot needed — the UTR is the proof of payment.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginTop: 10 },
  label: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink2,
    marginBottom: 6,
  },
  input: {
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    letterSpacing: 1,
    color: Colors.ink,
  },
  inputError: { borderColor: Colors.availNone },
  hint: { marginTop: 6, fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  error: { marginTop: 6, fontFamily: Fonts.body, fontSize: 12, color: Colors.availNone },
});

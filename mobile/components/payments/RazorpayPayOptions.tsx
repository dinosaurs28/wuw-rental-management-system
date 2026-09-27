import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { useHasUpiApp, type CheckoutMode } from '../../lib/razorpay';

export const NO_UPI_APP_NOTE =
  'No UPI app on this phone — let the customer scan the QR with their phone.';

interface Props {
  /** Label of the regular Razorpay button, e.g. "Confirm & pay". */
  payLabel: string;
  qrLabel?: string;
  /** Called with the Checkout mode the user picked. */
  onPay: (mode: CheckoutMode) => void;
  /** Right-aligned text on the first (primary) button, e.g. the amount. */
  trailing?: string;
  disabled?: boolean;
  /** The option currently in flight: shows its spinner and locks both. */
  busyMode?: CheckoutMode | null;
  /** Shown next to the spinner, e.g. "Verifying…". */
  busyLabel?: string;
  /** Replaces the default no-UPI-app note (e.g. on the customer's own phone). */
  noUpiNote?: string;
  /** Per-screen shape tweaks applied to both buttons (radius, height…). */
  buttonStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}

/**
 * Every Razorpay pay button: the normal sheet plus "Scan QR to pay". On a phone
 * with no UPI app the QR option comes first, since the sheet's UPI-app flow
 * can't complete there.
 */
export default function RazorpayPayOptions({
  payLabel,
  qrLabel = 'Scan QR to pay',
  onPay,
  trailing,
  disabled = false,
  busyMode = null,
  busyLabel,
  noUpiNote = NO_UPI_APP_NOTE,
  buttonStyle,
  style,
}: Props) {
  const hasUpi = useHasUpiApp();
  const qrFirst = hasUpi === false;
  const order: CheckoutMode[] = qrFirst ? ['qr', 'default'] : ['default', 'qr'];
  const locked = disabled || !!busyMode;

  return (
    <View style={[styles.wrap, style]}>
      {qrFirst && (
        <View style={styles.note}>
          <Ionicons name="information-circle-outline" size={16} color={Colors.availLow} />
          <Text style={styles.noteText}>{noUpiNote}</Text>
        </View>
      )}
      {order.map((mode, i) => {
        const primary = i === 0;
        const busy = busyMode === mode;
        const fg = primary ? Colors.white : Colors.ink;
        const showTrailing = primary && !!trailing;
        return (
          <TouchableOpacity
            key={mode}
            style={[
              styles.btn,
              primary ? styles.btnPrimary : styles.btnSecondary,
              showTrailing && styles.btnSplit,
              buttonStyle,
              locked && !busy && styles.btnDisabled,
            ]}
            onPress={() => onPay(mode)}
            disabled={locked}
            activeOpacity={0.85}
          >
            {busy ? (
              <View style={[styles.inner, styles.innerBusy]}>
                <ActivityIndicator size="small" color={fg} />
                {busyLabel ? <Text style={[styles.label, styles.busyLabel, { color: fg }]}>{busyLabel}</Text> : null}
              </View>
            ) : (
              <>
                <View style={styles.inner}>
                  <Ionicons name={mode === 'qr' ? 'qr-code-outline' : 'card-outline'} size={17} color={fg} />
                  <Text style={[styles.label, { color: fg }]}>{mode === 'qr' ? qrLabel : payLabel}</Text>
                </View>
                {showTrailing && <Text style={[styles.trailing, { color: fg }]}>{trailing}</Text>}
              </>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.availLowSoft,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noteText: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 12, lineHeight: 17, color: '#92400e' },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 20,
    minHeight: 50,
  },
  btnSplit: { justifyContent: 'space-between' },
  btnPrimary: { backgroundColor: Colors.orange },
  btnSecondary: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.hairline },
  btnDisabled: { opacity: 0.5 },
  inner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  innerBusy: { flexShrink: 1 },
  label: { fontFamily: Fonts.bodySemiBold, fontSize: 15, letterSpacing: 0.1 },
  busyLabel: { flexShrink: 1, fontSize: 14 },
  trailing: { fontFamily: Fonts.displayBold, fontSize: 18 },
});

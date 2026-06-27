import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { resolveTemplate, whatsappUrl } from '../../constants/links';
import { useWhatsAppConfig } from '../../hooks/useWhatsAppConfig';

interface Props {
  // Variables substituted into the configured {{token}} message template.
  variables?: Record<string, string | number>;
  label?: string;
  // 'card' = full-width row (settings/contact), 'pill' = compact inline button.
  variant?: 'card' | 'pill';
}

const WA_GREEN = '#25D366';

export default function WhatsAppSupportButton({ variables, label, variant = 'card' }: Props) {
  const { data: config, isLoading } = useWhatsAppConfig();

  // Mirror web: render nothing while loading or when disabled/missing.
  if (isLoading || !config || !config.isEnabled || !config.phoneNumber) return null;

  const open = () => {
    const message = resolveTemplate(config.messageTemplate ?? '', variables);
    Linking.openURL(whatsappUrl(config.phoneNumber, message)).catch(() => {});
  };

  if (variant === 'pill') {
    return (
      <TouchableOpacity style={styles.pill} onPress={open} activeOpacity={0.85}>
        <Ionicons name="logo-whatsapp" size={16} color={WA_GREEN} />
        <Text style={styles.pillText}>{label ?? 'WhatsApp'}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={styles.card} onPress={open} activeOpacity={0.85}>
      <View style={styles.iconWrap}>
        <Ionicons name="logo-whatsapp" size={20} color={WA_GREEN} />
      </View>
      <View style={styles.cardText}>
        <Text style={styles.cardTitle}>{label ?? 'Chat with us on WhatsApp'}</Text>
        <Text style={styles.cardSub}>Quick replies during business hours</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={Colors.ink4} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#e8fbef',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1 },
  cardTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  cardSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 2 },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#e8fbef',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#25D36633',
  },
  pillText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: '#128C3E' },
});

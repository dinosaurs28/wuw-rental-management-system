import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../constants/colors';
import { CONTACT, whatsappUrl } from '../constants/links';
import WhatsAppSupportButton from '../components/ui/WhatsAppSupportButton';
import { useWhatsAppConfig } from '../hooks/useWhatsAppConfig';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function Row({
  icon,
  label,
  value,
  onPress,
}: {
  icon: IoniconName;
  label: string;
  value: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={!onPress} activeOpacity={0.8}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={18} color={Colors.orange} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
      {onPress && <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />}
    </TouchableOpacity>
  );
}

export default function Contact() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: waConfig } = useWhatsAppConfig();
  const waEnabled = !!waConfig && waConfig.isEnabled && !!waConfig.phoneNumber;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Help & Contact</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>We're here to help. Reach {CONTACT.businessName} any day of the week.</Text>

        <Text style={styles.sectionTitle}>Get in touch</Text>
        <View style={styles.card}>
          {CONTACT.phones.map((p, i) => (
            <Row
              key={p.tel}
              icon="call-outline"
              label={i === 0 ? 'Call us' : 'Alternate line'}
              value={p.display}
              onPress={() => Linking.openURL(p.tel)}
            />
          ))}
        </View>

        <View style={{ marginTop: 12 }}>
          {waEnabled ? (
            <WhatsAppSupportButton label="Chat with us on WhatsApp" />
          ) : (
            <View style={styles.card}>
              <Row
                icon="logo-whatsapp"
                label="WhatsApp"
                value="Chat with us on WhatsApp"
                onPress={() => Linking.openURL(whatsappUrl(CONTACT.whatsappFallback))}
              />
            </View>
          )}
        </View>

        <Text style={styles.sectionTitle}>Visit us</Text>
        <View style={styles.card}>
          <Row
            icon="location-outline"
            label="Address"
            value={`${CONTACT.address.line1} ${CONTACT.address.line2}, ${CONTACT.address.cityPin}`}
            onPress={() => Linking.openURL(CONTACT.map.url)}
          />
          <Row icon="time-outline" label={CONTACT.hours.days} value={CONTACT.hours.time} />
        </View>

        <TouchableOpacity style={styles.mapBtn} onPress={() => Linking.openURL(CONTACT.map.url)} activeOpacity={0.85}>
          <Ionicons name="map-outline" size={18} color={Colors.white} />
          <Text style={styles.mapBtnText}>Open in Maps</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink, letterSpacing: -0.3 },
  scroll: { paddingHorizontal: 20, paddingTop: 16 },
  intro: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, lineHeight: 21, marginBottom: 8 },
  sectionTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 10,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.orangeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowLabel: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3, marginBottom: 2 },
  rowValue: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink },
  mapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    backgroundColor: Colors.ink,
    borderRadius: 14,
    paddingVertical: 15,
  },
  mapBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white },
});

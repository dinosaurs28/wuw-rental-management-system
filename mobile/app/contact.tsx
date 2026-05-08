import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../constants/colors';

const ADDRESS_LINE_1 = 'No. 16, Anath Nagar 1st Stage,';
const ADDRESS_LINE_2 = 'Near Syndicate Circle';
const ADDRESS_CITY = 'Manipal - 576104';
const PHONE_PRIMARY = '+918000800469';
const PHONE_SECONDARY = '+918000800468';
const HOURS_LABEL = 'All Days of the Week';
const HOURS_VALUE = '8:00 AM – 11:00 PM';
const MAPS_QUERY = 'What U Want Rentals, Manipal';

const WHATSAPP_NUMBER = (process.env.EXPO_PUBLIC_WHATSAPP_NUMBER ?? '').replace(/\D/g, '');

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

async function openLink(url: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Unable to open', 'Please try again later.');
  }
}

function ContactCard({
  icon,
  iconBg,
  iconColor,
  label,
  title,
  subtitle,
  onPress,
  cta,
}: {
  icon: IoniconName;
  iconBg?: string;
  iconColor?: string;
  label: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  cta?: string;
}) {
  const Wrap: any = onPress ? TouchableOpacity : View;
  return (
    <Wrap
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={[styles.cardIcon, { backgroundColor: iconBg ?? Colors.black }]}>
        <Ionicons name={icon} size={18} color={iconColor ?? Colors.white} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardLabel}>{label}</Text>
        <Text style={styles.cardTitle}>{title}</Text>
        {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
        {cta ? (
          <View style={styles.ctaPill}>
            <Text style={styles.ctaPillText}>{cta}</Text>
          </View>
        ) : null}
      </View>
      {onPress ? (
        <Ionicons name="chevron-forward" size={16} color={Colors.ink3} />
      ) : null}
    </Wrap>
  );
}

export default function ContactScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleWhatsApp = async () => {
    if (!WHATSAPP_NUMBER) {
      Alert.alert('WhatsApp not configured');
      return;
    }
    const text = encodeURIComponent('Hi, I need help with my booking');
    const appUrl = `whatsapp://send?phone=${WHATSAPP_NUMBER}&text=${text}`;
    const webUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${text}`;
    try {
      const supported = await Linking.canOpenURL(appUrl);
      await Linking.openURL(supported ? appUrl : webUrl);
    } catch {
      Alert.alert('Unable to open WhatsApp');
    }
  };

  const handleMaps = () => {
    const q = encodeURIComponent(MAPS_QUERY);
    const url = `https://www.google.com/maps/search/?api=1&query=${q}`;
    openLink(url);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Get in touch</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          We're here to help. Reach out for bookings, inquiries, or anything else.
        </Text>

        <ContactCard
          icon="location-outline"
          label="Location"
          title={`${ADDRESS_LINE_1}\n${ADDRESS_LINE_2}`}
          subtitle={ADDRESS_CITY}
          onPress={handleMaps}
          cta="Open in Maps"
        />

        <ContactCard
          icon="call-outline"
          label="Phone"
          title={PHONE_PRIMARY}
          subtitle={PHONE_SECONDARY}
          onPress={() => openLink(`tel:${PHONE_PRIMARY}`)}
        />

        <ContactCard
          icon="logo-whatsapp"
          iconBg="#25D366"
          iconColor={Colors.white}
          label="WhatsApp"
          title={WHATSAPP_NUMBER ? 'Chat with us on WhatsApp' : 'WhatsApp not configured'}
          subtitle={WHATSAPP_NUMBER ? 'Quick replies during business hours' : undefined}
          onPress={WHATSAPP_NUMBER ? handleWhatsApp : undefined}
          cta={WHATSAPP_NUMBER ? 'Open WhatsApp' : undefined}
        />

        <ContactCard
          icon="time-outline"
          label="Business Hours"
          title={HOURS_VALUE}
          subtitle={HOURS_LABEL}
        />
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
    backgroundColor: Colors.bg,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    fontFamily: Fonts.display,
    fontSize: 18,
    color: Colors.ink,
    letterSpacing: -0.3,
  },
  scroll: { paddingHorizontal: 20, paddingTop: 20, gap: 12 },
  intro: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink3,
    lineHeight: 20,
    marginBottom: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  cardIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: 2 },
  cardLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  cardTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
    lineHeight: 20,
  },
  cardSubtitle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink3,
    marginTop: 2,
  },
  ctaPill: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.black,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 10,
  },
  ctaPillText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.white,
  },
});

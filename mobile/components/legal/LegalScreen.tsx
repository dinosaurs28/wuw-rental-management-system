import {
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';

const RAW_BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000') as string;
// Strip a trailing /api segment if present so we can target static html on the host.
const WEB_BASE = RAW_BASE.replace(/\/api\/?$/, '').replace(/\/$/, '');

export interface LegalScreenProps {
  title: string;
  subtitle: string;
  htmlPath: string; // e.g. "/legal/terms.html"
}

export default function LegalScreen({ title, subtitle, htmlPath }: LegalScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const url = `${WEB_BASE}${htmlPath}`;

  const open = async () => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Unable to open', 'Please check your connection and try again.');
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.iconWrap}>
          <Ionicons name="document-text-outline" size={32} color={Colors.orange} />
        </View>
        <Text style={styles.bodyTitle}>{title}</Text>
        <Text style={styles.bodySubtitle}>{subtitle}</Text>
        <TouchableOpacity style={styles.cta} onPress={open} activeOpacity={0.85}>
          <Ionicons name="open-outline" size={16} color={Colors.white} />
          <Text style={styles.ctaText}>Open in browser</Text>
        </TouchableOpacity>
        <Text style={styles.urlText} numberOfLines={1} ellipsizeMode="middle">
          {url}
        </Text>
      </View>
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
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.display,
    fontSize: 18,
    color: Colors.ink,
    letterSpacing: -0.3,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: '#ff6a1f0e',
    borderWidth: 1,
    borderColor: '#ff6a1f20',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  bodyTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 22,
    color: Colors.ink,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  bodySubtitle: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink3,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.black,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 999,
    marginTop: 8,
  },
  ctaText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
  urlText: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.ink4,
    marginTop: 16,
    maxWidth: 260,
  },
});

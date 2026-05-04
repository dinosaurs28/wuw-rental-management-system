import {
  Dimensions,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../constants/colors';

const { height } = Dimensions.get('window');
const CAR = require('../../assets/hero-car.png');

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <LinearGradient
        colors={['#0a0a0a', '#111111', '#0a0a0a']}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Subtle ambient glow behind hero */}
      <View style={styles.ambientGlow} />

      <View style={[styles.content, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 28 }]}>

        {/* Logo */}
        <View style={styles.logoRow}>
          <Text style={styles.logo}>WUW</Text>
          <View style={styles.logoDot} />
        </View>

        {/* Hero card — white editorial card */}
        <View style={styles.heroWrapper}>
          <View style={styles.heroCard}>
            <Image
              source={CAR}
              style={styles.carImage}
              resizeMode="contain"
            />
            {/* Bottom gradient overlay for text */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.7)']}
              style={styles.cardOverlay}
            />
            <View style={styles.cardLabel}>
              <Text style={styles.cardLabelText}>✦  Premium Fleet</Text>
            </View>
          </View>

          {/* Floating pill */}
          <View style={styles.floatingPill}>
            <Text style={styles.floatingPillText}>White-Glove Service</Text>
          </View>
        </View>

        {/* Headline */}
        <View style={styles.headlineBlock}>
          <Text style={styles.headline}>
            Drive what{'\n'}
            <Text style={styles.italicOrange}>you want.</Text>
          </Text>
          <Text style={styles.sub}>
            Curated fleet. Delivered to you.{'\n'}Reserved just for you.
          </Text>
        </View>

        {/* CTAs */}
        <View style={styles.ctas}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.push('/(auth)/sign-up')}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>Get started</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={() => router.push('/(auth)/sign-in')}
            activeOpacity={0.8}
          >
            <Text style={styles.ghostBtnText}>I already have an account</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.staffLink}
            onPress={() => router.push('/(auth)/employee-sign-in')}
            activeOpacity={0.6}
          >
            <Text style={styles.staffLinkText}>Staff Portal</Text>
          </TouchableOpacity>
        </View>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.black },

  ambientGlow: {
    position: 'absolute',
    top: height * 0.18,
    left: '10%',
    right: '10%',
    height: height * 0.28,
    borderRadius: 999,
    backgroundColor: Colors.orange,
    opacity: 0.06,
  },

  content: {
    flex: 1,
    paddingHorizontal: 24,
    gap: 26,
  },

  /* Logo */
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  logo: {
    fontFamily: Fonts.displayBold,
    fontSize: 32,
    color: Colors.white,
    letterSpacing: -3,
  },
  logoDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.orange,
    marginTop: 2,
  },

  /* Hero */
  heroWrapper: { position: 'relative' },
  heroCard: {
    height: height * 0.30,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#0d0d0d',
  },
  carImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  cardOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 56,
  },
  cardLabel: {
    position: 'absolute',
    bottom: 14,
    left: 16,
  },
  cardLabelText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.8,
  },
  floatingPill: {
    position: 'absolute',
    bottom: -15,
    right: 18,
    backgroundColor: Colors.orange,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 8,
  },
  floatingPillText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.white,
    letterSpacing: 0.3,
  },

  /* Headline */
  headlineBlock: { gap: 10 },
  headline: {
    fontFamily: Fonts.display,
    fontSize: 46,
    color: Colors.white,
    lineHeight: 54,
    letterSpacing: -1.8,
  },
  italicOrange: {
    fontFamily: Fonts.displayItalic,
    color: Colors.orange,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 22,
  },

  /* CTAs */
  ctas: { gap: 12 },
  staffLink: { alignItems: 'center', paddingTop: 4 },
  staffLinkText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: 'rgba(255,255,255,0.2)',
    letterSpacing: 0.5,
  },
  primaryBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 999,
    paddingVertical: 17,
    alignItems: 'center',
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 6,
  },
  primaryBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
    letterSpacing: 0.2,
  },
  ghostBtn: {
    borderRadius: 999,
    paddingVertical: 17,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  ghostBtnText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 15,
    color: 'rgba(255,255,255,0.5)',
  },
});

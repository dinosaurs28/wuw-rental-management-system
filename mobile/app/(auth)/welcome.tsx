import {
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient as SvgGradient,
  Polygon,
  RadialGradient as SvgRadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';

const { width } = Dimensions.get('window');
const PAPER = '#f4f1ea';
const MONO = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = insets.top;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* ─── Road SVG ─── */}
      <View style={styles.road}>
        <Svg
          width={width}
          height="100%"
          viewBox="0 0 320 640"
          preserveAspectRatio="xMidYMid slice"
        >
          <Defs>
            {/* Road: warm amber at horizon, fades to black */}
            <SvgGradient id="rd" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%"   stopColor="#0a0908" stopOpacity="1" />
              <Stop offset="100%" stopColor="#000000" stopOpacity="1" />
            </SvgGradient>
            {/* Road horizon fade: mountain colour → transparent */}
            <SvgGradient id="roadFade" x1="0" y1="260" x2="0" y2="400" gradientUnits="userSpaceOnUse">
              <Stop offset="0%"   stopColor="#0a0908" stopOpacity="1" />
              <Stop offset="100%" stopColor="#0a0908" stopOpacity="0" />
            </SvgGradient>
            {/* Road lines: transparent at horizon → opaque lower */}
            <SvgGradient id="lineGrad" x1="0" y1="260" x2="0" y2="640" gradientUnits="userSpaceOnUse">
              <Stop offset="0%"   stopColor="#f4f1ea" stopOpacity="0"    />
              <Stop offset="35%"  stopColor="#f4f1ea" stopOpacity="0.6"  />
              <Stop offset="100%" stopColor="#f4f1ea" stopOpacity="0.85" />
            </SvgGradient>
            {/* Sky: deep indigo night → warm sunrise at horizon */}
            <SvgGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%"   stopColor="#04040e" stopOpacity="1" />
              <Stop offset="28%"  stopColor="#08071c" stopOpacity="1" />
              <Stop offset="52%"  stopColor="#0d0b26" stopOpacity="1" />
              <Stop offset="68%"  stopColor="#1e0e20" stopOpacity="1" />
              <Stop offset="80%"  stopColor="#2a0e04" stopOpacity="1" />
              <Stop offset="91%"  stopColor="#3d1a00" stopOpacity="1" />
              <Stop offset="100%" stopColor="#1a0900" stopOpacity="1" />
            </SvgGradient>
            {/* Sun corona: golden centre → deep orange → transparent */}
            <SvgRadialGradient
              id="sunglow"
              cx="160" cy="210" r="90"
              fx="160" fy="210"
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0%"   stopColor="#ffb040" stopOpacity="1"    />
              <Stop offset="9%"   stopColor="#ff8020" stopOpacity="0.88" />
              <Stop offset="30%"  stopColor="#e04400" stopOpacity="0.38" />
              <Stop offset="58%"  stopColor="#7a1e00" stopOpacity="0.10" />
              <Stop offset="100%" stopColor="#000000" stopOpacity="0"    />
            </SvgRadialGradient>
          </Defs>

          {/* Sky — full height */}
          <Rect x="0" y="0" width="320" height="260" fill="url(#sky)" />

          {/* Stars — scattered across the full sky */}
          <Circle cx="22"  cy="8"   r="0.7" fill={PAPER} opacity="0.45" />
          <Circle cx="90"  cy="15"  r="0.9" fill={PAPER} opacity="0.5"  />
          <Circle cx="170" cy="5"   r="0.7" fill={PAPER} opacity="0.4"  />
          <Circle cx="255" cy="12"  r="0.8" fill={PAPER} opacity="0.5"  />
          <Circle cx="305" cy="22"  r="0.6" fill={PAPER} opacity="0.35" />
          <Circle cx="42"  cy="38"  r="0.8" fill={PAPER} opacity="0.4"  />
          <Circle cx="128" cy="30"  r="1.0" fill={PAPER} opacity="0.5"  />
          <Circle cx="210" cy="42"  r="0.7" fill={PAPER} opacity="0.35" />
          <Circle cx="285" cy="55"  r="0.9" fill={PAPER} opacity="0.4"  />
          <Circle cx="65"  cy="70"  r="0.6" fill={PAPER} opacity="0.3"  />
          <Circle cx="155" cy="62"  r="0.7" fill={PAPER} opacity="0.35" />
          <Circle cx="240" cy="78"  r="0.6" fill={PAPER} opacity="0.3"  />
          <Circle cx="10"  cy="90"  r="0.8" fill={PAPER} opacity="0.3"  />
          <Circle cx="48"  cy="156" r="0.8" fill={PAPER} opacity="0.4"  />
          <Circle cx="130" cy="146" r="1.0" fill={PAPER} opacity="0.45" />
          <Circle cx="218" cy="153" r="0.7" fill={PAPER} opacity="0.3"  />
          <Circle cx="280" cy="166" r="0.9" fill={PAPER} opacity="0.35" />
          <Circle cx="76"  cy="180" r="0.6" fill={PAPER} opacity="0.25" />
          <Circle cx="258" cy="184" r="0.7" fill={PAPER} opacity="0.2"  />

          {/* Sun glow rising behind mountains */}
          <Circle cx="160" cy="210" r="90" fill="url(#sunglow)" />

          {/* Distant mountain range */}
          <Polygon
            points="0,260 55,247 88,253 118,230 143,236 160,218 177,236 202,230 232,253 265,247 320,260"
            fill="#141210"
          />

          {/* Near mountain range — sharp dark silhouette */}
          <Polygon
            points="0,260 20,257 45,260 62,250 82,242 100,248 118,215 130,222 142,200 153,188 160,174 167,188 178,200 190,222 202,215 220,248 238,242 258,250 275,260 300,257 320,260"
            fill="#0a0908"
          />

          {/* Road perspective */}
          <Polygon points="140,260 180,260 320,640 0,640" fill="url(#rd)" />
          {/* center dashes */}
          <Line
            x1="160" y1="265" x2="160" y2="640"
            stroke="url(#lineGrad)" strokeWidth="3"
            strokeDasharray="20 28"
          />
          {/* edge lines */}
          <Line x1="140" y1="260" x2="0"   y2="640" stroke="url(#lineGrad)" strokeWidth="1.5" />
          <Line x1="180" y1="260" x2="320" y2="640" stroke="url(#lineGrad)" strokeWidth="1.5" />
          {/* distant tail lights */}
          <Circle cx="150" cy="274" r="1.5" fill={Colors.orange} />
          <Circle cx="170" cy="274" r="1.5" fill={Colors.orange} />
          {/* Horizon fade — road dissolves into mountain */}
          <Polygon points="140,260 180,260 320,640 0,640" fill="url(#roadFade)" />
        </Svg>
      </View>

      {/* ─── Dark vignette ─── */}
      <LinearGradient
        colors={['transparent', 'rgba(17,17,17,0.8)', '#111111']}
        locations={[0.18, 0.52, 0.82]}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      {/* ─── Top bar ─── */}
      <View style={[styles.topBar, { paddingTop: T + 40 }]}>
        <View style={styles.brandRow}>
          <Text style={styles.brandName}>WUW</Text>
          <Ionicons
            name="moon"
            size={15}
            color={PAPER}
            style={{
              transform: [{ rotate: '30deg' }],
              textShadowColor: PAPER,
              textShadowRadius: 10,
              textShadowOffset: { width: 0, height: 0 },
            }}
          />
          <Text style={styles.brandSuffix}>Rentals</Text>
        </View>
      </View>

      {/* ─── Bottom content ─── */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 24 }]}>

        {/* Headline */}
        <View style={styles.headlineBlock}>
          <Text style={styles.headline}>
            {'Book a car,\n'}
            <Text style={styles.headlineOrange}>in minutes.</Text>
          </Text>
          <Text style={styles.sub}>QUICK SIGNUP · NO PAPERWORK · DRIVE TODAY</Text>
        </View>

        {/* HIT THE GAS */}
        <TouchableOpacity
          style={styles.pedal}
          onPress={() => router.push('/(auth)/sign-up')}
          activeOpacity={0.85}
        >
          <Text style={styles.pedalText}>HIT THE GAS</Text>
          <View style={styles.pedalCircle}>
            <Ionicons name="chevron-forward" size={14} color="#fff" />
          </View>
        </TouchableOpacity>

        {/* Already a member */}
        <TouchableOpacity
          onPress={() => router.push('/(auth)/sign-in')}
          activeOpacity={0.7}
          style={styles.footerRow}
        >
          <Text style={styles.footerText}>
            ALREADY A MEMBER ·{' '}
            <Text style={styles.footerLink}>SIGN IN</Text>
          </Text>
        </TouchableOpacity>

        {/* Staff portal */}
        <TouchableOpacity
          onPress={() => router.push('/(auth)/employee-sign-in')}
          activeOpacity={0.4}
          style={styles.staffRow}
        >
          <Text style={styles.staffText}>Staff Portal</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#04040e' },

  /* Road */
  road: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },

  /* Top bar */
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'center',
  },
  brandName: {
    fontFamily: Fonts.displaySemiBoldItalic,
    fontSize: 44,
    color: PAPER,
    letterSpacing: -1.5,
  },
  brandSuffix: {
    fontFamily: Fonts.displayItalic,
    fontSize: 32,
    color: Colors.orange,
    letterSpacing: -0.8,
  },

  mono: {
    fontFamily: MONO,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },

  /* Bottom content */
  bottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 22,
    gap: 14,
  },

  headlineBlock: { gap: 8 },
  headline: {
    fontFamily: Fonts.display,
    fontSize: 44,
    color: PAPER,
    lineHeight: 52,
    letterSpacing: -1.2,
  },
  headlineOrange: {
    fontFamily: Fonts.displayItalic,
    color: Colors.orange,
  },
  sub: {
    fontFamily: MONO,
    fontSize: 10,
    color: 'rgba(244,241,234,0.5)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  /* Pedal */
  pedal: {
    borderWidth: 2,
    borderColor: PAPER,
    borderRadius: 12,
    backgroundColor: Colors.orange,
    paddingVertical: 15,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pedalText: {
    fontFamily: MONO,
    fontSize: 14,
    color: '#fff',
    letterSpacing: 2,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  pedalCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Footer */
  footerRow: { alignItems: 'center', paddingHorizontal: 8 },
  footerText: {
    fontFamily: MONO,
    fontSize: 9,
    color: 'rgba(244,241,234,0.45)',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    textAlign: 'center',
    lineHeight: 15,
  },
  footerLink: {
    color: Colors.orange,
  },

  staffRow: { alignItems: 'center', marginTop: 4 },
  staffText: {
    fontFamily: MONO,
    fontSize: 9,
    color: 'rgba(255,255,255,0.2)',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
});

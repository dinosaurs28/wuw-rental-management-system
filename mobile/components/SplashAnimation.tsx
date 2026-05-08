import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Fonts } from '../constants/colors';

const { width: SW, height: SH } = Dimensions.get('window');
const ORANGE   = '#ff6a1f';
const PAPER    = '#f4f1ea';
const BG       = '#04040e';
const MONO     = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

const VIEWBOX = 700;
const CENTER  = VIEWBOX / 2;
// Keep the splat fully on-screen, with a tiny horizontal stretch.
const SPLAT_PX = Math.min(SW, SH) * 0.92;
const SPLAT_W  = Math.min(SW * 0.96, SPLAT_PX * 1.08);

// ── One smooth organic paint blob ─────────────────────────────────────────
// Dense angular sampling with stacked sine harmonics — a low-frequency lobe
// (k=3) creates the "paint leak" bulges, mid-frequency adds asymmetry, high
// frequency adds light texture. Standard Catmull-Rom keeps every edge silky.
const SPLAT_PATH = (() => {
  const N = 36;
  const baseR = 220;
  const MAX_R = 320; // hard cap so we stay inside the viewBox
  const pts = Array.from({ length: N }, (_, i) => {
    const a = (i / N) * Math.PI * 2;
    let r =
      baseR +
      52 * Math.sin(3 * a + 0.4) +
      28 * Math.sin(2 * a + 1.9) +
      14 * Math.sin(5 * a + 2.7) +
      6  * Math.sin(7 * a + 3.6);
    if (r > MAX_R) r = MAX_R;
    return {
      x: CENTER + r * Math.cos(a),
      y: CENTER + r * Math.sin(a),
    };
  });

  const T = 1 / 6; // standard Catmull-Rom tension
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[(i - 1 + pts.length) % pts.length];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    const p3 = pts[(i + 2) % pts.length];
    const c1x = p1.x + (p2.x - p0.x) * T;
    const c1y = p1.y + (p2.y - p0.y) * T;
    const c2x = p2.x - (p3.x - p1.x) * T;
    const c2y = p2.y - (p3.y - p1.y) * T;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d + ' Z';
})();

interface Props { onDone: () => void; }

export default function SplashAnimation({ onDone }: Props) {
  const playerRef = useRef<any>(null);

  // Splat: one big spring scale + tiny rotation settle
  const splatScale = useRef(new Animated.Value(0)).current;
  const splatRot   = useRef(new Animated.Value(0)).current;

  // WUW letters
  const wOp    = useRef(new Animated.Value(0)).current;
  const wScale = useRef(new Animated.Value(0.5)).current;
  const uOp    = useRef(new Animated.Value(0)).current;
  const uScale = useRef(new Animated.Value(0.5)).current;
  const w2Op   = useRef(new Animated.Value(0)).current;
  const w2Scale = useRef(new Animated.Value(0.5)).current;

  const rentalsOp = useRef(new Animated.Value(0)).current;
  const rentalsY  = useRef(new Animated.Value(8)).current;
  const tagOp     = useRef(new Animated.Value(0)).current;
  const containerOp = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let fadeIv: ReturnType<typeof setInterval> | null = null;
    try {
      const { createAudioPlayer, setAudioModeAsync } = require('expo-audio');
      setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
      playerRef.current = createAudioPlayer(require('../assets/sounds/engine.wav'));
      playerRef.current.play();
      setTimeout(() => {
        let v = 1.0;
        fadeIv = setInterval(() => {
          v -= 0.1;
          try { playerRef.current.volume = Math.max(0, v); } catch {}
          if (v <= 0) {
            clearInterval(fadeIv!);
            try { playerRef.current?.remove(); } catch {}
          }
        }, 40);
      }, 1000);
    } catch {}

    // ── Splat lands as one impact ──────────────────────────────────
    Animated.parallel([
      Animated.spring(splatScale, {
        toValue: 1,
        tension: 90,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(splatRot, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    const stampLetter = (op: Animated.Value, scale: Animated.Value, delay: number) =>
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(op, { toValue: 1, duration: 60, useNativeDriver: true }),
          Animated.spring(scale, { toValue: 1, tension: 220, friction: 7, useNativeDriver: true }),
        ]),
      ]);

    stampLetter(wOp,  wScale,  500).start();
    stampLetter(uOp,  uScale,  640).start();
    stampLetter(w2Op, w2Scale, 780).start();

    Animated.sequence([
      Animated.delay(960),
      Animated.parallel([
        Animated.timing(rentalsOp, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(rentalsY,  { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(tagOp,     { toValue: 1, duration: 300, useNativeDriver: true }),
      ]),
    ]).start();

    Animated.sequence([
      Animated.delay(1300),
      Animated.timing(containerOp, {
        toValue: 0,
        duration: 440,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => { if (finished) onDone(); });

    return () => {
      if (fadeIv) clearInterval(fadeIv);
      try { playerRef.current?.remove(); } catch {}
    };
  }, []);

  const splatRotate = splatRot.interpolate({
    inputRange: [0, 1],
    outputRange: ['-8deg', '0deg'],
  });

  return (
    <Animated.View style={[s.root, { opacity: containerOp }]}>

      {/* ── Single big paint splat ─────────────────────────── */}
      <Animated.View
        style={[
          s.splatWrap,
          {
            transform: [
              { scale: splatScale },
              { rotate: splatRotate },
            ],
          },
        ]}
      >
        <Svg width={SPLAT_W} height={SPLAT_PX} viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} preserveAspectRatio="none">
          <Path d={SPLAT_PATH} fill={ORANGE} />
        </Svg>
      </Animated.View>

      {/* ── WUW + RENTALS centered over the splat ── */}
      <View style={s.logoAnchor} pointerEvents="none">
        <View style={s.textRow}>
          <Animated.Text style={[s.letter, { opacity: wOp,  transform: [{ scale: wScale  }] }]}>W</Animated.Text>
          <Animated.Text style={[s.letter, { opacity: uOp,  transform: [{ scale: uScale  }] }]}>U</Animated.Text>
          <Animated.Text style={[s.letter, { opacity: w2Op, transform: [{ scale: w2Scale }] }]}>W</Animated.Text>
        </View>
        <Animated.Text style={[s.rentals, {
          opacity: rentalsOp,
          transform: [{ translateY: rentalsY }],
        }]}>
          RENTALS
        </Animated.Text>
      </View>

      {/* ── Bottom tag ── */}
      <Animated.Text style={[s.tag, { opacity: tagOp }]}>
        START YOUR ENGINE
      </Animated.Text>

    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },

  splatWrap: {
    position: 'absolute',
    width: SPLAT_W,
    height: SPLAT_PX,
    alignItems: 'center',
    justifyContent: 'center',
  },

  logoAnchor: {
    alignItems: 'center',
    gap: 14,
    maxWidth: SPLAT_PX * 0.6, // hard cap so text can never exit the inner safe area
  },

  textRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },

  letter: {
    fontFamily: Fonts.displayBold,
    fontSize: Math.round(SPLAT_PX * 0.18),
    color: PAPER,
    letterSpacing: -1,
    lineHeight: Math.round(SPLAT_PX * 0.19),
    textShadowColor: 'rgba(0,0,0,0.22)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },

  rentals: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: Math.max(10, Math.round(SPLAT_PX * 0.028)),
    color: PAPER,
    letterSpacing: 6,
    textTransform: 'uppercase',
    opacity: 0.92,
    paddingLeft: 6, // optical re-centering after wide letter-spacing
  },

  tag: {
    position: 'absolute',
    bottom: 52,
    fontFamily: MONO,
    fontSize: 9,
    color: 'rgba(244,241,234,0.22)',
    letterSpacing: 3.5,
    textTransform: 'uppercase',
  },
});

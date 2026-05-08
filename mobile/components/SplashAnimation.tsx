import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { Fonts } from '../constants/colors';

const { width: SW, height: SH } = Dimensions.get('window');
const ORANGE = '#ff6a1f';
const PAPER  = '#f4f1ea';
const BG     = '#04040e';
const MONO   = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

const LINE_WIDTH = Math.min(SW, SH) * 0.62;
const WUW_SIZE   = Math.min(SW, SH) * 0.20;

interface Props { onDone: () => void; }

export default function SplashAnimation({ onDone }: Props) {
  const playerRef = useRef<any>(null);

  // ── Animated values ─────────────────────────────────────────────
  // Line: draws outward from center (scaleX 0 -> 1)
  const lineScale = useRef(new Animated.Value(0)).current;
  const lineOp    = useRef(new Animated.Value(0)).current;

  // WUW: fades in + drops slightly from above
  const wuwOp = useRef(new Animated.Value(0)).current;
  const wuwTy = useRef(new Animated.Value(-12)).current;

  // RENTALS: fades in + rises slightly from below
  const rentalsOp = useRef(new Animated.Value(0)).current;
  const rentalsTy = useRef(new Animated.Value(12)).current;

  // Tagline + container
  const tagOp       = useRef(new Animated.Value(0)).current;
  const containerOp = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Engine sound (existing audio) ─────────────────────────────────
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
      }, 1300);
    } catch {}

    // Choreography ──────────────────────────────────────────────────
    Animated.sequence([
      // 1. Brief intentional black pause
      Animated.delay(180),

      // 2. Line draws outward from center (550ms)
      Animated.parallel([
        Animated.timing(lineOp,   { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(lineScale, {
          toValue: 1,
          duration: 620,
          easing: Easing.bezier(0.22, 0.65, 0.35, 1),
          useNativeDriver: true,
        }),
      ]),

      // 3. WUW + RENTALS appear, line settles (parallel)
      Animated.parallel([
        Animated.timing(wuwOp, { toValue: 1, duration: 480, useNativeDriver: true }),
        Animated.timing(wuwTy, {
          toValue: 0,
          duration: 540,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(rentalsOp, { toValue: 1, duration: 480, delay: 120, useNativeDriver: true }),
        Animated.timing(rentalsTy, {
          toValue: 0,
          duration: 540,
          delay: 120,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),

      // 4. Tagline fades in
      Animated.timing(tagOp, { toValue: 1, duration: 400, useNativeDriver: true }),

      // 5. Hold
      Animated.delay(600),

      // 6. Exit fade
      Animated.timing(containerOp, {
        toValue: 0,
        duration: 360,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) onDone();
    });

    return () => {
      if (fadeIv) clearInterval(fadeIv);
      try { playerRef.current?.remove(); } catch {}
    };
  }, []);

  return (
    <Animated.View style={[s.root, { opacity: containerOp }]}>
      {/* ── Wordmark stack ─────────────────────────────────────── */}
      <View style={s.stack}>
        {/* WUW */}
        <Animated.Text
          style={[
            s.wuw,
            { opacity: wuwOp, transform: [{ translateY: wuwTy }] },
          ]}
        >
          WUW
        </Animated.Text>

        {/* Animated horizontal accent line (draws outward from center) */}
        <Animated.View
          style={[
            s.line,
            {
              opacity: lineOp,
              transform: [{ scaleX: lineScale }],
            },
          ]}
        />

        {/* RENTALS */}
        <Animated.Text
          style={[
            s.rentals,
            { opacity: rentalsOp, transform: [{ translateY: rentalsTy }] },
          ]}
        >
          RENTALS
        </Animated.Text>
      </View>

      {/* ── Bottom tagline ─────────────────────────────────────── */}
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

  stack: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  wuw: {
    fontFamily: Fonts.displayBold,
    fontSize: WUW_SIZE,
    lineHeight: WUW_SIZE * 1.05,
    color: PAPER,
    letterSpacing: -1,
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
    marginBottom: 18,
  },

  line: {
    width: LINE_WIDTH,
    height: 1.5,
    backgroundColor: ORANGE,
    borderRadius: 1,
    // Glow so the line reads as light-emitting on dark
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 6,
    elevation: 4,
  },

  rentals: {
    fontFamily: Fonts.bodyMedium,
    fontSize: Math.max(11, Math.round(WUW_SIZE * 0.18)),
    color: PAPER,
    letterSpacing: 8,
    textTransform: 'uppercase',
    opacity: 0.78,
    paddingLeft: 8, // optical re-center after wide letter-spacing
    marginTop: 18,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },

  tag: {
    position: 'absolute',
    bottom: 56,
    fontFamily: MONO,
    fontSize: 9,
    color: 'rgba(244,241,234,0.22)',
    letterSpacing: 3.5,
    textTransform: 'uppercase',
  },
});

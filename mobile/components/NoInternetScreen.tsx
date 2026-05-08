import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../constants/colors';

const MONO = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

interface Props {
  onRetry: () => void;
  retrying: boolean;
}

export default function NoInternetScreen({ onRetry, retrying }: Props) {
  const insets = useSafeAreaInsets();

  // Entrance animation
  const opacity = useRef(new Animated.Value(0)).current;
  const slideY  = useRef(new Animated.Value(18)).current;

  // Pulsing dot animation
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(slideY, { toValue: 0, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    const pulse = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 380, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 380, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ])
      ).start();

    pulse(dot1, 0);
    pulse(dot2, 140);
    pulse(dot3, 280);
  }, []);

  return (
    <Animated.View style={[s.root, { opacity, transform: [{ translateY: slideY }] }]}>
      {/* Top brand mark */}
      <View style={[s.topBar, { paddingTop: insets.top + 16 }]}>
        <Text style={s.brandWUW}>WUW</Text>
        <Text style={s.brandSub}>RENTALS</Text>
      </View>

      {/* Centre content */}
      <View style={s.center}>
        {/* Signal bars icon — drawn with views */}
        <View style={s.signalWrap}>
          <View style={[s.bar, s.bar1]} />
          <View style={[s.bar, s.bar2, s.barDim]} />
          <View style={[s.bar, s.bar3, s.barDim]} />
          <View style={[s.bar, s.bar4, s.barDim]} />
          <View style={s.slash} />
        </View>

        <Text style={s.headline}>No connection.</Text>
        <Text style={s.body}>
          Can't reach the server.{'\n'}Check your network and try again.
        </Text>

        {/* Retry button */}
        <TouchableOpacity
          style={[s.btn, retrying && s.btnRetrying]}
          onPress={onRetry}
          activeOpacity={0.82}
          disabled={retrying}
        >
          {retrying ? (
            <View style={s.dotRow}>
              <Animated.View style={[s.dot, { opacity: dot1 }]} />
              <Animated.View style={[s.dot, { opacity: dot2 }]} />
              <Animated.View style={[s.dot, { opacity: dot3 }]} />
            </View>
          ) : (
            <Text style={s.btnText}>RETRY</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Footer */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 20 }]}>
        <Text style={s.footerText}>WUW · PREMIUM RENTALS</Text>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.bg,
    zIndex: 9998,
    justifyContent: 'space-between',
  },

  // ── Top brand ────────────────────────────────────────────────────────
  topBar: {
    alignItems: 'center',
    paddingBottom: 12,
  },
  brandWUW: {
    fontFamily: Fonts.displaySemiBoldItalic,
    fontSize: 30,
    color: Colors.ink,
    letterSpacing: -1,
    lineHeight: 34,
  },
  brandSub: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 9,
    color: Colors.ink3,
    letterSpacing: 5,
    textTransform: 'uppercase',
    marginTop: 2,
  },

  // ── Centre ───────────────────────────────────────────────────────────
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },

  // Signal icon
  signalWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    marginBottom: 12,
    position: 'relative',
  },
  bar: {
    width: 7,
    borderRadius: 2,
    backgroundColor: Colors.orange,
  },
  bar1: { height: 10 },
  bar2: { height: 16 },
  bar3: { height: 22 },
  bar4: { height: 28 },
  barDim: { backgroundColor: 'rgba(10,10,10,0.12)' },

  // Diagonal slash over signal bars
  slash: {
    position: 'absolute',
    width: 44,
    height: 1.5,
    backgroundColor: Colors.orange,
    top: 14,
    left: -3,
    transform: [{ rotate: '-35deg' }],
  },

  headline: {
    fontFamily: Fonts.displayBold,
    fontSize: 32,
    color: Colors.ink,
    letterSpacing: -0.8,
    textAlign: 'center',
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink3,
    textAlign: 'center',
    lineHeight: 22,
  },

  // Retry button
  btn: {
    marginTop: 12,
    backgroundColor: Colors.orange,
    paddingHorizontal: 40,
    paddingVertical: 15,
    borderRadius: 14,
    minWidth: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnRetrying: {
    backgroundColor: 'rgba(255,106,31,0.5)',
  },
  btnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: '#fff',
    letterSpacing: 2,
  },

  // Animated dots during retry
  dotRow: {
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    height: 20,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#fff',
  },

  // ── Footer ───────────────────────────────────────────────────────────
  footer: {
    alignItems: 'center',
  },
  footerText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 9,
    color: Colors.ink4,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
});

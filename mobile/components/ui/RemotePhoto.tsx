import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ImageResizeMode,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';

// Waits before the automatic retries (2 retries = 3 attempts in all), then a
// tap-to-retry. A slow mobile connection or a throttled photo host often
// fails once and works on the next try.
const RETRY_DELAYS_MS = [800, 2500];

/** Delay before automatic retry `failures` (1-based), or null once they are used up. */
export function retryDelayMs(failures: number): number | null {
  return RETRY_DELAYS_MS[failures - 1] ?? null;
}

interface Props {
  uri: string;
  /** Loaded at once when `uri` fails (the original behind a display copy), then retried */
  fallbackUri?: string;
  style?: StyleProp<ViewStyle>;
  resizeMode?: ImageResizeMode;
  accessibilityLabel?: string;
}

/**
 * A remote photo with a loading skeleton, a switch to `fallbackUri` when `uri`
 * fails, automatic retries with backoff and a tap-to-retry (back to `uri`). On Android it is decoded at the size it is shown
 * (resizeMethod "resize"), not at the photo's full resolution, so a strip of
 * large photos doesn't exhaust image memory.
 */
export default function RemotePhoto({ uri, fallbackUri, style, resizeMode = 'cover', accessibilityLabel }: Props) {
  const [attempt, setAttempt] = useState(0);
  // Showing the fallback (after `uri` failed)
  const [onFallback, setOnFallback] = useState(false);
  const hasFallback = !!fallbackUri && fallbackUri !== uri;
  const shown = onFallback && hasFallback ? fallbackUri! : uri;
  const [failures, setFailures] = useState(0);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulse = useRef(new Animated.Value(0.55)).current;

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // A new photo starts over.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    setAttempt(0);
    setFailures(0);
    setOnFallback(false);
    setStatus('loading');
  }, [uri, fallbackUri]);

  useEffect(() => {
    if (status !== 'loading') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [status, pulse]);

  const onError = () => {
    if (hasFallback && !onFallback) {
      setOnFallback(true);
      setAttempt((n) => n + 1);
      return;
    }
    const next = failures + 1;
    setFailures(next);
    const delay = retryDelayMs(next);
    if (delay == null) {
      setStatus('error');
      return;
    }
    timer.current = setTimeout(() => setAttempt((n) => n + 1), delay);
  };

  const retry = () => {
    if (timer.current) clearTimeout(timer.current);
    setOnFallback(false);
    setFailures(0);
    setStatus('loading');
    setAttempt((n) => n + 1);
  };

  return (
    <View style={[styles.frame, style]}>
      {status === 'loading' && <Animated.View style={[StyleSheet.absoluteFill, styles.skeleton, { opacity: pulse }]} />}
      {status === 'error' ? (
        <View style={styles.error}>
          <Ionicons name="image-outline" size={26} color={Colors.ink3} />
          <Text style={styles.errorText}>Photo didn't load</Text>
          <TouchableOpacity
            onPress={retry}
            style={styles.retryBtn}
            activeOpacity={0.8}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Retry loading photo"
          >
            <Ionicons name="refresh" size={14} color={Colors.ink} />
            <Text style={styles.retryText}>Tap to retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Image
          key={attempt}
          source={{ uri: shown }}
          style={StyleSheet.absoluteFill}
          resizeMode={resizeMode}
          resizeMethod="resize"
          accessibilityLabel={accessibilityLabel}
          onLoad={() => setStatus('loaded')}
          onError={onError}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: Colors.bg },
  skeleton: { backgroundColor: '#e6e6e3' },
  error: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12 },
  errorText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  retryText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
});

import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';

const TRACK_HEIGHT = 60;
const THUMB_SIZE = 52;
const PADDING = 4;
const COMPLETE_THRESHOLD = 0.7; // fraction of max travel before swipe counts

interface Props {
  label: string;
  loadingLabel?: string;
  onComplete: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** Bumping this number resets the thumb to start (e.g., on error) */
  resetSignal?: number;
}

export default function SwipeButton({
  label,
  loadingLabel = 'Processing…',
  onComplete,
  loading = false,
  disabled = false,
  resetSignal = 0,
}: Props) {
  const trackWidth = useSharedValue(0);
  const translateX = useSharedValue(0);
  const completed = useSharedValue(false);

  // Reset on signal change
  useEffect(() => {
    if (resetSignal === 0) return;
    completed.value = false;
    translateX.value = withSpring(0, { damping: 18, stiffness: 220 });
  }, [resetSignal]);

  const fireComplete = () => {
    onComplete();
  };

  const pan = Gesture.Pan()
    .enabled(!disabled && !loading)
    .activeOffsetX([-8, 8])
    .onUpdate((e) => {
      'worklet';
      if (completed.value) return;
      const max = trackWidth.value - THUMB_SIZE - PADDING * 2;
      if (max <= 0) return;
      translateX.value = Math.max(0, Math.min(e.translationX, max));
    })
    .onEnd(() => {
      'worklet';
      if (completed.value) return;
      const max = trackWidth.value - THUMB_SIZE - PADDING * 2;
      if (max <= 0) return;
      if (translateX.value > max * COMPLETE_THRESHOLD) {
        completed.value = true;
        translateX.value = withTiming(max, { duration: 180 });
        runOnJS(fireComplete)();
      } else {
        translateX.value = withSpring(0, { damping: 16, stiffness: 220 });
      }
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    // Fill extends just past the thumb so the rounded right edge curves
    // around the thumb's right side instead of cutting at it.
    width: translateX.value + PADDING + THUMB_SIZE + 6,
  }));

  const labelStyle = useAnimatedStyle(() => {
    const max = trackWidth.value - THUMB_SIZE - PADDING * 2;
    const opacity =
      max <= 0
        ? 1
        : interpolate(translateX.value, [0, max * 0.55], [1, 0], Extrapolation.CLAMP);
    const translate = interpolate(
      translateX.value,
      [0, max <= 0 ? 1 : max * 0.55],
      [0, 12],
      Extrapolation.CLAMP,
    );
    return { opacity, transform: [{ translateX: translate }] };
  });

  const chevronStyle = useAnimatedStyle(() => {
    const max = trackWidth.value - THUMB_SIZE - PADDING * 2;
    const opacity =
      max <= 0
        ? 1
        : interpolate(translateX.value, [0, max * 0.4], [1, 0], Extrapolation.CLAMP);
    return { opacity };
  });

  return (
    <View
      style={[
        styles.track,
        disabled && styles.trackDisabled,
      ]}
      onLayout={(e) => {
        trackWidth.value = e.nativeEvent.layout.width;
      }}
    >
      {/* Filled portion follows thumb — rounded right edge tucks under the
          thumb so the boundary is a curve, not a hard vertical line. */}
      <Animated.View style={[styles.fill, fillStyle]} pointerEvents="none" />

      {/* Label sits centered, fades as user drags */}
      <Animated.View style={[styles.labelWrap, labelStyle]} pointerEvents="none">
        <Text style={styles.labelText} numberOfLines={1}>
          {loading ? loadingLabel : label}
        </Text>
        <Animated.View style={chevronStyle}>
          <View style={styles.chevronGroup}>
            <Ionicons name="chevron-forward" size={12} color="rgba(255,255,255,0.4)" />
            <Ionicons name="chevron-forward" size={12} color="rgba(255,255,255,0.7)" style={styles.chevronOverlap} />
            <Ionicons name="chevron-forward" size={12} color="rgba(255,255,255,1)" style={styles.chevronOverlap} />
          </View>
        </Animated.View>
      </Animated.View>

      {/* Thumb */}
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.thumb, thumbStyle]}>
          {loading ? (
            <ActivityIndicator size="small" color={Colors.orange} />
          ) : (
            <Ionicons name="arrow-forward" size={20} color={Colors.orange} />
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: '#1a1a1a',
    overflow: 'hidden',
    justifyContent: 'center',
    paddingHorizontal: PADDING,
  },
  trackDisabled: {
    opacity: 0.4,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: Colors.orange,
    borderTopRightRadius: TRACK_HEIGHT / 2,
    borderBottomRightRadius: TRACK_HEIGHT / 2,
  },
  labelWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  labelText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
    letterSpacing: 0.3,
  },
  chevronGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chevronOverlap: {
    marginLeft: -7,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.black,
    shadowOpacity: 0.32,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});

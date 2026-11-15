import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { Colors, Fonts } from '../../constants/colors';
import { slideSources, slideView, viewerRetryDelayMs, type LoadStatus } from '../../lib/photoViewer';

export interface ViewerImage {
  url: string;
  // Smaller copy shown while `url` loads (and if it fails).
  previewUrl?: string | null;
  label?: string | null;
}

interface Props {
  visible: boolean;
  images: ViewerImage[];
  startIndex?: number;
  onClose: () => void;
  /**
   * Fresh links for photo `index`, asked for when every copy failed and the
   * user taps Retry — e.g. re-fetch a presigned URL that has expired. Optional:
   * without it Retry loads the same links again.
   */
  onRefreshImage?: (index: number) => Promise<ViewerImage | null>;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const SPRING = { damping: 20, stiffness: 200 };

interface SlideProps {
  image: ViewerImage;
  width: number;
  height: number;
  active: boolean;
  onZoomChange: (zoomed: boolean) => void;
  /** Fresh links for this photo (e.g. a presigned URL that has expired), asked for on Retry. */
  onRefresh?: () => Promise<ViewerImage | null>;
}

// One copy of a photo (full size or smaller): its load status, automatic
// retries with backoff (an immediate retry against a throttled host just
// fails again), then 'error' until reset.
function useRemoteCopy(uri: string | null) {
  const [status, setStatus] = useState<LoadStatus>(uri ? 'loading' : 'idle');
  // Bumped to remount the image element (a new request)
  const [attempt, setAttempt] = useState(0);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => {
    clear();
    failures.current = 0;
    setStatus(uri ? 'loading' : 'idle');
  }, [uri]);
  useEffect(() => clear, []);

  const onLoad = useCallback(() => {
    clear();
    failures.current = 0;
    setStatus('loaded');
  }, []);
  const onError = useCallback(() => {
    failures.current += 1;
    const delay = viewerRetryDelayMs(failures.current);
    if (delay == null) {
      setStatus('error');
      return;
    }
    clear();
    timer.current = setTimeout(() => setAttempt((n) => n + 1), delay);
  }, []);
  const reset = useCallback(() => {
    clear();
    failures.current = 0;
    setStatus(uri ? 'loading' : 'idle');
    setAttempt((n) => n + 1);
  }, [uri]);

  return { status, attempt, onLoad, onError, reset };
}

// One zoomable page: pinch, pan (clamped to the zoomed bounds) and double-tap.
// Pan only claims the touch while zoomed, so at 1x a horizontal swipe falls
// through to the pager. The smaller copy shows while the full-size photo
// loads and stays if it fails; only when every copy fails is there an error
// panel (Nov 15 2026: it used to leave a black page with a Retry pill).
function ZoomSlide({ image, width, height, active, onZoomChange, onRefresh }: SlideProps) {
  // Links re-fetched on Retry (onRefresh), replacing the ones passed in
  const [fresh, setFresh] = useState<ViewerImage | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => setFresh(null), [image.url, image.previewUrl]);

  const sources = slideSources(fresh ?? image, active);
  const full = useRemoteCopy(sources.full);
  const preview = useRemoteCopy(sources.preview);
  const view = slideView(sources, full.status, preview.status);

  const retryFull = () => full.reset();
  const retryAll = async () => {
    if (onRefresh) {
      setRefreshing(true);
      try {
        const next = await onRefresh();
        if (next?.url) setFresh(next);
      } catch {
        // Keep the links we have
      } finally {
        setRefreshing(false);
      }
    }
    full.reset();
    preview.reset();
  };
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  // Leaving a page resets it, so coming back always starts fitted.
  useEffect(() => {
    if (active) return;
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedX.value = 0;
    savedY.value = 0;
  }, [active]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, savedScale.value * e.scale));
    })
    .onEnd(() => {
      if (scale.value <= 1.02) {
        scale.value = withSpring(1, SPRING);
        translateX.value = withSpring(0, SPRING);
        translateY.value = withSpring(0, SPRING);
        savedScale.value = 1;
        savedX.value = 0;
        savedY.value = 0;
        runOnJS(onZoomChange)(false);
        return;
      }
      savedScale.value = scale.value;
      const maxX = ((scale.value - 1) * width) / 2;
      const maxY = ((scale.value - 1) * height) / 2;
      translateX.value = withSpring(Math.max(-maxX, Math.min(maxX, translateX.value)), SPRING);
      translateY.value = withSpring(Math.max(-maxY, Math.min(maxY, translateY.value)), SPRING);
      savedX.value = Math.max(-maxX, Math.min(maxX, translateX.value));
      savedY.value = Math.max(-maxY, Math.min(maxY, translateY.value));
      runOnJS(onZoomChange)(true);
    });

  const pan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((_e, state) => {
      if (scale.value > 1.02) state.activate();
      else state.fail();
    })
    .onStart(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    })
    .onUpdate((e) => {
      const maxX = ((scale.value - 1) * width) / 2;
      const maxY = ((scale.value - 1) * height) / 2;
      translateX.value = Math.max(-maxX, Math.min(maxX, savedX.value + e.translationX));
      translateY.value = Math.max(-maxY, Math.min(maxY, savedY.value + e.translationY));
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (savedScale.value > 1.02) {
        scale.value = withSpring(1, SPRING);
        translateX.value = withSpring(0, SPRING);
        translateY.value = withSpring(0, SPRING);
        savedScale.value = 1;
        savedX.value = 0;
        savedY.value = 0;
        runOnJS(onZoomChange)(false);
      } else {
        scale.value = withSpring(2.5, SPRING);
        savedScale.value = 2.5;
        runOnJS(onZoomChange)(true);
      }
    });

  const gesture = Gesture.Simultaneous(Gesture.Race(doubleTap, pan), pinch);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {view.showPreview && sources.preview && !refreshing && (
          <Animated.Image
            key={`p${preview.attempt}`}
            source={{ uri: sources.preview }}
            style={[{ width, height, position: 'absolute' }, animatedStyle]}
            resizeMode="contain"
            onLoad={preview.onLoad}
            onError={preview.onError}
          />
        )}
        {view.showFull && sources.full && !refreshing && (
          <Animated.Image
            key={`f${full.attempt}`}
            source={{ uri: sources.full }}
            style={[{ width, height, position: 'absolute' }, animatedStyle]}
            resizeMode="contain"
            onLoad={full.onLoad}
            onError={full.onError}
          />
        )}
        {(view.spinner || refreshing) && view.notice !== 'failed' && (
          <View style={styles.centerOverlay} pointerEvents="none">
            <ActivityIndicator color={Colors.orange} size="large" />
          </View>
        )}
        {view.notice === 'smaller-copy' && !refreshing && (
          <TouchableOpacity
            onPress={retryFull}
            style={styles.previewRetry}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Showing a smaller copy. Retry loading the full-size photo"
          >
            <Ionicons name="refresh" size={15} color="#fff" />
            <Text style={styles.retryText}>Smaller copy shown · Retry full size</Text>
          </TouchableOpacity>
        )}
        {view.notice === 'failed' &&
          (refreshing ? (
            <ActivityIndicator color={Colors.orange} size="large" />
          ) : (
            <View style={styles.errorInner}>
              <Ionicons name="image-outline" size={48} color="rgba(255,255,255,0.3)" />
              <Text style={styles.errorText}>This photo didn't load</Text>
              <Text style={styles.errorHint}>Check the connection, then try again.</Text>
              <TouchableOpacity
                onPress={retryAll}
                style={styles.retryBtn}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Retry loading photo"
              >
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ))}
      </View>
    </GestureDetector>
  );
}

/**
 * Full-screen photo viewer: horizontal paging between photos, pinch-zoom, pan
 * and double-tap on each, with a counter, caption and close button.
 */
export default function ImageViewer({ visible, images, startIndex = 0, onClose, onRefreshImage }: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const listRef = useRef<FlatList<ViewerImage>>(null);
  const [index, setIndex] = useState(startIndex);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (visible) {
      setIndex(Math.min(Math.max(startIndex, 0), Math.max(images.length - 1, 0)));
      setZoomed(false);
    }
  }, [visible, startIndex]);

  // Keep the current page under the user's thumb when the window is resized
  // (rotation), since page offsets are width-based.
  useEffect(() => {
    if (visible && images.length > 0) {
      listRef.current?.scrollToOffset({ offset: index * width, animated: false });
    }
  }, [width]);

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      setIndex(Math.min(Math.max(next, 0), Math.max(images.length - 1, 0)));
      setZoomed(false);
    },
    [width, images.length],
  );

  const current = images[index];
  const total = images.length;

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.root}>
        {total > 0 && (
          <FlatList
            ref={listRef}
            data={images}
            extraData={index}
            keyExtractor={(item, i) => `${i}_${item.url}`}
            horizontal
            pagingEnabled
            scrollEnabled={!zoomed && total > 1}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={Math.min(Math.max(startIndex, 0), total - 1)}
            getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })}
            initialNumToRender={1}
            windowSize={3}
            maxToRenderPerBatch={1}
            removeClippedSubviews
            onMomentumScrollEnd={onMomentumEnd}
            renderItem={({ item, index: i }) => (
              <ZoomSlide
                image={item}
                width={width}
                height={height}
                active={i === index}
                onZoomChange={i === index ? setZoomed : noop}
                onRefresh={onRefreshImage ? () => onRefreshImage(i) : undefined}
              />
            )}
          />
        )}

        {/* Header: counter + close */}
        <View style={[styles.header, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
          <View style={styles.counter}>
            <Text style={styles.counterText}>
              {total > 0 ? `${index + 1} / ${total}` : ''}
            </Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close photo viewer"
          >
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Caption */}
        {current?.label ? (
          <View style={[styles.caption, { paddingBottom: insets.bottom + 16 }]} pointerEvents="none">
            <Text style={styles.captionText} numberOfLines={2}>{current.label}</Text>
          </View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

function noop() {}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  counter: {
    minWidth: 38,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: '#fff' },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  captionText: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: '#fff', textAlign: 'center' },
  centerOverlay: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  errorInner: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  errorText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: 'rgba(255,255,255,0.85)' },
  errorHint: { fontFamily: Fonts.body, fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: -8 },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  retryText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: '#fff' },
  previewRetry: {
    position: 'absolute',
    bottom: 110,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
});

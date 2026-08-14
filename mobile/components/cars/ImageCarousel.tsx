import { useState } from 'react';
import {
  Image,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

interface Props {
  images: string[];
  style?: any;
  resizeMode?: 'cover' | 'contain';
}

// Swipeable, full-bleed image gallery with page dots. Sizes pages to its own
// measured width so it works full-screen (detail hero) or inset (sheets).
export default function ImageCarousel({ images, style, resizeMode = 'cover' }: Props) {
  const [w, setW] = useState(0);
  const [index, setIndex] = useState(0);

  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (w > 0) setIndex(Math.round(e.nativeEvent.contentOffset.x / w));
  };

  const list = images?.filter(Boolean) ?? [];

  if (list.length === 0) {
    return (
      <View style={[styles.placeholder, style]}>
        <Ionicons name="car-sport-outline" size={52} color="rgba(255,255,255,0.18)" />
      </View>
    );
  }

  return (
    <View style={[styles.root, style]} onLayout={onLayout}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        scrollEnabled={list.length > 1 && w > 0}
      >
        {w > 0 &&
          list.map((uri, i) => (
            <Image key={`${uri}-${i}`} source={{ uri }} style={{ width: w, height: '100%' }} resizeMode={resizeMode} />
          ))}
      </ScrollView>

      {list.length > 1 && (
        <View style={styles.dots} pointerEvents="none">
          {list.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden', backgroundColor: '#111' },
  placeholder: { backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  dots: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  dotActive: { backgroundColor: Colors.white, width: 18 },
});

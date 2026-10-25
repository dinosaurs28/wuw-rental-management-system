import { useCallback, useEffect, useState } from 'react';
import {
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
import { Fonts } from '../../../constants/colors';
import RemotePhoto from '../../ui/RemotePhoto';

export interface ComparePhoto {
  url: string;
  // Smaller copy to show (the strip's display copy); `url` when absent.
  displayUrl?: string;
  label?: string | null;
}

interface Props {
  visible: boolean;
  // Handover photos (pickup, or the replacement at its swap) and the drop photos,
  // each in the order taken: photo #n of one is shown with photo #n of the other.
  before: ComparePhoto[];
  after: ComparePhoto[];
  beforeTitle: string;
  afterTitle: string;
  startIndex?: number;
  onClose: () => void;
}

// Pickup photo #n beside drop photo #n (stacked on a phone held upright), one
// pair per page; swiping moves both to the next number.
export default function PhotoCompareViewer({
  visible,
  before,
  after,
  beforeTitle,
  afterTitle,
  startIndex = 0,
  onClose,
}: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const total = Math.max(before.length, after.length);
  const [index, setIndex] = useState(startIndex);
  useEffect(() => {
    if (visible) setIndex(Math.min(Math.max(startIndex, 0), Math.max(total - 1, 0)));
  }, [visible, startIndex, total]);

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      setIndex(Math.min(Math.max(next, 0), total - 1));
    },
    [width, total],
  );

  const landscape = width > height;
  const headerH = insets.top + 56;
  const footerH = insets.bottom + 16;
  const pageH = height - headerH - footerH;
  const paneW = landscape ? (width - 36) / 2 : width - 24;
  const paneH = landscape ? pageH - 32 : (pageH - 64) / 2;

  const pane = (photo: ComparePhoto | undefined, title: string, n: number) => (
    <View style={{ width: paneW }}>
      <Text style={styles.paneTitle} numberOfLines={1}>
        {`${title} #${n}`}
        {photo?.label ? ` · ${photo.label}` : ''}
      </Text>
      {photo ? (
        <RemotePhoto
          uri={photo.displayUrl || photo.url}
          fallbackUri={photo.url}
          resizeMode="contain"
          style={[styles.photo, { width: paneW, height: paneH }]}
          accessibilityLabel={`${title} photo ${n}`}
        />
      ) : (
        <View style={[styles.photo, styles.none, { width: paneW, height: paneH }]}>
          <Ionicons name="image-outline" size={22} color="rgba(255,255,255,0.5)" />
          <Text style={styles.noneText}>{`No ${title.toLowerCase()} photo #${n}`}</Text>
        </View>
      )}
    </View>
  );

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
          <Text style={styles.counter}>{total > 0 ? `${index + 1} / ${total}` : ''}</Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close photo comparison"
          >
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
        {visible && total > 0 && (
          <FlatList
            data={Array.from({ length: total }, (_v, i) => i)}
            keyExtractor={(i) => String(i)}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={Math.min(Math.max(startIndex, 0), total - 1)}
            getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })}
            initialNumToRender={1}
            windowSize={3}
            maxToRenderPerBatch={1}
            onMomentumScrollEnd={onMomentumEnd}
            renderItem={({ item: i }) => (
              <View
                style={[
                  styles.page,
                  { width, height: pageH },
                  landscape ? { flexDirection: 'row', gap: 12 } : { flexDirection: 'column', gap: 16 },
                ]}
              >
                {pane(before[i], beforeTitle, i + 1)}
                {pane(after[i], afterTitle, i + 1)}
              </View>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  counter: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: '#fff', fontVariant: ['tabular-nums'] },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  page: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  paneTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: '#fff', marginBottom: 6 },
  photo: { borderRadius: 10, backgroundColor: '#111' },
  none: { alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  noneText: { fontFamily: Fonts.body, fontSize: 12, color: 'rgba(255,255,255,0.6)' },
});

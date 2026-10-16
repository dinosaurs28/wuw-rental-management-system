import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import type { ViewerImage } from '../../ui/ImageViewer';
import RemotePhoto from '../../ui/RemotePhoto';
import { SWAP_PHOTOS_MISSING_NOTE } from '../VehicleSwapHistory';

// GET /api/employee/return/:bookingId/pickup-captures. `photos` = the pickup
// photos; the rest (item 2) is absent on older servers.
export interface ConditionPhoto {
  publicId: string;
  captureLabel: string | null;
  // The original (full-screen viewer).
  url: string;
  // ~1200 px copy for the strip; absent on older servers.
  displayUrl?: string;
  // When the photo was saved; absent on older servers.
  takenAt?: string;
  mime: string;
}

export interface ConditionPhotoSet {
  // PICKUP = handover photos, SWAP = the replacement's photos at a mid-rental swap.
  source: 'PICKUP' | 'SWAP';
  vehicle: { regNo: string; make: string; model: string } | null;
  takenAt: string | null;
  swapPublicId: string | null;
  // A mid-rental swap where no photo of the replacement was taken.
  photosMissing: boolean;
  // This car was swapped out later in the rental.
  replaced: boolean;
  photos: ConditionPhoto[];
}

export interface ReturnConditionCaptures {
  photos: ConditionPhoto[];
  // The car being returned: its own handover photos.
  currentVehicleCaptures?: ConditionPhotoSet;
  // Swapped-out cars, newest first, the original pickup last.
  earlierCaptures?: ConditionPhotoSet[];
  swapped?: boolean;
  photosMissing?: boolean;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function setTitle(set: ConditionPhotoSet): string {
  const reg = set.vehicle?.regNo;
  if (set.source === 'SWAP') {
    return `Photos of ${reg ?? 'the replacement'} at swap${set.takenAt ? `, ${formatDate(set.takenAt)}` : ''}${set.replaced ? ' (replaced)' : ''}`;
  }
  return set.replaced ? `Original pickup — ${reg ?? 'first vehicle'} (replaced)` : `Pickup${reg ? ` — ${reg}` : ''}`;
}

function viewerImages(set: ConditionPhotoSet): ViewerImage[] {
  const prefix = set.source === 'SWAP' ? `${set.vehicle?.regNo ?? 'Swap'} at swap` : 'Pickup';
  return set.photos.map((p, i) => ({
    url: p.url,
    previewUrl: p.displayUrl && p.displayUrl !== p.url ? p.displayUrl : undefined,
    label: p.captureLabel ? `${prefix}: ${p.captureLabel}` : `${prefix} photo ${i + 1}`,
  }));
}

// Card padding the strip bleeds through, so photos run edge to edge of the card.
const CARD_PAD = 16;
const GAP = 10;
const MAX_PHOTO_WIDTH = 560;
const MAX_DOTS = 12;

// Large photos (client item 6): one ~85%-of-screen 4:3 photo at a time, the next
// one peeking, snapping per photo. Only the photos near the visible one are
// mounted; the next two are prefetched.
function PhotoStrip({ set, onOpen }: { set: ConditionPhotoSet; onOpen: (images: ViewerImage[], index: number) => void }) {
  const { width: screenWidth } = useWindowDimensions();
  const [stripWidth, setStripWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const prefetched = useRef(new Set<string>());

  // Leave room for the next photo to peek in.
  const itemWidth = Math.round(
    Math.min(screenWidth * 0.85, stripWidth > 0 ? stripWidth - CARD_PAD - 28 : screenWidth * 0.85, MAX_PHOTO_WIDTH),
  );
  const interval = itemWidth + GAP;
  const total = set.photos.length;
  const src = (p: ConditionPhoto) => p.displayUrl || p.url;

  useEffect(() => {
    for (const p of set.photos.slice(index + 1, index + 3)) {
      const uri = src(p);
      if (prefetched.current.has(uri)) continue;
      prefetched.current.add(uri);
      Image.prefetch(uri).catch(() => prefetched.current.delete(uri));
    }
  }, [index, set.photos]);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / interval);
      setIndex(Math.min(Math.max(next, 0), total - 1));
    },
    [interval, total],
  );

  return (
    <View style={styles.stripWrap} onLayout={(e) => setStripWidth(e.nativeEvent.layout.width)}>
      {stripWidth > 0 && (
        <FlatList
          data={set.photos}
          keyExtractor={(p) => p.publicId}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={interval}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          contentContainerStyle={styles.strip}
          ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
          getItemLayout={(_d, i) => ({ length: interval, offset: interval * i, index: i })}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          windowSize={3}
          onMomentumScrollEnd={onScrollEnd}
          onScrollEndDrag={onScrollEnd}
          renderItem={({ item: p, index: i }) => (
            <TouchableOpacity
              style={{ width: itemWidth }}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel={`View handover photo ${i + 1} of ${total}${p.captureLabel ? `, ${p.captureLabel}` : ''}`}
              onPress={() => onOpen(viewerImages(set), i)}
            >
              <RemotePhoto uri={src(p)} style={[styles.photo, { width: itemWidth, height: Math.round((itemWidth * 3) / 4) }]} />
              <View style={styles.photoMeta}>
                <Text style={styles.photoLabel} numberOfLines={1}>{p.captureLabel ?? `Photo ${i + 1}`}</Text>
                {p.takenAt ? <Text style={styles.photoTime}>{formatDate(p.takenAt)}</Text> : null}
              </View>
            </TouchableOpacity>
          )}
        />
      )}
      {total > 1 && (
        <View style={styles.pager}>
          {total <= MAX_DOTS && (
            <View style={styles.dots}>
              {set.photos.map((p, i) => (
                <View key={p.publicId} style={[styles.dot, i === index && styles.dotActive]} />
              ))}
            </View>
          )}
          <Text style={styles.counter}>{`${index + 1} / ${total}`}</Text>
        </View>
      )}
    </View>
  );
}

function EarlierSet({ set, onOpen }: { set: ConditionPhotoSet; onOpen: (images: ViewerImage[], index: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.earlier}>
      <TouchableOpacity style={styles.earlierHead} onPress={() => setOpen((o) => !o)} activeOpacity={0.8} accessibilityRole="button">
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={15} color={Colors.ink3} />
        <Text style={styles.earlierTitle}>{setTitle(set)}</Text>
        <Text style={styles.earlierCount}>{set.photos.length}</Text>
      </TouchableOpacity>
      {open && <PhotoStrip set={set} onOpen={onOpen} />}
    </View>
  );
}

// Drop screen reference photos (item 2): the handover photos of the car being
// returned — after a mid-rental swap, the replacement's photos taken at the
// swap (or a warning when none were taken) — with the swapped-out cars'
// photos collapsed below. Renders nothing when there is nothing to show.
export default function HandoverConditionPhotos({
  data,
  onOpen,
  failed,
  onRetry,
}: {
  data: ReturnConditionCaptures | undefined;
  onOpen: (images: ViewerImage[], index: number) => void;
  // The photo list itself could not be fetched.
  failed?: boolean;
  onRetry?: () => void;
}) {
  if (!data && failed) {
    return (
      <>
        <Text style={styles.sectionHeader}>Pre-delivery Condition</Text>
        <View style={styles.card}>
          <View style={styles.failedRow}>
            <Ionicons name="cloud-offline-outline" size={18} color={Colors.ink3} />
            <Text style={styles.failedText}>Couldn't load the pickup photos. Check the connection and try again.</Text>
          </View>
          {onRetry && (
            <TouchableOpacity style={styles.failedRetry} onPress={onRetry} activeOpacity={0.8} accessibilityRole="button">
              <Ionicons name="refresh" size={15} color={Colors.ink} />
              <Text style={styles.failedRetryText}>Retry</Text>
            </TouchableOpacity>
          )}
        </View>
      </>
    );
  }
  if (!data) return null;
  const current: ConditionPhotoSet = data.currentVehicleCaptures ?? {
    source: 'PICKUP',
    vehicle: null,
    takenAt: null,
    swapPublicId: null,
    photosMissing: false,
    replaced: false,
    photos: data.photos ?? [],
  };
  const earlier = data.earlierCaptures ?? [];
  if (current.photos.length === 0 && !current.photosMissing && earlier.length === 0) return null;
  const atSwap = current.source === 'SWAP';

  return (
    <>
      <Text style={styles.sectionHeader}>{atSwap ? 'Condition at Handover' : 'Pre-delivery Condition'}</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>
          {atSwap
            ? `${setTitle(current)} — compare against its current condition.`
            : "Photos from pickup — compare against the vehicle's current condition."}
        </Text>
        {current.photosMissing && (
          <View style={styles.missing}>
            <Ionicons name="warning-outline" size={16} color="#b45309" />
            <Text style={styles.missingText}>{SWAP_PHOTOS_MISSING_NOTE}</Text>
          </View>
        )}
        {current.photos.length > 0 && <PhotoStrip set={current} onOpen={onOpen} />}
        {earlier.map((set) => (
          <EarlierSet key={set.swapPublicId ?? 'pickup'} set={set} onOpen={onOpen} />
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8, marginBottom: 4 },
  card: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.hairline, padding: 16, marginBottom: 4 },
  hint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17 },
  stripWrap: { marginHorizontal: -CARD_PAD, paddingTop: 12 },
  strip: { paddingHorizontal: CARD_PAD },
  photo: { borderRadius: 12 },
  photoMeta: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 6 },
  photoLabel: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  photoTime: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8, paddingHorizontal: CARD_PAD },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.ink4 },
  dotActive: { width: 16, backgroundColor: Colors.orange },
  counter: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.ink3, fontVariant: ['tabular-nums'] },
  missing: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12, padding: 12, borderRadius: 12,
    backgroundColor: Colors.availLowSoft, borderWidth: 1, borderColor: '#fcd34d',
  },
  missingText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: '#92400e', lineHeight: 18 },
  failedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  failedText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, lineHeight: 18 },
  failedRetry: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, marginTop: 12, height: 34,
    paddingHorizontal: 14, borderRadius: 17, borderWidth: 1, borderColor: Colors.hairline, backgroundColor: Colors.surface,
  },
  failedRetryText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  earlier: { marginTop: 12, borderTopWidth: 1, borderTopColor: Colors.hairline, paddingTop: 10 },
  earlierHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  earlierTitle: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  earlierCount: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
});

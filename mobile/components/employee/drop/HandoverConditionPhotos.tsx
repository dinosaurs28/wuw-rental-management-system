import { useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import ImageViewer, { type ViewerImage } from '../../ui/ImageViewer';
import RemotePhoto from '../../ui/RemotePhoto';
import { SWAP_PHOTOS_MISSING_NOTE } from '../VehicleSwapHistory';

// GET /api/employee/return/:bookingId/pickup-captures. `photos` = the pickup
// photos; the rest (item 2) is absent on older servers.
export interface ConditionPhoto {
  publicId: string;
  captureLabel: string | null;
  // The original (full-screen viewer).
  url: string;
  // ~1200 px copy for the on-screen photos; absent on older servers.
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

// Photos shown on the drop screen itself; the rest are behind "View all" (client TODO 8).
export const PREVIEW_COUNT = 2;

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

// "Photo 3 · Front left" — photos come in the order they were taken (oldest
// builds' photos: as saved), the same numbers as the drop photos.
export function photoCaption(index: number, label: string | null | undefined): string {
  return `Photo ${index + 1}${label ? ` · ${label}` : ''}`;
}

function viewerImages(set: ConditionPhotoSet): ViewerImage[] {
  const prefix = set.source === 'SWAP' ? `${set.vehicle?.regNo ?? 'Swap'} at swap · ` : '';
  return set.photos.map((p, i) => ({
    url: p.url,
    previewUrl: p.displayUrl && p.displayUrl !== p.url ? p.displayUrl : undefined,
    label: `${prefix}${photoCaption(i, p.captureLabel)}`,
  }));
}

const src = (p: ConditionPhoto) => p.displayUrl || p.url;

// One photo, 4:3, with its number, caption and time under it. Display copy
// first, the original if it fails, retries + tap-to-retry (RemotePhoto).
function PhotoTile({
  photo,
  index,
  total,
  width,
  onPress,
}: {
  photo: ConditionPhoto;
  index: number;
  total: number;
  width: number;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={{ width }}
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel={`View handover photo ${index + 1} of ${total}${photo.captureLabel ? `, ${photo.captureLabel}` : ''}`}
      onPress={onPress}
    >
      <View>
        <RemotePhoto
          uri={src(photo)}
          fallbackUri={photo.url}
          style={[styles.photo, { width, height: Math.round((width * 3) / 4) }]}
        />
        <View style={styles.numBadge} pointerEvents="none">
          <Text style={styles.numBadgeText}>{index + 1}</Text>
        </View>
      </View>
      <View style={styles.photoMeta}>
        <Text style={styles.photoLabel} numberOfLines={2}>
          {photoCaption(index, photo.captureLabel)}
        </Text>
        {photo.takenAt ? <Text style={styles.photoTime}>{formatDate(photo.takenAt)}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

// "View all": a bottom sheet, one full-width photo per row in the order taken —
// the returning car's set first, then (after a swap) the earlier cars' sets.
// Tapping a photo opens the zoomable viewer, rendered inside the sheet's modal
// so it stacks above it on iOS.
function AllPhotosSheet({
  visible,
  onClose,
  current,
  earlier,
}: {
  visible: boolean;
  onClose: () => void;
  current: ConditionPhotoSet;
  earlier: ConditionPhotoSet[];
}) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const [viewer, setViewer] = useState<{ images: ViewerImage[]; index: number } | null>(null);
  const photoWidth = Math.min(screenWidth, 720) - SHEET_PAD * 2;
  const sets = [current, ...earlier].filter((s) => s.photos.length > 0);
  const total = current.photos.length;

  return (
    <Modal transparent animationType="slide" visible={visible} statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
        <View style={[styles.sheet, { paddingTop: 10, maxHeight: '92%' }]}>
          <View style={styles.handle} />
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {current.source === 'SWAP' ? 'Handover photos' : 'Pickup photos'}
              {total > 0 ? ` (${total})` : ''}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.sheetClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close pickup photos"
            >
              <Ionicons name="close" size={20} color={Colors.ink} />
            </TouchableOpacity>
          </View>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: SHEET_PAD, paddingBottom: Math.max(insets.bottom, 16) + 8, gap: 18 }}
            showsVerticalScrollIndicator
          >
            {sets.map((set, si) => (
              <View key={set.swapPublicId ?? `pickup-${si}`} style={{ gap: 18 }}>
                {(si > 0 || set.source === 'SWAP' || earlier.length > 0) && (
                  <Text style={styles.sheetSetTitle}>
                    {setTitle(set)} · {set.photos.length} photo{set.photos.length === 1 ? '' : 's'}
                  </Text>
                )}
                {set.photos.map((p, i) => (
                  <PhotoTile
                    key={p.publicId}
                    photo={p}
                    index={i}
                    total={set.photos.length}
                    width={photoWidth}
                    onPress={() => setViewer({ images: viewerImages(set), index: i })}
                  />
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
        <ImageViewer
          visible={!!viewer}
          images={viewer?.images ?? []}
          startIndex={viewer?.index ?? 0}
          onClose={() => setViewer(null)}
        />
      </View>
    </Modal>
  );
}

// Drop screen reference photos (item 2; TODO 8): the first photos of the car
// being returned — after a mid-rental swap, the replacement's photos taken at
// the swap (or a warning when none were taken) — and "View all (N)", a sheet
// with every photo, the swapped-out cars' sets below. Renders nothing when
// there is nothing to show.
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cardWidth, setCardWidth] = useState(0);
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
  const earlier = (data.earlierCaptures ?? []).filter((s) => s.photos.length > 0);
  if (current.photos.length === 0 && !current.photosMissing && earlier.length === 0) return null;
  const atSwap = current.source === 'SWAP';
  const preview = current.photos.slice(0, PREVIEW_COUNT);
  const total = current.photos.length;
  const earlierCount = earlier.reduce((n, s) => n + s.photos.length, 0);
  // Two side by side; a single photo takes the full width.
  const tileWidth = cardWidth > 0 ? (preview.length > 1 ? Math.floor((cardWidth - GAP) / 2) : cardWidth) : 0;

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
        {preview.length > 0 && (
          <View style={styles.previewRow} onLayout={(e) => setCardWidth(Math.floor(e.nativeEvent.layout.width))}>
            {tileWidth > 0 &&
              preview.map((p, i) => (
                <PhotoTile
                  key={p.publicId}
                  photo={p}
                  index={i}
                  total={total}
                  width={tileWidth}
                  onPress={() => onOpen(viewerImages(current), i)}
                />
              ))}
          </View>
        )}
        {(total > preview.length || earlierCount > 0) && (
          <TouchableOpacity
            style={styles.viewAllBtn}
            onPress={() => setSheetOpen(true)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={total > 0 ? `View all ${total} handover photos` : 'View earlier photos'}
          >
            <Ionicons name="images-outline" size={16} color={Colors.ink} />
            <Text style={styles.viewAllText}>{total > 0 ? `View all (${total})` : `View earlier photos (${earlierCount})`}</Text>
          </TouchableOpacity>
        )}
        {earlierCount > 0 && total > 0 && (
          <Text style={styles.earlierNote}>
            The earlier car{earlier.length === 1 ? "'s" : "s'"} photos ({earlierCount}) are in View all.
          </Text>
        )}
      </View>
      <AllPhotosSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} current={current} earlier={earlier} />
    </>
  );
}

const GAP = 10;
const SHEET_PAD = 16;

const styles = StyleSheet.create({
  sectionHeader: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8, marginBottom: 4 },
  card: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.hairline, padding: 16, marginBottom: 4 },
  hint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17 },
  previewRow: { flexDirection: 'row', gap: GAP, marginTop: 12 },
  photo: { borderRadius: 12 },
  numBadge: {
    position: 'absolute', left: 8, top: 8, minWidth: 26, height: 26, paddingHorizontal: 7, borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center',
  },
  numBadgeText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.white },
  photoMeta: { gap: 2, marginTop: 6 },
  photoLabel: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  photoTime: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  viewAllBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, height: 40,
    borderRadius: 12, borderWidth: 1, borderColor: Colors.hairline, backgroundColor: Colors.surface,
  },
  viewAllText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  earlierNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 8, textAlign: 'center' },
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
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.hairline, marginBottom: 6 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SHEET_PAD, paddingBottom: 10 },
  sheetTitle: { flex: 1, fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink, letterSpacing: -0.3 },
  sheetClose: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.hairline,
  },
  sheetSetTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink2, marginTop: 4 },
});

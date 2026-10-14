import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import type { ViewerImage } from '../../ui/ImageViewer';
import { SWAP_PHOTOS_MISSING_NOTE } from '../VehicleSwapHistory';

// GET /api/employee/return/:bookingId/pickup-captures. `photos` = the pickup
// photos; the rest (item 2) is absent on older servers.
export interface ConditionPhoto {
  publicId: string;
  captureLabel: string | null;
  url: string;
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
  return set.photos.map((p, i) => ({ url: p.url, label: p.captureLabel ? `${prefix}: ${p.captureLabel}` : `${prefix} photo ${i + 1}` }));
}

function PhotoStrip({ set, onOpen }: { set: ConditionPhotoSet; onOpen: (images: ViewerImage[], index: number) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {set.photos.map((p, i) => (
        <TouchableOpacity
          key={p.publicId}
          style={styles.thumbWrap}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="View handover photo"
          onPress={() => onOpen(viewerImages(set), i)}
        >
          <Image source={{ uri: p.url }} style={styles.thumb} resizeMode="cover" />
          {p.captureLabel ? <Text style={styles.thumbLabel} numberOfLines={1}>{p.captureLabel}</Text> : null}
        </TouchableOpacity>
      ))}
    </ScrollView>
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
}: {
  data: ReturnConditionCaptures | undefined;
  onOpen: (images: ViewerImage[], index: number) => void;
}) {
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
  strip: { gap: 10, paddingTop: 12, paddingRight: 4 },
  thumbWrap: { width: 110, gap: 4 },
  thumb: { width: 110, height: 84, borderRadius: 10, backgroundColor: Colors.bg },
  thumbLabel: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3 },
  missing: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12, padding: 12, borderRadius: 12,
    backgroundColor: Colors.availLowSoft, borderWidth: 1, borderColor: '#fcd34d',
  },
  missingText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: '#92400e', lineHeight: 18 },
  earlier: { marginTop: 12, borderTopWidth: 1, borderTopColor: Colors.hairline, paddingTop: 10 },
  earlierHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  earlierTitle: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  earlierCount: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
});

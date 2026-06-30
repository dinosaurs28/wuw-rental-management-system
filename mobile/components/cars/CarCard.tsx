import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Fonts } from '../../constants/colors';
import { unitLabel, periodLabel } from '../../lib/pricing';
import { availabilityLabel, availabilityColor } from '../../lib/availability';
import StudioImage from './StudioImage';
import Chip from '../ui/Chip';
import type { Vehicle } from '../../types/api';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 52) / 2;

interface CarCardProps {
  vehicle: Vehicle;
  onPress?: () => void;
  /** wider card for horizontal "recommended" rails */
  width?: number;
}

export default function CarCard({ vehicle, onPress, width: cardWidth }: CarCardProps) {
  const router = useRouter();
  const thumb = vehicle.images?.[0];
  const handlePress = onPress ?? (() => router.push(`/vehicle/${vehicle.publicId}`));

  // Per-period headline RATE (priceInfo.price) + matching unit; total lives on detail.
  // A 0 rate means "unpriced" (no custom/branch-default rate) → show the em-dash, not "₹0".
  const rawPrice = vehicle.priceInfo?.price ?? vehicle.pricing?.daily ?? null;
  const price = rawPrice && rawPrice > 0 ? rawPrice : null;
  const priceUnit = vehicle.priceInfo ? unitLabel(vehicle.priceInfo.type) : '/ day';
  const badge = vehicle.priceInfo ? periodLabel(vehicle.priceInfo.type) : null;
  const availLabel = availabilityLabel(vehicle.availableCount);

  return (
    <TouchableOpacity
      style={[styles.card, { width: cardWidth ?? CARD_WIDTH }]}
      onPress={handlePress}
      activeOpacity={0.9}
    >
      <StudioImage uri={thumb} height={120} radius={0} contain>
        <View style={styles.imgTop}>
          {vehicle.category ? <Chip label={vehicle.category} variant="glass" /> : <View />}
        </View>
        {badge ? (
          <View style={styles.imgBottom}>
            <Chip label={badge} variant="glass" />
          </View>
        ) : null}
      </StudioImage>

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {vehicle.make} {vehicle.model}
        </Text>

        {availLabel ? (
          <View style={styles.availRow}>
            <View style={[styles.dot, { backgroundColor: availabilityColor(vehicle.availableCount) }]} />
            <Text style={styles.avail}>{availLabel}</Text>
          </View>
        ) : null}

        <View style={styles.priceRow}>
          {price != null ? (
            <Text style={styles.price}>
              ₹{price.toLocaleString('en-IN')}
              <Text style={styles.unit}> {priceUnit}</Text>
            </Text>
          ) : (
            <Text style={styles.price}>—</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardDark,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  imgTop: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  imgBottom: { position: 'absolute', bottom: 8, left: 8 },
  info: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 5 },
  name: {
    fontFamily: Fonts.displayBold,
    fontSize: 14,
    color: Colors.white,
    letterSpacing: -0.2,
    textTransform: 'uppercase',
  },
  availRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  avail: { fontFamily: Fonts.bodyMedium, fontSize: 11, color: Colors.onDarkMuted },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 2 },
  price: { fontFamily: Fonts.displayBold, fontSize: 16, color: Colors.white, letterSpacing: -0.3 },
  unit: { fontFamily: Fonts.body, fontSize: 11, color: Colors.onDarkMuted },
});

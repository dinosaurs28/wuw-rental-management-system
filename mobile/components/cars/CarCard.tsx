import { View, Text, Image, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { unitLabel, periodLabel } from '../../lib/pricing';
import type { Vehicle } from '../../types/api';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 52) / 2;

interface CarCardProps {
  vehicle: Vehicle;
  onPress?: () => void;
}

export default function CarCard({ vehicle, onPress }: CarCardProps) {
  const router = useRouter();
  const thumb = vehicle.images?.[0];

  const handlePress = onPress ?? (() => router.push(`/vehicle/${vehicle.publicId}`));

  // Duration-aware headline RATE: when dates were queried, show the per-period rate
  // (priceInfo.price) with its matching per-period unit; else the flat daily rate.
  // The trip total is shown on the details/checkout screens. Badge = real period type.
  const price = vehicle.priceInfo?.price ?? vehicle.pricing?.daily ?? null;
  const priceUnit = vehicle.priceInfo ? unitLabel(vehicle.priceInfo.type) : '/day';
  const badge = vehicle.priceInfo ? periodLabel(vehicle.priceInfo.type) : null;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={handlePress}
      activeOpacity={0.88}
    >
      {/* Photo / Placeholder */}
      <View style={styles.photoContainer}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={styles.placeholder}>
            <Ionicons name="car-sport-outline" size={36} color="rgba(0,0,0,0.12)" />
          </View>
        )}

        {/* Category badge */}
        <View style={styles.categoryBadge}>
          <Text style={styles.categoryText}>{vehicle.category}</Text>
        </View>
      </View>

      {/* Info */}
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {vehicle.make} {vehicle.model}
          </Text>
          {badge && (
            <View style={styles.periodBadge}>
              <Text style={styles.periodBadgeText}>{badge}</Text>
            </View>
          )}
        </View>

        <View style={styles.row}>
          {price != null ? (
            <Text style={styles.price}>
              ₹{price.toLocaleString('en-IN')}
              <Text style={styles.perDay}> {priceUnit}</Text>
            </Text>
          ) : (
            <Text style={styles.price}>—</Text>
          )}
          {vehicle.availableCount != null && vehicle.availableCount > 0 && (
            <View style={styles.availPill}>
              <Text style={styles.availText}>{vehicle.availableCount} avail</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    backgroundColor: Colors.surface,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  photoContainer: { position: 'relative' },
  photo: { width: '100%', height: 130 },
  placeholder: {
    width: '100%',
    height: 130,
    backgroundColor: '#f0f0ee',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  categoryText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 10,
    color: Colors.white,
    letterSpacing: 0.2,
  },
  info: { padding: 12, gap: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  name: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
    lineHeight: 18,
  },
  periodBadge: {
    backgroundColor: Colors.bg,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  periodBadgeText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 9,
    color: Colors.ink3,
    letterSpacing: 0.2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  price: {
    fontFamily: Fonts.displayBold,
    fontSize: 14,
    color: Colors.ink,
    letterSpacing: -0.3,
  },
  perDay: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.ink3,
  },
  availPill: {
    backgroundColor: '#e8f5ee',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  availText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 10,
    color: '#2d7d4f',
  },
});

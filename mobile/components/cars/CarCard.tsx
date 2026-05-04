import { View, Text, Image, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import type { Vehicle } from '../../types/api';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 52) / 2;

interface CarCardProps {
  vehicle: Vehicle;
}

export default function CarCard({ vehicle }: CarCardProps) {
  const router = useRouter();
  const thumb = vehicle.images?.[0];

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/vehicle/${vehicle.publicId}`)}
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
        <Text style={styles.name} numberOfLines={1}>
          {vehicle.make} {vehicle.model}
        </Text>

        <View style={styles.row}>
          {vehicle.pricing?.daily != null ? (
            <Text style={styles.price}>
              ₹{vehicle.pricing.daily.toLocaleString('en-IN')}
              <Text style={styles.perDay}>/day</Text>
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
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
    lineHeight: 18,
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

import { View, Text, Image, StyleSheet, TouchableOpacity, Dimensions, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Fonts } from '../../constants/colors';
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
  const available = vehicle.availableCount ?? 0;
  const price = vehicle.pricing?.daily;

  return (
    <TouchableOpacity style={styles.card} onPress={handlePress} activeOpacity={0.92}>
      {/* Photo hero */}
      <View style={styles.photoContainer}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={styles.photo} resizeMode="contain" />
        ) : (
          <View style={styles.placeholder}>
            <Ionicons name="car-sport-outline" size={40} color="rgba(0,0,0,0.12)" />
          </View>
        )}

        {/* Gradient mask for legible overlay text */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.0)', 'rgba(0,0,0,0.72)']}
          locations={[0, 0.45, 1]}
          style={styles.gradient}
          pointerEvents="none"
        />

        {/* Availability indicator — top right */}
        {available > 0 && (
          <View style={styles.availBadge}>
            <View style={styles.availDot} />
            <Text style={styles.availText}>{available}</Text>
          </View>
        )}

        {/* Title overlay — bottom left */}
        <View style={styles.titleOverlay}>
          <Text style={styles.makeLabel} numberOfLines={1}>
            {vehicle.make?.toUpperCase()}
          </Text>
          <Text style={styles.modelLabel} numberOfLines={1}>
            {vehicle.model}
          </Text>
        </View>
      </View>

      {/* Editorial price footer */}
      <View style={styles.footer}>
        <View style={styles.priceWrap}>
          {price != null ? (
            <>
              <Text style={styles.priceCurrency}>₹</Text>
              <Text style={styles.priceAmount}>{price.toLocaleString('en-IN')}</Text>
              <Text style={styles.priceUnit}>/day</Text>
            </>
          ) : (
            <Text style={styles.priceAmount}>—</Text>
          )}
        </View>

        <View style={styles.arrowBtn}>
          <Ionicons name="arrow-forward" size={13} color={Colors.ink} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.hairline,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.04,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 1 },
    }),
  },
  photoContainer: {
    position: 'relative',
    height: 158,
    overflow: 'hidden',
    backgroundColor: '#f6f6f4',
  },
  photo: { width: '100%', height: '100%' },
  placeholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#f0f0ee',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },

  // Availability badge — glassy, top-right
  availBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  availDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22c55e',
  },
  availText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: Colors.ink,
    letterSpacing: 0.2,
  },

  // Title overlay on photo
  titleOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
  },
  makeLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.78)',
    letterSpacing: 1.4,
    marginBottom: 2,
  },
  modelLabel: {
    fontFamily: Fonts.displayBold,
    fontSize: 18,
    color: Colors.white,
    letterSpacing: -0.4,
    lineHeight: 22,
  },

  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
  },
  priceWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexShrink: 1,
  },
  priceCurrency: {
    fontFamily: Fonts.display,
    fontSize: 13,
    color: Colors.ink2,
    marginRight: 1,
  },
  priceAmount: {
    fontFamily: Fonts.displayBold,
    fontSize: 22,
    color: Colors.ink,
    letterSpacing: -0.8,
    lineHeight: 24,
  },
  priceUnit: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.ink3,
    marginLeft: 2,
  },
  arrowBtn: {
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
});

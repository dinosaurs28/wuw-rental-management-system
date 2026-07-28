import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { unitLabel } from '../../lib/pricing';
import type { Vehicle } from '../../types/api';

interface Props {
  vehicle: Vehicle;
  onPress: () => void;
}

// Full-width Sixt-style offer card: big uppercase title, real-data chips,
// large studio image, availability check line, "₹rate / day · ₹total total".
export default function OfferCard({ vehicle, onPress }: Props) {
  const thumb = vehicle.images?.[0];
  const dated = !!vehicle.priceInfo;

  // Per-period headline rate; 0 means "unpriced" → em-dash, never "₹0".
  const rawRate = vehicle.priceInfo?.price ?? vehicle.pricing?.daily ?? null;
  const rate = rawRate && rawRate > 0 ? rawRate : null;
  const unit = unitLabel(vehicle.priceInfo?.type);
  const total = dated && vehicle.priceInfo!.finalPrice > 0 ? vehicle.priceInfo!.finalPrice : null;

  const count = vehicle.availableCount;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.92}>
      <LinearGradient
        colors={['#2b303a', '#181b21', '#0f1116']}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.body}>
        <Text style={styles.title}>{vehicle.make} {vehicle.model}</Text>
        {vehicle.category ? <Text style={styles.subtitle}>{vehicle.category}</Text> : null}

        {/* Real-data chips */}
        <View style={styles.chips}>
          {typeof count === 'number' ? (
            <View style={styles.chip}>
              <Ionicons name="car-outline" size={14} color={Colors.onDark} />
              <Text style={styles.chipText}>{count}</Text>
            </View>
          ) : null}
          {vehicle.branch ? (
            <View style={styles.chip}>
              <Ionicons name="location-outline" size={14} color={Colors.onDark} />
              <Text style={styles.chipText}>{vehicle.branch}</Text>
            </View>
          ) : null}
        </View>

        {/* Vehicle image */}
        <View style={styles.imageWrap}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.image} resizeMode="contain" />
          ) : (
            <Ionicons name="car-sport-outline" size={56} color="rgba(255,255,255,0.16)" />
          )}
        </View>

        {/* Check line — only claims backed by the availability-filtered query */}
        {dated && typeof count === 'number' && count > 0 ? (
          <View style={styles.checkRow}>
            <Ionicons name="checkmark" size={17} color={Colors.availGood} />
            <Text style={styles.checkText}>
              {count === 1 ? 'Available for your dates' : `${count} available for your dates`}
            </Text>
          </View>
        ) : null}

        {/* Price */}
        <View style={styles.priceRow}>
          {rate != null ? (
            <>
              <Text style={styles.price}>
                ₹{rate.toLocaleString('en-IN')}
                <Text style={styles.priceUnit}> {unit}</Text>
              </Text>
              {total != null ? (
                <Text style={styles.total}>₹{total.toLocaleString('en-IN')} total</Text>
              ) : null}
            </>
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
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  body: { padding: 20 },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 26,
    lineHeight: 31,
    color: Colors.white,
    letterSpacing: -0.4,
    textTransform: 'uppercase',
  },
  subtitle: { fontFamily: Fonts.body, fontSize: 15, color: Colors.onDarkMuted, marginTop: 4 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.glass,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.onDark },

  imageWrap: { height: 180, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  image: { width: '100%', height: '100%' },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  checkText: { fontFamily: Fonts.body, fontSize: 14.5, color: Colors.onDark },

  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 14 },
  price: { fontFamily: Fonts.displayBold, fontSize: 26, color: Colors.white, letterSpacing: -0.5 },
  priceUnit: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.onDarkMuted, letterSpacing: 0 },
  total: { fontFamily: Fonts.body, fontSize: 15, color: Colors.onDarkMuted },
});

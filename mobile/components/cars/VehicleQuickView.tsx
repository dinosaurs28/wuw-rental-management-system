import {
  Dimensions,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import type { Vehicle } from '../../types/api';

const { height } = Dimensions.get('window');

const INCLUDED = ['Insurance coverage', '24/7 Support', '200 km/day', 'Roadside assist'];

interface Props {
  vehicle: Vehicle | null;
  onClose: () => void;
}

export default function VehicleQuickView({ vehicle, onClose }: Props) {
  const router = useRouter();

  const handleViewDetails = () => {
    const id = vehicle!.publicId;
    onClose();
    router.push({ pathname: '/vehicle/[id]', params: { id } });
  };

  return (
    <Modal
      visible={!!vehicle}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        <TouchableWithoutFeedback>
          <View style={styles.sheet}>
            {/* Drag handle */}
            <View style={styles.handle} />

            {/* Image hero */}
            <View style={styles.imageWrap}>
              {vehicle?.images?.[0] ? (
                <Image
                  source={{ uri: vehicle.images[0] }}
                  style={styles.image}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.imagePlaceholder}>
                  <Ionicons name="car-sport-outline" size={52} color="rgba(0,0,0,0.12)" />
                </View>
              )}

              <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={8} activeOpacity={0.8}>
                <Ionicons name="close" size={16} color={Colors.ink} />
              </TouchableOpacity>

              {vehicle?.pricing?.daily != null && (
                <View style={styles.pricePill}>
                  <Text style={styles.pricePillText}>
                    ₹{vehicle.pricing.daily.toLocaleString('en-IN')}
                    <Text style={styles.pricePillDay}>/day</Text>
                  </Text>
                </View>
              )}
            </View>

            <ScrollView
              style={styles.body}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.bodyContent}
            >
              {/* Name */}
              <Text style={styles.name}>
                {vehicle?.make} {vehicle?.model}
              </Text>

              {/* Badges row */}
              <View style={styles.badges}>
                {vehicle?.category ? (
                  <View style={styles.badge}>
                    <Ionicons name="layers-outline" size={12} color={Colors.orange} />
                    <Text style={styles.badgeText}>{vehicle.category}</Text>
                  </View>
                ) : null}
                {vehicle?.branch ? (
                  <View style={[styles.badge, styles.badgeMuted]}>
                    <Ionicons name="location-outline" size={12} color={Colors.ink3} />
                    <Text style={[styles.badgeText, styles.badgeTextMuted]}>{vehicle.branch}</Text>
                  </View>
                ) : null}
                {vehicle?.availableCount != null && vehicle.availableCount > 0 ? (
                  <View style={[styles.badge, styles.badgeGreen]}>
                    <Text style={[styles.badgeText, styles.badgeTextGreen]}>
                      {vehicle.availableCount} available
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* What's included */}
              <Text style={styles.sectionLabel}>What's included</Text>
              <View style={styles.includedGrid}>
                {INCLUDED.map((item) => (
                  <View key={item} style={styles.includedItem}>
                    <View style={styles.checkWrap}>
                      <Ionicons name="checkmark" size={11} color="#2d9d61" />
                    </View>
                    <Text style={styles.includedText}>{item}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>

            {/* CTA */}
            <View style={styles.cta}>
              <TouchableOpacity
                style={styles.ctaBtn}
                onPress={handleViewDetails}
                activeOpacity={0.85}
              >
                <Text style={styles.ctaBtnText}>View Details</Text>
                <Ionicons name="arrow-forward" size={16} color={Colors.white} />
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: height * 0.8,
    overflow: 'hidden',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.ink4,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  imageWrap: {
    height: 196,
    margin: 16,
    marginBottom: 0,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#f0f0ee',
  },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pricePill: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: Colors.orange,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pricePillText: {
    fontFamily: Fonts.displayBold,
    fontSize: 14,
    color: Colors.white,
    letterSpacing: -0.3,
  },
  pricePillDay: {
    fontFamily: Fonts.body,
    fontSize: 11,
  },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  name: {
    fontFamily: Fonts.displayBold,
    fontSize: 24,
    color: Colors.ink,
    letterSpacing: -0.6,
    marginBottom: 12,
  },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Colors.orangeSoft,
    borderWidth: 1,
    borderColor: '#ff6a1f20',
  },
  badgeMuted: {
    backgroundColor: Colors.surface,
    borderColor: Colors.hairline,
  },
  badgeGreen: {
    backgroundColor: '#e8f5ee',
    borderColor: '#2d9d6120',
    borderWidth: 1,
  },
  badgeText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 12,
    color: Colors.orange,
  },
  badgeTextMuted: { color: Colors.ink3 },
  badgeTextGreen: { color: '#2d7d4f' },
  sectionLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginBottom: 12,
  },
  includedGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  includedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '46%',
  },
  checkWrap: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#e8f5ee',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  includedText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink2,
    flex: 1,
  },
  cta: {
    padding: 20,
    paddingBottom: 36,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
    backgroundColor: Colors.surface,
  },
  ctaBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
    letterSpacing: 0.2,
  },
});

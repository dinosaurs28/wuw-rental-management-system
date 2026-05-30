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
import { displayCategory } from '../../lib/categoryDisplay';
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

  const price = vehicle?.pricing?.daily;
  const available = vehicle?.availableCount ?? 0;

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
            {/* Sheet header: drag handle + close */}
            <View style={styles.sheetHeader}>
              <View style={styles.handle} />
              <TouchableOpacity
                onPress={onClose}
                style={styles.closeBtn}
                hitSlop={10}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={18} color={Colors.ink2} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.body}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.bodyContent}
              bounces={false}
            >
              {/* Hero image */}
              <View style={styles.imageWrap}>
                {vehicle?.images?.[0] ? (
                  <Image
                    source={{ uri: vehicle.images[0] }}
                    style={styles.image}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={styles.imagePlaceholder}>
                    <Ionicons name="car-sport-outline" size={56} color="rgba(0,0,0,0.12)" />
                  </View>
                )}
              </View>

              {/* Title block */}
              <View style={styles.titleBlock}>
                <Text style={styles.makeLabel} numberOfLines={1}>
                  {vehicle?.make?.toUpperCase()}
                </Text>
                <Text style={styles.modelLabel} numberOfLines={2}>
                  {vehicle?.model}
                </Text>
              </View>

              {/* Stat tiles */}
              <View style={styles.tiles}>
                {vehicle?.category ? (
                  <View style={styles.tile}>
                    <View style={styles.tileIcon}>
                      <Ionicons name="layers-outline" size={14} color={Colors.orange} />
                    </View>
                    <Text style={styles.tileLabel}>Category</Text>
                    <Text style={styles.tileValue} numberOfLines={1}>
                      {displayCategory(vehicle.category)}
                    </Text>
                  </View>
                ) : null}

                {vehicle?.branch ? (
                  <View style={styles.tile}>
                    <View style={styles.tileIcon}>
                      <Ionicons name="location-outline" size={14} color={Colors.orange} />
                    </View>
                    <Text style={styles.tileLabel}>Branch</Text>
                    <Text style={styles.tileValue} numberOfLines={1}>
                      {vehicle.branch}
                    </Text>
                  </View>
                ) : null}

                {available > 0 ? (
                  <View style={styles.tile}>
                    <View style={[styles.tileIcon, styles.tileIconGreen]}>
                      <Ionicons name="checkmark" size={14} color="#2d9d61" />
                    </View>
                    <Text style={styles.tileLabel}>Available</Text>
                    <Text style={styles.tileValue} numberOfLines={1}>
                      {available} {available === 1 ? 'unit' : 'units'}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Price card */}
              {price != null ? (
                <View style={styles.priceCard}>
                  <Text style={styles.priceEyebrow}>Starting from</Text>
                  <View style={styles.priceRow}>
                    <Text style={styles.priceCurrency}>₹</Text>
                    <Text style={styles.priceAmount}>{price.toLocaleString('en-IN')}</Text>
                    <Text style={styles.priceUnit}>/day</Text>
                  </View>
                  <View style={styles.priceFootnote}>
                    <View style={styles.priceFootnoteDot} />
                    <Text style={styles.priceFootnoteText}>Taxes calculated at checkout</Text>
                  </View>
                </View>
              ) : null}

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
                activeOpacity={0.9}
              >
                <Text style={styles.ctaBtnText}>View Details</Text>
                <View style={styles.ctaArrow}>
                  <Ionicons name="arrow-forward" size={14} color={Colors.orange} />
                </View>
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
    maxHeight: height * 0.88,
    overflow: 'hidden',
  },

  // Sheet header
  sheetHeader: {
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 999,
    backgroundColor: Colors.ink4,
  },
  closeBtn: {
    position: 'absolute',
    right: 14,
    top: 10,
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.hairline,
  },

  body: { flexGrow: 0 },
  bodyContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
  },

  // Hero image
  imageWrap: {
    height: 200,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#f1f1ee',
    marginBottom: 18,
  },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Title
  titleBlock: { marginBottom: 18 },
  makeLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    letterSpacing: 1.6,
    marginBottom: 4,
  },
  modelLabel: {
    fontFamily: Fonts.displayBold,
    fontSize: 26,
    color: Colors.ink,
    letterSpacing: -0.6,
    lineHeight: 30,
  },

  // Stat tiles
  tiles: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 18,
  },
  tile: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 6,
  },
  tileIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: '#ff6a1f12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileIconGreen: { backgroundColor: '#e8f5ee' },
  tileLabel: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginTop: 2,
  },
  tileValue: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },

  // Price card
  priceCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.hairline,
    marginBottom: 22,
  },
  priceEyebrow: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  priceCurrency: {
    fontFamily: Fonts.display,
    fontSize: 18,
    color: Colors.ink2,
    marginRight: 2,
  },
  priceAmount: {
    fontFamily: Fonts.displayBold,
    fontSize: 36,
    color: Colors.ink,
    letterSpacing: -1.2,
    lineHeight: 40,
  },
  priceUnit: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink3,
    marginLeft: 4,
  },
  priceFootnote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  priceFootnoteDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.ink4,
  },
  priceFootnoteText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.ink3,
  },

  // Included
  sectionLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
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
    width: '47%',
  },
  checkWrap: {
    width: 20,
    height: 20,
    borderRadius: 999,
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

  // CTA bar
  cta: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
    backgroundColor: Colors.surface,
  },
  ctaBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ctaBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
    letterSpacing: 0.2,
  },
  ctaArrow: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

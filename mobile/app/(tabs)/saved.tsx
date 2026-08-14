import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Fonts } from '../../constants/colors';
import { useSavedStore } from '../../store/saved';
import VehicleQuickView from '../../components/cars/VehicleQuickView';
import { displayCategory } from '../../lib/categoryDisplay';
import { useState } from 'react';
import type { Vehicle } from '../../types/api';

export default function Saved() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const saved = useSavedStore(s => s.saved);
  const toggleSaved = useSavedStore(s => s.toggle);
  const [quickView, setQuickView] = useState<Vehicle | null>(null);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Saved</Text>
        {saved.length > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{saved.length}</Text>
          </View>
        )}
      </View>

      {saved.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="heart-outline" size={32} color={Colors.ink4} />
          </View>
          <Text style={styles.emptyTitle}>Nothing saved yet</Text>
          <Text style={styles.emptySubtitle}>
            Tap the heart on any car to save it here for later.
          </Text>
          <TouchableOpacity
            style={styles.browseBtn}
            onPress={() => router.push('/(tabs)')}
            activeOpacity={0.85}
          >
            <Text style={styles.browseBtnText}>Browse vehicles</Text>
            <Ionicons name="arrow-forward" size={14} color={Colors.white} />
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={saved}
          keyExtractor={v => v.publicId}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <SavedHero
              vehicle={item}
              onPress={() => setQuickView(item)}
              onUnsave={() => toggleSaved(item)}
            />
          )}
        />
      )}

      <VehicleQuickView vehicle={quickView} onClose={() => setQuickView(null)} />
    </View>
  );
}

function SavedHero({
  vehicle,
  onPress,
  onUnsave,
}: {
  vehicle: Vehicle;
  onPress: () => void;
  onUnsave: () => void;
}) {
  const thumb = vehicle.images?.[0];
  const price = vehicle.pricing?.daily;
  const available = vehicle.availableCount ?? 0;

  return (
    <TouchableOpacity style={styles.hero} onPress={onPress} activeOpacity={0.94}>
      {/* Hero image */}
      <View style={styles.heroPhotoWrap}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={styles.heroPhoto} resizeMode="contain" />
        ) : (
          <View style={styles.heroPlaceholder}>
            <Ionicons name="car-sport-outline" size={56} color="rgba(0,0,0,0.14)" />
          </View>
        )}

        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.0)', 'rgba(0,0,0,0.78)']}
          locations={[0, 0.45, 1]}
          style={styles.heroGradient}
          pointerEvents="none"
        />

        {/* Unsave button — glassy, top-right */}
        <TouchableOpacity
          style={styles.heroUnsave}
          onPress={onUnsave}
          hitSlop={10}
          activeOpacity={0.8}
        >
          <Ionicons name="heart" size={18} color={Colors.orange} />
        </TouchableOpacity>

        {/* Availability — top-left */}
        {available > 0 && (
          <View style={styles.heroAvail}>
            <View style={styles.heroAvailDot} />
            <Text style={styles.heroAvailText}>{available} available</Text>
          </View>
        )}

        {/* Title overlay */}
        <View style={styles.heroTitleOverlay}>
          <Text style={styles.heroMake} numberOfLines={1}>
            {vehicle.make?.toUpperCase()}
          </Text>
          <Text style={styles.heroModel} numberOfLines={2}>
            {vehicle.model}
          </Text>
        </View>
      </View>

      {/* Footer */}
      <View style={styles.heroFooter}>
        <View style={styles.heroPriceWrap}>
          {price != null ? (
            <>
              <Text style={styles.heroPriceCurrency}>₹</Text>
              <Text style={styles.heroPrice}>{price.toLocaleString('en-IN')}</Text>
              <Text style={styles.heroPriceUnit}>/day</Text>
            </>
          ) : (
            <Text style={styles.heroPrice}>—</Text>
          )}
        </View>

        <View style={styles.heroMetaWrap}>
          <Text style={styles.heroMeta} numberOfLines={1}>
            {displayCategory(vehicle.category)}
          </Text>
          <View style={styles.heroArrow}>
            <Ionicons name="arrow-forward" size={14} color={Colors.ink} />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 26,
    color: Colors.ink,
    letterSpacing: -0.8,
  },
  countBadge: {
    backgroundColor: '#e53e3e',
    borderRadius: 999,
    minWidth: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  countText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.white,
  },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 48, gap: 12, paddingBottom: 80,
  },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.hairline,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 20, color: Colors.ink, letterSpacing: -0.4,
  },
  emptySubtitle: {
    fontFamily: Fonts.body,
    fontSize: 14, color: Colors.ink3,
    textAlign: 'center', lineHeight: 20,
  },
  browseBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.orange,
    borderRadius: 14, paddingVertical: 13, paddingHorizontal: 20,
    marginTop: 8,
  },
  browseBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14, color: Colors.white,
  },
  list: { paddingHorizontal: 16, paddingBottom: 100 },
  separator: { height: 16 },

  // Hero card
  hero: {
    backgroundColor: Colors.surface,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.hairline,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  heroPhotoWrap: {
    height: 240,
    backgroundColor: '#f6f6f4',
    position: 'relative',
  },
  heroPhoto: { width: '100%', height: '100%' },
  heroPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  heroUnsave: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAvail: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  heroAvailDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22c55e',
  },
  heroAvailText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    color: Colors.ink,
    letterSpacing: 0.2,
  },
  heroTitleOverlay: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 16,
  },
  heroMake: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.78)',
    letterSpacing: 1.6,
    marginBottom: 4,
  },
  heroModel: {
    fontFamily: Fonts.displayBold,
    fontSize: 26,
    color: Colors.white,
    letterSpacing: -0.6,
    lineHeight: 30,
  },

  // Footer
  heroFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 12,
  },
  heroPriceWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  heroPriceCurrency: {
    fontFamily: Fonts.display,
    fontSize: 16,
    color: Colors.ink2,
    marginRight: 1,
  },
  heroPrice: {
    fontFamily: Fonts.displayBold,
    fontSize: 24,
    color: Colors.ink,
    letterSpacing: -0.8,
    lineHeight: 28,
  },
  heroPriceUnit: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink3,
    marginLeft: 3,
  },
  heroMetaWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  heroMeta: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 12,
    color: Colors.ink3,
    flexShrink: 1,
  },
  heroArrow: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
});

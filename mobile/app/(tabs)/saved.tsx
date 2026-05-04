import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { useSavedStore } from '../../store/saved';
import CarCard from '../../components/cars/CarCard';
import VehicleQuickView from '../../components/cars/VehicleQuickView';
import { useState } from 'react';
import type { Vehicle } from '../../types/api';

export default function Saved() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const saved = useSavedStore(s => s.saved);
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
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <CarCard vehicle={item} onPress={() => setQuickView(item)} />
          )}
        />
      )}

      <VehicleQuickView vehicle={quickView} onClose={() => setQuickView(null)} />
    </View>
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
  grid: { paddingHorizontal: 20, paddingBottom: 100 },
  row: { gap: 12, marginBottom: 12 },
});

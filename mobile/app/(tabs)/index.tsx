import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { vehiclesApi } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import CarCard from '../../components/cars/CarCard';
import type { Vehicle } from '../../types/api';

const CATEGORIES = ['All', 'SUV', 'Sedan', 'Truck', 'Luxury', 'EV', 'Convertible'];

export default function Browse() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const insets = useSafeAreaInsets();
  const [selectedCategory, setSelectedCategory] = useState('All');

  const { data: vehiclesData, isLoading } = useQuery({
    queryKey: ['vehicles', selectedCategory],
    queryFn: () =>
      vehiclesApi.list({
        category: selectedCategory === 'All' ? undefined : selectedCategory,
        limit: 30,
      }),
    select: (res) => {
      const all = (res.data.data as Vehicle[]) ?? [];
      const seen = new Set<string>();
      return all.filter((v) => {
        if (seen.has(v.publicId)) return false;
        seen.add(v.publicId);
        return true;
      });
    },
  });

  const firstName = user?.name?.split(' ')[0] ?? 'there';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hi, {firstName}</Text>
          <Text style={styles.greetingSub}>Find your perfect drive</Text>
        </View>
        <TouchableOpacity
          style={styles.avatarCircle}
          onPress={() => router.push('/(tabs)/profile')}
          activeOpacity={0.8}
        >
          <Text style={styles.avatarText}>{firstName[0]?.toUpperCase()}</Text>
        </TouchableOpacity>
      </View>

      {/* Search bar */}
      <TouchableOpacity
        style={styles.searchBar}
        onPress={() => router.push('/search')}
        activeOpacity={0.92}
      >
        <View style={styles.searchIconWrap}>
          <Ionicons name="search-outline" size={16} color={Colors.ink3} />
        </View>
        <Text style={styles.searchPlaceholder}>Search cars…</Text>
        <View style={styles.searchFilter}>
          <Ionicons name="options-outline" size={16} color={Colors.ink3} />
        </View>
      </TouchableOpacity>

      {/* Category chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        style={styles.chipsScroll}
      >
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat}
            style={[styles.chip, selectedCategory === cat && styles.chipActive]}
            onPress={() => setSelectedCategory(cat)}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipText, selectedCategory === cat && styles.chipTextActive]}>
              {cat}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Section label */}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionLabel}>
          {selectedCategory === 'All' ? 'Available now' : selectedCategory}
        </Text>
        {vehiclesData && (
          <Text style={styles.sectionCount}>{vehiclesData.length} cars</Text>
        )}
      </View>

      {/* Car grid */}
      {isLoading ? (
        <ActivityIndicator style={styles.loader} color={Colors.orange} size="large" />
      ) : (
        <FlatList
          data={vehiclesData ?? []}
          keyExtractor={(v, i) => v.publicId ? `${v.publicId}-${i}` : String(i)}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No cars available</Text>
              <Text style={styles.emptySubtitle}>Check back soon or try a different category.</Text>
            </View>
          }
          renderItem={({ item }) => <CarCard vehicle={item} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  greeting: {
    fontFamily: Fonts.displayBold,
    fontSize: 22,
    color: Colors.ink,
    letterSpacing: -0.5,
  },
  greetingSub: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink3,
    marginTop: 2,
  },
  avatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
  searchBar: {
    marginHorizontal: 20,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 8,
  },
  searchIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchPlaceholder: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink3,
  },
  searchFilter: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipsScroll: { maxHeight: 44 },
  chips: { paddingHorizontal: 20, gap: 8, alignItems: 'center' },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  chipActive: { backgroundColor: Colors.black, borderColor: Colors.black },
  chipText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  chipTextActive: { color: Colors.white },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 20,
    marginBottom: 12,
  },
  sectionLabel: {
    fontFamily: Fonts.displayBold,
    fontSize: 18,
    color: Colors.ink,
    letterSpacing: -0.4,
  },
  sectionCount: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  grid: { paddingHorizontal: 20, paddingBottom: 100 },
  row: { gap: 12, marginBottom: 12 },
  loader: { marginTop: 60 },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyTitle: {
    fontFamily: Fonts.display,
    fontSize: 20,
    color: Colors.ink,
    letterSpacing: -0.4,
  },
  emptySubtitle: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink3,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
});

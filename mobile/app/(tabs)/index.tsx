import { useEffect, useMemo, useState } from 'react';
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
import { displayCategory } from '../../lib/categoryDisplay';
import { useAuthStore } from '../../store/auth';
import CarCard from '../../components/cars/CarCard';
import VehicleQuickView from '../../components/cars/VehicleQuickView';
import BranchPicker, { type Branch } from '../../components/branch/BranchPicker';
import Avatar from '../../components/ui/Avatar';
import type { Vehicle } from '../../types/api';


function normalizeGroup(g: any): Vehicle {
  const images: string[] = (g.imageUrl ?? [])
    .map((img: any) => img?.file?.url ?? null)
    .filter(Boolean);
  return {
    publicId: g.groupKey,
    make: g.make,
    model: g.model,
    category: g.category,
    branch: g.branch,
    availableCount: g.availableCount,
    images,
    pricing: { daily: g.pricing?.daily ?? null },
    availability: true,
  };
}

type SortKey = 'default' | 'price_low_to_high' | 'price_high_to_low';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'default',            label: 'Default' },
  { key: 'price_low_to_high',  label: 'Price ↑' },
  { key: 'price_high_to_low',  label: 'Price ↓' },
];

export default function Browse() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const insets = useSafeAreaInsets();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [quickViewVehicle, setQuickViewVehicle] = useState<Vehicle | null>(null);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('default');

  const { data: branches, isLoading: branchesLoading } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await vehiclesApi.branches();
      return (res.data?.data ?? []) as Branch[];
    },
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (branches && branches.length > 0 && !selectedBranch) {
      setSelectedBranch(branches[0]);
    }
  }, [branches]);

  const browseStart = new Date(Date.now() + 86_400_000).toISOString();
  const browseEnd   = new Date(Date.now() + 2 * 86_400_000).toISOString();

  const { data: allVehicles, isLoading: vehiclesLoading } = useQuery({
    queryKey: ['vehicles-all', browseStart.slice(0, 10), sortKey],
    queryFn: () => vehiclesApi.list({
      limit: 100,
      start: browseStart,
      end: browseEnd,
      ...(sortKey !== 'default' ? { sort: sortKey } : {}),
    }),
    select: (res) => {
      const groups = (res.data?.data ?? []) as any[];
      const seen = new Set<string>();
      return groups
        .filter(g => {
          if (!g.groupKey || seen.has(g.groupKey)) return false;
          seen.add(g.groupKey);
          return true;
        })
        .map(normalizeGroup);
    },
    staleTime: 30_000,
    enabled: !!selectedBranch,
  });

  const vehiclesData = useMemo(() => {
    if (!allVehicles) return undefined;
    return allVehicles.filter(v => {
      if (selectedCategory && v.category !== selectedCategory) return false;
      return true;
    });
  }, [allVehicles, selectedCategory]);

  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const isLoading = branchesLoading || (!!selectedBranch && vehiclesLoading);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.greeting}>Hi, {firstName}</Text>
          <Text style={styles.greetingSub}>Find your perfect drive</Text>
        </View>
        <View style={styles.headerRight}>
          {branchesLoading ? (
            <View style={styles.branchPillLoading}>
              <ActivityIndicator size="small" color={Colors.ink3} />
            </View>
          ) : branches && branches.length > 0 ? (
            <TouchableOpacity
              style={styles.branchPill}
              onPress={() => setBranchPickerOpen(true)}
              activeOpacity={0.8}
              hitSlop={6}
            >
              <Ionicons name="location-outline" size={13} color={Colors.ink2} />
              <Text style={styles.branchPillText} numberOfLines={1}>
                {selectedBranch?.name ?? 'Branch'}
              </Text>
              <Ionicons name="chevron-down" size={13} color={Colors.ink3} />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} activeOpacity={0.8}>
            <Avatar seed={user?.name ?? firstName} size={42} />
          </TouchableOpacity>
        </View>
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

      {/* No branch selected — prompt */}
      {!selectedBranch ? (
        <View style={styles.noBranchState}>
          <View style={styles.noBranchIcon}>
            <Ionicons name="location-outline" size={32} color={Colors.orange} />
          </View>
          <Text style={styles.noBranchTitle}>Choose a branch</Text>
          <Text style={styles.noBranchSub}>
            Tap the branch chip in the top right to choose your location.
          </Text>
        </View>
      ) : (
        <>
          {/* Compact filter bar — categories scroll, sort cycles */}
          <View style={styles.filterBar}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterScroll}
              style={styles.filterScrollWrap}
            >
              <TouchableOpacity
                style={[styles.chip, selectedCategory === null && styles.chipActive]}
                onPress={() => setSelectedCategory(null)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, selectedCategory === null && styles.chipTextActive]}>
                  All
                </Text>
              </TouchableOpacity>

              {[...new Set((allVehicles ?? []).map(v => v.category).filter(Boolean))].sort().map((name) => (
                <TouchableOpacity
                  key={name}
                  style={[styles.chip, selectedCategory === name && styles.chipActive]}
                  onPress={() => setSelectedCategory(name)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, selectedCategory === name && styles.chipTextActive]}>
                    {displayCategory(name)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={[styles.sortPill, sortKey !== 'default' && styles.sortPillActive]}
              onPress={() => {
                const idx = SORT_OPTIONS.findIndex(o => o.key === sortKey);
                const next = SORT_OPTIONS[(idx + 1) % SORT_OPTIONS.length];
                setSortKey(next.key);
              }}
              activeOpacity={0.8}
              hitSlop={6}
            >
              <Ionicons
                name={
                  sortKey === 'price_low_to_high' ? 'arrow-up' :
                  sortKey === 'price_high_to_low' ? 'arrow-down' :
                  'swap-vertical'
                }
                size={13}
                color={sortKey === 'default' ? Colors.ink3 : Colors.orange}
              />
              <Text style={[styles.sortPillText, sortKey !== 'default' && styles.sortPillTextActive]}>
                {sortKey === 'default' ? 'Sort' : 'Price'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Section label */}
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>
              {selectedCategory == null ? 'Available now' : displayCategory(selectedCategory)}
            </Text>
            {vehiclesData && (
              <Text style={styles.sectionCount}>
                {vehiclesData.length} vehicle{vehiclesData.length !== 1 ? 's' : ''}
              </Text>
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
                  <Text style={styles.emptyTitle}>No vehicles available</Text>
                  <Text style={styles.emptySubtitle}>
                    Try a different branch or category, or check back soon.
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <CarCard
                  vehicle={item}
                  onPress={() => setQuickViewVehicle(item)}
                />
              )}
            />
          )}
        </>
      )}

      {/* Quick view bottom sheet */}
      <VehicleQuickView
        vehicle={quickViewVehicle}
        onClose={() => setQuickViewVehicle(null)}
      />

      {/* Branch picker bottom sheet */}
      <BranchPicker
        visible={branchPickerOpen}
        branches={branches ?? []}
        selectedId={selectedBranch?.publicId ?? null}
        onSelect={(b) => setSelectedBranch(b)}
        onClose={() => setBranchPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 12,
  },
  headerLeft: { flex: 1, minWidth: 0 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  branchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: 140,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  branchPillText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 13,
    color: Colors.ink,
    flexShrink: 1,
  },
  branchPillLoading: {
    width: 80,
    height: 34,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
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

  // Compact filter bar
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 20,
    paddingRight: 12,
    gap: 8,
  },
  filterScrollWrap: { flex: 1 },
  filterScroll: { gap: 8, paddingRight: 8, alignItems: 'center' },
  sortPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  sortPillActive: {
    backgroundColor: '#ff6a1f0e',
    borderColor: '#ff6a1f33',
  },
  sortPillText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 13,
    color: Colors.ink2,
  },
  sortPillTextActive: { color: Colors.orange },

  // No branch state
  noBranchState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 48,
    gap: 12,
    paddingBottom: 80,
  },
  noBranchIcon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: '#ff6a1f0e',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#ff6a1f20',
  },
  noBranchTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 20,
    color: Colors.ink,
    letterSpacing: -0.4,
  },
  noBranchSub: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink3,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Categories
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

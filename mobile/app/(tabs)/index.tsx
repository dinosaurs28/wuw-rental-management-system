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
import { useAuthStore } from '../../store/auth';
import CarCard from '../../components/cars/CarCard';
import VehicleQuickView from '../../components/cars/VehicleQuickView';
import Avatar from '../../components/ui/Avatar';
import type { Vehicle } from '../../types/api';

interface Branch {
  publicId: string;
  name: string;
}


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

export default function Browse() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const insets = useSafeAreaInsets();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [quickViewVehicle, setQuickViewVehicle] = useState<Vehicle | null>(null);

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

  const today = new Date().toISOString().slice(0, 10);
  const browseStart = useMemo(() => new Date(Date.now() + 86_400_000).toISOString(), [today]);
  const browseEnd   = useMemo(() => new Date(Date.now() + 2 * 86_400_000).toISOString(), [today]);

  const { data: allVehicles, isLoading: vehiclesLoading } = useQuery({
    queryKey: ['vehicles', selectedBranch?.publicId ?? 'all', today],
    queryFn: () => vehiclesApi.list({
      limit: 100,
      start: browseStart,
      end: browseEnd,
      branch: selectedBranch?.publicId,
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
        <View>
          <Text style={styles.greeting}>Hi, {firstName}</Text>
          <Text style={styles.greetingSub}>Find your perfect drive</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} activeOpacity={0.8}>
          <Avatar seed={user?.name ?? firstName} size={42} />
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

      {/* Branch selector */}
      {branchesLoading ? (
        <View style={styles.branchLoaderRow}>
          <ActivityIndicator size="small" color={Colors.orange} />
        </View>
      ) : branches && branches.length > 0 ? (
        <View style={styles.branchSection}>
          <View style={styles.branchLabelRow}>
            <Ionicons name="location-outline" size={13} color={Colors.ink3} />
            <Text style={styles.branchLabel}>Select Branch</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.branchChips}
          >
            {branches.map((branch) => {
              const active = selectedBranch?.publicId === branch.publicId;
              return (
                <TouchableOpacity
                  key={branch.publicId}
                  style={[styles.branchChip, active && styles.branchChipActive]}
                  onPress={() => setSelectedBranch(active ? null : branch)}
                  activeOpacity={0.8}
                >
                  {active && (
                    <Ionicons name="checkmark-circle" size={13} color={Colors.white} />
                  )}
                  <Text style={[styles.branchChipText, active && styles.branchChipTextActive]}>
                    {branch.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* No branch selected — prompt */}
      {!selectedBranch ? (
        <View style={styles.noBranchState}>
          <View style={styles.noBranchIcon}>
            <Ionicons name="location-outline" size={32} color={Colors.orange} />
          </View>
          <Text style={styles.noBranchTitle}>Choose a branch</Text>
          <Text style={styles.noBranchSub}>
            Select a branch above to see available vehicles near you.
          </Text>
        </View>
      ) : (
        <>
          {/* Category chips — always show All; show others once vehicles loaded */}
          <View style={styles.chips}>
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
                  {name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Section label */}
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>
              {selectedCategory == null ? 'Available now' : selectedCategory}
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

  // Branch selector
  branchLoaderRow: { paddingVertical: 8, alignItems: 'center' },
  branchSection: { marginBottom: 4 },
  branchLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  branchLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  branchChips: { paddingHorizontal: 20, gap: 8, alignItems: 'center' },
  branchChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  branchChipActive: {
    backgroundColor: Colors.ink,
    borderColor: Colors.ink,
  },
  branchChipText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 13,
    color: Colors.ink2,
  },
  branchChipTextActive: { color: Colors.white },

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
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 8,
    paddingVertical: 4,
  },
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

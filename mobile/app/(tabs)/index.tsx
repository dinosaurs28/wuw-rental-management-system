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
import { normalizeGroups } from '../../lib/vehicles';
import CarCard from '../../components/cars/CarCard';
import VehicleQuickView from '../../components/cars/VehicleQuickView';
import FilterSheet, { type FilterValue } from '../../components/cars/FilterSheet';
import SearchCard, { type SearchQuery } from '../../components/cars/SearchCard';
import Avatar from '../../components/ui/Avatar';
import type { Vehicle } from '../../types/api';

interface Branch {
  publicId: string;
  name: string;
}

export default function Browse() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const insets = useSafeAreaInsets();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [quickViewVehicle, setQuickViewVehicle] = useState<Vehicle | null>(null);
  const [sort, setSort] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

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
  const browseEnd = useMemo(() => new Date(Date.now() + 2 * 86_400_000).toISOString(), [today]);

  const { data: allVehicles, isLoading: vehiclesLoading } = useQuery({
    queryKey: ['vehicles', selectedBranch?.publicId ?? 'all', today, sort ?? 'default'],
    queryFn: () =>
      vehiclesApi.list({
        limit: 100,
        start: browseStart,
        end: browseEnd,
        branch: selectedBranch?.publicId,
        sort: (sort as any) || undefined,
      }),
    select: (res) => normalizeGroups((res.data?.data ?? []) as any[]),
    staleTime: 30_000,
    enabled: !!selectedBranch,
  });

  const vehiclesData = useMemo(() => {
    if (!allVehicles) return undefined;
    return allVehicles.filter((v) => {
      if (selectedCategory && v.category !== selectedCategory) return false;
      return true;
    });
  }, [allVehicles, selectedCategory]);

  const categories = useMemo(
    () => [...new Set((allVehicles ?? []).map((v) => v.category).filter(Boolean))].sort(),
    [allVehicles],
  );

  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const isLoading = branchesLoading || (!!selectedBranch && vehiclesLoading);

  // Search card → results, carrying branch + date/time window.
  const onSearch = (q: SearchQuery) =>
    router.push({
      pathname: '/search',
      params: { branch: q.branchId, branchName: q.branchName, start: q.start, end: q.end },
    });

  const Header = (
    <View style={styles.headerWrap}>
      {/* Greeting */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>Hi, {firstName}</Text>
          <Text style={styles.greetingSub}>Find your perfect drive</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} activeOpacity={0.8}>
          <Avatar seed={user?.name ?? firstName} size={42} />
        </TouchableOpacity>
      </View>

      {/* Hero search card */}
      <View style={styles.searchCardWrap}>
        <SearchCard branches={branches ?? []} defaultBranchId={selectedBranch?.publicId} onSubmit={onSearch} />
      </View>

      {/* Browse the fleet */}
      <Text style={styles.eyebrow}>Browse the fleet</Text>

      {branches && branches.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.branchChips}>
          {branches.map((branch) => {
            const active = selectedBranch?.publicId === branch.publicId;
            return (
              <TouchableOpacity
                key={branch.publicId}
                style={[styles.branchChip, active && styles.branchChipActive]}
                onPress={() => { setSelectedBranch(branch); setSelectedCategory(null); }}
                activeOpacity={0.8}
              >
                {active && <Ionicons name="location" size={12} color={Colors.white} />}
                <Text style={[styles.branchChipText, active && styles.branchChipTextActive]}>{branch.name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}

      {/* Category chips */}
      {selectedBranch ? (
        <View style={styles.chips}>
          <TouchableOpacity
            style={[styles.chip, selectedCategory === null && styles.chipActive]}
            onPress={() => setSelectedCategory(null)}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipText, selectedCategory === null && styles.chipTextActive]}>All</Text>
          </TouchableOpacity>
          {categories.map((name) => (
            <TouchableOpacity
              key={name}
              style={[styles.chip, selectedCategory === name && styles.chipActive]}
              onPress={() => setSelectedCategory(name)}
              activeOpacity={0.8}
            >
              <Text style={[styles.chipText, selectedCategory === name && styles.chipTextActive]}>{name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {/* Section row */}
      {selectedBranch ? (
        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>{selectedCategory ?? 'Available now'}</Text>
          <View style={styles.sectionRight}>
            {vehiclesData ? (
              <Text style={styles.sectionCount}>
                {vehiclesData.length} vehicle{vehiclesData.length !== 1 ? 's' : ''}
              </Text>
            ) : null}
            <TouchableOpacity
              style={[styles.filterBtn, (sort || selectedCategory) && styles.filterBtnActive]}
              onPress={() => setFilterOpen(true)}
              hitSlop={8}
              activeOpacity={0.8}
            >
              <Ionicons name="options-outline" size={16} color={sort || selectedCategory ? Colors.white : Colors.ink2} />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <FlatList
        data={selectedBranch ? vehiclesData ?? [] : []}
        keyExtractor={(v, i) => v.publicId ?? String(i)}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={Header}
        ListEmptyComponent={
          !selectedBranch ? null : isLoading ? (
            <ActivityIndicator style={styles.loader} color={Colors.orange} size="large" />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No vehicles available</Text>
              <Text style={styles.emptySubtitle}>Try a different branch or category, or check back soon.</Text>
            </View>
          )
        }
        renderItem={({ item }) => <CarCard vehicle={item} onPress={() => setQuickViewVehicle(item)} />}
      />

      <VehicleQuickView vehicle={quickViewVehicle} onClose={() => setQuickViewVehicle(null)} />

      <FilterSheet
        visible={filterOpen}
        branches={(branches ?? []).map((b) => ({ id: b.publicId, label: b.name }))}
        categories={categories.map((n) => ({ id: n, label: n }))}
        value={{ branch: selectedBranch?.publicId ?? null, category: selectedCategory, sort }}
        onApply={(v: FilterValue) => {
          setSelectedBranch(v.branch ? (branches ?? []).find((b) => b.publicId === v.branch) ?? null : selectedBranch);
          setSelectedCategory(v.category);
          setSort(v.sort);
        }}
        onClose={() => setFilterOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  headerWrap: { paddingBottom: 4 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  greeting: { fontFamily: Fonts.displayBold, fontSize: 26, color: Colors.ink, letterSpacing: -0.6 },
  greetingSub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, marginTop: 2 },

  searchCardWrap: { paddingHorizontal: 20, marginBottom: 8 },

  eyebrow: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    paddingHorizontal: 20,
    marginTop: 20,
    marginBottom: 12,
  },

  branchChips: { paddingHorizontal: 20, gap: 8, alignItems: 'center', paddingBottom: 4 },
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
  branchChipActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  branchChipText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  branchChipTextActive: { color: Colors.white },

  chips: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, gap: 8, paddingVertical: 4, marginTop: 8 },
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
    marginTop: 18,
    marginBottom: 14,
  },
  sectionLabel: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  sectionRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sectionCount: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  filterBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtnActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },

  grid: { paddingHorizontal: 20, paddingBottom: 100 },
  row: { gap: 12, marginBottom: 12 },
  loader: { marginTop: 60 },
  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 40 },
  emptyTitle: { fontFamily: Fonts.display, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  emptySubtitle: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, textAlign: 'center', marginTop: 8, lineHeight: 20 },
});

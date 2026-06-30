import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../constants/colors';
import { vehiclesApi } from '../lib/api';
import { normalizeGroups } from '../lib/vehicles';
import CarCard from '../components/cars/CarCard';
import VehicleQuickView from '../components/cars/VehicleQuickView';
import FilterSheet, { type FilterValue } from '../components/cars/FilterSheet';
import SearchCard, { type SearchQuery } from '../components/cars/SearchCard';
import ItinerarySummary from '../components/cars/ItinerarySummary';
import type { Vehicle } from '../types/api';

export default function Search() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ branch?: string; branchName?: string; start?: string; end?: string }>();

  const [searchText, setSearchText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [quickViewVehicle, setQuickViewVehicle] = useState<Vehicle | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const [branchId, setBranchId] = useState<string | null>(params.branch ?? null);
  const [branchName, setBranchName] = useState<string | null>(params.branchName ?? null);
  const [start, setStart] = useState<string | null>(params.start ?? null);
  const [end, setEnd] = useState<string | null>(params.end ?? null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [sort, setSort] = useState<string | null>(null);

  const dated = !!(start && end);
  const filtersActive = !!(branchId || categoryId || sort);
  const active = dated || submitted || filtersActive || searchText.length > 0;

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await vehiclesApi.branches()).data?.data ?? [],
    select: (rows: any[]) => rows as { publicId: string; name: string }[],
    staleTime: 5 * 60_000,
  });
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await vehiclesApi.categories()).data?.data ?? [],
    select: (rows: any[]) => rows as { publicId: string; name: string }[],
    staleTime: 5 * 60_000,
  });

  const { data: results, isLoading } = useQuery({
    queryKey: ['search', searchText, branchId ?? '', categoryId ?? '', sort ?? '', start ?? '', end ?? ''],
    queryFn: () =>
      vehiclesApi.list({
        search: searchText || undefined,
        branch: branchId || undefined,
        category: categoryId || undefined,
        sort: (sort as any) || undefined,
        start: start || undefined,
        end: end || undefined,
        limit: 40,
      }),
    select: (res) => normalizeGroups((res.data?.data ?? []) as any[]),
    enabled: active,
  });

  const applyEdit = (q: SearchQuery) => {
    setBranchId(q.branchId);
    setBranchName(q.branchName);
    setStart(q.start);
    setEnd(q.end);
    setEditOpen(false);
    setSubmitted(true);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Search bar row */}
      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <View style={styles.searchBarWrap}>
          <Ionicons name="search-outline" size={17} color={Colors.ink3} />
          <TextInput
            style={styles.searchInput}
            placeholder="Make, model…"
            placeholderTextColor={Colors.ink3}
            value={searchText}
            onChangeText={setSearchText}
            returnKeyType="search"
            onSubmitEditing={() => setSubmitted(true)}
            autoFocus={!dated}
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => { setSearchText(''); setSubmitted(false); }} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color={Colors.ink4} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[styles.filterBtn, (sort || categoryId) && styles.filterBtnActive]}
          onPress={() => setFilterOpen(true)}
          hitSlop={8}
          activeOpacity={0.8}
        >
          <Ionicons name="options-outline" size={18} color={sort || categoryId ? Colors.white : Colors.ink} />
        </TouchableOpacity>
      </View>

      {/* Itinerary summary (when arrived with dates) */}
      {dated ? (
        <View style={styles.summaryWrap}>
          <ItinerarySummary branchName={branchName} start={start} end={end} onEdit={() => setEditOpen(true)} />
        </View>
      ) : null}

      {/* Results */}
      {!active ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Find your car</Text>
          <Text style={styles.emptySubtitle}>
            Search by make or model, or tap the filter icon to browse by branch, category & price.
          </Text>
        </View>
      ) : isLoading ? (
        <ActivityIndicator style={styles.loader} color={Colors.orange} size="large" />
      ) : (
        <>
          <Text style={styles.resultCount}>
            {results?.length ?? 0} result{results?.length !== 1 ? 's' : ''} found
          </Text>
          <FlatList
            data={results ?? []}
            keyExtractor={(v, i) => (v.publicId ? `${v.publicId}-${i}` : String(i))}
            numColumns={2}
            columnWrapperStyle={styles.row}
            contentContainerStyle={styles.grid}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.noResults}>
                <Text style={styles.noResultsText}>No vehicles match your search.</Text>
              </View>
            }
            renderItem={({ item }) => <CarCard vehicle={item} onPress={() => setQuickViewVehicle(item)} />}
          />
        </>
      )}

      <VehicleQuickView vehicle={quickViewVehicle} onClose={() => setQuickViewVehicle(null)} />

      <FilterSheet
        visible={filterOpen}
        branches={(branches ?? []).map((b) => ({ id: b.publicId, label: b.name }))}
        categories={(categories ?? []).map((c) => ({ id: c.publicId, label: c.name }))}
        value={{ branch: branchId, category: categoryId, sort }}
        onApply={(v: FilterValue) => {
          setBranchId(v.branch);
          setBranchName(v.branch ? (branches ?? []).find((b) => b.publicId === v.branch)?.name ?? branchName : null);
          setCategoryId(v.category);
          setSort(v.sort);
          setSubmitted(true);
        }}
        onClose={() => setFilterOpen(false)}
      />

      {/* Edit-search modal */}
      <Modal visible={editOpen} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setEditOpen(false)}>
        <View style={styles.editOverlay}>
          <TouchableWithoutFeedback onPress={() => setEditOpen(false)}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={styles.editSheet}>
            <View style={styles.handle} />
            <Text style={styles.editTitle}>Edit search</Text>
            <View style={{ paddingHorizontal: 16 }}>
              <SearchCard
                branches={branches ?? []}
                defaultBranchId={branchId}
                initialStart={start ?? undefined}
                initialEnd={end ?? undefined}
                ctaLabel="Update results"
                onSubmit={applyEdit}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 10 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  filterBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtnActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  searchBarWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 48,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  searchInput: { flex: 1, fontFamily: Fonts.body, fontSize: 15, color: Colors.ink, padding: 0 },
  summaryWrap: { paddingHorizontal: 20, paddingBottom: 4 },
  resultCount: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink3,
    paddingHorizontal: 20,
    marginTop: 16,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  grid: { paddingHorizontal: 20, paddingBottom: 24 },
  row: { gap: 12, marginBottom: 12 },
  loader: { marginTop: 60 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyTitle: { fontFamily: Fonts.display, fontSize: 22, color: Colors.ink, letterSpacing: -0.5 },
  emptySubtitle: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, textAlign: 'center', marginTop: 8, lineHeight: 21 },
  noResults: { alignItems: 'center', paddingTop: 40 },
  noResultsText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink3 },

  editOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  editSheet: { backgroundColor: Colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 36 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.ink4, alignSelf: 'center', marginTop: 10, marginBottom: 14 },
  editTitle: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink, letterSpacing: -0.3, paddingHorizontal: 20, marginBottom: 12 },
});

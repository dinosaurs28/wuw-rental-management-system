import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../constants/colors';
import { vehiclesApi } from '../lib/api';
import { normalizeGroups } from '../lib/vehicles';
import OfferCard from '../components/cars/OfferCard';
import FilterSheet, { type FilterValue } from '../components/cars/FilterSheet';
import SearchCard, { type SearchQuery } from '../components/cars/SearchCard';

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// "12 Jul | 12:00"
function fmtStamp(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} | ${hh}:${mm}`;
}

// Sixt-style offers list: close button, itinerary summary with edit pencil,
// "Filter & sort" chip, then ONE full-width offer card per row.
export default function Search() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const params = useLocalSearchParams<{ branch?: string; branchName?: string; start?: string; end?: string }>();

  const [filterOpen, setFilterOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const [branchId, setBranchId] = useState<string | null>(params.branch ?? null);
  const [branchName, setBranchName] = useState<string | null>(params.branchName ?? null);
  const [start, setStart] = useState<string | null>(params.start ?? null);
  const [end, setEnd] = useState<string | null>(params.end ?? null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [sort, setSort] = useState<string | null>(null);

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
    queryKey: ['search', branchId ?? '', categoryId ?? '', sort ?? '', start ?? '', end ?? ''],
    queryFn: () =>
      vehiclesApi.list({
        branch: branchId || undefined,
        category: categoryId || undefined,
        sort: (sort as any) || undefined,
        start: start || undefined,
        end: end || undefined,
        limit: 40,
      }),
    select: (res) => normalizeGroups((res.data?.data ?? []) as any[]),
  });

  const applyEdit = (q: SearchQuery) => {
    setBranchId(q.branchId);
    setBranchName(q.branchName);
    setStart(q.start);
    setEnd(q.end);
    setEditOpen(false);
  };

  const startStamp = fmtStamp(start);
  const endStamp = fmtStamp(end);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {isFocused ? <StatusBar style="light" /> : null}

      {/* Close */}
      <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} hitSlop={10}>
        <Ionicons name="close" size={26} color={Colors.white} />
      </TouchableOpacity>

      {/* Itinerary summary */}
      <TouchableOpacity style={styles.summary} onPress={() => setEditOpen(true)} activeOpacity={0.85}>
        <View style={{ flex: 1 }}>
          <Text style={styles.summaryTitle} numberOfLines={1}>{branchName ?? 'All branches'}</Text>
          {startStamp && endStamp ? (
            <Text style={styles.summaryDates}>{startStamp} - {endStamp}</Text>
          ) : null}
        </View>
        <Ionicons name="pencil" size={19} color={Colors.white} />
      </TouchableOpacity>

      {/* Filter & sort */}
      <TouchableOpacity
        style={[styles.filterChip, (sort || categoryId) && styles.filterChipActive]}
        onPress={() => setFilterOpen(true)}
        activeOpacity={0.85}
      >
        <Ionicons name="filter-outline" size={17} color={Colors.white} />
        <Text style={styles.filterChipText}>Filter & sort</Text>
      </TouchableOpacity>

      {/* Offers — one big card per row */}
      {isLoading ? (
        <ActivityIndicator style={styles.loader} color={Colors.orange} size="large" />
      ) : (
        <FlatList
          data={results ?? []}
          keyExtractor={(v, i) => (v.publicId ? `${v.publicId}-${i}` : String(i))}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.noResults}>
              <Text style={styles.noResultsText}>No vehicles match your search.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <OfferCard
              vehicle={item}
              onPress={() =>
                router.push({
                  pathname: `/vehicle/${item.publicId}` as any,
                  params: {
                    ...(start ? { start } : {}),
                    ...(end ? { end } : {}),
                  },
                })
              }
            />
          )}
        />
      )}

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
                branch={branchId ? { publicId: branchId, name: branchName ?? '' } : null}
                onBranchChange={(b) => { setBranchId(b.publicId); setBranchName(b.name); }}
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
  root: { flex: 1, backgroundColor: Colors.bgDark },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
    marginTop: 8,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surfaceDark,
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 14,
    paddingHorizontal: 18,
    paddingVertical: 15,
  },
  summaryTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 17, color: Colors.white, letterSpacing: -0.2 },
  summaryDates: { fontFamily: Fonts.body, fontSize: 14, color: Colors.onDarkMuted, marginTop: 3 },

  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: Colors.surfaceDark,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 11,
    marginLeft: 16,
    marginTop: 16,
    marginBottom: 4,
  },
  filterChipActive: { borderWidth: 1, borderColor: Colors.orange },
  filterChipText: { fontFamily: Fonts.bodyMedium, fontSize: 15, color: Colors.white },

  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 14 },
  loader: { marginTop: 60 },
  noResults: { alignItems: 'center', paddingTop: 48 },
  noResultsText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.onDarkMuted },

  editOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  editSheet: { backgroundColor: Colors.bgDark, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 36 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', alignSelf: 'center', marginTop: 10, marginBottom: 14 },
  editTitle: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.white, letterSpacing: -0.3, paddingHorizontal: 20, marginBottom: 12 },
});

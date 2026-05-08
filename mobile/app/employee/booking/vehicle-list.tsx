import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';

interface VehicleGroup {
  groupKey: string;
  make: string;
  model: string;
  category: string;
  branch: string;
  availableCount: number;
  imageUrl: { file: { url: string } }[];
  pricing: { daily: number; hourly?: number; halfDay?: number };
}

interface Category {
  publicId: string;
  name: string;
}

type SortKey = 'default' | 'price_low_to_high' | 'price_high_to_low';
const PAGE_LIMIT = 12;

export default function EmployeeVehicleList() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { customerPublicId, start, end } = useLocalSearchParams<{
    customerPublicId?: string;
    start?: string;
    end?: string;
  }>();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('default');
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setOffset(0);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setOffset(0);
  }, [category, sort]);

  const { data: categories } = useQuery<Category[]>({
    queryKey: ['employee', 'vehicle-categories'],
    queryFn: async () => {
      const res = await employeeApi.getEmployeeVehicleCategories();
      return (res.data?.data ?? []) as Category[];
    },
    staleTime: 5 * 60_000,
  });

  const params = useMemo(
    () => ({
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(category ? { category } : {}),
      ...(sort !== 'default' ? { sort } : {}),
      ...(start ? { start: String(start) } : {}),
      ...(end ? { end: String(end) } : {}),
      limit: PAGE_LIMIT,
      offset,
    }),
    [debouncedSearch, category, sort, start, end, offset],
  );

  const { data, isLoading, isFetching } = useQuery<{
    data: VehicleGroup[];
    pagination: { total: number; limit: number; offset: number };
  }>({
    queryKey: ['employee', 'vehicles', params],
    queryFn: async () => {
      const res = await employeeApi.listEmployeeVehicles(params);
      return res.data;
    },
    staleTime: 30_000,
  });

  const vehicles = data?.data ?? [];
  const total = data?.pagination?.total ?? 0;
  const hasNext = offset + PAGE_LIMIT < total;
  const hasPrev = offset > 0;

  const handleTap = (group: VehicleGroup) => {
    if (!start || !end || !customerPublicId) return;
    if (group.availableCount > 1) {
      router.push({
        pathname: '/employee/booking/group/[key]' as any,
        params: {
          key: group.groupKey,
          customerPublicId,
          start: String(start),
          end: String(end),
        },
      });
    } else {
      router.push({
        pathname: '/employee/booking/vehicle/[id]' as any,
        params: {
          id: group.groupKey,
          isGroup: '1',
          customerPublicId,
          start: String(start),
          end: String(end),
        },
      });
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <View style={styles.headerTitles}>
          <Text style={styles.title}>Select Vehicle</Text>
          <Text style={styles.subtitle}>
            {total > 0 ? `${total} groups available` : 'Pick a vehicle for the booking'}
          </Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={17} color={Colors.ink3} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search make or model..."
            placeholderTextColor={Colors.ink4}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color={Colors.ink4} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Category chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
      >
        <TouchableOpacity
          style={[styles.chip, category === null && styles.chipActive]}
          onPress={() => setCategory(null)}
          activeOpacity={0.85}
        >
          <Text
            style={[styles.chipText, category === null && styles.chipTextActive]}
          >
            All
          </Text>
        </TouchableOpacity>
        {(categories ?? []).map((c) => {
          const active = category === c.publicId;
          return (
            <TouchableOpacity
              key={c.publicId}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setCategory(c.publicId)}
              activeOpacity={0.85}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {c.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Sort row */}
      <View style={styles.sortRow}>
        {(
          [
            { key: 'default', label: 'Default' },
            { key: 'price_low_to_high', label: 'Price ↑' },
            { key: 'price_high_to_low', label: 'Price ↓' },
          ] as { key: SortKey; label: string }[]
        ).map((opt) => {
          const active = sort === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[styles.sortBtn, active && styles.sortBtnActive]}
              onPress={() => setSort(opt.key)}
              activeOpacity={0.85}
            >
              <Text style={[styles.sortText, active && styles.sortTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* List */}
      {isLoading ? (
        <ActivityIndicator style={styles.loader} color={Colors.orange} size="large" />
      ) : (
        <FlatList
          data={vehicles}
          keyExtractor={(item) => item.groupKey}
          numColumns={2}
          columnWrapperStyle={styles.col}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="car-outline" size={44} color={Colors.ink4} />
              <Text style={styles.emptyTitle}>No vehicles match</Text>
              <Text style={styles.emptySub}>
                Adjust filters or change dates to see more options.
              </Text>
            </View>
          }
          ListFooterComponent={
            vehicles.length > 0 ? (
              <View style={styles.pagerRow}>
                <TouchableOpacity
                  style={[styles.pagerBtn, !hasPrev && styles.pagerDisabled]}
                  onPress={() => hasPrev && setOffset(Math.max(0, offset - PAGE_LIMIT))}
                  disabled={!hasPrev}
                  activeOpacity={0.85}
                >
                  <Ionicons name="chevron-back" size={16} color={Colors.ink} />
                  <Text style={styles.pagerText}>Prev</Text>
                </TouchableOpacity>
                <Text style={styles.pagerInfo}>
                  {offset + 1}–{Math.min(offset + PAGE_LIMIT, total)} of {total}
                </Text>
                <TouchableOpacity
                  style={[styles.pagerBtn, !hasNext && styles.pagerDisabled]}
                  onPress={() => hasNext && setOffset(offset + PAGE_LIMIT)}
                  disabled={!hasNext}
                  activeOpacity={0.85}
                >
                  <Text style={styles.pagerText}>Next</Text>
                  <Ionicons name="chevron-forward" size={16} color={Colors.ink} />
                </TouchableOpacity>
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const thumb = item.imageUrl?.[0]?.file?.url;
            return (
              <TouchableOpacity
                style={styles.card}
                onPress={() => handleTap(item)}
                activeOpacity={0.88}
              >
                <View style={styles.photoContainer}>
                  {thumb ? (
                    <Image source={{ uri: thumb }} style={styles.photo} resizeMode="cover" />
                  ) : (
                    <View style={styles.placeholder}>
                      <Ionicons
                        name="car-sport-outline"
                        size={36}
                        color="rgba(0,0,0,0.12)"
                      />
                    </View>
                  )}
                  <View style={styles.categoryBadge}>
                    <Text style={styles.categoryText}>{item.category}</Text>
                  </View>
                </View>
                <View style={styles.info}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.make} {item.model}
                  </Text>
                  <View style={styles.row}>
                    {item.pricing?.daily != null ? (
                      <Text style={styles.price}>
                        ₹{Number(item.pricing.daily).toLocaleString('en-IN')}
                        <Text style={styles.perDay}>/day</Text>
                      </Text>
                    ) : (
                      <Text style={styles.price}>—</Text>
                    )}
                    <View style={styles.availPill}>
                      <Text style={styles.availText}>{item.availableCount} avail</Text>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {isFetching && !isLoading && (
        <View style={styles.fetchOverlay} pointerEvents="none">
          <ActivityIndicator size="small" color={Colors.orange} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 12,
  },
  back: { width: 36, height: 36, justifyContent: 'center' },
  headerTitles: { flex: 1 },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 20,
    color: Colors.ink,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink3,
    marginTop: 2,
  },

  searchRow: { paddingHorizontal: 20, marginBottom: 10 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    height: 46,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
    padding: 0,
  },

  chipsRow: { paddingHorizontal: 20, gap: 8, marginBottom: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  chipActive: {
    backgroundColor: Colors.ink,
    borderColor: Colors.ink,
  },
  chipText: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink2 },
  chipTextActive: { color: Colors.white },

  sortRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 12,
  },
  sortBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  sortBtnActive: { backgroundColor: Colors.orangeSoft },
  sortText: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink3 },
  sortTextActive: { color: Colors.orange },

  loader: { marginTop: 60 },
  list: { paddingHorizontal: 20, paddingBottom: 80, gap: 12 },
  col: { gap: 12, marginBottom: 12 },

  card: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  photoContainer: { position: 'relative' },
  photo: { width: '100%', height: 130 },
  placeholder: {
    width: '100%',
    height: 130,
    backgroundColor: '#f0f0ee',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  categoryText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 10,
    color: Colors.white,
    letterSpacing: 0.2,
  },
  info: { padding: 12, gap: 6 },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  price: {
    fontFamily: Fonts.displayBold,
    fontSize: 14,
    color: Colors.ink,
    letterSpacing: -0.3,
  },
  perDay: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3 },
  availPill: {
    backgroundColor: '#e8f5ee',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  availText: { fontFamily: Fonts.bodyMedium, fontSize: 10, color: '#2d7d4f' },

  pagerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    paddingBottom: 4,
  },
  pagerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: Colors.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  pagerDisabled: { opacity: 0.4 },
  pagerText: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink },
  pagerInfo: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },

  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: 40,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: Fonts.display,
    fontSize: 18,
    color: Colors.ink2,
    letterSpacing: -0.4,
  },
  emptySub: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink3,
    textAlign: 'center',
  },

  fetchOverlay: {
    position: 'absolute',
    top: 12,
    right: 12,
    padding: 6,
    backgroundColor: Colors.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
});

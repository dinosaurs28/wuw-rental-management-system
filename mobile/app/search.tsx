import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../constants/colors';
import { vehiclesApi } from '../lib/api';
import CarCard from '../components/cars/CarCard';
import type { Vehicle } from '../types/api';

const CATEGORIES = [
  { label: 'All',  value: 'All' },
  { label: 'Bike', value: 'Bike' },
  { label: 'Car',  value: 'Car' },
];

export default function Search() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [searchText, setSearchText] = useState('');
  const [selectedCat, setSelectedCat] = useState('All');
  const [submitted, setSubmitted] = useState(false);

  const { data: results, isLoading } = useQuery({
    queryKey: ['search', searchText, selectedCat],
    queryFn: () =>
      vehiclesApi.list({
        search: searchText || undefined,
        category: selectedCat === 'All' ? undefined : selectedCat,
        limit: 40,
      }),
    select: (res) => {
      const all = (res.data.data as Vehicle[]) ?? [];
      const seen = new Set<string>();
      return all.filter((v) => { if (seen.has(v.publicId)) return false; seen.add(v.publicId); return true; });
    },
    enabled: submitted,
  });

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
            autoFocus
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => { setSearchText(''); setSubmitted(false); }} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color={Colors.ink4} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Category filter */}
      <View style={styles.chips}>
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat.value}
            style={[styles.chip, selectedCat === cat.value && styles.chipActive]}
            onPress={() => { setSelectedCat(cat.value); setSubmitted(true); }}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipText, selectedCat === cat.value && styles.chipTextActive]}>
              {cat.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Results */}
      {!submitted ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Find your car</Text>
          <Text style={styles.emptySubtitle}>
            Search by make, model, or pick a category above.
          </Text>
        </View>
      ) : isLoading ? (
        <ActivityIndicator style={styles.loader} color={Colors.orange} size="large" />
      ) : (
        <>
          <Text style={styles.resultCount}>
            {results?.length ?? 0} result{results?.length !== 1 ? 's' : ''}
          </Text>
          <FlatList
            data={results ?? []}
            keyExtractor={(v) => v.publicId}
            numColumns={2}
            columnWrapperStyle={styles.row}
            contentContainerStyle={styles.grid}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.noResults}>
                <Text style={styles.noResultsText}>No vehicles match your search.</Text>
              </View>
            }
            renderItem={({ item }) => <CarCard vehicle={item} />}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 10,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
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
  searchInput: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
    padding: 0,
  },
  chips: { flexDirection: 'row', paddingHorizontal: 20, gap: 8, paddingBottom: 12 },
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
  emptyTitle: {
    fontFamily: Fonts.display,
    fontSize: 22,
    color: Colors.ink,
    letterSpacing: -0.5,
  },
  emptySubtitle: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink3,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 21,
  },
  noResults: { alignItems: 'center', paddingTop: 40 },
  noResultsText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink3 },
});

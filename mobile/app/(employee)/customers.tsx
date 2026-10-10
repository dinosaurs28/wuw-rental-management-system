import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { apiErrorMessage } from '../../lib/counterErrors';
import { CustomerCard } from '../../components/employee/customers/CustomerCard';
import { useCustomerList, useDebouncedValue } from '../../components/employee/customers/useCustomers';
import type { CustomerFilter } from '../../types/customers';

// Same filters as the branch manager's Customers tab.
const FILTERS: { key: CustomerFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'branch', label: 'Rented at my branch' },
  { key: 'credit', label: 'Pending credit' },
  { key: 'blacklisted', label: 'Blacklisted' },
];

const SEARCH_MAX = 100;

export default function CustomersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), 400);
  const [filter, setFilter] = useState<CustomerFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const {
    rows, total, isLoading, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isPlaceholderData,
  } = useCustomerList(search, filter);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const typing = searchInput.trim() !== search;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Customers</Text>
        <Text style={styles.subtitle}>Every registered customer across all branches</Text>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={17} color={Colors.ink3} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or phone number"
          placeholderTextColor={Colors.ink4}
          value={searchInput}
          onChangeText={(t) => setSearchInput(t.slice(0, SEARCH_MAX))}
          maxLength={SEARCH_MAX}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {typing || isPlaceholderData ? (
          <ActivityIndicator size="small" color={Colors.ink3} />
        ) : searchInput.length > 0 ? (
          <TouchableOpacity onPress={() => setSearchInput('')} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={17} color={Colors.ink4} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {FILTERS.map(({ key, label }) => {
            const active = filter === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setFilter(key)}
                activeOpacity={0.8}
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <ActivityIndicator style={styles.loader} color={Colors.orange} size="large" />
      ) : isError ? (
        <View style={styles.empty}>
          <Ionicons name="cloud-offline-outline" size={40} color={Colors.ink4} />
          <Text style={styles.emptyTitle}>Could not load customers</Text>
          <Text style={styles.emptySub}>{apiErrorMessage(error, 'Check your connection and try again.')}</Text>
          <TouchableOpacity onPress={() => refetch()}>
            <Text style={styles.retryText}>Tap to retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.customerPublicId}
          style={isPlaceholderData ? styles.stale : undefined}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.orange} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage && !isPlaceholderData) fetchNextPage();
          }}
          ListHeaderComponent={
            rows.length > 0 ? (
              <Text style={styles.countLine}>
                {total} customer{total === 1 ? '' : 's'}
              </Text>
            ) : null
          }
          ListFooterComponent={
            isFetchingNextPage ? <ActivityIndicator style={styles.footerLoader} color={Colors.orange} /> : null
          }
          ListEmptyComponent={
            isPlaceholderData ? (
              <ActivityIndicator style={styles.loader} color={Colors.orange} />
            ) : (
              <View style={styles.empty}>
                <Ionicons name="people-outline" size={44} color={Colors.ink4} />
                <Text style={styles.emptyTitle}>No customers found</Text>
                <Text style={styles.emptySub}>
                  {search ? 'Try a different name or phone number.' : 'Nobody matches this filter yet.'}
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <View style={styles.cardWrap}>
              <CustomerCard
                c={item}
                onPress={() => router.push(`/employee/customers/${item.customerPublicId}` as Href)}
              />
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, gap: 2 },
  title: { fontFamily: Fonts.displayBold, fontSize: 26, color: Colors.ink, letterSpacing: -0.6 },
  subtitle: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    height: 48,
    gap: 10,
  },
  searchInput: { flex: 1, fontFamily: Fonts.body, fontSize: 15, color: Colors.ink, padding: 0 },

  chips: { paddingHorizontal: 20, paddingVertical: 12, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  chipActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  chipText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  chipTextActive: { color: Colors.white },

  list: { paddingBottom: 100 },
  stale: { opacity: 0.6 },
  countLine: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink3, paddingHorizontal: 20, paddingBottom: 8 },
  cardWrap: { paddingHorizontal: 20, paddingBottom: 10 },
  loader: { marginTop: 80 },
  footerLoader: { marginVertical: 16 },
  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink2, letterSpacing: -0.4, textAlign: 'center' },
  emptySub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, textAlign: 'center' },
  retryText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange },
});

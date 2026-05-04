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
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';

interface CustomerResult {
  publicId: string;
  name: string;
  email: string;
  phone: string | null;
  customerProfile: {
    isProfileCompleted: boolean;
  } | null;
}

export default function CustomerSearch() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const { data: results, isLoading } = useQuery<CustomerResult[]>({
    queryKey: ['employee', 'customer-search', query],
    queryFn: async () => {
      const res = await employeeApi.searchCustomer(query);
      return (res.data?.customers ?? []) as CustomerResult[];
    },
    enabled: submitted && query.trim().length >= 2,
    staleTime: 30_000,
  });

  const handleSearch = () => {
    if (query.trim().length >= 2) setSubmitted(true);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>Customer Search</Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={17} color={Colors.ink3} />
          <TextInput
            style={styles.searchInput}
            placeholder="Name or phone number..."
            placeholderTextColor={Colors.ink4}
            value={query}
            onChangeText={(t) => { setQuery(t); setSubmitted(false); }}
            returnKeyType="search"
            onSubmitEditing={handleSearch}
            autoFocus
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => { setQuery(''); setSubmitted(false); }} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color={Colors.ink4} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[styles.searchBtn, query.trim().length < 2 && styles.searchBtnDisabled]}
          onPress={handleSearch}
          disabled={query.trim().length < 2}
          activeOpacity={0.8}
        >
          <Ionicons name="arrow-forward" size={18} color={Colors.white} />
        </TouchableOpacity>
      </View>

      {/* Results */}
      {!submitted ? (
        <View style={styles.emptyState}>
          <Ionicons name="people-outline" size={44} color={Colors.ink4} />
          <Text style={styles.emptyTitle}>Search customers</Text>
          <Text style={styles.emptySub}>Enter a name or phone number (min. 2 characters)</Text>
        </View>
      ) : isLoading ? (
        <ActivityIndicator style={styles.loader} color={Colors.orange} size="large" />
      ) : (
        <FlatList
          data={results ?? []}
          keyExtractor={(item) => item.publicId}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No results</Text>
              <Text style={styles.emptySub}>Try a different search term.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.customerCard}
              onPress={() => router.push(`/employee/customer/${item.publicId}`)}
              activeOpacity={0.85}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {item.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.customerInfo}>
                <Text style={styles.customerName}>{item.name}</Text>
                <Text style={styles.customerPhone}>{item.phone ?? item.email}</Text>
              </View>
              <View style={[styles.kycBadge, item.customerProfile?.isProfileCompleted ? styles.kycGreen : styles.kycAmber]}>
                <Text style={[styles.kycText, item.customerProfile?.isProfileCompleted ? styles.kycTextGreen : styles.kycTextAmber]}>
                  {item.customerProfile?.isProfileCompleted ? 'Verified' : 'Incomplete'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />
            </TouchableOpacity>
          )}
        />
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
    paddingBottom: 16,
    gap: 12,
  },
  back: { width: 36, height: 36, justifyContent: 'center' },
  title: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },

  searchRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 8,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    height: 50,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
    padding: 0,
  },
  searchBtn: {
    width: 50,
    height: 50,
    borderRadius: 14,
    backgroundColor: Colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBtnDisabled: { opacity: 0.35 },

  loader: { marginTop: 60 },
  list: { paddingHorizontal: 20, paddingBottom: 100, gap: 8 },

  customerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.white },
  customerInfo: { flex: 1 },
  customerName: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  customerPhone: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, marginTop: 2 },
  kycBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  kycGreen: { backgroundColor: '#10b98115' },
  kycAmber: { backgroundColor: '#f59e0b15' },
  kycText: { fontFamily: Fonts.bodySemiBold, fontSize: 11 },
  kycTextGreen: { color: '#10b981' },
  kycTextAmber: { color: '#f59e0b' },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 8 },
  emptyTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink2, letterSpacing: -0.4 },
  emptySub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, textAlign: 'center', paddingHorizontal: 40 },
});

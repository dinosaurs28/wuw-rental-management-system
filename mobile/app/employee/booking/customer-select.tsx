import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
import DateRangePicker from '../../../components/ui/DateRangePicker';

interface CustomerResult {
  publicId: string;
  name: string;
  email: string;
  phone: string | null;
  customerProfile: {
    isProfileCompleted: boolean;
    publicId: string;
  } | null;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function toIso(d: Date, time = '10:00') {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}T${time}`;
}

export default function EmployeeCustomerSelect() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { customerPublicId: preselectedId } = useLocalSearchParams<{
    customerPublicId?: string;
  }>();
  const [showSearch, setShowSearch] = useState(false);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  const { data: preselected, isLoading: preselectedLoading } = useQuery<CustomerResult | null>({
    queryKey: ['employee', 'customer', preselectedId],
    queryFn: async () => {
      const res = await employeeApi.getCustomer(preselectedId as string);
      const c = res.data?.data;
      if (!c) return null;
      return {
        publicId: c.publicId ?? preselectedId!,
        name: c.name,
        email: c.email,
        phone: c.phone ?? null,
        customerProfile: c.customerProfile ?? (c.isProfileCompleted != null ? {
          publicId: c.publicId ?? preselectedId!,
          isProfileCompleted: c.isProfileCompleted,
        } : null),
      };
    },
    enabled: !!preselectedId && !showSearch,
    staleTime: 60_000,
  });

  const initialStart = useMemo(() => new Date(), []);
  const initialEnd = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  }, []);

  const [startDate, setStartDate] = useState<Date>(initialStart);
  const [endDate, setEndDate] = useState<Date>(initialEnd);
  const [pickerVisible, setPickerVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results, isFetching } = useQuery<CustomerResult[]>({
    queryKey: ['employee', 'booking', 'customer-search', debounced],
    queryFn: async () => {
      const res = await employeeApi.searchCustomer(debounced);
      return (res.data?.customers ?? []) as CustomerResult[];
    },
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });

  const handleSelectCustomer = (c: CustomerResult) => {
    router.push({
      pathname: '/employee/booking/vehicle-list' as any,
      params: {
        customerPublicId: c.publicId,
        start: toIso(startDate),
        end: toIso(endDate),
      },
    });
  };

  const handleCreateNewCustomer = () => {
    const next = encodeURIComponent(
      `/employee/booking/vehicle-list?start=${toIso(startDate)}&end=${toIso(endDate)}`,
    );
    router.push(
      `/employee/walkin/initiate?next=${next}&customerHandoff=1` as any,
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <View style={styles.headerTitles}>
          <Text style={styles.title}>Select Customer</Text>
          <Text style={styles.subtitle}>Step 1 · New Booking</Text>
        </View>
      </View>

      {/* Date pill */}
      <TouchableOpacity
        style={styles.dateCard}
        onPress={() => setPickerVisible(true)}
        activeOpacity={0.85}
      >
        <View style={styles.dateBlock}>
          <Text style={styles.dateLabel}>PICKUP</Text>
          <Text style={styles.dateValue}>{fmtDate(startDate)}</Text>
        </View>
        <Ionicons name="arrow-forward" size={16} color={Colors.ink3} />
        <View style={styles.dateBlock}>
          <Text style={styles.dateLabel}>RETURN</Text>
          <Text style={styles.dateValue}>{fmtDate(endDate)}</Text>
        </View>
        <Ionicons name="calendar-outline" size={18} color={Colors.orange} />
      </TouchableOpacity>

      {/* Preselected customer card (when arriving from /employee/customer/[id]) */}
      {preselectedId && !showSearch ? (
        preselectedLoading ? (
          <ActivityIndicator style={{ marginTop: 16 }} color={Colors.orange} />
        ) : preselected ? (
          <View style={{ paddingHorizontal: 20 }}>
            <Text style={styles.preselectedLabel}>SELECTED CUSTOMER</Text>
            <View style={styles.preselectedCard}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {preselected.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.customerInfo}>
                <Text style={styles.customerName} numberOfLines={1}>
                  {preselected.name}
                </Text>
                <Text style={styles.customerMeta} numberOfLines={1}>
                  {preselected.phone ?? preselected.email}
                </Text>
              </View>
              <View
                style={[
                  styles.kycBadge,
                  preselected.customerProfile?.isProfileCompleted ? styles.kycGreen : styles.kycAmber,
                ]}
              >
                <Text
                  style={[
                    styles.kycText,
                    preselected.customerProfile?.isProfileCompleted ? styles.kycTextGreen : styles.kycTextAmber,
                  ]}
                >
                  {preselected.customerProfile?.isProfileCompleted ? 'Complete' : 'Incomplete'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.continueBtn}
              onPress={() => handleSelectCustomer(preselected)}
              activeOpacity={0.9}
            >
              <Text style={styles.continueBtnText}>Continue to vehicles</Text>
              <Ionicons name="arrow-forward" size={16} color={Colors.white} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.changeCustomerLink}
              onPress={() => setShowSearch(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="swap-horizontal-outline" size={14} color={Colors.ink3} />
              <Text style={styles.changeCustomerText}>Change customer</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.emptyState, { paddingHorizontal: 32 }]}>
            <Ionicons name="alert-circle-outline" size={36} color={Colors.ink4} />
            <Text style={styles.emptyTitle}>Customer not found</Text>
            <TouchableOpacity onPress={() => setShowSearch(true)} activeOpacity={0.7}>
              <Text style={[styles.changeCustomerText, { marginTop: 8 }]}>Search instead</Text>
            </TouchableOpacity>
          </View>
        )
      ) : null}

      {/* Search bar (hidden when preselected and not actively switching) */}
      {(!preselectedId || showSearch) && (
      <>
      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={17} color={Colors.ink3} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, phone, or email..."
            placeholderTextColor={Colors.ink4}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoFocus
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color={Colors.ink4} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Create new walkin CTA */}
      <TouchableOpacity
        style={styles.createNewBtn}
        onPress={handleCreateNewCustomer}
        activeOpacity={0.85}
      >
        <View style={styles.createNewIcon}>
          <Ionicons name="person-add-outline" size={18} color={Colors.orange} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.createNewTitle}>Create new walk-in customer</Text>
          <Text style={styles.createNewSub}>For first-time renters at the counter</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={Colors.ink4} />
      </TouchableOpacity>

      {/* Results */}
      {debounced.length < 2 ? (
        <View style={styles.emptyState}>
          <Ionicons name="people-outline" size={44} color={Colors.ink4} />
          <Text style={styles.emptyTitle}>Find a customer</Text>
          <Text style={styles.emptySub}>
            Type at least 2 characters to search the customer database.
          </Text>
        </View>
      ) : isFetching ? (
        <ActivityIndicator style={styles.loader} color={Colors.orange} size="large" />
      ) : (
        <FlatList
          data={results ?? []}
          keyExtractor={(item) => item.publicId}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No matches</Text>
              <Text style={styles.emptySub}>
                Try a different name or phone, or create a new walk-in.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const completed = item.customerProfile?.isProfileCompleted;
            return (
              <TouchableOpacity
                style={styles.customerCard}
                onPress={() => handleSelectCustomer(item)}
                activeOpacity={0.85}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {item.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.customerInfo}>
                  <Text style={styles.customerName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.customerMeta} numberOfLines={1}>
                    {item.phone ?? item.email}
                  </Text>
                </View>
                <View
                  style={[
                    styles.kycBadge,
                    completed ? styles.kycGreen : styles.kycAmber,
                  ]}
                >
                  <Text
                    style={[
                      styles.kycText,
                      completed ? styles.kycTextGreen : styles.kycTextAmber,
                    ]}
                  >
                    {completed ? 'Verified' : 'Incomplete'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />
              </TouchableOpacity>
            );
          }}
        />
      )}
      </>
      )}

      <DateRangePicker
        visible={pickerVisible}
        startDate={startDate}
        endDate={endDate}
        onConfirm={(s, e) => {
          setStartDate(s);
          setEndDate(e);
        }}
        onClose={() => setPickerVisible(false)}
      />
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

  dateCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  dateBlock: { flex: 1 },
  dateLabel: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 9,
    color: Colors.ink3,
    letterSpacing: 0.9,
  },
  dateValue: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
    marginTop: 2,
  },

  searchRow: {
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  searchWrap: {
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

  createNewBtn: {
    marginHorizontal: 20,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.orangeSoft,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  createNewIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createNewTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  createNewSub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink3,
    marginTop: 1,
  },

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
  customerName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
  customerMeta: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink3,
    marginTop: 2,
  },
  kycBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  kycGreen: { backgroundColor: '#10b98115' },
  kycAmber: { backgroundColor: '#f59e0b15' },
  kycText: { fontFamily: Fonts.bodySemiBold, fontSize: 11 },
  kycTextGreen: { color: '#10b981' },
  kycTextAmber: { color: '#f59e0b' },

  preselectedLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 18,
    marginBottom: 8,
  },
  preselectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 12,
  },
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.orange,
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 14,
  },
  continueBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
    letterSpacing: 0.2,
  },
  changeCustomerLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
  },
  changeCustomerText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 13,
    color: Colors.ink3,
  },

  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
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
});

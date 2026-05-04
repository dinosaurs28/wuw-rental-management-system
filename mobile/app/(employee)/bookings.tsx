import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';

type Tab = 'pickups' | 'returns';

interface BookingItem {
  publicId: string;
  startAt: string;
  endAt: string;
  status: string;
  totalFinal: number;
  customer: { user: { name: string; phone: string | null } };
  items: Array<{ vehicle: { make: string; model: string; regNo: string } }>;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function BookingCard({ booking, type }: { booking: BookingItem; type: Tab }) {
  const router = useRouter();
  const vehicle = booking.items[0]?.vehicle;
  const customer = booking.customer?.user;
  const dateLabel = type === 'pickups' ? 'Pickup' : 'Return';
  const dateValue = type === 'pickups' ? booking.startAt : booking.endAt;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() =>
        router.push(
          type === 'pickups'
            ? `/employee/pickup/${booking.publicId}`
            : `/employee/return/${booking.publicId}`,
        )
      }
    >
      <View style={styles.cardTop}>
        <View style={styles.cardVehicle}>
          <Text style={styles.vehicleName}>
            {vehicle ? `${vehicle.make} ${vehicle.model}` : 'Vehicle'}
          </Text>
          {vehicle?.regNo && <Text style={styles.regNo}>{vehicle.regNo}</Text>}
        </View>
        <View style={[styles.statusBadge, type === 'pickups' ? styles.statusPickup : styles.statusReturn]}>
          <Text style={[styles.statusText, type === 'pickups' ? styles.statusPickupText : styles.statusReturnText]}>
            {type === 'pickups' ? 'Pickup' : 'Return'}
          </Text>
        </View>
      </View>

      <View style={styles.cardMeta}>
        <View style={styles.metaRow}>
          <Ionicons name="person-outline" size={13} color={Colors.ink3} />
          <Text style={styles.metaText}>{customer?.name ?? '—'}</Text>
          {customer?.phone && <Text style={styles.metaPhone}>{customer.phone}</Text>}
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={13} color={Colors.ink3} />
          <Text style={styles.metaText}>
            {dateLabel}: {formatDate(dateValue)}
          </Text>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.bookingId}>#{booking.publicId.slice(-8).toUpperCase()}</Text>
        <View style={styles.amountRow}>
          <Text style={styles.amount}>₹{Number(booking.totalFinal).toLocaleString('en-IN')}</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function BookingsQueue() {
  const insets = useSafeAreaInsets();
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const [activeTab, setActiveTab] = useState<Tab>(tab === 'returns' ? 'returns' : 'pickups');

  const {
    data: pickups,
    isLoading: pickupsLoading,
    refetch: refetchPickups,
    isError: pickupsError,
  } = useQuery<BookingItem[]>({
    queryKey: ['employee', 'pickups'],
    queryFn: async () => {
      try {
        const res = await employeeApi.listPickups();
        return (res.data?.data ?? []) as BookingItem[];
      } catch (err: any) {
        if (err.response?.status === 404) return [];
        throw err;
      }
    },
    staleTime: 30_000,
    retry: false,
  });

  const {
    data: returns,
    isLoading: returnsLoading,
    refetch: refetchReturns,
    isError: returnsError,
  } = useQuery<BookingItem[]>({
    queryKey: ['employee', 'returns'],
    queryFn: async () => {
      try {
        const res = await employeeApi.listReturns();
        return (res.data?.data ?? []) as BookingItem[];
      } catch (err: any) {
        if (err.response?.status === 404) return [];
        throw err;
      }
    },
    staleTime: 30_000,
    retry: false,
  });

  const isLoading = activeTab === 'pickups' ? pickupsLoading : returnsLoading;
  const isError = activeTab === 'pickups' ? pickupsError : returnsError;
  const data = activeTab === 'pickups' ? (pickups ?? []) : (returns ?? []);

  const onRefresh = () => {
    if (activeTab === 'pickups') refetchPickups();
    else refetchReturns();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Queue</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'pickups' && styles.tabActive]}
          onPress={() => setActiveTab('pickups')}
          activeOpacity={0.8}
        >
          <Ionicons
            name="arrow-up-circle-outline"
            size={15}
            color={activeTab === 'pickups' ? Colors.orange : Colors.ink3}
          />
          <Text style={[styles.tabText, activeTab === 'pickups' && styles.tabTextActive]}>
            Pickups{pickups?.length ? ` (${pickups.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'returns' && styles.tabActive]}
          onPress={() => setActiveTab('returns')}
          activeOpacity={0.8}
        >
          <Ionicons
            name="arrow-down-circle-outline"
            size={15}
            color={activeTab === 'returns' ? Colors.orange : Colors.ink3}
          />
          <Text style={[styles.tabText, activeTab === 'returns' && styles.tabTextActive]}>
            Returns{returns?.length ? ` (${returns.length})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      {isLoading ? (
        <ActivityIndicator style={styles.loader} color={Colors.orange} size="large" />
      ) : isError ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Could not load</Text>
          <TouchableOpacity onPress={onRefresh}>
            <Text style={styles.retryText}>Tap to retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.publicId}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={Colors.orange} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons
                name={activeTab === 'pickups' ? 'arrow-up-circle-outline' : 'arrow-down-circle-outline'}
                size={44}
                color={Colors.ink4}
              />
              <Text style={styles.emptyTitle}>
                No {activeTab === 'pickups' ? 'upcoming pickups' : 'pending returns'}
              </Text>
              <Text style={styles.emptySub}>Check back after a refresh.</Text>
            </View>
          }
          renderItem={({ item }) => <BookingCard booking={item} type={activeTab} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 26,
    color: Colors.ink,
    letterSpacing: -0.6,
  },

  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  tabActive: { borderColor: Colors.orange, backgroundColor: '#ff6a1f0d' },
  tabText: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink3 },
  tabTextActive: { color: Colors.orange },

  list: { paddingHorizontal: 20, paddingBottom: 100, gap: 10 },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 12,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardVehicle: { gap: 2 },
  vehicleName: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.ink },
  regNo: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  statusBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusPickup: { backgroundColor: '#ff6a1f15' },
  statusReturn: { backgroundColor: '#3b82f615' },
  statusText: { fontFamily: Fonts.bodySemiBold, fontSize: 11 },
  statusPickupText: { color: Colors.orange },
  statusReturnText: { color: '#3b82f6' },

  cardMeta: { gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2 },
  metaPhone: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, marginLeft: 4 },

  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bookingId: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink4 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  amount: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },

  loader: { marginTop: 80 },
  empty: { alignItems: 'center', paddingTop: 80, gap: 8 },
  emptyTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink2, letterSpacing: -0.4 },
  emptySub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },
  retryText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange },
});

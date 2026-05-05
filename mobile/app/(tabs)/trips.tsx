import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Fonts } from '../../constants/colors';
import { userApi } from '../../lib/api';
import type { BookingTrip, BookingStatus } from '../../types/api';

type Tab = 'active' | 'upcoming' | 'past';

const TAB_LABELS: { key: Tab; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
];

const STATUS_COLOR: Record<BookingStatus, string> = {
  HOLD: Colors.ink3,
  CONFIRMED: '#2d9d61',
  PICKED_UP: Colors.orange,
  RETURNED: Colors.ink3,
  CANCELLED: '#e53e3e',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
}

function TripCard({ trip }: { trip: BookingTrip }) {
  const router = useRouter();
  const v = trip.vehicles[0];

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push({
        pathname: '/trip/[bookingId]',
        params: {
          bookingId:     trip.bookingId,
          status:        trip.status,
          make:          v?.make ?? '',
          model:         v?.model ?? '',
          thumbnail:     v?.thumbnail ?? '',
          startAt:       trip.startAt,
          endAt:         trip.endAt,
          days:          String(trip.days),
          total:         String(trip.total),
          paymentStatus: trip.paymentStatus ?? '',
        },
      })}
      activeOpacity={0.88}
    >
      <View style={styles.cardPhoto}>
        {v?.thumbnail ? (
          <Image source={{ uri: v.thumbnail }} style={styles.photo} resizeMode="cover" />
        ) : (
          <LinearGradient
            colors={['#1a1a1a', '#2a2a2a']}
            style={styles.photo}
          />
        )}
      </View>
      <View style={styles.cardInfo}>
        <View style={styles.cardTop}>
          <Text style={styles.carName} numberOfLines={1}>
            {v ? `${v.make} ${v.model}` : 'Vehicle'}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[trip.status] + '22' }]}>
            <Text style={[styles.statusText, { color: STATUS_COLOR[trip.status] }]}>
              {trip.status}
            </Text>
          </View>
        </View>
        <Text style={styles.dates}>
          {formatDate(trip.startAt)} → {formatDate(trip.endAt)} · {trip.days}d
        </Text>
        <View style={styles.cardBottom}>
          <Text style={styles.total}>
            ₹{Number(trip.total).toLocaleString('en-IN')}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function Trips() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<Tab>('upcoming');

  const { data: bookings, isLoading, error } = useQuery({
    queryKey: ['bookings', activeTab],
    queryFn: async () => {
      const res = await userApi.bookings(1, 20);
      console.log(`[trips] API response status=${res.status} data=${JSON.stringify(res.data?.data?.map((b: any) => ({ id: b.bookingId, status: b.status, paymentStatus: b.paymentStatus })))}`);
      return res;
    },
    select: (res) => {
      const all: BookingTrip[] = res.data.data ?? [];
      if (activeTab === 'active') return all.filter((b) => b.status === 'PICKED_UP');
      if (activeTab === 'upcoming') return all.filter((b) => b.status === 'CONFIRMED' || b.status === 'HOLD');
      return all.filter((b) => b.status === 'RETURNED' || b.status === 'CANCELLED');
    },
  });
  if (error) console.error('[trips] query error:', error);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>My Trips</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {TAB_LABELS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, activeTab === t.key && styles.tabActive]}
            onPress={() => setActiveTab(t.key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator style={styles.loader} color={Colors.orange} size="large" />
      ) : (
        <FlatList
          data={bookings ?? []}
          keyExtractor={(b) => b.bookingId}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name="car-outline" size={32} color={Colors.ink4} />
              </View>
              <Text style={styles.emptyTitle}>No trips here</Text>
              <Text style={styles.emptySubtitle}>
                {activeTab === 'active'
                  ? 'You have no active rentals.'
                  : activeTab === 'upcoming'
                  ? 'No upcoming bookings.'
                  : 'Your trip history will appear here.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => <TripCard trip={item} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 26,
    color: Colors.ink,
    letterSpacing: -0.8,
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 8,
    marginTop: 16,
    marginBottom: 4,
  },
  tab: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  tabActive: {
    backgroundColor: Colors.black,
    borderColor: Colors.black,
  },
  tabText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 13,
    color: Colors.ink2,
  },
  tabTextActive: { color: Colors.white },
  loader: { marginTop: 60 },
  list: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 12 },
  card: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardPhoto: { width: 100 },
  photo: { width: 100, height: '100%' as const, minHeight: 90 },
  cardInfo: { flex: 1, padding: 14, gap: 4 },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  carName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
    flex: 1,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  dates: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink3,
    marginTop: 2,
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  total: {
    fontFamily: Fonts.displayBold,
    fontSize: 15,
    color: Colors.ink,
  },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
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

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ScrollView,
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
import { useEmployeeBookingStore } from '../../../store/employeeBooking';
import DateRangePicker from '../../../components/ui/DateRangePicker';

interface VehicleCard {
  groupKey: string;
  make: string;
  model: string;
  category: string;
  branch: string;
  availableCount: number;
  imageUrl: Array<{ file: { url: string } }>;
  pricing: { daily: number };
  pricingDetails?: { price: number; finalPrice: number; type: string };
}

const TIME_SLOTS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? '00' : '30';
  return `${String(h).padStart(2, '0')}:${m}`;
});

function toLocalISO(date: Date, time: string) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T${time}`;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function TimeRow({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timeRow}>
      {TIME_SLOTS.map((t) => (
        <TouchableOpacity
          key={t}
          style={[styles.timePill, value === t && styles.timePillActive]}
          onPress={() => onChange(t)}
          activeOpacity={0.8}
        >
          <Text style={[styles.timePillText, value === t && styles.timePillTextActive]}>{t}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

export default function WalkinVehiclesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const customer = useEmployeeBookingStore((s) => s.customer);
  const setVehicle = useEmployeeBookingStore((s) => s.setVehicle);
  const setDates = useEmployeeBookingStore((s) => s.setDates);

  const [startDate, setStartDate] = useState(() => new Date(Date.now() + 86400_000));
  const [endDate, setEndDate] = useState(() => new Date(Date.now() + 2 * 86400_000));
  const [pickupTime, setPickupTime] = useState('10:00');
  const [returnTime, setReturnTime] = useState('10:00');
  const [showDates, setShowDates] = useState(false);

  const [category, setCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'default' | 'price_low_to_high' | 'price_high_to_low'>('default');
  const [selecting, setSelecting] = useState<string | null>(null);

  const startISO = useMemo(() => toLocalISO(startDate, pickupTime), [startDate, pickupTime]);
  const endISO = useMemo(() => toLocalISO(endDate, returnTime), [endDate, returnTime]);

  const { data: categories = [] } = useQuery({
    queryKey: ['employee', 'vehicle-categories'],
    queryFn: async () => {
      const res = await employeeApi.vehicleCategories();
      const raw = res.data;
      const list = Array.isArray(raw) ? raw : raw?.data ?? [];
      return list as { publicId: string; name: string }[];
    },
    staleTime: 300_000,
  });

  const { data: vehicles = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['employee', 'walkin-vehicles', startISO, endISO, category, search, sort],
    queryFn: async () => {
      const res = await employeeApi.searchVehicles({
        start: startISO,
        end: endISO,
        ...(category !== 'all' ? { category } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(sort !== 'default' ? { sort } : {}),
        limit: 100,
      });
      return (res.data?.data ?? []) as VehicleCard[];
    },
    enabled: !!customer,
  });

  const selectGroup = async (card: VehicleCard) => {
    setSelecting(card.groupKey);
    try {
      const res = await employeeApi.vehicleGroupDetail(card.groupKey, { start: startISO, end: endISO });
      const d = res.data?.data;
      setDates(startISO, endISO);
      setVehicle({
        groupKey: card.groupKey,
        make: d?.make ?? card.make,
        model: d?.model ?? card.model,
        category: d?.category ?? card.category,
        branch: d?.branch ?? card.branch,
        deposit: Number(d?.deposit ?? 0),
        dailyPrice: d?.pricing?.daily ?? card.pricing?.daily ?? null,
        image: card.imageUrl?.[0]?.file?.url ?? d?.images?.[0] ?? null,
        pricingDetails: d?.pricingDetails ?? null,
        advancePayAmount: Number(d?.advancePayAmount ?? 0),
      });
      router.push('/employee/booking/kyc');
    } catch (err: any) {
      Alert.alert('Unavailable', err?.response?.data?.message ?? 'Could not load this vehicle for the selected dates.');
    } finally {
      setSelecting(null);
    }
  };

  if (!customer) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.replace('/employee/customer/search')} style={styles.back} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.title}>Select Vehicle</Text>
        </View>
        <View style={styles.empty}>
          <Ionicons name="person-outline" size={40} color={Colors.ink4} />
          <Text style={styles.emptyTitle}>Pick a customer first</Text>
        </View>
      </View>
    );
  }

  const header = (
    <View style={styles.listHeader}>
      {/* Customer chip */}
      <View style={styles.customerChip}>
        <Ionicons name="person-circle-outline" size={18} color={Colors.orange} />
        <Text style={styles.customerChipText} numberOfLines={1}>
          Booking for {customer.name}
        </Text>
      </View>

      {/* Rental period */}
      <Text style={styles.sectionLabel}>Rental period</Text>
      <View style={styles.periodCard}>
        <TouchableOpacity style={styles.dateRow} onPress={() => setShowDates(true)} activeOpacity={0.8}>
          <View style={styles.dateCol}>
            <Text style={styles.dateColLabel}>PICKUP</Text>
            <Text style={styles.dateColValue}>{fmtDate(startDate)}</Text>
          </View>
          <Ionicons name="arrow-forward" size={16} color={Colors.ink4} />
          <View style={styles.dateCol}>
            <Text style={styles.dateColLabel}>RETURN</Text>
            <Text style={styles.dateColValue}>{fmtDate(endDate)}</Text>
          </View>
          <Ionicons name="calendar-outline" size={18} color={Colors.ink3} />
        </TouchableOpacity>

        <View style={styles.timeBlock}>
          <Text style={styles.timeLabel}>Pickup time</Text>
          <TimeRow value={pickupTime} onChange={setPickupTime} />
        </View>
        <View style={styles.timeBlock}>
          <Text style={styles.timeLabel}>Return time</Text>
          <TimeRow value={returnTime} onChange={setReturnTime} />
        </View>
      </View>

      {/* Category tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow}>
        <TouchableOpacity
          style={[styles.catPill, category === 'all' && styles.catPillActive]}
          onPress={() => setCategory('all')}
          activeOpacity={0.8}
        >
          <Text style={[styles.catText, category === 'all' && styles.catTextActive]}>All</Text>
        </TouchableOpacity>
        {categories.map((c) => (
          <TouchableOpacity
            key={c.publicId}
            style={[styles.catPill, category === c.publicId && styles.catPillActive]}
            onPress={() => setCategory(c.publicId)}
            activeOpacity={0.8}
          >
            <Text style={[styles.catText, category === c.publicId && styles.catTextActive]}>{c.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Search + sort */}
      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={16} color={Colors.ink3} />
          <TextInput
            style={styles.searchInput}
            placeholder="Make or model"
            placeholderTextColor={Colors.ink4}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
        </View>
        <TouchableOpacity
          style={styles.sortBtn}
          onPress={() =>
            setSort((s) =>
              s === 'default' ? 'price_low_to_high' : s === 'price_low_to_high' ? 'price_high_to_low' : 'default',
            )
          }
          activeOpacity={0.8}
        >
          <Ionicons
            name={sort === 'price_high_to_low' ? 'arrow-down' : sort === 'price_low_to_high' ? 'arrow-up' : 'swap-vertical'}
            size={16}
            color={sort === 'default' ? Colors.ink3 : Colors.orange}
          />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>Select Vehicle</Text>
      </View>

      <FlatList
        data={vehicles}
        keyExtractor={(item) => item.groupKey}
        ListHeaderComponent={header}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={Colors.orange} size="large" />
          ) : isError ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Could not load vehicles</Text>
              <TouchableOpacity onPress={() => refetch()}><Text style={styles.retry}>Tap to retry</Text></TouchableOpacity>
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="car-outline" size={40} color={Colors.ink4} />
              <Text style={styles.emptyTitle}>No vehicles available</Text>
              <Text style={styles.emptySub}>Try different dates or category.</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const price = item.pricingDetails?.finalPrice ?? item.pricing?.daily ?? 0;
          const busy = selecting === item.groupKey;
          return (
            <TouchableOpacity style={styles.card} onPress={() => selectGroup(item)} disabled={busy} activeOpacity={0.85}>
              {item.imageUrl?.[0]?.file?.url ? (
                <Image source={{ uri: item.imageUrl[0].file.url }} style={styles.cardImg} resizeMode="cover" />
              ) : (
                <View style={[styles.cardImg, styles.cardImgPlaceholder]}>
                  <Ionicons name="car-outline" size={24} color={Colors.ink4} />
                </View>
              )}
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{item.make} {item.model}</Text>
                <Text style={styles.cardMeta}>{item.category} · {item.availableCount} available</Text>
                <Text style={styles.cardPrice}>₹{Number(price).toLocaleString('en-IN')}{item.pricingDetails ? ' total' : '/day'}</Text>
              </View>
              {busy ? (
                <ActivityIndicator size="small" color={Colors.orange} />
              ) : (
                <Ionicons name="chevron-forward" size={18} color={Colors.ink4} />
              )}
            </TouchableOpacity>
          );
        }}
      />

      <DateRangePicker
        visible={showDates}
        startDate={startDate}
        endDate={endDate}
        onConfirm={(s, e) => { setStartDate(s); setEndDate(e); }}
        onClose={() => setShowDates(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 12 },
  back: { width: 36, height: 36, justifyContent: 'center' },
  title: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },

  list: { paddingHorizontal: 20, gap: 10 },
  listHeader: { gap: 14, paddingBottom: 6 },

  customerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#ff6a1f0d', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: '#ff6a1f25',
  },
  customerChipText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink2, flex: 1 },

  sectionLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3, textTransform: 'uppercase', letterSpacing: 1 },
  periodCard: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.hairline, padding: 14, gap: 14 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dateCol: { flex: 1 },
  dateColLabel: { fontFamily: Fonts.bodyMedium, fontSize: 10, color: Colors.ink3, letterSpacing: 0.6, marginBottom: 2 },
  dateColValue: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  timeBlock: { gap: 8 },
  timeLabel: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink3 },
  timeRow: { gap: 6, paddingRight: 8 },
  timePill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline },
  timePillActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  timePillText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3 },
  timePillTextActive: { color: Colors.white },

  catRow: { gap: 8, paddingRight: 8 },
  catPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.hairline },
  catPillActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  catText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  catTextActive: { color: Colors.white },

  searchRow: { flexDirection: 'row', gap: 10 },
  searchWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.hairline,
    paddingHorizontal: 12, height: 46,
  },
  searchInput: { flex: 1, fontFamily: Fonts.body, fontSize: 14, color: Colors.ink, padding: 0 },
  sortBtn: {
    width: 46, height: 46, borderRadius: 12, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.hairline, alignItems: 'center', justifyContent: 'center',
  },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 16, padding: 12,
    borderWidth: 1, borderColor: Colors.hairline,
  },
  cardImg: { width: 76, height: 56, borderRadius: 10, backgroundColor: Colors.bg },
  cardImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardInfo: { flex: 1, gap: 2 },
  cardName: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  cardMeta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  cardPrice: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange, marginTop: 2 },

  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink2, letterSpacing: -0.4 },
  emptySub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },
  retry: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange, marginTop: 6 },
});

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useEmployeeBookingStore, type WalkinPlan } from '../../../store/employeeBooking';
import { useAuthStore } from '../../../store/auth';
import DateRangePicker from '../../../components/ui/DateRangePicker';
import DurationChips from '../../../components/ui/DurationChips';
import { BranchHoursLine, TimesNotice } from '../../../components/booking/BranchHours';
import { useBranchSchedule } from '../../../hooks/useBranchSchedule';
import { MAX_BOOKING_DAYS, MONTHLY_MAX_DAYS, MONTHLY_MIN_DAYS } from '../../../lib/bookingWindow';
import {
  bookingTimesNotice,
  closedDayText,
  fitBookingRange,
  isClosedDay,
  noPickupTimesLeft,
  rangeHoursLine,
  rangeScheduleIssue,
  slotsWithinHours,
} from '../../../lib/branchSchedule';
import {
  DURATION_PRESETS,
  activePresetHours,
  bookingWindowLastDay,
  initialRange,
  maxReturnFor,
  monthlyReturnMax,
  monthlyReturnMin,
  normalizeRange,
  presetRange,
  rangeLengthLabel,
  timeOf,
  withSelectedSlot,
  withTime,
  type TimeSlot,
} from '../../../lib/dates';

// Monthly plan quick lengths: the engine counts a month as 30 days.
const MONTH_PRESETS = [1, 2, 3, 6].map((n) => ({ label: `${n} month${n > 1 ? 's' : ''}`, hours: n * 30 * 24 }));

interface VehicleCard {
  groupKey: string;
  make: string;
  model: string;
  category: string;
  typeClass?: string;
  branch: string;
  availableCount: number;
  imageUrl: Array<{ file: { url: string } }>;
  pricing: { daily: number };
  // billedAs (#5): what the total covers, e.g. "12 hours", "1 month + 5 days"
  pricingDetails?: { price: number; finalPrice: number; type: string; billedAs?: string };
}

type TypeClass = 'TWO_WHEELER' | 'FOUR_WHEELER';
const TYPE_LABEL: Record<TypeClass, string> = { TWO_WHEELER: 'two-wheeler', FOUR_WHEELER: 'four-wheeler' };

interface LimitSlot {
  vehicleMake: string;
  vehicleModel: string;
  endAt: string;
}

// GET /api/employee/customer/:id/booking-limits — the customer's own active
// bookings that block new ones for the chosen dates.
interface BookingLimits {
  usedTypeClasses?: Partial<Record<TypeClass, LimitSlot>>;
  // The branch allows one vehicle at a time and the customer already has one.
  blockedAll?: boolean;
  anyVehicleConflict?: LimitSlot | null;
}

// Offset-less "YYYY-MM-DDTHH:mm" — the backend reads it as IST.
function toLocalISO(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T${timeOf(date)}`;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function TimeRow({
  value,
  slots,
  onChange,
  emptyText,
}: {
  value: string;
  slots: TimeSlot[];
  onChange: (t: string) => void;
  emptyText?: string;
}) {
  const scrollRef = useRef<ScrollView>(null);
  // An off-grid current value (e.g. 6:05 PM) stays listed and selected.
  const data = withSelectedSlot(slots, value);
  return (
    <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timeRow}>
      {data.map((t) => (
        <TouchableOpacity
          key={t.value}
          style={[styles.timePill, value === t.value && styles.timePillActive]}
          onPress={() => onChange(t.value)}
          // Bring the selected time into view whenever the row lays out.
          onLayout={(e) => {
            if (t.value === value) scrollRef.current?.scrollTo({ x: Math.max(0, e.nativeEvent.layout.x - 8), animated: false });
          }}
          activeOpacity={0.8}
        >
          <Text style={[styles.timePillText, value === t.value && styles.timePillTextActive]}>{t.label}</Text>
        </TouchableOpacity>
      ))}
      {data.length === 0 ? (
        <Text style={styles.timeEmpty}>{emptyText ?? 'No times left on this day. Pick another date.'}</Text>
      ) : null}
    </ScrollView>
  );
}

export default function WalkinVehiclesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const customer = useEmployeeBookingStore((s) => s.customer);
  const setVehicle = useEmployeeBookingStore((s) => s.setVehicle);
  const setDates = useEmployeeBookingStore((s) => s.setDates);
  const setStorePlan = useEmployeeBookingStore((s) => s.setPlan);

  // Pickup today at the next 5-minute mark, return 24 hours later; every
  // change goes through normalizeRange so the return stays after the pickup.
  const [range, setRange] = useState(() => initialRange());
  const { start: startDate, end: endDate } = range;
  const [showDates, setShowDates] = useState(false);

  // Rental plan (#15/#17): Standard = up to 15 days; Monthly rental = the
  // counter-only monthly plan, 30–180 days with the pickup inside 15 days.
  const [plan, setPlan] = useState<WalkinPlan>(() => useEmployeeBookingStore.getState().plan);
  const monthly = plan === 'MONTHLY';

  // Office hours of the staff member's branch (#2): pickers offer only times
  // it accepts, and the range is moved back inside hours and length limits
  // whenever a change lands outside them. Fleet staff can't bypass hours.
  const branchPublicId = useAuthStore((s) => s.user?.branchPublicId ?? null);
  const { data: schedule } = useBranchSchedule(branchPublicId);
  const maxEnd = useCallback((s: Date) => (monthly ? monthlyReturnMax(s) : maxReturnFor(s)), [monthly]);
  const fit = useCallback(
    (r: { start: Date; end: Date }) =>
      fitBookingRange(r, { config: schedule, maxEnd, minEnd: monthly ? monthlyReturnMin : undefined }),
    [schedule, maxEnd, monthly],
  );
  useEffect(() => {
    setRange((r) => fit(r));
  }, [fit, range]);
  const timesNotice = bookingTimesNotice(schedule, startDate, endDate, { monthly });
  const presets = monthly ? MONTH_PRESETS : DURATION_PRESETS;
  const presetIssue = (hours: number) => {
    const next = presetRange(startDate, hours);
    if (next.end.getTime() > maxEnd(startDate).getTime()) {
      return `past the ${monthly ? MONTHLY_MAX_DAYS : MAX_BOOKING_DAYS}-day limit`;
    }
    return rangeScheduleIssue(schedule, next.start, next.end);
  };
  const choosePlan = (next: WalkinPlan) => {
    if (next === plan) return;
    setPlan(next);
    // Monthly starts at the 30-day minimum; Standard goes back to one day.
    setRange((r) => presetRange(r.start, next === 'MONTHLY' ? MONTHLY_MIN_DAYS * 24 : 24));
  };

  const [category, setCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'default' | 'price_low_to_high' | 'price_high_to_low'>('default');
  const [selecting, setSelecting] = useState<string | null>(null);

  const startISO = useMemo(() => toLocalISO(startDate), [startDate]);
  const endISO = useMemo(() => toLocalISO(endDate), [endDate]);

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

  // Same check the web listing runs up front, so staff see the block before
  // picking a vehicle instead of at booking create.
  const { data: limits } = useQuery({
    queryKey: ['employee', 'customer-booking-limits', customer?.publicId, startISO, endISO],
    queryFn: async () => {
      const res = await employeeApi.customerBookingLimits(customer!.publicId, { start: startISO, end: endISO });
      return res.data as BookingLimits;
    },
    enabled: !!customer,
    staleTime: 30_000,
    retry: false,
  });
  const usedTypes = Object.keys(limits?.usedTypeClasses ?? {}) as TypeClass[];
  const blockedAll = !!limits?.blockedAll;
  const limitSlots: LimitSlot[] = blockedAll
    ? (limits?.anyVehicleConflict ? [limits.anyVehicleConflict] : [])
    : usedTypes.map((t) => limits!.usedTypeClasses![t]!).filter(Boolean);
  const blockedReason = (card: VehicleCard): string | null => {
    if (blockedAll) return 'Blocked — customer already has a booking for these dates';
    const tc = card.typeClass as TypeClass | undefined;
    return tc && usedTypes.includes(tc) ? `Blocked — customer already has a ${TYPE_LABEL[tc]} booking` : null;
  };

  const selectGroup = async (card: VehicleCard) => {
    if (blockedReason(card)) return;
    // The screen may have sat open past the pickup time — bump it first.
    const next = fit(normalizeRange(startDate, endDate));
    const start = toLocalISO(next.start);
    const end = toLocalISO(next.end);
    if (start !== startISO || end !== endISO) setRange(next);
    // Times the server would refuse (15-day / monthly limits, pickup outside
    // branch hours): stop here with the same message.
    const blocking = bookingTimesNotice(schedule, next.start, next.end, { monthly });
    if (blocking?.tone === 'error') {
      Alert.alert('Change the rental period', blocking.text);
      return;
    }
    setSelecting(card.groupKey);
    try {
      const res = await employeeApi.vehicleGroupDetail(card.groupKey, { start, end });
      const d = res.data?.data;
      setDates(start, end);
      setStorePlan(plan);
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
        {/* Plan — Monthly rental is a counter-only option (#15/#17) */}
        <View style={styles.planRow}>
          {(['STANDARD', 'MONTHLY'] as const).map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.planBtn, plan === p && styles.planBtnActive]}
              onPress={() => choosePlan(p)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ selected: plan === p }}
            >
              <Text style={[styles.planText, plan === p && styles.planTextActive]}>
                {p === 'MONTHLY' ? 'Monthly rental' : 'Standard'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.planHint}>
          {monthly
            ? `${MONTHLY_MIN_DAYS}–${MONTHLY_MAX_DAYS} days · pickup within the next ${MAX_BOOKING_DAYS} days`
            : `Up to ${MAX_BOOKING_DAYS} days · return by ${fmtDate(bookingWindowLastDay())}`}
        </Text>

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

        {/* Quick lengths (#5): 12 hours / 1 day, or months on the monthly plan */}
        <DurationChips
          presets={presets}
          activeHours={activePresetHours(startDate, endDate, presets)}
          issueFor={presetIssue}
          onSelect={(h) => setRange((r) => presetRange(r.start, h))}
        />

        <View style={styles.timeBlock}>
          <Text style={styles.timeLabel}>Pickup time</Text>
          <TimeRow
            value={timeOf(startDate)}
            slots={slotsWithinHours(startDate, schedule, 'pickup')}
            emptyText={closedDayText(schedule, startDate)}
            onChange={(t) => setRange((r) => normalizeRange(withTime(r.start, t), r.end))}
          />
        </View>
        <View style={styles.timeBlock}>
          <Text style={styles.timeLabel}>
            Return time{rangeLengthLabel(startDate, endDate) ? ` · ${rangeLengthLabel(startDate, endDate)}` : ''}
          </Text>
          <TimeRow
            value={timeOf(endDate)}
            slots={slotsWithinHours(endDate, schedule, 'return', {
              after: monthly ? new Date(monthlyReturnMin(startDate).getTime() - 1) : startDate,
              before: maxEnd(startDate),
            })}
            emptyText={closedDayText(schedule, endDate)}
            onChange={(t) => setRange((r) => normalizeRange(r.start, withTime(r.end, t)))}
          />
        </View>

        {/* Branch hours (#2) and anything the server would refuse */}
        <BranchHoursLine text={rangeHoursLine(schedule, startDate, endDate)} />
        <TimesNotice notice={timesNotice} />
      </View>

      {/* Booking restriction — same banner as the web listing */}
      {(blockedAll || usedTypes.length > 0) && (
        <View style={styles.limitBanner}>
          <Ionicons name="lock-closed" size={16} color="#b45309" style={{ marginTop: 1 }} />
          <View style={styles.limitTextWrap}>
            <Text style={styles.limitTitle}>
              {blockedAll
                ? 'Customer already has an active booking for these dates'
                : `Customer has an active ${usedTypes.map((t) => TYPE_LABEL[t]).join(' and ')} booking`}
            </Text>
            <Text style={styles.limitText}>
              {blockedAll
                ? 'This branch allows one vehicle at a time, so all vehicles are blocked.'
                : 'Vehicles of the same type are blocked for these dates.'}
            </Text>
            {limitSlots.map((slot, i) => (
              <Text key={i} style={styles.limitSlot}>
                {slot.vehicleMake} {slot.vehicleModel} · until{' '}
                {new Date(slot.endAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </Text>
            ))}
          </View>
        </View>
      )}

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
          const blocked = blockedReason(item);
          return (
            <TouchableOpacity
              style={[styles.card, blocked && styles.cardBlocked]}
              onPress={() => selectGroup(item)}
              disabled={busy || !!blocked}
              activeOpacity={0.85}
            >
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
                {blocked ? (
                  <Text style={styles.cardBlockedText}>{blocked}</Text>
                ) : (
                  <Text style={styles.cardPrice}>
                    ₹{Number(price).toLocaleString('en-IN')}
                    {item.pricingDetails
                      ? ` total${item.pricingDetails.billedAs ? ` · ${item.pricingDetails.billedAs}` : ''}`
                      : '/day'}
                  </Text>
                )}
              </View>
              {busy ? (
                <ActivityIndicator size="small" color={Colors.orange} />
              ) : (
                <Ionicons name={blocked ? 'lock-closed' : 'chevron-forward'} size={blocked ? 16 : 18} color={Colors.ink4} />
              )}
            </TouchableOpacity>
          );
        }}
      />

      <DateRangePicker
        visible={showDates}
        startDate={startDate}
        endDate={endDate}
        onConfirm={(s, e) => setRange((r) => normalizeRange(withTime(s, timeOf(r.start)), withTime(e, timeOf(r.end))))}
        onClose={() => setShowDates(false)}
        maxStartDay={bookingWindowLastDay()}
        endDayBounds={monthly ? (p) => ({ min: monthlyReturnMin(p), max: monthlyReturnMax(p) }) : undefined}
        isDayClosed={schedule ? (d) => isClosedDay(schedule, d) : undefined}
        noPickupTimes={schedule ? (d) => noPickupTimesLeft(schedule, d) : undefined}
        note={
          monthly
            ? `Monthly rental: return ${MONTHLY_MIN_DAYS}–${MONTHLY_MAX_DAYS} days after pickup`
            : `Bookings open up to ${MAX_BOOKING_DAYS} days ahead`
        }
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
  planRow: { flexDirection: 'row', gap: 8 },
  planBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12,
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline,
  },
  planBtnActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  planText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink2 },
  planTextActive: { color: Colors.white },
  planHint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: -6 },
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
  timeEmpty: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, paddingVertical: 7 },

  limitBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#fffbeb', borderRadius: 14, borderWidth: 1, borderColor: '#fcd34d', padding: 14,
  },
  limitTextWrap: { flex: 1, gap: 2 },
  limitTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: '#78350f' },
  limitText: { fontFamily: Fonts.body, fontSize: 12, color: '#92400e', lineHeight: 17 },
  limitSlot: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: '#b45309', marginTop: 2 },

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
  cardBlocked: { opacity: 0.55 },
  cardBlockedText: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: '#b45309', marginTop: 2 },
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

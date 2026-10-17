import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useQuery, type Query } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import { callPhone } from '../../components/employee/recovery/recoveryUtils';
import { useRecoveryCount } from '../../components/employee/recovery/useRecovery';
import { fmtDurationMinutes } from '../../lib/dates';
import { DlStatusLine } from '../../components/employee/DlStatus';
import { PausedChip } from '../../components/employee/OperationDraftParts';
import PausedOperations from '../../components/employee/PausedOperations';
import { useDebouncedValue } from '../../components/employee/customers/useCustomers';
import type {
  BookingListType,
  QueueBooking,
  QueueCounts,
  QueueListResponse,
} from '../../types/queue';

type Tab = 'pickups' | 'returns';
type ListTab = Tab;

const isTab = (t?: string): t is Tab => t === 'pickups' || t === 'returns';

// Local YYYY-MM-DD (the employee list endpoints filter by calendar day).
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// A YYYY-MM-DD route param as local midnight; undefined when absent or malformed.
function parseYmd(s?: string): Date | undefined {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? undefined : d;
}
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Registration number search (server keeps 60 characters).
const SEARCH_MAX = 60;

interface QueueResult {
  rows: QueueBooking[];
  counts: QueueCounts | null; // null on servers older than #17
  // Done for the day (client item 1); empty on older servers.
  completed: QueueBooking[];
}

function PhoneLink({ phone, label }: { phone: string; label?: string }) {
  return (
    <TouchableOpacity style={styles.phoneLink} onPress={() => callPhone(phone)} hitSlop={8} activeOpacity={0.7}>
      <Ionicons name="call-outline" size={13} color={Colors.orange} />
      <Text style={styles.phoneText}>{label ? `${label} ${phone}` : phone}</Text>
    </TouchableOpacity>
  );
}

function MonthlyPill({ days }: { days?: number }) {
  return (
    <View style={styles.monthlyPill}>
      <Text style={styles.monthlyPillText}>Monthly{days ? ` · ${days} days` : ''}</Text>
    </View>
  );
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

function BookingCard({ booking, type }: { booking: QueueBooking; type: ListTab }) {
  const router = useRouter();
  const vehicle = booking.items[0]?.vehicle;
  const customer = booking.customer?.user;
  const dateLabel = type === 'pickups' ? 'Pickup' : 'Return';
  const dateValue = type === 'pickups' ? booking.startAt : booking.endAt;
  const monthly = (booking.bookingType ?? (booking.rentalPeriodType === 'MONTHLY' ? 'MONTHLY' : 'DAILY')) === 'MONTHLY';
  // Done (client item 1): opens the read-only summary, never the workflow.
  const completed = booking.completed ?? null;
  const phase = type === 'pickups' ? 'pickup' : 'return';
  // Still out past its return time: live "Overdue · 1d 19h" instead of "Return".
  const [now, setNow] = useState(() => Date.now());
  const overdueMs = type === 'returns' && booking.status === 'PICKED_UP' && !completed ? now - new Date(booking.endAt).getTime() : 0;
  const isOverdue = overdueMs > 0;
  useEffect(() => {
    if (!isOverdue) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [isOverdue]);

  return (
    <TouchableOpacity
      style={[styles.card, completed && styles.cardCompleted]}
      activeOpacity={0.85}
      onPress={() =>
        router.push(
          (completed
            ? `/employee/${phase}/summary/${booking.publicId}`
            : `/employee/${phase}/${booking.publicId}`) as Href,
        )
      }
    >
      <View style={styles.cardTop}>
        <View style={styles.cardVehicle}>
          <Text style={styles.vehicleName} numberOfLines={2}>
            {vehicle ? `${vehicle.make} ${vehicle.model}` : 'Vehicle'}
          </Text>
          {vehicle?.regNo && <Text style={styles.regNo} numberOfLines={1}>{vehicle.regNo}</Text>}
        </View>
        {completed ? (
          <CompletedTag awaitingManager={!!booking.awaitingManager} />
        ) : (
          <View style={[styles.statusBadge, type === 'pickups' ? styles.statusPickup : isOverdue ? styles.statusOverdue : styles.statusReturn]}>
            <Text style={[styles.statusText, type === 'pickups' ? styles.statusPickupText : isOverdue ? styles.statusOverdueText : styles.statusReturnText]}>
              {type === 'pickups' ? 'Pickup' : isOverdue ? `Overdue · ${fmtDurationMinutes(overdueMs / 60000)}` : 'Return'}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.cardMeta}>
        <View style={styles.metaRow}>
          <Ionicons name="person-outline" size={13} color={Colors.ink3} />
          <Text style={styles.metaText}>{customer?.name ?? '—'}</Text>
          {customer?.phone ? <PhoneLink phone={customer.phone} /> : null}
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={13} color={Colors.ink3} />
          <Text style={styles.metaText}>
            {dateLabel}: {formatDate(dateValue)}
          </Text>
        </View>
        {/* Who completed it and when (client item 1) */}
        {completed && (completed.at || completed.byName) ? (
          <View style={styles.metaRow}>
            <Ionicons
              name={booking.awaitingManager ? 'time-outline' : 'checkmark-done-outline'}
              size={13}
              color={booking.awaitingManager ? Colors.availLow : Colors.availGood}
            />
            <Text style={styles.metaText}>
              {booking.awaitingManager ? 'Sent to manager' : 'Completed'}
              {completed.at ? ` ${formatDate(completed.at)}` : ''}
              {completed.byName ? ` · by ${completed.byName}` : ''}
            </Text>
          </View>
        ) : null}
        {/* Original driving licence status (#3, D6) — pickups show it only once set */}
        <DlStatusLine status={booking.dlStatus} note={booking.dlDepositNote} showUnrecorded={type === 'returns' && !completed} />
        {/* Started and left for later (client item 2) — tapping resumes it */}
        <PausedChip draft={booking.draft} />
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.footerLeft}>
          <Text style={styles.bookingId}>#{booking.publicId.slice(-8).toUpperCase()}</Text>
          {monthly ? <MonthlyPill days={booking.days} /> : null}
        </View>
        {completed ? (
          /* The only way back into a completed pickup / drop */
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => router.push(`/employee/${phase}/${booking.publicId}?edit=1` as Href)}
            hitSlop={8}
            activeOpacity={0.7}
          >
            <Ionicons name="create-outline" size={14} color={Colors.orange} />
            <Text style={styles.actionText}>{type === 'pickups' ? 'Edit Pickup' : 'Edit Return'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.amountRow}>
            <Text style={styles.amount}>₹{Number(booking.totalFinal).toLocaleString('en-IN')}</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// "Completed" (green) or "Awaiting manager" (amber) on a done pickup / drop.
function CompletedTag({ awaitingManager }: { awaitingManager: boolean }) {
  return (
    <View style={[styles.statusBadge, awaitingManager ? styles.statusAwaiting : styles.statusCompleted]}>
      <Text style={[styles.statusText, awaitingManager ? styles.statusAwaitingText : styles.statusCompletedText]}>
        {awaitingManager ? 'Awaiting manager' : 'Completed'}
      </Text>
    </View>
  );
}

export default function BookingsQueue() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isFocused = useIsFocused();
  const { tab, view, date } = useLocalSearchParams<{ tab?: string; view?: string; date?: string }>();
  const [activeTab, setActiveTab] = useState<Tab>(isTab(tab) ? tab : 'pickups');
  // Daily / Monthly split of the Pickups and Returns queues (#17).
  const [listType, setListType] = useState<BookingListType>('DAILY');
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // This tab screen stays mounted, so apply the dashboard's Pickup / Return
  // choice whenever it arrives, then clear it — the next shortcut tap applies
  // again, and a plain tab-bar visit keeps the last-used tab, Daily / Monthly
  // and day. The shortcuts also send view=daily and today's date, so the list
  // matches their badge. The old `?tab=overdue` deep link now opens the
  // Recovery tab.
  useEffect(() => {
    if (tab === 'overdue') {
      router.setParams({ tab: undefined });
      router.navigate('/(employee)/recovery' as Href);
      return;
    }
    if (!isTab(tab)) return;
    setActiveTab(tab);
    if (view === 'daily') setListType('DAILY');
    else if (view === 'monthly') setListType('MONTHLY');
    const day = parseYmd(date);
    if (day) setSelectedDate(day);
    router.setParams({ tab: undefined, view: undefined, date: undefined });
  }, [tab, view, date]);
  const dateParam = ymd(selectedDate);
  // Registration number search, for both queues, Daily / Monthly and the day.
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), 300);
  const typing = searchInput.trim() !== search;

  // Date strip: 3 days back → 13 days ahead (Daily tab). Rentals still out
  // from any earlier day are on the Recovery tab.
  const dateOptions = useMemo(() => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    return Array.from({ length: 17 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() - 3 + i);
      return d;
    });
  }, []);
  const todayStr = ymd(new Date());

  // Monthly ignores the date server-side. The date is still sent so that
  // counts.daily (the Daily chip) matches the selected day.
  // includeCompleted: the day's done pickups / returns stay listed (client item 1).
  const fetchQueue = async (kind: ListTab): Promise<QueueResult> => {
    const params = { date: dateParam, type: listType, includeCompleted: 1 as const, ...(search ? { q: search } : {}) };
    try {
      const res = kind === 'pickups' ? await employeeApi.listPickups(params) : await employeeApi.listReturns(params);
      const body = res.data as QueueListResponse;
      return { rows: body?.data ?? [], counts: body?.counts ?? null, completed: body?.completed ?? [] };
    } catch (err: any) {
      // Older servers answer an empty queue with 404.
      if (err.response?.status === 404) return { rows: [], counts: err.response?.data?.counts ?? null, completed: [] };
      throw err;
    }
  };

  // A new search keeps the current list on screen until the results arrive;
  // a new tab or day still shows the loader.
  const keepWhileSearching = (prev: QueueResult | undefined, prevQuery?: Query<QueueResult, Error, QueueResult, readonly unknown[]>) =>
    prevQuery?.queryKey[2] === listType && prevQuery?.queryKey[3] === dateParam ? prev : undefined;

  const {
    data: pickups,
    isLoading: pickupsLoading,
    refetch: refetchPickups,
    isError: pickupsError,
  } = useQuery<QueueResult>({
    queryKey: ['employee', 'pickups', listType, dateParam, search],
    queryFn: () => fetchQueue('pickups'),
    placeholderData: keepWhileSearching,
    staleTime: 30_000,
    retry: false,
  });

  const {
    data: returns,
    isLoading: returnsLoading,
    refetch: refetchReturns,
    isError: returnsError,
  } = useQuery<QueueResult>({
    queryKey: ['employee', 'returns', listType, dateParam, search],
    queryFn: () => fetchQueue('returns'),
    placeholderData: keepWhileSearching,
    staleTime: 30_000,
    retry: false,
  });

  // Overdue rentals live on the Recovery tab; the count feeds the Returns banner.
  const overdueCount = useRecoveryCount();

  // Back from a pickup, drop or extension: reload the queues. The first focus
  // is the initial load.
  const focusedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnceRef.current) {
        focusedOnceRef.current = true;
        return;
      }
      refetchPickups();
      refetchReturns();
    }, [refetchPickups, refetchReturns]),
  );

  const isLoading = activeTab === 'pickups' ? pickupsLoading : returnsLoading;
  const isError = activeTab === 'pickups' ? pickupsError : returnsError;
  const data = activeTab === 'pickups' ? (pickups?.rows ?? []) : (returns?.rows ?? []);
  const completedRows = activeTab === 'pickups' ? (pickups?.completed ?? []) : (returns?.completed ?? []);
  const counts = activeTab === 'pickups' ? pickups?.counts : returns?.counts;
  const monthly = listType === 'MONTHLY';

  const onRefresh = () => {
    if (activeTab === 'pickups') refetchPickups();
    else refetchReturns();
  };

  const emptyTitle = search
    ? `No vehicles match “${search}”`
    : activeTab === 'pickups'
      ? monthly ? 'No monthly rentals waiting for pickup' : 'No pickups on this day'
      : monthly ? 'No monthly rentals on the road' : 'No returns due on this day';

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
          <Text style={[styles.tabText, activeTab === 'pickups' && styles.tabTextActive]}>Pickups</Text>
          {pickups?.rows.length ? (
            <View style={[styles.tabCount, activeTab === 'pickups' && styles.tabCountActive]}>
              <Text style={[styles.tabCountText, activeTab === 'pickups' && styles.tabCountTextActive]}>
                {pickups.rows.length}
              </Text>
            </View>
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'returns' && styles.tabActive]}
          onPress={() => setActiveTab('returns')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, activeTab === 'returns' && styles.tabTextActive]}>Returns</Text>
          {returns?.rows.length ? (
            <View style={[styles.tabCount, activeTab === 'returns' && styles.tabCountActive]}>
              <Text style={[styles.tabCountText, activeTab === 'returns' && styles.tabCountTextActive]}>
                {returns.rows.length}
              </Text>
            </View>
          ) : null}
        </TouchableOpacity>
      </View>

      {/* Registration number search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={17} color={Colors.ink3} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by registration number"
          placeholderTextColor={Colors.ink4}
          value={searchInput}
          onChangeText={(t) => setSearchInput(t.slice(0, SEARCH_MAX))}
          maxLength={SEARCH_MAX}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="characters"
        />
        {typing ? (
          <ActivityIndicator size="small" color={Colors.ink3} />
        ) : searchInput.length > 0 ? (
          <TouchableOpacity onPress={() => setSearchInput('')} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={17} color={Colors.ink4} />
          </TouchableOpacity>
        ) : null}
      </View>

      {(
        <>
          {/* Daily / Monthly */}
          <View style={styles.segment}>
            {(['DAILY', 'MONTHLY'] as const).map((t) => {
              const active = listType === t;
              const n = counts ? (t === 'DAILY' ? counts.daily : counts.monthly) : null;
              return (
                <TouchableOpacity
                  key={t}
                  style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                  onPress={() => setListType(t)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {t === 'DAILY' ? 'Daily' : 'Monthly'}
                  </Text>
                  {n != null ? (
                    <Text style={[styles.segmentCount, active && styles.segmentCountActive]}>{n}</Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>

          {monthly ? (
            /* Monthly lists every booking of that status, whatever the date */
            <View style={styles.scopeRow}>
              <Ionicons name="calendar-outline" size={14} color={Colors.ink3} />
              <Text style={styles.scopeText}>
                {activeTab === 'pickups'
                  ? 'Every monthly rental waiting for pickup, any date'
                  : 'Every monthly rental on the road, any date'}
              </Text>
            </View>
          ) : (
            /* Date selector */
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0 }}
              contentContainerStyle={styles.dateStrip}
            >
              {dateOptions.map((d) => {
                const ds = ymd(d);
                const active = ds === dateParam;
                const isToday = ds === todayStr;
                return (
                  <TouchableOpacity
                    key={ds}
                    style={[styles.dateChip, active && styles.dateChipActive]}
                    onPress={() => setSelectedDate(d)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.dateChipDow, active && styles.dateChipTextActive]}>
                      {isToday ? 'Today' : WEEKDAYS[d.getDay()]}
                    </Text>
                    <Text style={[styles.dateChipNum, active && styles.dateChipTextActive]}>{d.getDate()}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </>
      )}

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
          ListHeaderComponent={
            <>
            {/* Paused pickups / drops of any day (client item 2) — not part of a search */}
            {search ? null : <PausedOperations type={activeTab === 'pickups' ? 'PICKUP' : 'RETURN'} />}
            {/* The Daily return list covers one day; rentals still out from
                earlier days live on the Recovery tab. */}
            {activeTab === 'returns' && overdueCount > 0 ? (
              <TouchableOpacity style={styles.overdueBanner} onPress={() => router.navigate('/(employee)/recovery' as Href)} activeOpacity={0.85}>
                <Ionicons name="alarm-outline" size={16} color={Colors.availNone} />
                <Text style={styles.overdueBannerText}>
                  {overdueCount} rental{overdueCount === 1 ? '' : 's'} not returned on time
                </Text>
                <Text style={styles.overdueBannerLink}>open Recovery</Text>
                <Ionicons name="chevron-forward" size={14} color={Colors.availNone} />
              </TouchableOpacity>
            ) : null}
            </>
          }
          ListEmptyComponent={
            completedRows.length > 0 ? (
              /* Everything for the day is done — the completed ones follow */
              <View style={styles.allDone}>
                <Ionicons name="checkmark-circle-outline" size={16} color={Colors.availGood} />
                <Text style={styles.allDoneText}>
                  {activeTab === 'pickups' ? 'No pickups waiting' : 'No returns waiting'}
                </Text>
              </View>
            ) : (
              <View style={styles.empty}>
                <Ionicons
                  name={activeTab === 'pickups' ? 'arrow-up-circle-outline' : 'arrow-down-circle-outline'}
                  size={44}
                  color={Colors.ink4}
                />
                <Text style={styles.emptyTitle}>{emptyTitle}</Text>
                <Text style={styles.emptySub}>
                  {search ? 'Try a different registration number.' : 'Check back after a refresh.'}
                </Text>
              </View>
            )
          }
          ListFooterComponent={
            completedRows.length > 0 ? (
              /* Done for the day (client item 1): kept here, tagged Completed */
              <View style={styles.completedSection}>
                <Text style={styles.completedHeader}>
                  Completed · {completedRows.length}
                  {monthly ? ` · ${selectedDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
                </Text>
                {completedRows.map((item) => (
                  <BookingCard key={item.publicId} booking={item} type={activeTab as ListTab} />
                ))}
              </View>
            ) : null
          }
          renderItem={({ item }) => <BookingCard booking={item} type={activeTab as ListTab} />}
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
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  tabActive: { borderColor: Colors.orange, backgroundColor: '#ff6a1f0d' },
  tabText: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink3 },
  tabTextActive: { color: Colors.orange },
  tabCount: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: Colors.bg,
    alignItems: 'center',
  },
  tabCountActive: { backgroundColor: Colors.orange },
  tabCountText: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3 },
  tabCountTextActive: { color: Colors.white },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    height: 44,
    gap: 10,
  },
  searchInput: { flex: 1, fontFamily: Fonts.body, fontSize: 15, color: Colors.ink, padding: 0 },

  segment: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 3,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    borderRadius: 9,
  },
  segmentBtnActive: { backgroundColor: Colors.ink },
  segmentText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3 },
  segmentTextActive: { color: Colors.white },
  segmentCount: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.ink4 },
  segmentCountActive: { color: 'rgba(255,255,255,0.7)' },

  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  scopeText: { flex: 1, fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },

  dateStrip: { paddingHorizontal: 20, gap: 8, paddingBottom: 14, alignItems: 'flex-start' },
  dateChip: {
    width: 52,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    gap: 2,
  },
  dateChipActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  dateChipDow: { fontFamily: Fonts.bodyMedium, fontSize: 10, color: Colors.ink3, letterSpacing: 0.3 },
  dateChipNum: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.ink },
  dateChipTextActive: { color: Colors.white },

  list: { paddingHorizontal: 20, paddingBottom: 100, gap: 10 },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 12,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  cardVehicle: { flex: 1, gap: 2, minWidth: 0 },
  vehicleName: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.ink },
  regNo: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  statusBadge: {
    flexShrink: 0,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusPickup: { backgroundColor: '#ff6a1f15' },
  statusReturn: { backgroundColor: '#3b82f615' },
  statusText: { fontFamily: Fonts.bodySemiBold, fontSize: 11 },
  statusPickupText: { color: Colors.orange },
  statusReturnText: { color: '#3b82f6' },
  statusOverdue: { backgroundColor: Colors.availNone + '1f' },
  statusOverdueText: { color: Colors.availNone },
  statusCompleted: { backgroundColor: Colors.availGoodSoft },
  statusCompletedText: { color: Colors.availGood },
  statusAwaiting: { backgroundColor: Colors.availLowSoft },
  statusAwaitingText: { color: Colors.availLow },
  cardCompleted: { backgroundColor: '#fbfbfa' },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  completedSection: { gap: 10, marginTop: 6 },
  completedHeader: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink3,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  allDone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  allDoneText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3 },

  cardMeta: { gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { flexShrink: 1, fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2 },
  metaSub: { flexShrink: 1, fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  phoneRow: { flexWrap: 'wrap', columnGap: 14, rowGap: 6 },
  phoneLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  phoneText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.orange },

  lateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  lateText: { fontFamily: Fonts.bodySemiBold, fontSize: 14 },
  lateSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.availLow },

  extTag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.availLowSoft,
  },
  extTagText: { flexShrink: 1, fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.availLow },

  monthlyPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#7c3aed14',
  },
  monthlyPillText: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: '#7c3aed' },

  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  bookingId: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink4 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  amount: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  actionText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.orange },

  overdueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: Colors.availNoneSoft,
    borderWidth: 1,
    borderColor: '#e53e3e30',
  },
  overdueBannerText: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.availNone },
  overdueBannerLink: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.availNone },

  loader: { marginTop: 80 },
  footerLoader: { marginVertical: 16 },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 12, gap: 8 },
  emptyTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink2, letterSpacing: -0.4, textAlign: 'center' },
  emptySub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3 },
  retryText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange },
});

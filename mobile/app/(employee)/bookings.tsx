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
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import { fmtDurationMinutes, fmtIstDateTime } from '../../lib/dates';
import { DlStatusLine } from '../../components/employee/DlStatus';
import type {
  BookingListType,
  OverdueReturn,
  OverdueReturnsResponse,
  QueueBooking,
  QueueCounts,
  QueueListResponse,
  ReturnState,
} from '../../types/queue';

type Tab = 'pickups' | 'returns' | 'overdue';
type ListTab = Exclude<Tab, 'overdue'>;

const isTab = (t?: string): t is Tab => t === 'pickups' || t === 'returns' || t === 'overdue';

// Local YYYY-MM-DD (the employee list endpoints filter by calendar day).
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface QueueResult {
  rows: QueueBooking[];
  counts: QueueCounts | null; // null on servers older than #17
}

type OverdueRow = OverdueReturn & { fetchedAt: number };
type OverduePage = OverdueReturnsResponse & { fetchedAt: number };

const OVERDUE_PAGE_SIZE = 50;
const OVERDUE_REFETCH_MS = 60_000;
// Re-renders the running "late by" durations between refetches.
const OVERDUE_TICK_MS = 30_000;

// Badge per return state: red overdue, amber within the branch grace period,
// grey once the vehicle is back and only the paperwork is still open.
const STATE_LOOK: Record<ReturnState, { label: string; color: string; bg: string }> = {
  OVERDUE: { label: 'Overdue', color: Colors.availNone, bg: Colors.availNoneSoft },
  IN_GRACE: { label: 'In grace', color: Colors.availLow, bg: Colors.availLowSoft },
  RETURN_IN_PROGRESS: { label: 'Return in progress', color: Colors.ink2, bg: '#0a0a0a0d' },
  AWAITING_MANAGER_CONFIRMATION: { label: 'Awaiting manager', color: Colors.ink2, bg: '#0a0a0a0d' },
};

// Minutes late right now: the server's figure at serverNow plus the time since
// the response arrived, so the duration keeps running between refetches.
function liveOverdueMinutes(row: OverdueRow, now: number) {
  return row.overdueMinutes + Math.max(0, Math.floor((now - row.fetchedAt) / 60_000));
}

// A grace period can run out between refetches; show the row as overdue then.
function liveReturnState(row: OverdueRow, minutes: number): ReturnState {
  if (row.returnState === 'IN_GRACE' && row.graceMinutes != null && minutes > row.graceMinutes) return 'OVERDUE';
  return row.returnState;
}

function callPhone(phone: string) {
  Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`).catch(() =>
    Alert.alert('Could not start the call', `Dial ${phone} from the phone app.`),
  );
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
          <Text style={styles.vehicleName} numberOfLines={2}>
            {vehicle ? `${vehicle.make} ${vehicle.model}` : 'Vehicle'}
          </Text>
          {vehicle?.regNo && <Text style={styles.regNo} numberOfLines={1}>{vehicle.regNo}</Text>}
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
          {customer?.phone ? <PhoneLink phone={customer.phone} /> : null}
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={13} color={Colors.ink3} />
          <Text style={styles.metaText}>
            {dateLabel}: {formatDate(dateValue)}
          </Text>
        </View>
        {/* Original driving licence status (#3, D6) — pickups show it only once set */}
        <DlStatusLine status={booking.dlStatus} note={booking.dlDepositNote} showUnrecorded={type === 'returns'} />
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.footerLeft}>
          <Text style={styles.bookingId}>#{booking.publicId.slice(-8).toUpperCase()}</Text>
          {monthly ? <MonthlyPill days={booking.days} /> : null}
        </View>
        <View style={styles.amountRow}>
          <Text style={styles.amount}>₹{Number(booking.totalFinal).toLocaleString('en-IN')}</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const EXTENSION_STATUS_LABEL: Record<'PENDING_PAYMENT' | 'PAYMENT_COLLECTED', string> = {
  PENDING_PAYMENT: 'awaiting payment',
  PAYMENT_COLLECTED: 'awaiting manager',
};

function OverdueCard({ row, now }: { row: OverdueRow; now: number }) {
  const router = useRouter();
  const minutes = liveOverdueMinutes(row, now);
  const state = liveReturnState(row, minutes);
  const look = STATE_LOOK[state];
  // Vehicle already back: lateness stopped, so the clock only says how long ago it was due.
  const vehicleBack = state === 'RETURN_IN_PROGRESS' || state === 'AWAITING_MANAGER_CONFIRMATION';
  // The legacy drop is already done and waits for the manager's confirmation;
  // opening the drop again would restart it, so the row is read-only.
  const canOpen = state !== 'AWAITING_MANAGER_CONFIRMATION';
  const [first, ...more] = row.vehicles;
  const { name, phone, alternatePhone } = row.customer;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      disabled={!canOpen}
      onPress={() => router.push(`/employee/return/${row.publicId}`)}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardVehicle}>
          <Text style={styles.vehicleName} numberOfLines={2}>
            {first ? `${first.make} ${first.model}` : 'Vehicle'}
          </Text>
          {first?.regNo ? <Text style={styles.regNo} numberOfLines={1}>{first.regNo}</Text> : null}
          {more.map((v) => (
            <Text key={v.publicId} style={styles.regNo} numberOfLines={1}>
              + {v.make} {v.model} · {v.regNo}
            </Text>
          ))}
        </View>
        <View style={[styles.statusBadge, { backgroundColor: look.bg }]}>
          <Text style={[styles.statusText, { color: look.color }]}>{look.label}</Text>
        </View>
      </View>

      <View style={[styles.lateRow, { backgroundColor: look.bg }]}>
        <Ionicons name="alarm-outline" size={15} color={look.color} />
        <Text style={[styles.lateText, { color: look.color }]}>
          {vehicleBack ? `Was due ${fmtDurationMinutes(minutes)} ago` : `Late by ${fmtDurationMinutes(minutes)}`}
        </Text>
        {state === 'IN_GRACE' && row.graceMinutes != null ? (
          <Text style={styles.lateSub}>
            · grace ends in {fmtDurationMinutes(Math.max(1, row.graceMinutes - minutes))}
          </Text>
        ) : null}
      </View>

      <View style={styles.cardMeta}>
        <View style={styles.metaRow}>
          <Ionicons name="person-outline" size={13} color={Colors.ink3} />
          <Text style={styles.metaText}>{name ?? '—'}</Text>
        </View>
        {phone || alternatePhone ? (
          <View style={[styles.metaRow, styles.phoneRow]}>
            {phone ? <PhoneLink phone={phone} /> : null}
            {alternatePhone ? <PhoneLink phone={alternatePhone} label="Alt" /> : null}
          </View>
        ) : null}
        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={13} color={Colors.ink3} />
          <Text style={styles.metaText}>
            Expected return: {row.endAtDisplay || fmtIstDateTime(row.endAt)}
          </Text>
        </View>
        {/* Original driving licence status (#3) — what to hand back when the car comes in */}
        <DlStatusLine status={row.dlStatus} note={row.dlDepositNote} />
        {row.originalEndAt ? (
          <View style={styles.metaRow}>
            <Ionicons name="refresh-outline" size={13} color={Colors.ink3} />
            <Text style={styles.metaSub}>
              Extended {row.extensionCount > 1 ? `${row.extensionCount} times ` : ''}from {fmtIstDateTime(row.originalEndAt)}
            </Text>
          </View>
        ) : null}
        {row.pendingExtension ? (
          <View style={styles.extTag}>
            <Ionicons name="hourglass-outline" size={12} color={Colors.availLow} />
            <Text style={styles.extTagText}>
              Extension to {fmtIstDateTime(row.pendingExtension.requestedEndAt)} ·{' '}
              {EXTENSION_STATUS_LABEL[row.pendingExtension.status] ?? 'pending'}
            </Text>
          </View>
        ) : row.extensionPending ? (
          <View style={styles.extTag}>
            <Ionicons name="hourglass-outline" size={12} color={Colors.availLow} />
            <Text style={styles.extTagText}>Extension pending</Text>
          </View>
        ) : null}
        {state === 'RETURN_IN_PROGRESS' ? (
          <Text style={styles.metaSub}>The vehicle is back. The drop bill is being settled.</Text>
        ) : state === 'AWAITING_MANAGER_CONFIRMATION' ? (
          <Text style={styles.metaSub}>The vehicle is back. Waiting for the branch manager to confirm the return.</Text>
        ) : null}
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.footerLeft}>
          <Text style={styles.bookingId}>#{row.publicId.slice(-8).toUpperCase()}</Text>
          {row.bookingType === 'MONTHLY' ? <MonthlyPill days={row.days} /> : null}
        </View>
        {canOpen ? (
          <View style={styles.amountRow}>
            <Text style={styles.actionText}>
              {state === 'RETURN_IN_PROGRESS' ? 'Continue return' : 'Process return'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.orange} />
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

export default function BookingsQueue() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isFocused = useIsFocused();
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const [activeTab, setActiveTab] = useState<Tab>(isTab(tab) ? tab : 'pickups');
  // Daily / Monthly split of the Pickups and Returns queues (#17).
  const [listType, setListType] = useState<BookingListType>('DAILY');

  // This tab screen stays mounted, so apply the dashboard's Pickup / Return /
  // Overdue choice whenever it arrives, then clear it — the next shortcut tap
  // applies again, and a plain tab-bar visit keeps the last-used tab.
  useEffect(() => {
    if (!isTab(tab)) return;
    setActiveTab(tab);
    router.setParams({ tab: undefined });
  }, [tab]);
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const dateParam = ymd(selectedDate);

  // Date strip: 3 days back → 13 days ahead (Daily tab). Rentals still out
  // from any earlier day are on the Overdue tab.
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
  const fetchQueue = async (kind: ListTab): Promise<QueueResult> => {
    const params = { date: dateParam, type: listType };
    try {
      const res = kind === 'pickups' ? await employeeApi.listPickups(params) : await employeeApi.listReturns(params);
      const body = res.data as QueueListResponse;
      return { rows: body?.data ?? [], counts: body?.counts ?? null };
    } catch (err: any) {
      // Older servers answer an empty queue with 404.
      if (err.response?.status === 404) return { rows: [], counts: err.response?.data?.counts ?? null };
      throw err;
    }
  };

  const {
    data: pickups,
    isLoading: pickupsLoading,
    refetch: refetchPickups,
    isError: pickupsError,
  } = useQuery<QueueResult>({
    queryKey: ['employee', 'pickups', listType, dateParam],
    queryFn: () => fetchQueue('pickups'),
    staleTime: 30_000,
    retry: false,
  });

  const {
    data: returns,
    isLoading: returnsLoading,
    refetch: refetchReturns,
    isError: returnsError,
  } = useQuery<QueueResult>({
    queryKey: ['employee', 'returns', listType, dateParam],
    queryFn: () => fetchQueue('returns'),
    staleTime: 30_000,
    retry: false,
  });

  // Overdue / no-show returns (#8): every PICKED_UP rental past its return
  // time, whatever the day, most overdue first. The key sits under
  // ['employee', 'returns'], so finishing a drop refreshes it too.
  const {
    data: overdue,
    isLoading: overdueLoading,
    refetch: refetchOverdue,
    isError: overdueError,
    fetchNextPage: fetchMoreOverdue,
    hasNextPage: hasMoreOverdue,
    isFetchingNextPage: loadingMoreOverdue,
  } = useInfiniteQuery({
    queryKey: ['employee', 'returns', 'overdue'],
    queryFn: async ({ pageParam }): Promise<OverduePage> => {
      const res = await employeeApi.listOverdueReturns({ page: pageParam, limit: OVERDUE_PAGE_SIZE });
      return { ...(res.data as OverdueReturnsResponse), fetchedAt: Date.now() };
    },
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.pagination && last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined,
    refetchInterval: isFocused ? OVERDUE_REFETCH_MS : false,
    staleTime: 30_000,
    retry: false,
  });

  // Pages can overlap when rows shift between fetches; keep the first copy.
  const overdueRows = useMemo(() => {
    const seen = new Set<string>();
    const out: OverdueRow[] = [];
    for (const page of overdue?.pages ?? []) {
      for (const row of page.data ?? []) {
        if (seen.has(row.publicId)) continue;
        seen.add(row.publicId);
        out.push({ ...row, fetchedAt: page.fetchedAt });
      }
    }
    return out;
  }, [overdue]);
  const overdueHead = overdue?.pages[0];
  const overdueCount = overdueHead?.overdueCount ?? 0;
  const vehiclesBack =
    (overdueHead?.counts?.RETURN_IN_PROGRESS ?? 0) + (overdueHead?.counts?.AWAITING_MANAGER_CONFIRMATION ?? 0);

  // Clock for the running "late by" durations, only while they are on screen.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isFocused || activeTab !== 'overdue') return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), OVERDUE_TICK_MS);
    return () => clearInterval(id);
  }, [isFocused, activeTab]);

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
      refetchOverdue();
    }, [refetchPickups, refetchReturns, refetchOverdue]),
  );

  const isLoading =
    activeTab === 'pickups' ? pickupsLoading : activeTab === 'returns' ? returnsLoading : overdueLoading;
  const isError = activeTab === 'pickups' ? pickupsError : activeTab === 'returns' ? returnsError : overdueError;
  const data = activeTab === 'pickups' ? (pickups?.rows ?? []) : (returns?.rows ?? []);
  const counts = activeTab === 'pickups' ? pickups?.counts : activeTab === 'returns' ? returns?.counts : null;
  const monthly = listType === 'MONTHLY';

  const onRefresh = () => {
    if (activeTab === 'pickups') refetchPickups();
    else if (activeTab === 'returns') refetchReturns();
    refetchOverdue();
  };

  const emptyTitle =
    activeTab === 'pickups'
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
        <TouchableOpacity
          style={[styles.tab, activeTab === 'overdue' && styles.tabOverdueActive]}
          onPress={() => setActiveTab('overdue')}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.tabText,
              (activeTab === 'overdue' || overdueCount > 0) && styles.tabTextOverdue,
            ]}
          >
            Overdue
          </Text>
          {overdueCount > 0 ? (
            <View style={[styles.tabCount, styles.tabCountOverdue]}>
              <Text style={[styles.tabCountText, styles.tabCountTextActive]}>{overdueCount}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      </View>

      {activeTab === 'overdue' ? (
        /* Overdue summary — counts cover the whole list, not just this page */
        <View style={styles.scopeRow}>
          <Ionicons name="alarm-outline" size={14} color={Colors.ink3} />
          <Text style={styles.scopeText}>
            {overdueHead
              ? [
                  `${overdueHead.counts?.OVERDUE ?? 0} overdue`,
                  `${overdueHead.counts?.IN_GRACE ?? 0} in grace`,
                  ...(vehiclesBack ? [`${vehiclesBack} back, paperwork open`] : []),
                ].join(' · ') + ' · most overdue first'
              : 'Rentals past their return time, most overdue first'}
          </Text>
        </View>
      ) : (
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
      ) : activeTab === 'overdue' ? (
        <FlatList
          data={overdueRows}
          keyExtractor={(item) => item.publicId}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={Colors.orange} />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasMoreOverdue && !loadingMoreOverdue) fetchMoreOverdue();
          }}
          ListFooterComponent={
            loadingMoreOverdue ? <ActivityIndicator style={styles.footerLoader} color={Colors.orange} /> : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="checkmark-circle-outline" size={44} color={Colors.ink4} />
              <Text style={styles.emptyTitle}>No overdue returns</Text>
              <Text style={styles.emptySub}>Every rental past its return time is back.</Text>
            </View>
          }
          renderItem={({ item }) => <OverdueCard row={item} now={now} />}
        />
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
            // The Daily return list covers one day; rentals still out from
            // earlier days live on the Overdue tab.
            activeTab === 'returns' && overdueCount > 0 ? (
              <TouchableOpacity style={styles.overdueBanner} onPress={() => setActiveTab('overdue')} activeOpacity={0.85}>
                <Ionicons name="alarm-outline" size={16} color={Colors.availNone} />
                <Text style={styles.overdueBannerText}>
                  {overdueCount} rental{overdueCount === 1 ? ' is' : 's are'} overdue
                </Text>
                <Text style={styles.overdueBannerLink}>View</Text>
                <Ionicons name="chevron-forward" size={14} color={Colors.availNone} />
              </TouchableOpacity>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons
                name={activeTab === 'pickups' ? 'arrow-up-circle-outline' : 'arrow-down-circle-outline'}
                size={44}
                color={Colors.ink4}
              />
              <Text style={styles.emptyTitle}>{emptyTitle}</Text>
              <Text style={styles.emptySub}>Check back after a refresh.</Text>
            </View>
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
  tabOverdueActive: { borderColor: Colors.availNone, backgroundColor: Colors.availNoneSoft },
  tabText: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink3 },
  tabTextActive: { color: Colors.orange },
  tabTextOverdue: { color: Colors.availNone },
  tabCount: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: Colors.bg,
    alignItems: 'center',
  },
  tabCountActive: { backgroundColor: Colors.orange },
  tabCountOverdue: { backgroundColor: Colors.availNone },
  tabCountText: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3 },
  tabCountTextActive: { color: Colors.white },

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

  dateStrip: { paddingHorizontal: 20, gap: 8, paddingBottom: 14 },
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

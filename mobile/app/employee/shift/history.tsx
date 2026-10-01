import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import { apiErrorMessage } from '../../../lib/counterErrors';
import StatusBadge from '../../../components/ui/StatusBadge';
import {
  SHIFT_RANGE_PRESETS,
  inr2,
  inrOrDash,
  istDateTime,
  istDayLabel,
  istTime,
  istYmd,
  money,
  paise,
  presetRange,
  shiftStatusBadge,
  signedInr,
  type ShiftRangePreset,
} from '../../../lib/cashShift';
import type { MyShiftsParams, MyShiftsResponse, ShiftDayTotals, ShiftView } from '../../../types/shift';

const PAGE_SIZE = 20;

// "Open now" lists the shift open right now whatever day it started, so it
// ignores the date presets. Closed = CLOSED + DISCREPANCY_FLAGGED.
type StatusChip = 'ALL' | 'OPEN_NOW' | 'ENDED' | 'DISCREPANCY_FLAGGED';
const STATUS_CHIPS: Array<{ key: StatusChip; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'OPEN_NOW', label: 'Open now' },
  { key: 'ENDED', label: 'Closed' },
  { key: 'DISCREPANCY_FLAGGED', label: 'Flagged' },
];

type ListItem =
  | { kind: 'day'; key: string; date: string; totals: (ShiftDayTotals & { date: string }) | undefined }
  | { kind: 'shift'; key: string; shift: ShiftView };

// Short = red, over = amber, exact = green.
function varianceColor(v: number): string {
  const p = paise(v);
  if (p === 0) return Colors.availGood;
  return p < 0 ? Colors.availNone : Colors.availLow;
}

function Figure({ label, value, color, dark }: { label: string; value: string; color?: string; dark?: boolean }) {
  return (
    <View style={styles.figure}>
      <Text style={[styles.figureLabel, dark && styles.figureLabelDark]} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[styles.figureValue, dark && styles.figureValueDark, color ? { color } : null]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
    </View>
  );
}

function SummaryCard({ summary, rangeLabel }: { summary: ShiftDayTotals; rangeLabel: string }) {
  const variance = money(summary.variance) ?? 0;
  const ended = summary.closedCount + summary.flaggedCount;
  // Old-rule closes are left out of the variance sum
  const legacy = summary.legacyCount ?? 0;
  const varianceCovered = ended - legacy > 0;
  const pending = money(summary.pendingCash) ?? 0;
  const upi = money(summary.upiCollected) ?? 0;
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryHead}>
        <Text style={styles.summaryTitle}>{rangeLabel}</Text>
        <Text style={styles.summaryCount}>
          {summary.shiftCount} shift{summary.shiftCount === 1 ? '' : 's'}
          {summary.flaggedCount > 0 ? ` · ${summary.flaggedCount} flagged` : ''}
          {summary.openCount > 0 ? ` · ${summary.openCount} open` : ''}
        </Text>
      </View>
      <View style={styles.figureRow}>
        <Figure dark label="Opening" value={inrOrDash(summary.openingCash)} />
        <Figure dark label="Collected" value={inrOrDash(summary.cashCollected)} />
        <Figure dark label="Refunded" value={inrOrDash(summary.cashRefunded)} />
      </View>
      <View style={styles.figureRow}>
        <Figure dark label="Expected" value={inrOrDash(summary.expectedClosing)} />
        <Figure dark label="Counted" value={ended > 0 ? inrOrDash(summary.closingCash) : '—'} />
        <Figure
          dark
          label="Variance"
          value={varianceCovered ? signedInr(variance) : '—'}
          color={varianceCovered ? varianceColor(variance) : undefined}
        />
      </View>
      {summary.openCount > 0 && ended > 0 ? (
        <Text style={styles.summaryNote}>Counted and variance cover closed shifts only.</Text>
      ) : null}
      {legacy > 0 ? (
        <Text style={styles.summaryNote}>
          Variance leaves out {legacy} shift{legacy === 1 ? '' : 's'} closed under the old rule.
        </Text>
      ) : null}
      {pending > 0 || upi > 0 ? (
        <Text style={styles.summaryNote}>
          {pending > 0 ? <Text style={styles.pendingText}>{inr2(pending)} pending confirmation</Text> : null}
          {pending > 0 && upi > 0 ? ' · ' : null}
          {upi > 0 ? `UPI ${inr2(upi)} (not in the drawer)` : null}
        </Text>
      ) : null}
    </View>
  );
}

function DayHeader({ date, totals }: { date: string; totals?: ShiftDayTotals }) {
  // Old-rule closes are left out of the day's variance sum
  const ended = totals ? totals.closedCount + totals.flaggedCount - (totals.legacyCount ?? 0) : 0;
  const variance = money(totals?.variance) ?? 0;
  return (
    <View style={styles.dayHeader}>
      <Text style={styles.dayTitle}>{date === istYmd() ? 'Today' : istDayLabel(date)}</Text>
      {totals ? (
        <Text style={styles.dayMeta} numberOfLines={1}>
          Collected {inrOrDash(totals.cashCollected)}
          {ended > 0 ? (
            <>
              {' · '}
              <Text style={{ color: varianceColor(variance) }}>{signedInr(variance)}</Text>
            </>
          ) : null}
        </Text>
      ) : null}
    </View>
  );
}

function ShiftCard({ shift, onPress }: { shift: ShiftView; onPress: () => void }) {
  const badge = shiftStatusBadge(shift);
  const variance = money(shift.variance);
  const pending = money(shift.pendingCash) ?? 0;
  const upi = money(shift.upiCollected) ?? 0;
  // A close on a later IST day shows its date too.
  const closedLabel = !shift.closedAt
    ? null
    : istYmd(new Date(shift.closedAt)) === shift.istDate
      ? istTime(shift.closedAt)
      : istDateTime(shift.closedAt);
  return (
    <TouchableOpacity style={[styles.card, shift.isOpen && styles.cardOpen]} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.cardTop}>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle}>
            {shift.isOpen ? `Open since ${istTime(shift.openedAt)}` : `${istTime(shift.openedAt)} – ${closedLabel}`}
          </Text>
          {shift.branchName ? (
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={12} color={Colors.ink3} />
              <Text style={styles.metaText} numberOfLines={1}>
                {shift.branchName}
              </Text>
            </View>
          ) : null}
        </View>
        <StatusBadge label={badge.label} tone={badge.tone} />
      </View>

      <View style={styles.figureRow}>
        <Figure label="Opening" value={inrOrDash(shift.openingCash)} />
        <Figure label="Collected" value={inrOrDash(shift.cashCollected)} />
        <Figure label={shift.isOpen ? 'Expected now' : 'Expected'} value={inrOrDash(shift.expectedClosing)} />
      </View>
      <View style={styles.figureRow}>
        <Figure label="Refunded" value={inrOrDash(shift.cashRefunded)} />
        {/* Closing cash and variance don't exist until the shift closes */}
        <Figure label="Counted" value={inrOrDash(shift.closingCash)} />
        <Figure
          label="Variance"
          value={variance == null ? '—' : signedInr(variance)}
          color={variance == null ? undefined : varianceColor(variance)}
        />
      </View>

      {pending > 0 || upi > 0 ? (
        <Text style={styles.cardNote}>
          {pending > 0 ? <Text style={styles.pendingText}>{inr2(pending)} pending confirmation</Text> : null}
          {pending > 0 && upi > 0 ? ' · ' : null}
          {upi > 0 ? `UPI ${inr2(upi)} (not in the drawer)` : null}
        </Text>
      ) : null}
      {shift.legacyVariance ? (
        <Text style={styles.cardNote}>Closed under the old rule (variance vs manager-confirmed cash).</Text>
      ) : null}
      {shift.reconciledAt ? (
        <Text style={styles.cardNote}>
          Reconciled{shift.reconciledByName ? ` by ${shift.reconciledByName}` : ''} · {istDateTime(shift.reconciledAt)}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

export default function ShiftHistory() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [preset, setPreset] = useState<ShiftRangePreset>('last7');
  const [statusChip, setStatusChip] = useState<StatusChip>('ALL');

  // IST dates for the preset; recomputed when the IST day rolls over.
  const today = istYmd();
  const params = useMemo<MyShiftsParams>(() => {
    if (statusChip === 'OPEN_NOW') return { openNow: true };
    const range = presetRange(preset);
    return statusChip === 'ALL' ? range : { ...range, status: statusChip };
  }, [preset, statusChip, today]);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['employee', 'shifts', 'mine', params],
    queryFn: async ({ pageParam }): Promise<MyShiftsResponse> => {
      const res = await employeeApi.getMyShifts({ ...params, page: pageParam, pageSize: PAGE_SIZE });
      return res.data as MyShiftsResponse;
    },
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    staleTime: 30_000,
    retry: false,
  });

  // Back from a shift's detail (or a close): reload. The first focus is the initial load.
  const focusedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnceRef.current) {
        focusedOnceRef.current = true;
        return;
      }
      refetch();
    }, [refetch]),
  );

  // The spinner follows the pull only; the on-focus reload runs quietly.
  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    setPulling(true);
    try {
      await refetch();
    } finally {
      setPulling(false);
    }
  };

  const head = data?.pages[0];

  // Day headers between shifts, with that day's totals over the whole filter.
  const items = useMemo<ListItem[]>(() => {
    const totalsByDay = new Map((head?.dailyTotals ?? []).map((d) => [d.date, d]));
    const seen = new Set<string>();
    const out: ListItem[] = [];
    let lastDay: string | null = null;
    for (const page of data?.pages ?? []) {
      for (const shift of page.shifts ?? []) {
        if (seen.has(shift.publicId)) continue;
        seen.add(shift.publicId);
        if (shift.istDate !== lastDay) {
          lastDay = shift.istDate;
          out.push({ kind: 'day', key: `day-${shift.istDate}`, date: shift.istDate, totals: totalsByDay.get(shift.istDate) });
        }
        out.push({ kind: 'shift', key: shift.publicId, shift });
      }
    }
    return out;
  }, [data, head]);

  const openNowCount = head?.openNowCount ?? 0;
  const openNow = statusChip === 'OPEN_NOW';
  const rangeLabel = openNow
    ? 'Open right now'
    : (SHIFT_RANGE_PRESETS.find((p) => p.key === preset)?.label ?? '');

  const openShift = (publicId: string) =>
    router.push({ pathname: '/employee/shift/[publicId]', params: { publicId } } as never);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Shift History</Text>
          <Text style={styles.subtitle}>Your cash shifts, by the IST day they opened</Text>
        </View>
      </View>

      {/* Status */}
      <View style={styles.segment}>
        {STATUS_CHIPS.map((c) => {
          const active = statusChip === c.key;
          return (
            <TouchableOpacity
              key={c.key}
              style={[styles.segmentBtn, active && styles.segmentBtnActive]}
              onPress={() => setStatusChip(c.key)}
              activeOpacity={0.8}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>
                {c.label}
              </Text>
              {c.key === 'OPEN_NOW' && openNowCount > 0 ? (
                <Text style={[styles.segmentCount, active && styles.segmentCountActive]}>{openNowCount}</Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Date range (IST) — not used by "Open now" */}
      {openNow ? (
        <View style={styles.scopeRow}>
          <Ionicons name="information-circle-outline" size={14} color={Colors.ink3} />
          <Text style={styles.scopeText}>Your shift open right now, whatever day it started</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetStrip}>
          {SHIFT_RANGE_PRESETS.map((p) => {
            const active = preset === p.key;
            return (
              <TouchableOpacity
                key={p.key}
                style={[styles.presetChip, active && styles.presetChipActive]}
                onPress={() => setPreset(p.key)}
                activeOpacity={0.8}
              >
                <Text style={[styles.presetText, active && styles.presetTextActive]}>{p.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {isLoading ? (
        <ActivityIndicator style={styles.loader} color={Colors.orange} size="large" />
      ) : isError ? (
        <View style={styles.empty}>
          <Ionicons name="cloud-offline-outline" size={40} color={Colors.ink4} />
          <Text style={styles.emptyTitle}>Could not load your shifts</Text>
          <Text style={styles.emptySub}>{apiErrorMessage(error, 'Check your connection and try again.')}</Text>
          <TouchableOpacity onPress={() => refetch()}>
            <Text style={styles.retryText}>Tap to retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.key}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={Colors.orange} />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          ListHeaderComponent={
            head && head.summary.shiftCount > 0 ? <SummaryCard summary={head.summary} rangeLabel={rangeLabel} /> : null
          }
          ListFooterComponent={
            isFetchingNextPage ? <ActivityIndicator style={styles.footerLoader} color={Colors.orange} /> : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="wallet-outline" size={44} color={Colors.ink4} />
              <Text style={styles.emptyTitle}>{openNow ? 'No shift open right now' : 'No shifts in this period'}</Text>
              <Text style={styles.emptySub}>
                {openNow ? 'Open a shift from the dashboard to start collecting cash.' : 'Try a longer date range.'}
              </Text>
            </View>
          }
          renderItem={({ item }) =>
            item.kind === 'day' ? (
              <DayHeader date={item.date} totals={item.totals} />
            ) : (
              <ShiftCard shift={item.shift} onPress={() => openShift(item.shift.publicId)} />
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
  },
  back: { width: 36, height: 36, justifyContent: 'center' },
  title: { fontFamily: Fonts.displayBold, fontSize: 26, color: Colors.ink, letterSpacing: -0.6 },
  subtitle: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, marginTop: 2 },

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
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderRadius: 9,
  },
  segmentBtnActive: { backgroundColor: Colors.ink },
  segmentText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3 },
  segmentTextActive: { color: Colors.white },
  segmentCount: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.orange },
  segmentCountActive: { color: 'rgba(255,255,255,0.7)' },

  presetStrip: { paddingHorizontal: 20, gap: 8, paddingBottom: 14 },
  presetChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  presetChipActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  presetText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  presetTextActive: { color: Colors.white },

  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  scopeText: { flex: 1, fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },

  list: { paddingHorizontal: 20, gap: 10, flexGrow: 1 },
  loader: { marginTop: 48 },
  footerLoader: { marginVertical: 16 },

  summaryCard: {
    backgroundColor: Colors.ink,
    borderRadius: 18,
    padding: 16,
    gap: 12,
    marginBottom: 4,
  },
  summaryHead: { gap: 2 },
  summaryTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white },
  summaryCount: { fontFamily: Fonts.body, fontSize: 12, color: 'rgba(255,255,255,0.65)' },
  summaryNote: { fontFamily: Fonts.body, fontSize: 12, color: 'rgba(255,255,255,0.65)', lineHeight: 17 },

  figureRow: { flexDirection: 'row', gap: 10 },
  figure: { flex: 1, gap: 2, minWidth: 0 },
  figureLabel: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3 },
  figureValue: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  figureLabelDark: { color: 'rgba(255,255,255,0.6)' },
  figureValueDark: { color: Colors.white },

  dayHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 8,
  },
  dayTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  dayMeta: { flexShrink: 1, fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 12,
  },
  cardOpen: { borderColor: Colors.orange, backgroundColor: '#ff6a1f08' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  cardTitleWrap: { flex: 1, gap: 4, minWidth: 0 },
  cardTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { flexShrink: 1, fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  cardNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17, marginTop: -4 },
  pendingText: { color: '#d97706' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32, paddingVertical: 48 },
  emptyTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.ink, textAlign: 'center' },
  emptySub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, textAlign: 'center' },
  retryText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange, marginTop: 4 },
});

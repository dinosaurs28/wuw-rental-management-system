import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { RecoveryCard } from '../../components/employee/recovery/RecoveryCard';
import { RecoveryHeader, type RecoveryFilter } from '../../components/employee/recovery/RecoveryHeader';
import { useRecoveryList } from '../../components/employee/recovery/useRecovery';
import {
  RECOVERY_TICK_MS,
  isVehicleBack,
  liveOverdueMinutes,
  liveReturnState,
} from '../../components/employee/recovery/recoveryUtils';

const EMPTY_COPY: Record<RecoveryFilter, string> = {
  ALL: 'Every rental past its return time is back.',
  OVERDUE: 'No rental is overdue right now.',
  IN_GRACE: 'No rental is inside its grace period.',
  AWAITING: 'No returned vehicle is waiting for the manager.',
};

export default function RecoveryScreen() {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const [filter, setFilter] = useState<RecoveryFilter>('ALL');
  const [refreshing, setRefreshing] = useState(false);
  const { rows, head, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useRecoveryList(isFocused);

  // Clock for the running "late by" durations, only while they are on screen.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isFocused) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), RECOVERY_TICK_MS);
    return () => clearInterval(id);
  }, [isFocused]);

  // Live state per row (a grace period can run out between refetches).
  const classified = useMemo(
    () =>
      rows.map((row) => {
        const minutes = liveOverdueMinutes(row, now);
        return { row, minutes, state: liveReturnState(row, minutes) };
      }),
    [rows, now],
  );

  const chipCounts = useMemo(() => {
    const c: Record<RecoveryFilter, number> = { ALL: classified.length, OVERDUE: 0, IN_GRACE: 0, AWAITING: 0 };
    for (const { state } of classified) {
      if (state === 'OVERDUE') c.OVERDUE++;
      else if (state === 'IN_GRACE') c.IN_GRACE++;
      else if (state === 'AWAITING_MANAGER_CONFIRMATION') c.AWAITING++;
    }
    return c;
  }, [classified]);

  const visible = useMemo(
    () =>
      classified
        .filter(({ state }) =>
          filter === 'ALL'
            ? true
            : filter === 'OVERDUE'
              ? state === 'OVERDUE'
              : filter === 'IN_GRACE'
                ? state === 'IN_GRACE'
                : state === 'AWAITING_MANAGER_CONFIRMATION',
        )
        .map(({ row }) => row),
    [classified, filter],
  );

  // Rentals still out (not yet back): count and the longest wait.
  const out = classified.filter(({ state }) => !isVehicleBack(state));
  const longestMinutes = out.length ? Math.max(...out.map((o) => o.minutes)) : null;
  const overdueCount = out.length || (head?.overdueCount ?? 0);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Recovery</Text>
        <Text style={styles.subtitle}>Customers not back after the rental period</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator style={styles.loader} color={Colors.orange} size="large" />
      ) : isError ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Could not load</Text>
          <TouchableOpacity onPress={() => refetch()}>
            <Text style={styles.retryText}>Tap to retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.publicId}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.orange} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              <RecoveryHeader
                overdueCount={overdueCount}
                longestMinutes={longestMinutes}
                filter={filter}
                onFilter={setFilter}
                chipCounts={chipCounts}
              />
            </View>
          }
          ListFooterComponent={
            isFetchingNextPage ? <ActivityIndicator style={styles.footerLoader} color={Colors.orange} /> : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="checkmark-circle-outline" size={44} color={Colors.ink4} />
              <Text style={styles.emptyTitle}>{filter === 'ALL' ? 'Nothing to recover' : 'No rentals here'}</Text>
              <Text style={styles.emptySub}>{EMPTY_COPY[filter]}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.cardWrap}>
              <RecoveryCard row={item} now={now} />
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
  list: { paddingBottom: 100 },
  headerBlock: {},
  cardWrap: { paddingHorizontal: 20, paddingBottom: 10 },
  loader: { marginTop: 80 },
  footerLoader: { marginVertical: 16 },
  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 12, gap: 8 },
  emptyTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink2, letterSpacing: -0.4, textAlign: 'center' },
  emptySub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, textAlign: 'center' },
  retryText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange },
});

import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import { SHIFT_REQUIRED_MESSAGE } from '../../lib/counterErrors';
import { useAuthStore } from '../../store/auth';
import NotificationBell from '../../components/notifications/NotificationBell';
import { useRecoveryCount } from '../../components/employee/recovery/useRecovery';
import type { QueueListResponse } from '../../types/queue';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type QueueKind = 'pickups' | 'returns';

// Local YYYY-MM-DD, as the Queue tab sends and reads it.
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Size of today's Daily list — what the Queue tab shows when a shortcut opens
// it. Servers older than #17 send no counts, so fall back to the rows.
async function fetchQueueCount(kind: QueueKind, date: string): Promise<number> {
  const params = { date, type: 'DAILY' as const };
  try {
    const res = kind === 'pickups' ? await employeeApi.listPickups(params) : await employeeApi.listReturns(params);
    const body = res.data as QueueListResponse;
    return body?.counts?.daily ?? body?.data?.length ?? 0;
  } catch (err: any) {
    // Older servers answer an empty queue with 404.
    if (err.response?.status === 404) return 0;
    throw err;
  }
}

interface Shift {
  publicId: string;
  status: string;
  openedAt: string;
  expectedTotal?: string | null; // = expectedClosing on #22 servers; confirmed cash before
  pendingTotal?: string | null;  // collected, awaiting manager confirmation
  // #22: expected in drawer = opening + cash collected − cash refunded (live).
  // Absent on older servers.
  expectedClosing?: string | null;
  pendingCash?: string | null;
}

function QuickAction({
  label,
  icon,
  onPress,
  accent,
  count = 0,
  countNoun = 'waiting',
}: {
  label: string;
  icon: IoniconName;
  onPress: () => void;
  accent?: boolean;
  // Small badge on the icon; hidden at 0.
  count?: number;
  countNoun?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.quickAction, accent && styles.quickActionAccent]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `${label}, ${count} ${countNoun}` : label}
    >
      <View style={[styles.qaIcon, accent && styles.qaIconAccent]}>
        <Ionicons name={icon} size={20} color={accent ? Colors.white : Colors.ink2} />
        {count > 0 ? (
          <View style={styles.qaBadge}>
            <Text style={styles.qaBadgeText}>{count > 99 ? '99+' : count}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.qaLabel, accent && styles.qaLabelAccent]}>{label}</Text>
    </TouchableOpacity>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export default function EmployeeDashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const firstName = user?.name?.split(' ')[0] ?? 'there';

  const isFocused = useIsFocused();
  const qc = useQueryClient();
  // Badges on the Pickup / Return Queue shortcuts. The keys sit under
  // ['employee', 'pickups'] / ['employee', 'returns'], so finishing a pickup
  // or drop refreshes them too; the 60 s poll keeps them current on screen.
  const today = ymd(new Date());
  const { data: pickupCount = 0, isFetching: pickupCountFetching, refetch: refetchPickupCount } = useQuery({
    queryKey: ['employee', 'pickups', 'count', today],
    queryFn: () => fetchQueueCount('pickups', today),
    staleTime: 60_000,
    refetchInterval: isFocused ? 60_000 : false,
    retry: false,
  });
  const { data: returnCount = 0, isFetching: returnCountFetching, refetch: refetchReturnCount } = useQuery({
    queryKey: ['employee', 'returns', 'count', today],
    queryFn: () => fetchQueueCount('returns', today),
    staleTime: 60_000,
    refetchInterval: isFocused ? 60_000 : false,
    retry: false,
  });
  // Same number as the Recovery tab badge, so the two always agree.
  const overdueReturns = useRecoveryCount();
  const refetchOverdueCount = useCallback(
    () => qc.refetchQueries({ queryKey: ['employee', 'returns', 'overdue-count'], exact: true }),
    [qc],
  );

  // Back from another screen: refresh the counts. The first focus is the initial load.
  const countsFocusedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!countsFocusedOnceRef.current) {
        countsFocusedOnceRef.current = true;
        return;
      }
      refetchPickupCount();
      refetchReturnCount();
      refetchOverdueCount();
    }, [refetchPickupCount, refetchReturnCount, refetchOverdueCount]),
  );

  const { data: shiftData, isLoading: shiftLoading, isFetching: shiftFetching, refetch: refetchShift } = useQuery<Shift | null>({
    queryKey: ['employee', 'active-shift'],
    queryFn: async () => {
      const res = await employeeApi.getActiveShift();
      return (res.data?.data ?? null) as Shift | null;
    },
    staleTime: 30_000,
  });

  // The pull-to-refresh spinner follows the pull only, so the 60 s count
  // polls and the on-focus refresh run quietly in the background.
  const [pulling, setPulling] = useState(false);
  const refreshing = pulling && (pickupCountFetching || returnCountFetching || shiftFetching);

  // Staff can't take a booking without an open cash shift (the server rejects
  // it with SHIFT_REQUIRED). With no shift cached, re-check before blocking in
  // case one was opened elsewhere; if the check itself fails, let the server decide.
  // Like the web, opening the shift from this prompt continues into the booking.
  const startNewBooking = async () => {
    if (!shiftData) {
      const { data, isError } = await refetchShift();
      if (!isError && !data) {
        Alert.alert('Cash shift not open', SHIFT_REQUIRED_MESSAGE, [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Open shift',
            onPress: () => router.push({ pathname: '/employee/shift/open', params: { next: 'new-booking' } }),
          },
        ]);
        return;
      }
    }
    router.push('/employee/customer/search');
  };

  const onRefresh = async () => {
    setPulling(true);
    await Promise.all([refetchPickupCount(), refetchReturnCount(), refetchOverdueCount(), refetchShift()]);
    setPulling(false);
  };

  return (
    <ScrollView
      style={[styles.root, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.orange} />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.greeting}>Hi, {firstName}</Text>
          <View style={styles.headerMeta}>
            <Text style={styles.role}>Fleet Executive</Text>
            {user?.branchName && (
              <>
                <Text style={styles.metaDot}>·</Text>
                <View style={styles.branchBadge}>
                  <Ionicons name="location-outline" size={11} color={Colors.orange} />
                  <Text style={styles.branchBadgeText}>{user.branchName}</Text>
                </View>
              </>
            )}
          </View>
        </View>
        <View style={styles.headerRight}>
          <NotificationBell />
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={() => router.push('/(employee)/scan')}
            activeOpacity={0.8}
          >
            <Ionicons name="qr-code-outline" size={20} color={Colors.ink2} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Shift Status Card */}
      <View style={styles.shiftCard}>
        {shiftLoading ? (
          <ActivityIndicator color={Colors.orange} size="small" />
        ) : shiftData ? (
          <View>
            <View style={styles.shiftActive}>
              <View style={styles.shiftActiveLeft}>
                <View style={styles.shiftDot} />
                <View>
                  <Text style={styles.shiftActiveTitle}>Shift Active</Text>
                  <Text style={styles.shiftActiveTime}>
                    Started at {formatTime(shiftData.openedAt)}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.closeShiftBtn}
                onPress={() => router.push('/employee/shift/close')}
                activeOpacity={0.8}
              >
                <Text style={styles.closeShiftText}>Close</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.shiftCashRow}>
              <View style={styles.shiftCashItem}>
                {/* #22: opening + cash collected − cash refunded; older servers send confirmed cash only */}
                <Text style={styles.shiftCashLabel}>
                  {shiftData.expectedClosing != null ? 'Expected in drawer' : 'In drawer (confirmed)'}
                </Text>
                <Text style={styles.shiftCashValue}>
                  ₹{Number(shiftData.expectedClosing ?? shiftData.expectedTotal ?? 0).toLocaleString('en-IN')}
                </Text>
              </View>
              <View style={styles.shiftCashDivider} />
              <View style={styles.shiftCashItem}>
                <Text style={styles.shiftCashLabel}>Pending confirmation</Text>
                <Text style={styles.shiftCashValuePending}>
                  ₹{Number(shiftData.pendingCash ?? shiftData.pendingTotal ?? 0).toLocaleString('en-IN')}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.shiftInactive}>
            <View style={styles.shiftInactiveText}>
              <Text style={styles.shiftInactiveTitle}>No Active Shift</Text>
              <Text style={styles.shiftInactiveSub}>Open a shift to start collecting cash</Text>
            </View>
            <TouchableOpacity
              style={styles.openShiftBtn}
              onPress={() => router.push('/employee/shift/open')}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={16} color={Colors.white} />
              <Text style={styles.openShiftText}>Open Shift</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* Own shift history (#22) */}
        {!shiftLoading && (
          <TouchableOpacity
            style={styles.shiftHistoryLink}
            onPress={() => router.push('/employee/shift/history' as never)}
            activeOpacity={0.7}
          >
            <Ionicons name="time-outline" size={14} color={Colors.ink3} />
            <Text style={styles.shiftHistoryText}>Shift history</Text>
            <Ionicons name="chevron-forward" size={14} color={Colors.ink4} />
          </TouchableOpacity>
        )}
      </View>

      {/* Overdue returns (#8) — rentals past their return time, not back yet */}
      {overdueReturns > 0 && (
        <TouchableOpacity
          style={styles.overdueAlert}
          onPress={() => router.navigate('/(employee)/recovery' as Href)}
          activeOpacity={0.85}
        >
          <View style={styles.overdueAlertIcon}>
            <Ionicons name="alarm-outline" size={20} color={Colors.availNone} />
          </View>
          <View style={styles.overdueAlertBody}>
            <Text style={styles.overdueAlertTitle}>
              {overdueReturns} not back after the rental period
            </Text>
            <Text style={styles.overdueAlertSub}>Open Recovery to call or message them</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.availNone} />
        </TouchableOpacity>
      )}

      {/* Quick Actions */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsGrid}>
        <QuickAction
          label="New Booking"
          icon="add-circle-outline"
          onPress={startNewBooking}
          accent
        />
        <QuickAction
          label="Pickup Queue"
          icon="arrow-up-circle-outline"
          onPress={() => router.push({ pathname: '/(employee)/bookings', params: { tab: 'pickups', view: 'daily', date: today } })}
          count={pickupCount}
        />
        <QuickAction
          label="Return Queue"
          icon="arrow-down-circle-outline"
          onPress={() => router.push({ pathname: '/(employee)/bookings', params: { tab: 'returns', view: 'daily', date: today } })}
          count={returnCount}
        />
        <QuickAction
          label="Recovery"
          icon="alarm-outline"
          onPress={() => router.navigate('/(employee)/recovery' as Href)}
          count={overdueReturns}
          countNoun="overdue"
        />
        <QuickAction
          label="Scan Booking"
          icon="qr-code-outline"
          onPress={() => router.push('/(employee)/scan')}
        />
        <QuickAction
          label="Customer Search"
          icon="people-outline"
          onPress={() => router.push('/employee/customer/search')}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: { paddingBottom: 100 },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  headerLeft: { flex: 1 },
  greeting: {
    fontFamily: Fonts.displayBold,
    fontSize: 22,
    color: Colors.ink,
    letterSpacing: -0.5,
  },
  headerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  role: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink3,
  },
  metaDot: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink4,
  },
  branchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#ff6a1f12',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#ff6a1f25',
  },
  branchBadgeText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.orange,
  },
  headerRight: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Shift Card */
  shiftCard: {
    marginHorizontal: 20,
    marginBottom: 24,
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  shiftActive: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shiftActiveLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shiftDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10b981',
  },
  shiftActiveTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
  shiftActiveTime: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink3,
    marginTop: 2,
  },
  closeShiftBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e53e3e30',
    backgroundColor: '#e53e3e0d',
  },
  closeShiftText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: '#e53e3e',
  },
  shiftCashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
  },
  shiftCashItem: { flex: 1, gap: 3 },
  shiftCashDivider: { width: 1, height: 32, backgroundColor: Colors.hairline, marginHorizontal: 12 },
  shiftCashLabel: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3 },
  shiftCashValue: { fontFamily: Fonts.displayBold, fontSize: 18, color: Colors.ink, letterSpacing: -0.4 },
  shiftCashValuePending: { fontFamily: Fonts.displayBold, fontSize: 18, color: '#d97706', letterSpacing: -0.4 },
  shiftHistoryLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
  },
  shiftHistoryText: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },

  shiftInactive: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'nowrap',
  },
  shiftInactiveText: { flex: 1 },
  shiftInactiveTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
  shiftInactiveSub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink3,
    marginTop: 2,
  },
  openShiftBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.orange,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  openShiftText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.white,
  },

  /* Overdue returns alert */
  overdueAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 20,
    marginBottom: 24,
    padding: 14,
    borderRadius: 16,
    backgroundColor: Colors.availNoneSoft,
    borderWidth: 1,
    borderColor: '#e53e3e30',
  },
  overdueAlertIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overdueAlertBody: { flex: 1, gap: 2 },
  overdueAlertTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.availNone },
  overdueAlertSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink2 },

  /* Quick Actions */
  sectionTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 10,
  },
  quickAction: {
    width: '47.5%',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 10,
  },
  quickActionAccent: {
    backgroundColor: Colors.ink,
    borderColor: Colors.ink,
  },
  qaIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qaIconAccent: { backgroundColor: 'rgba(255,255,255,0.12)' },
  // Same look as the tab-bar badges, pinned to the icon's top-right corner.
  qaBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qaBadgeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.white,
    includeFontPadding: false,
  },
  qaLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
    lineHeight: 20,
  },
  qaLabelAccent: { color: Colors.white },
});

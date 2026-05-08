import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import { useAuthStore } from '../../store/auth';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface DashboardStats {
  todaysPickups: number;
  todaysReturns: number;
  activeRentals: number;
}

interface Shift {
  publicId: string;
  status: string;
  openedAt: string;
}

interface QueueBooking {
  publicId: string;
}

const DATE_STRIP_RANGE: number[] = [-1, 0, 1, 2, 3, 4, 5];

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateForOffset(offset: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

function dateChipLabel(offset: number, date: Date): { primary: string; secondary: string } {
  if (offset === -1) return { primary: 'Yesterday', secondary: date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) };
  if (offset === 0) return { primary: 'Today', secondary: date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) };
  if (offset === 1) return { primary: 'Tomorrow', secondary: date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) };
  return {
    primary: date.toLocaleDateString('en-IN', { weekday: 'short' }),
    secondary: date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
  };
}

function StatCard({ label, value, icon, color, loading }: { label: string; value: number; icon: IoniconName; color: string; loading?: boolean }) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIconWrap, { backgroundColor: color + '15' }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      {loading ? (
        <ActivityIndicator color={color} size="small" style={{ alignSelf: 'flex-start', height: 32 }} />
      ) : (
        <Text style={styles.statValue}>{value}</Text>
      )}
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function QuickAction({
  label,
  icon,
  onPress,
  accent,
}: {
  label: string;
  icon: IoniconName;
  onPress: () => void;
  accent?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.quickAction, accent && styles.quickActionAccent]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={[styles.qaIcon, accent && styles.qaIconAccent]}>
        <Ionicons name={icon} size={20} color={accent ? Colors.white : Colors.ink2} />
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
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const firstName = user?.name?.split(' ')[0] ?? 'there';

  const [selectedOffset, setSelectedOffset] = useState<number>(0);
  const selectedDate = useMemo(() => dateForOffset(selectedOffset), [selectedOffset]);
  const selectedDateIso = useMemo(() => toIsoDate(selectedDate), [selectedDate]);
  const isToday = selectedOffset === 0;

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery<DashboardStats>({
    queryKey: ['employee', 'dashboard-stats'],
    queryFn: async () => {
      const res = await employeeApi.dashboardStats();
      return res.data as DashboardStats;
    },
    staleTime: 60_000,
  });

  const { data: pickupsForDate, isLoading: pickupsForDateLoading, refetch: refetchPickupsForDate } = useQuery<QueueBooking[]>({
    queryKey: ['employee', 'pickups', selectedDateIso],
    queryFn: async () => {
      try {
        const res = await employeeApi.listPickups({ date: selectedDateIso });
        return (res.data?.data ?? []) as QueueBooking[];
      } catch (err: any) {
        if (err.response?.status === 404) return [];
        throw err;
      }
    },
    enabled: !isToday,
    staleTime: 30_000,
    retry: false,
  });

  const { data: returnsForDate, isLoading: returnsForDateLoading, refetch: refetchReturnsForDate } = useQuery<QueueBooking[]>({
    queryKey: ['employee', 'returns', selectedDateIso],
    queryFn: async () => {
      try {
        const res = await employeeApi.listReturns({ date: selectedDateIso });
        return (res.data?.data ?? []) as QueueBooking[];
      } catch (err: any) {
        if (err.response?.status === 404) return [];
        throw err;
      }
    },
    enabled: !isToday,
    staleTime: 30_000,
    retry: false,
  });

  const { data: shiftData, isLoading: shiftLoading, refetch: refetchShift } = useQuery<Shift | null>({
    queryKey: ['employee', 'active-shift'],
    queryFn: async () => {
      const res = await employeeApi.getActiveShift();
      return (res.data?.data ?? null) as Shift | null;
    },
    staleTime: 30_000,
  });

  const openShiftMutation = useMutation({
    mutationFn: () => employeeApi.openShift(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee', 'active-shift'] });
    },
  });

  const refreshing = statsLoading || shiftLoading || pickupsForDateLoading || returnsForDateLoading;

  const onRefresh = () => {
    refetchStats();
    refetchShift();
    if (!isToday) {
      refetchPickupsForDate();
      refetchReturnsForDate();
    }
  };

  const pickupsCount = isToday ? (stats?.todaysPickups ?? 0) : (pickupsForDate?.length ?? 0);
  const returnsCount = isToday ? (stats?.todaysReturns ?? 0) : (returnsForDate?.length ?? 0);
  const pickupsLoading = isToday ? statsLoading : pickupsForDateLoading;
  const returnsLoading = isToday ? statsLoading : returnsForDateLoading;

  const sectionTitle = isToday
    ? 'Today'
    : selectedDate.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short' });

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
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={() => router.push('/(employee)/scan')}
            activeOpacity={0.8}
          >
            <Ionicons name="qr-code-outline" size={20} color={Colors.ink2} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Date strip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.dateStrip}
      >
        {DATE_STRIP_RANGE.map((offset) => {
          const date = dateForOffset(offset);
          const { primary, secondary } = dateChipLabel(offset, date);
          const active = offset === selectedOffset;
          return (
            <TouchableOpacity
              key={offset}
              style={[styles.dateChip, active && styles.dateChipActive]}
              onPress={() => setSelectedOffset(offset)}
              activeOpacity={0.85}
            >
              <Text style={[styles.dateChipPrimary, active && styles.dateChipPrimaryActive]}>{primary}</Text>
              <Text style={[styles.dateChipSecondary, active && styles.dateChipSecondaryActive]}>{secondary}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Shift Status Card */}
      <View style={styles.shiftCard}>
        {shiftLoading ? (
          <ActivityIndicator color={Colors.orange} size="small" />
        ) : shiftData ? (
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
      </View>

      {/* Stats */}
      <Text style={styles.sectionTitle}>{sectionTitle}</Text>
      <View style={styles.statsRow}>
        <StatCard
          label="Pickups"
          value={pickupsCount}
          icon="arrow-up-circle-outline"
          color="#ff6a1f"
          loading={pickupsLoading}
        />
        <StatCard
          label="Returns"
          value={returnsCount}
          icon="arrow-down-circle-outline"
          color="#3b82f6"
          loading={returnsLoading}
        />
        <StatCard
          label="Active"
          value={stats?.activeRentals ?? 0}
          icon="car-outline"
          color="#10b981"
          loading={statsLoading}
        />
      </View>

      {/* Quick Actions */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsGrid}>
        <QuickAction
          label="Pickup Queue"
          icon="arrow-up-circle-outline"
          onPress={() => router.push({ pathname: '/(employee)/bookings', params: { tab: 'pickups', date: selectedDateIso } })}
          accent
        />
        <QuickAction
          label="Return Queue"
          icon="arrow-down-circle-outline"
          onPress={() => router.push({ pathname: '/(employee)/bookings', params: { tab: 'returns', date: selectedDateIso } })}
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
    paddingBottom: 16,
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

  /* Date strip */
  dateStrip: {
    paddingHorizontal: 20,
    gap: 8,
    paddingBottom: 20,
  },
  dateChip: {
    minWidth: 76,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    gap: 2,
  },
  dateChipActive: {
    backgroundColor: Colors.ink,
    borderColor: Colors.ink,
  },
  dateChipPrimary: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  dateChipPrimaryActive: { color: Colors.white },
  dateChipSecondary: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.ink3,
  },
  dateChipSecondaryActive: { color: 'rgba(255,255,255,0.75)' },

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

  /* Stats */
  sectionTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 28,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 6,
  },
  statIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  statValue: {
    fontFamily: Fonts.displayBold,
    fontSize: 26,
    color: Colors.ink,
    letterSpacing: -0.8,
  },
  statLabel: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink3,
  },

  /* Quick Actions */
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
  qaLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
    lineHeight: 20,
  },
  qaLabelAccent: { color: Colors.white },
});

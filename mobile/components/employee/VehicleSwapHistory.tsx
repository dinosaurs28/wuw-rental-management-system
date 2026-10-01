import { useCallback, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import {
  SWAP_REASON_LABEL,
  fuelBarsValue,
  priceDifferenceOf,
  type VehicleSwapRecord,
} from '../../types/vehicleSwap';
import { swapHistoryKey, swapInr } from './SwapParts';

const km = (n: number) => `${n.toLocaleString('en-IN')} km`;
const fuel = (level: string | null) => (level == null ? null : fuelBarsValue(level) ? `${level}/10` : level);

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

const STAGE_LABEL: Record<string, string> = {
  PICKED_UP: 'During the rental',
  CONFIRMED: 'Before pickup',
};

function reading(odo: number | null, fuelLevel: string | null) {
  const parts = [odo != null ? km(odo) : null, fuel(fuelLevel) ? `fuel ${fuel(fuelLevel)}` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function SwapRow({ swap }: { swap: VehicleSwapRecord }) {
  const from = swap.originalVehicle;
  const to = swap.newVehicle;
  const stage = swap.bookingStatusAtSwap ? STAGE_LABEL[swap.bookingStatusAtSwap] : undefined;
  const reason = SWAP_REASON_LABEL[swap.reason] ?? swap.reason;
  const back = reading(swap.originalVehicleEndOdometer, swap.originalVehicleFuelLevel);
  const out = reading(swap.newVehicleStartOdometer, swap.newVehicleFuelLevel);
  const diff = priceDifferenceOf(swap.priceDifference) ?? 0;
  const originalFate =
    swap.originalVehicleStatus === 'MAINTENANCE'
      ? `${from.regNo} sent to maintenance${swap.originalVehicleNotes ? ` — ${swap.originalVehicleNotes}` : ''}`
      : swap.originalVehicleStatus === 'MANAGER_REPORTED'
        ? `${from.regNo} held for the manager's damage review`
        : null;

  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.regs} numberOfLines={1}>{from.regNo} → {to.regNo}</Text>
        <Text style={styles.when}>{formatDate(swap.swappedAt)}</Text>
      </View>
      <Text style={styles.cars} numberOfLines={1}>
        {from.make} {from.model} → {to.make} {to.model}
      </Text>
      <Text style={styles.meta}>
        {stage ? `${stage} · ` : ''}{reason}{swap.reasonNotes ? ` — ${swap.reasonNotes}` : ''}
      </Text>
      {(back || out) && (
        <View style={styles.readings}>
          {back && <Text style={styles.reading}>Returned at {back}</Text>}
          {out && <Text style={styles.reading}>Handed over at {out}</Text>}
        </View>
      )}
      {diff > 0 && (
        <Text style={[styles.price, !swap.chargeDifference && styles.priceWaived]}>
          {swap.chargeDifference
            ? `Price difference ${swapInr(diff)} + GST · charged`
            : `Price difference ${swapInr(diff)} · waived`}
        </Text>
      )}
      {originalFate && <Text style={styles.meta}>{originalFate}</Text>}
      {swap.swappedBy?.name ? <Text style={styles.by}>By {swap.swappedBy.name}</Text> : null}
    </View>
  );
}

// "Vehicle swaps" card: this booking's swaps, newest first. Renders nothing
// until there is at least one.
export default function VehicleSwapHistory({ bookingId }: { bookingId: string }) {
  const { data: swaps = [], isError, error, refetch } = useQuery<VehicleSwapRecord[]>({
    queryKey: swapHistoryKey(bookingId),
    queryFn: async () => {
      const res = await employeeApi.getBookingSwapHistory(bookingId);
      return (res.data?.data ?? []) as VehicleSwapRecord[];
    },
    enabled: !!bookingId,
    staleTime: 30_000,
    retry: false,
  });

  // Back from the extension screen: its "swap to another vehicle" option adds a row.
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

  // 404 = a server without this endpoint, or not this branch's booking: nothing to show.
  if (isError && (error as any)?.response?.status !== 404) {
    return (
      <>
        <Text style={styles.sectionHeader}>Vehicle swaps</Text>
        <View style={styles.card}>
          <Text style={styles.meta}>Couldn't load the vehicle swap history.</Text>
          <TouchableOpacity onPress={() => refetch()} hitSlop={8} style={{ marginTop: 8 }}>
            <Text style={styles.link}>Try again</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }
  if (swaps.length === 0) return null;

  return (
    <>
      <Text style={styles.sectionHeader}>Vehicle swaps</Text>
      <View style={styles.card}>
        {swaps.map((s, i) => (
          <View key={s.publicId}>
            {i > 0 && <View style={styles.divider} />}
            <View style={styles.item}>
              <View style={styles.icon}>
                <Ionicons name="swap-horizontal" size={16} color={Colors.orange} />
              </View>
              <View style={{ flex: 1 }}>
                <SwapRow swap={s} />
              </View>
            </View>
          </View>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8, marginBottom: 4 },
  card: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.hairline, padding: 16, marginBottom: 4 },
  divider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 12 },
  item: { flexDirection: 'row', gap: 12 },
  icon: { width: 32, height: 32, borderRadius: 10, backgroundColor: Colors.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  row: { gap: 3 },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  regs: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  when: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3 },
  cars: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink2 },
  meta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17 },
  readings: { backgroundColor: Colors.bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginTop: 4, gap: 2 },
  reading: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink2 },
  price: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.ink, marginTop: 2 },
  priceWaived: { color: Colors.ink3 },
  by: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink3, marginTop: 2 },
  link: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.orange },
});

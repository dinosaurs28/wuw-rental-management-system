import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import { apiErrorMessage } from '../../lib/counterErrors';
import type { SwapKmPreview as SwapKmPreviewData } from '../../types/vehicleSwap';

const km = (n: number) => `${n.toLocaleString('en-IN')} km`;
const inr = (s: string | null) => `₹${(parseFloat(s ?? '0') || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** The value once it has stopped changing for `ms`. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

// The returning car's km at a mid-rental swap, worked out by the server with the
// drop's rule while staff type its odometer: km this segment, free km left for
// it, extra km and ₹ — recorded with the swap and billed at drop.
export default function SwapKmPreview({
  bookingId,
  endOdometer,
  segmentStart,
  newVehicleId,
  regNo,
}: {
  bookingId: string;
  /** Typed end odometer of the returning car (null = not a number yet) */
  endOdometer: number | null;
  /** Its start reading this segment — lower readings aren't sent (the field shows the error) */
  segmentStart: number | null;
  /** The chosen replacement (the drop prices the booking's km on it); null = none picked yet */
  newVehicleId: number | null;
  regNo: string;
}) {
  const settled = useSettled(endOdometer, 400);
  const ready = settled != null && (segmentStart == null || settled >= segmentStart);
  const query = useQuery<SwapKmPreviewData>({
    queryKey: ['employee', 'swap-km-preview', bookingId, settled, newVehicleId],
    queryFn: async () => {
      const res = await employeeApi.previewSwapKm(bookingId, settled!, newVehicleId ?? undefined);
      return res.data?.data as SwapKmPreviewData;
    },
    enabled: !!bookingId && ready,
    staleTime: 30_000,
    retry: false,
  });

  if (endOdometer == null || !ready) return null;
  const typing = settled !== endOdometer;

  if (query.isLoading || (typing && !query.data)) {
    return (
      <View style={styles.row}>
        <ActivityIndicator size="small" color={Colors.ink3} />
        <Text style={styles.muted}>Working out the km on {regNo}…</Text>
      </View>
    );
  }
  if (query.isError) {
    // An older server without the preview: nothing to show
    if ((query.error as any)?.response?.status === 404 && !(query.error as any)?.response?.data?.code) return null;
    return <Text style={styles.warn}>{apiErrorMessage(query.error, "Couldn't work out the km for this swap.")}</Text>;
  }
  const data = query.data;
  if (!data) return null;
  if (!data.available) {
    return (
      <View style={[styles.box, styles.boxWarn]}>
        <Text style={styles.warnText}>
          {km(data.kmDriven)} driven on {regNo}. {data.unavailableReason}
        </Text>
      </View>
    );
  }
  const extra = data.extraKm ?? 0;
  return (
    <View style={[styles.box, extra > 0 ? styles.boxExtra : null, typing ? { opacity: 0.6 } : null]}>
      <Text style={styles.body}>
        Driven {km(data.kmDriven)}
        {data.allowanceKm != null ? ` · free km left for it ${km(data.allowanceKm)}` : ''}
        {data.priorKm > 0 && data.includedKm != null
          ? ` (of ${km(data.includedKm)}; earlier cars used ${km(data.priorKm)})`
          : ''}
      </Text>
      {extra > 0 ? (
        <Text style={styles.extra}>
          Extra km on {regNo}: {extra.toLocaleString('en-IN')} km ·{' '}
          {data.extraKmEnabled ? `${inr(data.extraKmCharge)} — billed at drop` : "₹0 — extra km isn't charged at this branch"}
        </Text>
      ) : (
        <Text style={styles.body}>No extra km on {regNo} — within the free km.</Text>
      )}
      {!newVehicleId ? (
        <Text style={styles.muted}>Estimate on {data.rateVehicleRegNo}'s rate — pick the replacement for the exact figure.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  muted: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 2 },
  warn: { fontFamily: Fonts.body, fontSize: 12, color: Colors.availLow, marginTop: 6, lineHeight: 17 },
  box: {
    marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: Colors.hairline,
    backgroundColor: Colors.bg, paddingHorizontal: 10, paddingVertical: 8, gap: 2,
  },
  boxExtra: { borderColor: Colors.orange, backgroundColor: Colors.orangeSoft },
  boxWarn: { borderColor: Colors.availLow, backgroundColor: Colors.availLowSoft },
  warnText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink2, lineHeight: 17 },
  body: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink2, lineHeight: 17 },
  extra: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink, lineHeight: 18 },
});

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import { apiErrorMessage } from '../../lib/counterErrors';
import {
  defaultChargeDifference,
  priceDifferenceOf,
  type SwapCandidate,
  type SwapReason,
  type VehicleSwapRecord,
} from '../../types/vehicleSwap';
import {
  SwapCandidateList,
  SwapPriceDifference,
  SwapReasonChips,
  chargeDifferenceToSend,
  swapCandidatesKey,
  swapHistoryKey,
  swapInr,
  useSwapCandidates,
} from './SwapParts';

// #51 — "is the vehicle available?" gate → pick a replacement (same category
// first, higher categories flagged "Upgrade") → swap. Before pickup: no
// readings. The pre-GST price difference shows per car; "Charge customer"
// decides whether it goes on the drop bill (#13).
export default function VehicleSwapSection({ bookingId, onSwapped }: { bookingId: string; onSwapped: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // No default: the reason decides whether the customer pays the difference.
  const [reason, setReason] = useState<SwapReason | null>(null);
  const [charge, setCharge] = useState(false);
  const [reasonNotes, setReasonNotes] = useState('');
  const [markMaint, setMarkMaint] = useState(false);
  const [maintNotes, setMaintNotes] = useState('');
  const [swapping, setSwapping] = useState(false);

  const { data, isLoading, isError, error } = useSwapCandidates(bookingId, open);
  const vehicles = data?.vehicles ?? [];
  const context = data?.context ?? null;
  const selected: SwapCandidate | null = vehicles.find((v) => v.id === selectedId) ?? null;

  // A reload can drop the picked car (taken meanwhile).
  useEffect(() => {
    if (selectedId != null && data && !data.vehicles.some((v) => v.id === selectedId)) setSelectedId(null);
  }, [data]);

  const pickReason = (r: SwapReason) => {
    setReason(r);
    setCharge(defaultChargeDifference(context, r));
  };

  const doSwap = async () => {
    if (!selected) { Alert.alert('Select a vehicle', 'Pick a replacement vehicle first.'); return; }
    if (!reason) { Alert.alert('Reason required', 'Pick the reason for the swap.'); return; }
    if (markMaint && !maintNotes.trim()) { Alert.alert('Notes required', 'Add notes when marking the original for maintenance.'); return; }
    setSwapping(true);
    try {
      const res = await employeeApi.swapVehicle(bookingId, {
        newVehicleId: selected.id,
        reason,
        ...(reasonNotes.trim() ? { reasonNotes: reasonNotes.trim() } : {}),
        ...(markMaint ? { markOriginalForMaintenance: true, originalVehicleNotes: maintNotes.trim() } : {}),
        chargeDifference: chargeDifferenceToSend(selected, reason, charge),
      });
      const swap = (res.data?.data ?? null) as VehicleSwapRecord | null;
      const diff = priceDifferenceOf(swap?.priceDifference) ?? 0;
      const money =
        diff > 0
          ? swap?.chargeDifference
            ? ` Price difference ${swapInr(diff)} + GST goes on the drop bill.`
            : ` The ${swapInr(diff)} price difference was waived.`
          : '';
      Alert.alert('Vehicle swapped', `The booking now points to the new vehicle.${money}`);
      setOpen(false);
      setSelectedId(null);
      setReason(null);
      setCharge(false);
      qc.invalidateQueries({ queryKey: swapHistoryKey(bookingId) });
      onSwapped();
    } catch (err: any) {
      const code = err?.response?.data?.code;
      // The picked car can't take this booking any more — reload the list.
      if (code === 'VEHICLE_NOT_AVAILABLE' || code === 'VEHICLE_BUSY' || code === 'BOOKING_CHANGED' || code === 'VEHICLE_NOT_FOUND') {
        qc.invalidateQueries({ queryKey: swapCandidatesKey(bookingId) });
      }
      Alert.alert('Swap failed', apiErrorMessage(err, 'Could not swap the vehicle.'));
    } finally {
      setSwapping(false);
    }
  };

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.toggleRow} onPress={() => setOpen((v) => !v)} activeOpacity={0.8}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={styles.title}>Assigned vehicle not available?</Text>
          <Text style={styles.sub}>Swap to another vehicle of the same or a higher category.</Text>
        </View>
        <Switch
          value={open}
          onValueChange={setOpen}
          trackColor={{ false: Colors.ink4, true: Colors.orange }}
          thumbColor={Colors.white}
        />
      </TouchableOpacity>

      {open && (
        <>
          <View style={styles.divider} />
          {isLoading || (!data && !isError) ? (
            <ActivityIndicator color={Colors.orange} style={{ marginVertical: 12 }} />
          ) : isError ? (
            <Text style={styles.emptyText}>{apiErrorMessage(error, 'Could not load alternatives.')}</Text>
          ) : vehicles.length === 0 ? (
            <Text style={styles.emptyText}>No alternative vehicles of the same or a higher category are free in this branch.</Text>
          ) : (
            <>
              {context?.pricingError ? (
                <Text style={styles.warnText}>Price differences unavailable: {context.pricingError}</Text>
              ) : null}
              <SwapCandidateList
                vehicles={vehicles}
                selectedId={selectedId}
                onSelect={(v) => setSelectedId(v.id)}
                disabled={swapping}
              />

              <Text style={styles.fieldLabel}>Reason</Text>
              <SwapReasonChips value={reason} onChange={pickReason} disabled={swapping} />

              <TextInput
                style={styles.input}
                value={reasonNotes}
                onChangeText={setReasonNotes}
                placeholder="Notes (optional)"
                placeholderTextColor={Colors.ink4}
              />

              {selected && (
                <SwapPriceDifference
                  candidate={selected}
                  pricingError={context?.pricingError ?? null}
                  reason={reason}
                  charge={charge}
                  onChargeChange={setCharge}
                  disabled={swapping}
                />
              )}

              <View style={styles.maintRow}>
                <Text style={styles.maintLabel}>Mark original for maintenance</Text>
                <Switch
                  value={markMaint}
                  onValueChange={setMarkMaint}
                  trackColor={{ false: Colors.ink4, true: Colors.orange }}
                  thumbColor={Colors.white}
                />
              </View>
              {markMaint && (
                <TextInput
                  style={styles.input}
                  value={maintNotes}
                  onChangeText={setMaintNotes}
                  placeholder="Maintenance notes (required)"
                  placeholderTextColor={Colors.ink4}
                />
              )}

              <TouchableOpacity
                style={[styles.swapBtn, (swapping || !selected || !reason) && styles.swapBtnDisabled]}
                onPress={doSwap}
                disabled={swapping || !selected || !reason}
                activeOpacity={0.85}
              >
                {swapping ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.swapBtnText}>Swap vehicle</Text>}
              </TouchableOpacity>
            </>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.hairline, padding: 16, marginBottom: 4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  sub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 2 },
  divider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 14 },
  emptyText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  warnText: { fontFamily: Fonts.body, fontSize: 12, color: '#d97706', marginBottom: 10, lineHeight: 17 },
  fieldLabel: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink3, marginTop: 6, marginBottom: 8 },
  input: {
    backgroundColor: Colors.bg, borderRadius: 12, borderWidth: 1, borderColor: Colors.hairline,
    paddingHorizontal: 14, paddingVertical: 11, fontFamily: Fonts.body, fontSize: 14, color: Colors.ink, marginTop: 10,
  },
  maintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  maintLabel: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2, flex: 1 },
  swapBtn: { backgroundColor: Colors.orange, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  swapBtnDisabled: { opacity: 0.5 },
  swapBtnText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white },
});

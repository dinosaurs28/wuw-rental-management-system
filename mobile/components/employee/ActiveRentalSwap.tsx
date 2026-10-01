import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import ActiveSwapSheet from './ActiveSwapSheet';
import VehicleSwapHistory from './VehicleSwapHistory';
import { swapCandidatesKey, swapHistoryKey } from './SwapParts';

// Drop screen (#13): "Swap vehicle" for an active rental + this booking's swap
// history. canSwap = PICKED_UP with no drop bill started (the server refuses
// otherwise and the sheet shows its reason).
export default function ActiveRentalSwap({ bookingId, canSwap }: { bookingId: string; canSwap: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const onSwapped = () => {
    setOpen(false);
    // The drop screen's booking (new car, km segments, swap charges), the
    // history and the Fleet queues all changed.
    qc.invalidateQueries({ queryKey: ['employee', 'return'] });
    qc.invalidateQueries({ queryKey: swapHistoryKey(bookingId) });
    qc.invalidateQueries({ queryKey: swapCandidatesKey(bookingId) });
    qc.invalidateQueries({ queryKey: ['employee', 'returns'] });
    qc.invalidateQueries({ queryKey: ['employee', 'pickups'] });
    qc.invalidateQueries({ queryKey: ['employee', 'dashboard-stats'] });
  };

  return (
    <>
      {canSwap && (
        <TouchableOpacity style={styles.btn} onPress={() => setOpen(true)} activeOpacity={0.85}>
          <Ionicons name="swap-horizontal-outline" size={18} color={Colors.ink2} />
          <Text style={styles.btnText}>Swap vehicle</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />
        </TouchableOpacity>
      )}

      <VehicleSwapHistory bookingId={bookingId} />

      <ActiveSwapSheet
        visible={open && canSwap}
        bookingId={bookingId}
        onClose={() => setOpen(false)}
        onSwapped={onSwapped}
      />
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 4,
  },
  btnText: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink2 },
});

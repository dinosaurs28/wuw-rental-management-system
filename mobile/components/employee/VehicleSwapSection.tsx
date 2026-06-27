import { useState } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';

interface AvailableVehicle {
  id: number;
  publicId: string;
  make: string;
  model: string;
  regNo: string;
  categoryName?: string;
  images?: { url: string | null }[];
}

const REASONS = ['CUSTOMER_REQUEST', 'MAINTENANCE', 'UPGRADE', 'DOWNGRADE', 'DAMAGE', 'OTHER'] as const;
const REASON_LABEL: Record<string, string> = {
  CUSTOMER_REQUEST: 'Customer request',
  MAINTENANCE: 'Maintenance',
  UPGRADE: 'Upgrade',
  DOWNGRADE: 'Downgrade',
  DAMAGE: 'Damage',
  OTHER: 'Other',
};

// #51 — "is the vehicle available?" gate → pick a same-category replacement → swap.
export default function VehicleSwapSection({ bookingId, onSwapped }: { bookingId: string; onSwapped: () => void }) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reason, setReason] = useState<(typeof REASONS)[number]>('CUSTOMER_REQUEST');
  const [reasonNotes, setReasonNotes] = useState('');
  const [markMaint, setMarkMaint] = useState(false);
  const [maintNotes, setMaintNotes] = useState('');
  const [swapping, setSwapping] = useState(false);

  const { data: vehicles = [], isLoading, isError } = useQuery({
    queryKey: ['employee', 'available-vehicles', bookingId],
    queryFn: async () => (await employeeApi.getAvailableVehicles(bookingId)).data?.data ?? [],
    select: (rows: any[]) => rows as AvailableVehicle[],
    enabled: open,
    staleTime: 30_000,
    retry: false,
  });

  const doSwap = async () => {
    if (!selectedId) { Alert.alert('Select a vehicle', 'Pick a replacement vehicle first.'); return; }
    if (markMaint && !maintNotes.trim()) { Alert.alert('Notes required', 'Add notes when marking the original for maintenance.'); return; }
    setSwapping(true);
    try {
      await employeeApi.swapVehicle(bookingId, {
        newVehicleId: selectedId,
        reason,
        ...(reasonNotes.trim() ? { reasonNotes: reasonNotes.trim() } : {}),
        ...(markMaint ? { markOriginalForMaintenance: true, originalVehicleNotes: maintNotes.trim() } : {}),
      });
      Alert.alert('Vehicle swapped', 'The booking now points to the new vehicle.');
      setOpen(false);
      setSelectedId(null);
      onSwapped();
    } catch (err: any) {
      Alert.alert('Swap failed', err?.response?.data?.message ?? 'Could not swap the vehicle.');
    } finally {
      setSwapping(false);
    }
  };

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.toggleRow} onPress={() => setOpen((v) => !v)} activeOpacity={0.8}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={styles.title}>Assigned vehicle not available?</Text>
          <Text style={styles.sub}>Swap to another vehicle of the same category.</Text>
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
          {isLoading ? (
            <ActivityIndicator color={Colors.orange} style={{ marginVertical: 12 }} />
          ) : isError ? (
            <Text style={styles.emptyText}>Could not load alternatives.</Text>
          ) : vehicles.length === 0 ? (
            <Text style={styles.emptyText}>No alternative vehicles available in this category/branch.</Text>
          ) : (
            <>
              {vehicles.map((v) => {
                const sel = v.id === selectedId;
                const thumb = v.images?.[0]?.url ?? null;
                return (
                  <TouchableOpacity
                    key={v.id}
                    style={[styles.vehRow, sel && styles.vehRowActive]}
                    onPress={() => setSelectedId(v.id)}
                    activeOpacity={0.85}
                  >
                    {thumb ? (
                      <Image source={{ uri: thumb }} style={styles.vehThumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.vehThumb, styles.vehThumbPlaceholder]}>
                        <Ionicons name="car-outline" size={18} color={Colors.ink4} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.vehName}>{v.make} {v.model}</Text>
                      <Text style={styles.vehReg}>{v.regNo}{v.categoryName ? ` · ${v.categoryName}` : ''}</Text>
                    </View>
                    <Ionicons name={sel ? 'radio-button-on' : 'radio-button-off'} size={20} color={sel ? Colors.orange : Colors.ink4} />
                  </TouchableOpacity>
                );
              })}

              <Text style={styles.fieldLabel}>Reason</Text>
              <View style={styles.reasonWrap}>
                {REASONS.map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.reasonChip, reason === r && styles.reasonChipActive]}
                    onPress={() => setReason(r)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.reasonText, reason === r && styles.reasonTextActive]}>{REASON_LABEL[r]}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput
                style={styles.input}
                value={reasonNotes}
                onChangeText={setReasonNotes}
                placeholder="Notes (optional)"
                placeholderTextColor={Colors.ink4}
              />

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
                style={[styles.swapBtn, (swapping || !selectedId) && styles.swapBtnDisabled]}
                onPress={doSwap}
                disabled={swapping || !selectedId}
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
  vehRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.hairline, marginBottom: 8, backgroundColor: Colors.bg,
  },
  vehRowActive: { borderColor: Colors.orange, backgroundColor: '#fff7f2' },
  vehThumb: { width: 48, height: 40, borderRadius: 8, backgroundColor: Colors.surface },
  vehThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  vehName: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  vehReg: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 1 },
  fieldLabel: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink3, marginTop: 6, marginBottom: 8 },
  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reasonChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.hairline },
  reasonChipActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  reasonText: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink2 },
  reasonTextActive: { color: Colors.white },
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

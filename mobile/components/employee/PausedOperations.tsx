import { useCallback, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { employeeApi } from '../../lib/api';
import { pausedLabel, type OperationDraftType, type PausedOperation } from '../../lib/operationDraft';

// Pickups / drops a Fleet Executive started and left for later (client item 2),
// whatever their date — so a paused one is easy to find and resume while the
// queue below shows another day or tab. Hidden when there are none.
export default function PausedOperations({ type }: { type: OperationDraftType }) {
  const router = useRouter();
  const { data = [], refetch } = useQuery<PausedOperation[]>({
    queryKey: ['employee', 'operation-drafts', type],
    queryFn: async () => {
      try {
        const res = await employeeApi.listOperationDrafts({ type });
        return res.data?.data ?? [];
      } catch (err: any) {
        // Servers without paused operations
        if (err?.response?.status === 404) return [];
        throw err;
      }
    },
    staleTime: 30_000,
    retry: false,
  });

  // Back from a pickup / drop: it may have been paused, resumed or completed.
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

  if (data.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Ionicons name="pause-circle-outline" size={15} color={Colors.availLow} />
        <Text style={styles.headText}>
          {data.length} paused {type === 'PICKUP' ? 'pickup' : 'drop'}{data.length === 1 ? '' : 's'} · tap to continue
        </Text>
      </View>
      {data.map((op) => {
        const vehicle = op.booking.items[0]?.vehicle;
        return (
          <TouchableOpacity
            key={op.publicId}
            style={styles.row}
            activeOpacity={0.85}
            onPress={() =>
              router.push(
                op.type === 'PICKUP'
                  ? `/employee/pickup/${op.booking.publicId}`
                  : `/employee/return/${op.booking.publicId}`,
              )
            }
          >
            <View style={styles.rowText}>
              <Text style={styles.vehicle} numberOfLines={1}>
                {vehicle ? `${vehicle.make} ${vehicle.model}` : 'Vehicle'}
                {vehicle?.regNo ? <Text style={styles.reg}>  {vehicle.regNo}</Text> : null}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {op.booking.customer?.user?.name ?? '—'} · #{op.booking.publicId.slice(-8).toUpperCase()}
              </Text>
              <Text style={styles.paused} numberOfLines={1}>{pausedLabel(op)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.availLowSoft,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headText: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.availLow },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: Colors.bg,
  },
  rowText: { flex: 1, gap: 2 },
  vehicle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  reg: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  meta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  paused: { fontFamily: Fonts.bodyMedium, fontSize: 11.5, color: Colors.availLow },
});

import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import type { KmSegment } from '../../types/return';

const km = (n: number) => `${n.toLocaleString('en-IN')} km`;
const inr = (s: string) => `₹${(parseFloat(s) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

// "Vehicle swap" at the drop: for each mid-rental swap, the car handed back
// (start → end odometer, km driven, extra km and ₹ recorded at the swap) and the
// replacement with its start reading — the drop is checked against the car
// actually coming back. The recorded extra km is part of the drop's one extra-km
// charge, never billed on top of it.
export default function DropSwapSection({
  segments,
  currentStartOdometer,
  style,
}: {
  segments: KmSegment[];
  currentStartOdometer: number | null;
  style?: object;
}) {
  if (segments.length === 0) return null;
  const last = segments[segments.length - 1]!;
  return (
    <View style={[styles.card, style]}>
      <View style={styles.titleRow}>
        <Ionicons name="swap-horizontal-outline" size={16} color={Colors.ink2} />
        <Text style={styles.title}>Vehicle swap{segments.length > 1 ? `s (${segments.length})` : ''}</Text>
      </View>
      {segments.map((s, i) => {
        const r = s.recorded ?? null;
        return (
          <View key={s.endedBySwapPublicId ?? i} style={styles.swap}>
            {s.swappedAt ? <Text style={styles.muted}>Swapped {formatWhen(s.swappedAt)}</Text> : null}
            <View style={styles.block}>
              <Text style={styles.label}>Replaced</Text>
              <Text style={styles.reg}>{s.vehicleRegNo ?? '—'}</Text>
              <Text style={styles.body}>
                {s.startOdometer != null ? km(s.startOdometer) : '—'} → {s.endOdometer != null ? km(s.endOdometer) : '—'}
                {s.km != null ? ` · driven ${km(s.km)}` : ''}
              </Text>
              {r?.extraKm != null ? (
                <Text style={r.extraKm > 0 ? styles.extra : styles.muted}>
                  {r.extraKm > 0
                    ? `Extra km recorded at the swap: ${km(r.extraKm)}${
                        r.extraKmEnabled && r.extraKmCharge != null ? ` · ${inr(r.extraKmCharge)}` : ''
                      }`
                    : 'No extra km at the swap'}
                </Text>
              ) : (
                <Text style={styles.muted}>Extra km not recorded at the swap</Text>
              )}
            </View>
            <View style={[styles.block, styles.blockNew]}>
              <Text style={styles.label}>Replacement</Text>
              <Text style={styles.reg}>{s.replacementRegNo ?? '—'}</Text>
              <Text style={styles.body}>
                Start odometer {s.replacementStartOdometer != null ? km(s.replacementStartOdometer) : 'not recorded'}
              </Text>
            </View>
          </View>
        );
      })}
      <Text style={styles.note}>
        Check the drop against {last.replacementRegNo ?? 'the replacement'}
        {currentStartOdometer != null ? ` — its end odometer can't be below ${km(currentStartOdometer)}` : ''}. Km on the
        replaced car{segments.length > 1 ? 's' : ''} is part of this drop's one extra-km charge, not added on top.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.hairline,
    padding: 14, gap: 10, marginBottom: 12,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  swap: { gap: 6 },
  block: { backgroundColor: Colors.bg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, gap: 2 },
  blockNew: { borderWidth: 1, borderColor: Colors.orange, backgroundColor: Colors.surface },
  label: { fontFamily: Fonts.bodyMedium, fontSize: 11, color: Colors.ink3, textTransform: 'uppercase', letterSpacing: 0.4 },
  reg: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  body: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink2 },
  extra: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: '#c2410c' },
  muted: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  note: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink2, lineHeight: 17 },
});

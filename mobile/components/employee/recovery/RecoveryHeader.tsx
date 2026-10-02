import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { fmtDurationMinutes } from '../../../lib/dates';

export type RecoveryFilter = 'ALL' | 'OVERDUE' | 'IN_GRACE' | 'AWAITING';

export const RECOVERY_FILTERS: { key: RecoveryFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'OVERDUE', label: 'Overdue' },
  { key: 'IN_GRACE', label: 'In grace' },
  { key: 'AWAITING', label: 'Awaiting manager' },
];

interface Props {
  overdueCount: number;
  /** Longest wait among rentals still out, in minutes; null when none. */
  longestMinutes: number | null;
  filter: RecoveryFilter;
  onFilter: (f: RecoveryFilter) => void;
  chipCounts: Record<RecoveryFilter, number>;
}

/** Summary (count, longest overdue) plus the state filter chips. */
export function RecoveryHeader({ overdueCount, longestMinutes, filter, onFilter, chipCounts }: Props) {
  return (
    <View>
      <View style={styles.summary}>
        <View style={styles.summaryCell}>
          <Text style={[styles.summaryValue, overdueCount > 0 && styles.summaryValueAlert]}>{overdueCount}</Text>
          <Text style={styles.summaryLabel}>not back yet</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryCell}>
          <Text style={styles.summaryValue}>{longestMinutes != null ? fmtDurationMinutes(longestMinutes) : '—'}</Text>
          <Text style={styles.summaryLabel}>longest overdue</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {RECOVERY_FILTERS.map(({ key, label }) => {
          const active = filter === key;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => onFilter(key)}
              activeOpacity={0.8}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
              <Text style={[styles.chipCount, active && styles.chipTextActive]}>{chipCounts[key]}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.scopeRow}>
        <Ionicons name="alarm-outline" size={14} color={Colors.ink3} />
        <Text style={styles.scopeText}>Customers not back after the rental period, most overdue first</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 12,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  summaryCell: { flex: 1, alignItems: 'center', gap: 2 },
  summaryDivider: { width: 1, backgroundColor: Colors.hairline },
  summaryValue: { fontFamily: Fonts.displayBold, fontSize: 24, color: Colors.ink, letterSpacing: -0.5 },
  summaryValueAlert: { color: Colors.availNone },
  summaryLabel: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },

  chips: { paddingHorizontal: 20, gap: 8, paddingBottom: 12 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  chipActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  chipText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },
  chipTextActive: { color: Colors.white },
  chipCount: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.ink4 },

  scopeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingBottom: 12 },
  scopeText: { flex: 1, fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
});

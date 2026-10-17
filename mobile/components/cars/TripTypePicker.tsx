import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Fonts } from '../../constants/colors';
import { VEHICLE_USE_CASES, VEHICLE_USE_CASE_LABELS, type VehicleUseCase } from '../../lib/tripTypes';

/** Shown while no trip type is chosen. */
export const TRIP_TYPE_HINT = "Choose where you'll drive";

interface Props {
  value: VehicleUseCase | null;
  onSelect: (t: VehicleUseCase) => void;
  /** Show TRIP_TYPE_HINT under the chips while nothing is chosen. */
  showHint?: boolean;
}

// The required trip type as two one-tap chips (dark, same look as the package
// chips): "Udupi/Manipal" | "Out of Udupi". Single choice.
export default function TripTypePicker({ value, onSelect, showHint = true }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Trip type">
        {VEHICLE_USE_CASES.map((t) => {
          const active = value === t;
          return (
            <TouchableOpacity
              key={t}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => onSelect(t)}
              activeOpacity={0.85}
              accessibilityRole="radio"
              accessibilityLabel={VEHICLE_USE_CASE_LABELS[t]}
              accessibilityState={{ checked: active }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                {VEHICLE_USE_CASE_LABELS[t]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {showHint && !value ? <Text style={styles.hint}>{TRIP_TYPE_HINT}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: Colors.hairlineOnDark,
  },
  chipActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  chipText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.onDark },
  chipTextActive: { color: Colors.white },
  hint: { fontFamily: Fonts.bodyMedium, fontSize: 12, lineHeight: 17, color: Colors.orange },
});

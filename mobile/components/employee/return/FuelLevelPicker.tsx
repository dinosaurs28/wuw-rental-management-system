import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Fonts } from '../../../constants/colors';
import { FUEL_LEVELS, type FuelLevel } from '../../../types/return';

interface Props {
  value: FuelLevel | null;
  onChange: (level: FuelLevel) => void;
  disabled?: boolean;
}

export default function FuelLevelPicker({ value, onChange, disabled = false }: Props) {
  return (
    <View style={styles.row}>
      {FUEL_LEVELS.map((l) => {
        const active = value === l.value;
        return (
          <TouchableOpacity
            key={l.value}
            style={[styles.pill, active && styles.pillActive, disabled && styles.pillDisabled]}
            onPress={() => !disabled && onChange(l.value)}
            disabled={disabled}
            activeOpacity={0.8}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{l.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
  },
  pill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
  },
  pillActive: {
    backgroundColor: Colors.ink,
    borderColor: Colors.ink,
  },
  pillDisabled: { opacity: 0.5 },
  label: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink2,
  },
  labelActive: { color: Colors.white },
});

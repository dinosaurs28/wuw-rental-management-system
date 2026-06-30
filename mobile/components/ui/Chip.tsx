import type { ComponentProps } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface ChipProps {
  label: string;
  icon?: IconName;
  /** solid = on light surfaces; glass = over dark imagery */
  variant?: 'solid' | 'glass';
  /** render a colored status dot instead of an icon */
  dotColor?: string;
  style?: ViewStyle;
}

// Small pill used for branch / period / availability metadata.
export default function Chip({ label, icon, variant = 'solid', dotColor, style }: ChipProps) {
  const glass = variant === 'glass';
  return (
    <View style={[styles.base, glass ? styles.glass : styles.solid, style]}>
      {dotColor ? (
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
      ) : icon ? (
        <Ionicons name={icon} size={12} color={glass ? Colors.onDark : Colors.ink3} />
      ) : null}
      <Text style={[styles.label, glass ? styles.labelGlass : styles.labelSolid]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  solid: { backgroundColor: Colors.bg, borderColor: Colors.hairline },
  glass: { backgroundColor: Colors.glass, borderColor: Colors.glassHairline },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  label: { fontFamily: Fonts.bodyMedium, fontSize: 11.5, letterSpacing: 0.1 },
  labelSolid: { color: Colors.ink2 },
  labelGlass: { color: Colors.onDark },
});

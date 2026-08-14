import type { ComponentProps } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';

type IconName = ComponentProps<typeof Ionicons>['name'];
export type BadgeTone = 'good' | 'warn' | 'bad' | 'neutral' | 'info';

const TONES: Record<BadgeTone, { fg: string; bg: string }> = {
  good: { fg: Colors.availGood, bg: Colors.availGoodSoft },
  warn: { fg: Colors.availLow, bg: Colors.availLowSoft },
  bad: { fg: Colors.availNone, bg: Colors.availNoneSoft },
  neutral: { fg: Colors.ink2, bg: Colors.bg },
  info: { fg: Colors.orange, bg: Colors.orangeSoft },
};

interface Props {
  label: string;
  tone?: BadgeTone;
  icon?: IconName;
  style?: ViewStyle;
}

// Unified status pill (trip status, reservation state, availability, "starts in N days").
export default function StatusBadge({ label, tone = 'neutral', icon, style }: Props) {
  const c = TONES[tone];
  return (
    <View style={[styles.base, { backgroundColor: c.bg }, style]}>
      {icon ? <Ionicons name={icon} size={12} color={c.fg} /> : null}
      <Text style={[styles.label, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  label: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});

import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Fonts } from '../../constants/colors';

interface Props {
  presets: { label: string; hours: number }[];
  /** The preset the current range matches exactly (activePresetHours). */
  activeHours: number | null;
  /** Why a preset can't be used right now (outside branch hours, past the limit); null = usable. */
  issueFor?: (hours: number) => string | null;
  onSelect: (hours: number) => void;
  /** dark = on the dark search card / vehicle page; light = staff screens */
  tone?: 'dark' | 'light';
}

// One-tap rental lengths ("12 hours", "1 day") next to the date pickers. A
// preset that would break a rule is greyed out with the reason underneath.
export default function DurationChips({ presets, activeHours, issueFor, onSelect, tone = 'light' }: Props) {
  const dark = tone === 'dark';
  const issues = presets
    .map((p) => ({ label: p.label, issue: issueFor?.(p.hours) ?? null }))
    .filter((p): p is { label: string; issue: string } => !!p.issue);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {presets.map((p) => {
          const active = activeHours === p.hours;
          const blocked = !!issueFor?.(p.hours);
          return (
            <TouchableOpacity
              key={p.hours}
              style={[
                styles.chip,
                dark ? styles.chipDark : styles.chipLight,
                active && styles.chipActive,
                blocked && styles.chipBlocked,
              ]}
              onPress={() => onSelect(p.hours)}
              disabled={blocked}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: blocked }}
            >
              <Text
                style={[
                  styles.chipText,
                  dark ? styles.chipTextDark : styles.chipTextLight,
                  active && styles.chipTextActive,
                ]}
              >
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {issues.map((i) => (
        <Text key={i.label} style={[styles.issue, dark ? styles.issueDark : styles.issueLight]}>
          {i.label} unavailable — {i.issue}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  chipDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: Colors.hairlineOnDark },
  chipLight: { backgroundColor: Colors.bg, borderColor: Colors.hairline },
  chipActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  chipBlocked: { opacity: 0.4 },
  chipText: { fontFamily: Fonts.bodySemiBold, fontSize: 13 },
  chipTextDark: { color: Colors.onDark },
  chipTextLight: { color: Colors.ink2 },
  chipTextActive: { color: Colors.white },
  issue: { fontFamily: Fonts.body, fontSize: 12, lineHeight: 17 },
  issueDark: { color: Colors.onDarkMuted },
  issueLight: { color: Colors.ink3 },
});

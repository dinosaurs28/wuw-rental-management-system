import { useRef } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Fonts } from '../../constants/colors';
import type { PackageChoice } from '../../lib/packages';

interface Props {
  choices: PackageChoice[];
  /** The chosen package's hours; null = none chosen. */
  selectedHours: number | null;
  onSelect: (hours: number) => void;
  /** dark = the search card / vehicle page; light = checkout, trips and staff screens */
  tone?: 'dark' | 'light';
  /** Shown instead of the chips when no package is left. */
  emptyText?: string;
}

// Booking packages as one-tap chips: "12 hours", "1 day" … "15 days" (or
// "+12 hours", "+1 day" … for an extension). A package the branch can't take
// (its return falls outside office hours) is greyed out with the reason
// underneath; chips sharing a reason share one line.
export default function PackagePicker({ choices, selectedHours, onSelect, tone = 'light', emptyText }: Props) {
  const dark = tone === 'dark';
  const listRef = useRef<FlatList<PackageChoice>>(null);
  const scrolledFor = useRef<number | null>(null);

  if (choices.length === 0) {
    return emptyText ? <Text style={[styles.issue, dark ? styles.issueDark : styles.issueLight]}>{emptyText}</Text> : null;
  }

  // "12 hours unavailable — …", "6 days, 13 days unavailable — …"
  const reasons: { labels: string[]; issue: string }[] = [];
  for (const c of choices) {
    if (!c.issue) continue;
    const same = reasons.find((r) => r.issue === c.issue);
    if (same) same.labels.push(c.label);
    else reasons.push({ labels: [c.label], issue: c.issue });
  }

  return (
    <View style={styles.wrap}>
      <FlatList
        ref={listRef}
        horizontal
        data={choices}
        keyExtractor={(c) => String(c.hours)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        initialNumToRender={20}
        renderItem={({ item: c }) => {
          const active = selectedHours === c.hours;
          const blocked = !!c.issue;
          return (
            <TouchableOpacity
              style={[
                styles.chip,
                dark ? styles.chipDark : styles.chipLight,
                active && styles.chipActive,
                blocked && styles.chipBlocked,
              ]}
              onPress={() => onSelect(c.hours)}
              disabled={blocked}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={blocked ? `${c.label}, unavailable` : c.label}
              accessibilityState={{ selected: active, disabled: blocked }}
              // Bring the chosen package into view once it lays out.
              onLayout={(e) => {
                if (!active || scrolledFor.current === c.hours) return;
                scrolledFor.current = c.hours;
                listRef.current?.scrollToOffset({ offset: Math.max(0, e.nativeEvent.layout.x - 24), animated: false });
              }}
            >
              <Text
                style={[
                  styles.chipText,
                  dark ? styles.chipTextDark : styles.chipTextLight,
                  active && styles.chipTextActive,
                ]}
              >
                {c.label}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
      {reasons.map((r) => (
        <Text key={r.issue} style={[styles.issue, dark ? styles.issueDark : styles.issueLight]}>
          {r.labels.join(', ')} unavailable — {r.issue}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { gap: 8, paddingRight: 8 },
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

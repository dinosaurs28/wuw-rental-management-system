import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import type { BookingTimesNotice } from '../../lib/branchSchedule';

type Tone = 'dark' | 'light';

// Compact office-hours line under the booking pickers, e.g.
// "Branch hours 9:00 AM – 10:00 PM". Renders nothing without a text.
export function BranchHoursLine({ text, tone = 'light' }: { text: string | null; tone?: Tone }) {
  if (!text) return null;
  const dark = tone === 'dark';
  return (
    <View style={styles.line}>
      <Ionicons name="time-outline" size={13} color={dark ? Colors.onDarkMuted : Colors.ink3} />
      <Text style={[styles.lineText, dark ? styles.lineTextDark : styles.lineTextLight]}>{text}</Text>
    </View>
  );
}

// Amber note (grace / adjusted return) or red block (pickup outside hours,
// 15-day limit) for the chosen times. Renders nothing without a notice.
export function TimesNotice({ notice, tone = 'light' }: { notice: BookingTimesNotice | null; tone?: Tone }) {
  if (!notice) return null;
  const dark = tone === 'dark';
  const error = notice.tone === 'error';
  const color = error ? (dark ? '#fca5a5' : Colors.availNone) : dark ? '#fbbf24' : '#92400e';
  return (
    <View
      style={[
        styles.notice,
        error
          ? dark ? styles.noticeErrorDark : styles.noticeErrorLight
          : dark ? styles.noticeWarnDark : styles.noticeWarnLight,
      ]}
    >
      <Ionicons name={error ? 'alert-circle-outline' : 'information-circle-outline'} size={16} color={color} />
      <Text style={[styles.noticeText, { color }]}>{notice.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  lineText: { flex: 1, fontFamily: Fonts.body, fontSize: 12, lineHeight: 17 },
  lineTextDark: { color: Colors.onDarkMuted },
  lineTextLight: { color: Colors.ink3 },

  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, padding: 12, borderWidth: 1 },
  noticeErrorLight: { backgroundColor: Colors.availNoneSoft, borderColor: '#e53e3e30' },
  noticeWarnLight: { backgroundColor: Colors.availLowSoft, borderColor: '#d9770630' },
  noticeErrorDark: { backgroundColor: 'rgba(229,62,62,0.14)', borderColor: 'rgba(229,62,62,0.3)' },
  noticeWarnDark: { backgroundColor: 'rgba(217,119,6,0.14)', borderColor: 'rgba(217,119,6,0.3)' },
  noticeText: { flex: 1, fontFamily: Fonts.body, fontSize: 12.5, lineHeight: 18 },
});

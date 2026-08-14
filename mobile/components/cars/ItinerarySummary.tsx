import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { fmtDateTime } from '../../lib/dates';

interface Props {
  branchName?: string | null;
  start?: string | null;
  end?: string | null;
  onEdit: () => void;
}

// Compact "where + when" strip shown above results; tap to edit the search.
export default function ItinerarySummary({ branchName, start, end, onEdit }: Props) {
  return (
    <TouchableOpacity style={styles.card} onPress={onEdit} activeOpacity={0.8}>
      <View style={{ flex: 1 }}>
        {branchName ? (
          <View style={styles.row}>
            <Ionicons name="location-outline" size={13} color={Colors.ink2} />
            <Text style={styles.branch} numberOfLines={1}>{branchName}</Text>
          </View>
        ) : null}
        {start || end ? (
          <Text style={styles.dates} numberOfLines={1}>
            {fmtDateTime(start)} — {fmtDateTime(end)}
          </Text>
        ) : null}
      </View>
      <View style={styles.editBtn}>
        <Ionicons name="create-outline" size={15} color={Colors.ink} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  branch: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink, letterSpacing: -0.2 },
  dates: { fontFamily: Fonts.body, fontSize: 12.5, color: Colors.ink3, marginTop: 2 },
  editBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import { StyleSheet, Text, View } from 'react-native';
import { Colors, Fonts } from '../../constants/colors';
import { fmtDateTime } from '../../lib/dates';

interface Props {
  reservationNumber?: string | null;
  start?: string | null;
  end?: string | null;
}

// Reservation reference + pickup/return datetime timeline.
// Datetimes only — bookings carry no branch/station, so we never imply a location.
export default function ItineraryTimeline({ reservationNumber, start, end }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.title}>Your itinerary</Text>
      </View>
      {reservationNumber ? (
        <Text style={styles.ref}>Reservation no. {reservationNumber}</Text>
      ) : null}

      <View style={styles.timeline}>
        <View style={styles.point}>
          <View style={styles.dotOuter}>
            <View style={styles.dotInner} />
          </View>
          <View style={styles.line} />
        </View>
        <View style={styles.stop}>
          <Text style={styles.stopLabel}>Pick-up</Text>
          <Text style={styles.stopValue}>{fmtDateTime(start)}</Text>
        </View>
      </View>

      <View style={styles.timeline}>
        <View style={styles.point}>
          <View style={[styles.dotOuter, styles.dotOuterEnd]}>
            <View style={[styles.dotInner, styles.dotInnerEnd]} />
          </View>
        </View>
        <View style={[styles.stop, { paddingBottom: 0 }]}>
          <Text style={styles.stopLabel}>Return</Text>
          <Text style={styles.stopValue}>{fmtDateTime(end)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 18,
  },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontFamily: Fonts.displayBold, fontSize: 17, color: Colors.ink, letterSpacing: -0.4 },
  ref: { fontFamily: Fonts.body, fontSize: 12.5, color: Colors.ink3, marginTop: 4, marginBottom: 16 },
  timeline: { flexDirection: 'row', gap: 14 },
  point: { alignItems: 'center', width: 16 },
  dotOuter: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: Colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  dotOuterEnd: { borderColor: Colors.orange },
  dotInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.ink },
  dotInnerEnd: { backgroundColor: Colors.orange },
  line: { flex: 1, width: 2, backgroundColor: Colors.hairline, marginVertical: 2 },
  stop: { flex: 1, paddingBottom: 18 },
  stopLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3, textTransform: 'uppercase', letterSpacing: 0.8 },
  stopValue: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink, marginTop: 3, letterSpacing: -0.2 },
});

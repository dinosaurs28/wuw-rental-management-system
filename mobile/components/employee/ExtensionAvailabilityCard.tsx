import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EXTENSION_BUFFER_HOURS } from '../../lib/extensionBuffer';
import { Colors, Fonts } from '../../constants/colors';
import type { ExtensionCarAvailability } from '../../types/api';

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

// The tail of a booking id, as the Fleet screens show it: "…AB12CD34".
const shortRef = (ref: string) => `…${ref.slice(-8).toUpperCase()}`;

// The car's next booking and how far it can be extended, on every Extend
// Booking step: "Next booking on <reg>: <date, time> pickup" (or "No upcoming
// booking") and "Available to extend until <date, time>": 2 hours before
// that pickup, or the rental-length cap, saying which applies. Server figures
// only; renders nothing for an older server that doesn't send them.
export default function ExtensionAvailabilityCard({
  availability,
  maxBookingDays,
  afterExtension = false,
}: {
  availability: ExtensionCarAvailability | null | undefined;
  /** 30, or 180 for a monthly plan: names the cap when it is the limit. */
  maxBookingDays?: number;
  /** After the commit: availableUntil is how much further the car could still go. */
  afterExtension?: boolean;
}) {
  if (!availability?.availableUntil || !availability.limitReason) return null;
  const reg = availability.vehicleRegNo ?? 'This car';
  const buffer = availability.extensionBufferHours ?? EXTENSION_BUFFER_HOURS;
  const byNext = availability.limitReason === 'NEXT_BOOKING';
  // A booking lock: the car can be out right up to when it starts to act —
  // 00:00 the day before the lock (nextBookingStartAt), no buffer
  const isLock = availability.nextBookingKind === 'LOCK';
  const byLock = byNext && isLock;
  const lockText = `Locked: ${availability.nextLockReason ?? 'booking lock'}${
    availability.nextLockEndAt ? ` until ${fmt(availability.nextLockEndAt)}` : ''
  }`;
  const limitText = byLock
    ? '1 day before the booking lock starts'
    : byNext
    ? `${buffer} h before the next pickup`
    : maxBookingDays
      ? `${maxBookingDays}-day rental limit`
      : 'Rental-length limit';

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Ionicons name="calendar-outline" size={16} color={Colors.ink3} />
        <View style={styles.body}>
          <Text style={styles.label}>Next booking on {availability.vehicleRegNo ?? 'this car'}</Text>
          <Text style={styles.value}>
            {availability.nextBookingStartAt
              ? `${fmt(availability.nextBookingStartAt)} ${isLock ? 'locked from' : 'pickup'}`
              : 'No upcoming booking'}
          </Text>
          {availability.nextBookingStartAt && isLock ? (
            <Text style={styles.sub}>{lockText}</Text>
          ) : availability.nextBookingStartAt && availability.nextBookingRef ? (
            <Text style={styles.sub}>
              {availability.nextBookingKind === 'HOLD' ? 'Customer checkout in progress' : 'Booking'}{' '}
              {shortRef(availability.nextBookingRef)}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.divider} />

      {availability.canExtend === false ? (
        <View style={styles.warn}>
          <Ionicons name="alert-circle-outline" size={16} color="#92400e" />
          <Text style={styles.warnText}>
            {byLock
              ? afterExtension
                ? `${reg} can't go any further: it is locked for bookings from the new return (${lockText}).`
                : `${reg} can't be extended: it is locked for bookings from the current return (${lockText}). A swap to another car may still be offered.`
              : byNext
              ? afterExtension
                ? `${reg} can't go any further: its next booking picks up within ${buffer} h of the new return.`
                : `${reg} can't be extended: its next booking picks up within ${buffer} h of the current return. A swap to another car may still be offered.`
              : afterExtension
                ? `The ${limitText.toLowerCase()} has been reached.`
                : `This booking is at the ${limitText.toLowerCase()}.`}
          </Text>
        </View>
      ) : (
        <View style={styles.row}>
          <Ionicons name="time-outline" size={16} color={Colors.orange} />
          <View style={styles.body}>
            <Text style={styles.label}>{afterExtension ? 'Could go further until' : 'Available to extend until'}</Text>
            <Text style={[styles.value, styles.valueAccent]}>{fmt(availability.availableUntil)}</Text>
            <Text style={styles.sub}>{limitText}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.hairline, padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  body: { flex: 1, gap: 2 },
  label: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  value: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  valueAccent: { color: Colors.orange },
  sub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  divider: { height: 1, backgroundColor: Colors.hairline },
  warn: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, padding: 12, borderWidth: 1,
    backgroundColor: Colors.availLowSoft, borderColor: '#d9770630',
  },
  warnText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, lineHeight: 18, color: '#92400e' },
});

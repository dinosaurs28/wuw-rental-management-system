import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { fmtIstShort, rentalMinutesLabel } from '../../../lib/dates';
import type { RentalTimeline, RentalTimelineExtension } from '../../../types/return';

// "Rental time" rows for the drop screen's Booking card (#7): the booked
// window as originally agreed, the time added by formal extensions, any late
// return beyond the current end, and the total — exact minutes, never rounded.

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function Row({
  icon, label, value, valueColor, strong,
}: { icon: IoniconName; label: string; value: string; valueColor?: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Ionicons name={icon} size={15} color={Colors.ink3} />
        <Text style={[styles.label, strong && styles.labelStrong]}>{label}</Text>
      </View>
      <Text style={[styles.value, strong && styles.valueStrong, valueColor ? { color: valueColor } : undefined]}>
        {value}
      </Text>
    </View>
  );
}

function Tag({ text, tone }: { text: string; tone: 'ok' | 'warn' | 'muted' }) {
  return (
    <View style={[styles.tag, tone === 'ok' ? styles.tagOk : tone === 'warn' ? styles.tagWarn : styles.tagMuted]}>
      <Text style={[styles.tagText, tone === 'ok' ? styles.tagTextOk : tone === 'warn' ? styles.tagTextWarn : styles.tagTextMuted]}>
        {text}
      </Text>
    </View>
  );
}

function ExtensionLine({ ext }: { ext: RentalTimelineExtension }) {
  return (
    <View style={styles.extLine}>
      <Text style={styles.extText}>
        {fmtIstShort(ext.oldEndAt)} → {fmtIstShort(ext.newEndAt)} · +{rentalMinutesLabel(ext.minutes)}
        {ext.freeKm
          ? ` · ${ext.freeKm.km > 0 ? `+${ext.freeKm.km.toLocaleString('en-IN')} free km` : 'no extra free km'}`
          : ''}
      </Text>
      <View style={styles.tagRow}>
        {ext.unpaid ? (
          <Tag text="Unpaid" tone="warn" />
        ) : ext.awaitingConfirmation ? (
          <Tag text="Awaiting manager" tone="warn" />
        ) : (
          <Tag text="Confirmed" tone="ok" />
        )}
        {ext.isPartial && <Tag text="Partial" tone="muted" />}
      </View>
    </View>
  );
}

// Grace note for the late-return row, from the policy the server applied.
function graceNote(t: RentalTimeline): string | null {
  if (!t.gracePolicyEnabled || t.graceMinutes <= 0) return 'No grace period';
  if (t.graceApplied) return `${rentalMinutesLabel(t.graceMinutes)} grace applied`;
  if (t.graceType === 'MANUAL') return `${rentalMinutesLabel(t.graceMinutes)} grace — staff can apply it`;
  return null;
}

export default function RentalTimeBlock({ timeline }: { timeline: RentalTimeline }) {
  const extended = timeline.extensionCount > 0 || timeline.extendedMinutes > 0;
  const late = timeline.lateMinutes > 0;
  const note = late ? graceNote(timeline) : null;

  return (
    <View style={styles.block}>
      <Text style={styles.heading}>Rental time</Text>
      {extended ? (
        <>
          <Row icon="time-outline" label="Original rental" value={rentalMinutesLabel(timeline.originalMinutes)} />
          <Row
            icon="add-circle-outline"
            label={timeline.extensionCount > 1 ? `Extended (${timeline.extensionCount}×)` : 'Extended'}
            value={`+${rentalMinutesLabel(timeline.extendedMinutes)}`}
            valueColor={Colors.orange}
          />
          {timeline.extensions.map((ext) => (
            <ExtensionLine key={ext.publicId} ext={ext} />
          ))}
          {timeline.extensionFreeKmTotal != null && timeline.extensions.length > 0 ? (
            <>
              <Row
                icon="speedometer-outline"
                label="Free km from extensions"
                value={`+${timeline.extensionFreeKmTotal.toLocaleString('en-IN')} km`}
              />
              <Text style={styles.subNote}>Whole days and 12-hour blocks only — extra hours add none</Text>
            </>
          ) : null}
        </>
      ) : (
        <Row
          icon="time-outline"
          label="Rental length"
          value={`${rentalMinutesLabel(timeline.totalMinutes)} · Not extended`}
        />
      )}
      {late && (
        <>
          <Row
            icon="alert-circle-outline"
            label="Late return"
            value={`+${rentalMinutesLabel(timeline.lateMinutes)}`}
            valueColor="#dc3545"
          />
          <Text style={styles.subNote}>
            Due {fmtIstShort(timeline.currentEndAt)}
            {timeline.returnedAt ? ` · as of ${fmtIstShort(timeline.returnedAt)}` : ''}
            {note ? ` · ${note}` : ''}
          </Text>
        </>
      )}
      {(extended || late) && (
        <>
          <View style={styles.rule} />
          <Row
            icon="hourglass-outline"
            label="Total time"
            value={rentalMinutesLabel(late ? timeline.totalWithLateMinutes : timeline.totalMinutes)}
            strong
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  heading: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3, textTransform: 'uppercase', letterSpacing: 0.8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  labelStrong: { fontFamily: Fonts.bodySemiBold, color: Colors.ink },
  value: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink, flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  valueStrong: { fontSize: 15 },
  extLine: { marginLeft: 23, gap: 4, paddingBottom: 2 },
  extText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink2 },
  tagRow: { flexDirection: 'row', gap: 6 },
  tag: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  tagOk: { backgroundColor: Colors.availGoodSoft },
  tagWarn: { backgroundColor: Colors.availLowSoft },
  tagMuted: { backgroundColor: Colors.bg },
  tagText: { fontFamily: Fonts.bodySemiBold, fontSize: 10 },
  tagTextOk: { color: Colors.availGood },
  tagTextWarn: { color: Colors.availLow },
  tagTextMuted: { color: Colors.ink3 },
  subNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginLeft: 23 },
  rule: { height: 1, backgroundColor: Colors.hairline, marginVertical: 2 },
});

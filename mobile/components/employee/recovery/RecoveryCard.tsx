import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { fmtDurationMinutes, fmtIstDateTime } from '../../../lib/dates';
import { DlStatusLine } from '../DlStatus';
import {
  STATE_LOOK,
  callPhone,
  isVehicleBack,
  liveOverdueMinutes,
  liveReturnState,
  openWhatsAppReminder,
  type RecoveryRow,
} from './recoveryUtils';

const EXTENSION_STATUS_LABEL: Record<'PENDING_PAYMENT' | 'PAYMENT_COLLECTED', string> = {
  PENDING_PAYMENT: 'awaiting payment',
  PAYMENT_COLLECTED: 'awaiting manager',
};

function PhoneLink({ phone, label }: { phone: string; label?: string }) {
  return (
    <TouchableOpacity style={styles.phoneLink} onPress={() => callPhone(phone)} hitSlop={8} activeOpacity={0.7}>
      <Ionicons name="call-outline" size={13} color={Colors.orange} />
      <Text style={styles.phoneText}>{label ? `${label} ${phone}` : phone}</Text>
    </TouchableOpacity>
  );
}

export function RecoveryCard({ row, now }: { row: RecoveryRow; now: number }) {
  const router = useRouter();
  const minutes = liveOverdueMinutes(row, now);
  const state = liveReturnState(row, minutes);
  const look = STATE_LOOK[state];
  const vehicleBack = isVehicleBack(state);
  // The legacy drop is already done and waits for the manager's confirmation;
  // opening the drop again would restart it, so the row is read-only.
  const canOpen = state !== 'AWAITING_MANAGER_CONFIRMATION';
  const [first, ...more] = row.vehicles;
  const { name, phone, alternatePhone, drivingLicenceNumber } = row.customer;
  const canWhatsApp = !!(phone || alternatePhone);

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      disabled={!canOpen}
      onPress={() => router.push(`/employee/return/${row.publicId}`)}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardVehicle}>
          <Text style={styles.vehicleName} numberOfLines={2}>
            {first ? `${first.make} ${first.model}` : 'Vehicle'}
          </Text>
          {first?.regNo ? <Text style={styles.regNo} numberOfLines={1}>{first.regNo}</Text> : null}
          {more.map((v) => (
            <Text key={v.publicId} style={styles.regNo} numberOfLines={1}>
              + {v.make} {v.model} · {v.regNo}
            </Text>
          ))}
        </View>
        <View style={[styles.statusBadge, { backgroundColor: look.bg }]}>
          <Text style={[styles.statusText, { color: look.color }]}>{look.label}</Text>
        </View>
      </View>

      <View style={[styles.lateRow, { backgroundColor: look.bg }]}>
        <Ionicons name="alarm-outline" size={15} color={look.color} />
        <Text style={[styles.lateText, { color: look.color }]}>
          {vehicleBack ? `Was due ${fmtDurationMinutes(minutes)} ago` : `Late by ${fmtDurationMinutes(minutes)}`}
        </Text>
        {state === 'IN_GRACE' && row.graceMinutes != null ? (
          <Text style={styles.lateSub}>
            · grace ends in {fmtDurationMinutes(Math.max(1, row.graceMinutes - minutes))}
          </Text>
        ) : null}
      </View>

      <View style={styles.cardMeta}>
        <View style={styles.metaRow}>
          <Ionicons name="person-outline" size={13} color={Colors.ink3} />
          <Text style={styles.metaText}>{name ?? '—'}</Text>
        </View>
        {phone || alternatePhone ? (
          <View style={[styles.metaRow, styles.phoneRow]}>
            {phone ? <PhoneLink phone={phone} /> : null}
            {alternatePhone ? <PhoneLink phone={alternatePhone} label="Alt" /> : null}
          </View>
        ) : null}
        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={13} color={Colors.ink3} />
          <Text style={styles.metaText}>
            Expected return: {row.endAtDisplay || fmtIstDateTime(row.endAt)}
          </Text>
        </View>
        {drivingLicenceNumber ? (
          <View style={styles.metaRow}>
            <Ionicons name="id-card-outline" size={13} color={Colors.ink3} />
            <Text style={styles.metaText}>DL {drivingLicenceNumber}</Text>
          </View>
        ) : null}
        {/* Original driving licence status — what to hand back when the car comes in */}
        <DlStatusLine status={row.dlStatus} note={row.dlDepositNote} />
        {row.originalEndAt ? (
          <View style={styles.metaRow}>
            <Ionicons name="refresh-outline" size={13} color={Colors.ink3} />
            <Text style={styles.metaSub}>
              Extended {row.extensionCount > 1 ? `${row.extensionCount} times ` : ''}from {fmtIstDateTime(row.originalEndAt)}
            </Text>
          </View>
        ) : null}
        {row.pendingExtension ? (
          <View style={styles.extTag}>
            <Ionicons name="hourglass-outline" size={12} color={Colors.availLow} />
            <Text style={styles.extTagText}>
              Extension to {fmtIstDateTime(row.pendingExtension.requestedEndAt)} ·{' '}
              {EXTENSION_STATUS_LABEL[row.pendingExtension.status] ?? 'pending'}
            </Text>
          </View>
        ) : row.extensionPending ? (
          <View style={styles.extTag}>
            <Ionicons name="hourglass-outline" size={12} color={Colors.availLow} />
            <Text style={styles.extTagText}>Extension pending</Text>
          </View>
        ) : null}
        {state === 'RETURN_IN_PROGRESS' ? (
          <Text style={styles.metaSub}>The vehicle is back. The drop bill is being settled.</Text>
        ) : state === 'AWAITING_MANAGER_CONFIRMATION' ? (
          <Text style={styles.metaSub}>The vehicle is back. Waiting for the branch manager to confirm the return.</Text>
        ) : null}
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.footerLeft}>
          <Text style={styles.bookingId}>#{row.publicId.slice(-8).toUpperCase()}</Text>
          {row.bookingType === 'MONTHLY' ? (
            <View style={styles.monthlyPill}>
              <Text style={styles.monthlyPillText}>Monthly{row.days ? ` · ${row.days} days` : ''}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.actions}>
          {canWhatsApp && !vehicleBack ? (
            <TouchableOpacity
              style={styles.waBtn}
              onPress={() => openWhatsAppReminder(row)}
              activeOpacity={0.8}
              hitSlop={6}
            >
              <Ionicons name="logo-whatsapp" size={15} color="#128c7e" />
              <Text style={styles.waText}>Remind</Text>
            </TouchableOpacity>
          ) : null}
          {canOpen ? (
            <View style={styles.actionRow}>
              <Text style={styles.actionText}>
                {state === 'RETURN_IN_PROGRESS' ? 'Continue return' : 'Process return'}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.orange} />
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 12,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  cardVehicle: { flex: 1, gap: 2, minWidth: 0 },
  vehicleName: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.ink },
  regNo: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  statusBadge: { flexShrink: 0, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontFamily: Fonts.bodySemiBold, fontSize: 11 },

  lateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  lateText: { fontFamily: Fonts.bodySemiBold, fontSize: 14 },
  lateSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.availLow },

  cardMeta: { gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { flexShrink: 1, fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2 },
  metaSub: { flexShrink: 1, fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  phoneRow: { flexWrap: 'wrap', columnGap: 14, rowGap: 6 },
  phoneLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  phoneText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.orange },

  extTag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.availLowSoft,
  },
  extTagText: { flexShrink: 1, fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.availLow },

  monthlyPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: '#7c3aed14' },
  monthlyPillText: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: '#7c3aed' },

  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  bookingId: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.orange },
  waBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#25d36618',
  },
  waText: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: '#128c7e' },
});

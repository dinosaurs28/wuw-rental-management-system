import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { fmtIstDateTime } from '../../../lib/dates';
import StatusBadge from '../../ui/StatusBadge';
import type { RentRow } from '../../../types/customers';
import { inr, isPositive, rentStatus, shortRef, vehicleLine } from './format';

/** One rent of the customer (any branch); tap for the amount breakdown and payments. */
export function RentCard({ r, onPress }: { r: RentRow; onPress: () => void }) {
  const status = rentStatus(r);
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.top}>
        <View style={styles.vehicle}>
          <Text style={styles.vehicleName} numberOfLines={2}>{vehicleLine(r.vehicles)}</Text>
          <Text style={styles.ref} numberOfLines={1}>
            {r.vehicles.map((v) => v.regNo).join(', ')}
            {r.vehicles.length ? ' · ' : ''}
            {shortRef(r.publicId)}
          </Text>
        </View>
        <StatusBadge label={status.label} tone={status.tone} />
      </View>

      <View style={styles.pills}>
        <Text style={styles.pill}>{r.source === 'COUNTER' ? 'Walk-in' : 'Online'}</Text>
        {r.type === 'MONTHLY' ? <Text style={[styles.pill, styles.pillMonthly]}>Monthly</Text> : null}
      </View>

      <View style={styles.line}>
        <Ionicons name="calendar-outline" size={14} color={Colors.ink3} />
        <Text style={styles.lineText}>
          {fmtIstDateTime(r.startAt)} → {fmtIstDateTime(r.endAt)}
        </Text>
      </View>
      {r.returnedAt ? (
        <View style={styles.line}>
          <Ionicons name="checkmark-done-outline" size={14} color={Colors.ink3} />
          <Text style={styles.lineText}>Returned {fmtIstDateTime(r.returnedAt)}</Text>
        </View>
      ) : null}
      <View style={styles.line}>
        <Ionicons name="location-outline" size={14} color={Colors.ink3} />
        <Text style={styles.lineText}>
          {r.branch.name}
          {r.isOwnBranch ? ' (yours)' : ''}
          {r.extensionCount > 0 ? ` · ${r.extensionCount} extension${r.extensionCount > 1 ? 's' : ''}` : ''}
        </Text>
      </View>

      <View style={styles.bottom}>
        <View style={styles.money}>
          <Text style={styles.moneyText}>Paid {inr(r.amounts.paid)}</Text>
          {isPositive(r.amounts.pendingConfirmation) ? (
            <Text style={styles.moneyText}>Awaiting confirmation {inr(r.amounts.pendingConfirmation)}</Text>
          ) : null}
          {isPositive(r.amounts.creditPending) ? (
            <Text style={[styles.moneyText, styles.credit]}>Credit pending {inr(r.amounts.creditPending)}</Text>
          ) : null}
        </View>
        <View style={styles.total}>
          <Text style={styles.totalLabel}>RENT AMOUNT</Text>
          <Text style={styles.totalValue}>{inr(r.amounts.totalFinal)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 14,
    gap: 7,
  },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  vehicle: { flex: 1, minWidth: 0 },
  vehicleName: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  ref: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.ink3, marginTop: 2 },
  pills: { flexDirection: 'row', gap: 6 },
  pill: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 11,
    color: Colors.ink2,
    backgroundColor: Colors.bg,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  pillMonthly: { backgroundColor: '#f3e8ff', color: '#7e22ce' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lineText: { flex: 1, fontFamily: Fonts.body, fontSize: 12.5, color: Colors.ink2 },
  bottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, marginTop: 2 },
  money: { flex: 1, gap: 2 },
  moneyText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },
  credit: { fontFamily: Fonts.bodySemiBold, color: '#c2410c' },
  total: {
    alignItems: 'flex-end',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ff6a1f40',
    backgroundColor: '#fff7f2',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  totalLabel: { fontFamily: Fonts.bodyMedium, fontSize: 9.5, color: Colors.orange, letterSpacing: 0.6 },
  totalValue: { fontFamily: Fonts.bodyBold, fontSize: 15, color: '#c2410c' },
});

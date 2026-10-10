import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { fmtDate } from '../../../lib/dates';
import type { CustomerRow } from '../../../types/customers';
import { inr, isPositive } from './format';

/** One row of the Customers list — the fields the branch manager's list shows. */
export function CustomerCard({ c, onPress }: { c: CustomerRow; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.top}>
        <View style={[styles.avatar, c.isBlacklisted && styles.avatarBlocked]}>
          <Text style={styles.avatarText}>{c.name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
          <Text style={styles.contact} numberOfLines={1}>
            {c.phone}
            {c.email ? ` · ${c.email}` : ''}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />
      </View>

      {c.isBlacklisted || !c.isProfileCompleted ? (
        <View style={styles.badges}>
          {c.isBlacklisted ? (
            <View style={[styles.badge, styles.badgeBlocked]}>
              <Ionicons name="ban-outline" size={11} color={Colors.white} />
              <Text style={[styles.badgeText, { color: Colors.white }]}>Blacklisted</Text>
            </View>
          ) : null}
          {!c.isProfileCompleted ? (
            <View style={[styles.badge, styles.badgeAmber]}>
              <Text style={[styles.badgeText, { color: Colors.availLow }]}>Profile incomplete</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {c.isBlacklisted && c.blacklistReason ? (
        <Text style={styles.reason} numberOfLines={2}>Reason: {c.blacklistReason}</Text>
      ) : null}

      <View style={styles.counts}>
        <Text style={[styles.count, styles.countUpcoming]}>Upcoming {c.rents.upcoming}</Text>
        <Text style={[styles.count, styles.countActive]}>Active {c.rents.active}</Text>
        <Text style={[styles.count, styles.countPast]}>Past {c.rents.past}</Text>
        {isPositive(c.pendingCredit) ? (
          <Text style={[styles.count, styles.countCredit]}>Credit pending {inr(c.pendingCredit)}</Text>
        ) : null}
      </View>

      <Text style={styles.dates}>
        Registered {fmtDate(c.registeredAt)}
        {c.lastRentAt ? ` · Last rent ${fmtDate(c.lastRentAt)}` : ''}
      </Text>
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
    gap: 8,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBlocked: { backgroundColor: Colors.availNone },
  avatarText: { fontFamily: Fonts.displayBold, fontSize: 17, color: Colors.white },
  info: { flex: 1, minWidth: 0 },
  name: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  contact: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, marginTop: 2 },

  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeBlocked: { backgroundColor: Colors.availNone },
  badgeAmber: { backgroundColor: Colors.availLowSoft },
  badgeText: { fontFamily: Fonts.bodySemiBold, fontSize: 10.5, letterSpacing: 0.3, textTransform: 'uppercase' },
  reason: { fontFamily: Fonts.body, fontSize: 12, color: Colors.availNone },

  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  count: { fontFamily: Fonts.bodyMedium, fontSize: 11.5, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' },
  countUpcoming: { backgroundColor: '#eff6ff', color: '#1d4ed8' },
  countActive: { backgroundColor: Colors.availGoodSoft, color: Colors.availGood },
  countPast: { backgroundColor: Colors.bg, color: Colors.ink2 },
  countCredit: { backgroundColor: '#fff7f2', color: '#c2410c', fontFamily: Fonts.bodySemiBold },

  dates: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.ink3 },
});

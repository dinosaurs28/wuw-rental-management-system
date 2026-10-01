import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationFeed,
  useNotificationSession,
  useUnreadNotificationCount,
} from '../../hooks/useNotifications';
import { notificationTimeLabel, openNotificationTarget } from '../../lib/notifications';
import { apiErrorMessage } from '../../lib/counterErrors';
import type { AppNotification, NotificationAudience } from '../../types/notifications';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const GREEN = Colors.availGood;
const AMBER = Colors.availLow;
const RED = Colors.availNone;

// Unknown (newer) types fall back to a plain bell.
function visualFor(item: AppNotification): { icon: IoniconName; color: string } {
  switch (item.type) {
    case 'BOOKING_CONFIRMED':         return { icon: 'checkmark-circle-outline', color: GREEN };
    case 'BOOKING_CANCELLED':         return { icon: 'close-circle-outline', color: RED };
    case 'BOOKING_DISPLACED':         return { icon: 'swap-horizontal-outline', color: AMBER };
    case 'PAYMENT_NEEDS_REFUND':      return { icon: 'card-outline', color: AMBER };
    case 'REFUND_COMPLETED':          return { icon: 'cash-outline', color: GREEN };
    case 'EXTENSION_CONFIRMED':       return { icon: 'time-outline', color: GREEN };
    case 'EXTENSION_REJECTED':        return { icon: 'time-outline', color: RED };
    case 'PICKUP_COMPLETED':          return { icon: 'key-outline', color: Colors.orange };
    case 'PICKUP_APPROVAL_REQUESTED': return { icon: 'key-outline', color: AMBER };
    case 'RETURN_COMPLETED':          return { icon: 'flag-outline', color: GREEN };
    case 'RETURN_APPROVAL_REQUESTED': return { icon: 'flag-outline', color: AMBER };
    case 'RETURN_OVERDUE':            return { icon: 'alarm-outline', color: RED };
    case 'DAMAGE_REPORTED':           return { icon: 'construct-outline', color: AMBER };
    case 'DAMAGE_CHARGED':            return { icon: 'construct-outline', color: RED };
    case 'VEHICLE_SWAPPED':           return { icon: 'car-sport-outline', color: Colors.orange };
    case 'APPROVAL_REQUESTED':        return { icon: 'hourglass-outline', color: AMBER };
    case 'APPROVAL_RESOLVED':
      return item.data?.approved === false
        ? { icon: 'close-circle-outline', color: RED }
        : { icon: 'checkmark-done-outline', color: GREEN };
    case 'CASH_DELAYED':              return { icon: 'cash-outline', color: AMBER };
    case 'SHIFT_DISCREPANCY':         return { icon: 'alert-circle-outline', color: AMBER };
    default:                          return { icon: 'notifications-outline', color: Colors.ink3 };
  }
}

// Customers can only be taken to a booking; Fleet always lands somewhere
// (the booking, or the bookings tab).
function hasTarget(audience: NotificationAudience, item: AppNotification): boolean {
  return audience === 'STAFF' || !!item.data?.bookingPublicId;
}

const EMPTY_COPY: Record<NotificationAudience, string> = {
  CUSTOMER: 'Booking confirmations, pickup and return updates and payment alerts will show up here.',
  STAFF: 'New bookings, overdue returns, vehicle swaps and manager decisions for your branch will show up here.',
};

/**
 * The notifications screen, shared by customers (app/notifications.tsx) and
 * Fleet Executives (app/employee/notifications.tsx). Tapping a row marks it
 * read and opens what it is about.
 */
export default function NotificationInbox() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { audience } = useNotificationSession();
  const unread = useUnreadNotificationCount();
  const feed = useNotificationFeed();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const [pulling, setPulling] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const items: AppNotification[] = (feed.data?.pages ?? []).flatMap((p) => p.items);

  const onRefresh = async () => {
    setPulling(true);
    try {
      await feed.refetch();
    } finally {
      setPulling(false);
    }
  };

  const onEndReached = () => {
    if (feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage();
  };

  const onPressItem = async (item: AppNotification) => {
    if (openingId) return;
    if (!item.readAt) markRead.mutate(item.publicId);
    if (!hasTarget(audience, item)) return;
    setOpeningId(item.publicId);
    try {
      await openNotificationTarget(audience, item.type, item.data);
    } finally {
      setOpeningId(null);
    }
  };

  const renderItem = ({ item }: { item: AppNotification }) => {
    const isUnread = !item.readAt;
    const { icon, color } = visualFor(item);
    const opening = openingId === item.publicId;
    return (
      <TouchableOpacity
        style={[styles.card, isUnread && styles.cardUnread]}
        onPress={() => onPressItem(item)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`${isUnread ? 'Unread. ' : ''}${item.title}. ${item.body}`}
      >
        <View style={[styles.iconWrap, { backgroundColor: `${color}14` }]}>
          <Ionicons name={icon} size={20} color={color} />
        </View>
        <View style={styles.cardBody}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, isUnread && styles.titleUnread]} numberOfLines={2}>
              {item.title}
            </Text>
            {isUnread ? <View style={styles.unreadDot} /> : null}
          </View>
          <Text style={styles.body}>{item.body}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.time}>{notificationTimeLabel(item.createdAt)}</Text>
            {opening ? (
              <ActivityIndicator size="small" color={Colors.orange} />
            ) : hasTarget(audience, item) ? (
              <Ionicons name="chevron-forward" size={15} color={Colors.ink4} />
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace(audience === 'STAFF' ? '/(employee)/dashboard' : '/(tabs)')
          }
          style={styles.backBtn}
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={{ width: 36 }} />
      </View>

      {feed.isLoading ? (
        <ActivityIndicator style={styles.loader} color={Colors.orange} size="large" />
      ) : feed.isError && items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Could not load</Text>
          <Text style={styles.emptySub}>
            {apiErrorMessage(feed.error, 'Could not load notifications. Please try again.')}
          </Text>
          <TouchableOpacity onPress={() => feed.refetch()}>
            <Text style={styles.retry}>Tap to retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.publicId}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: 24 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={Colors.orange} />
          }
          ListHeaderComponent={
            items.length > 0 ? (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryText}>
                  {unread > 0 ? `${unread} unread` : 'All caught up'}
                </Text>
                {unread > 0 ? (
                  <TouchableOpacity
                    onPress={() => markAll.mutate()}
                    disabled={markAll.isPending}
                    hitSlop={8}
                    style={styles.markAllBtn}
                  >
                    {markAll.isPending ? (
                      <ActivityIndicator size="small" color={Colors.orange} />
                    ) : (
                      <>
                        <Ionicons name="checkmark-done-outline" size={15} color={Colors.orange} />
                        <Text style={styles.markAllText}>Mark all read</Text>
                      </>
                    )}
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name="notifications-outline" size={30} color={Colors.ink4} />
              </View>
              <Text style={styles.emptyTitle}>No notifications yet</Text>
              <Text style={styles.emptySub}>{EMPTY_COPY[audience]}</Text>
            </View>
          }
          ListFooterComponent={
            feed.isFetchingNextPage ? (
              <ActivityIndicator style={styles.footerLoader} color={Colors.orange} />
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.ink, letterSpacing: -0.3 },
  loader: { marginTop: 60 },
  footerLoader: { marginVertical: 16 },
  list: { padding: 20, gap: 10 },

  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  summaryText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  markAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 24 },
  markAllText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.orange },

  card: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 14,
  },
  cardUnread: { backgroundColor: '#fffaf6', borderColor: '#ff6a1f33' },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  title: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink, lineHeight: 19 },
  titleUnread: { fontFamily: Fonts.bodySemiBold },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.orange, marginTop: 5 },
  body: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, lineHeight: 19 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  time: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3 },

  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40, gap: 8 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 20, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.hairline, alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  emptyTitle: { fontFamily: Fonts.display, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  emptySub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, textAlign: 'center', lineHeight: 20 },
  retry: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange, marginTop: 8 },
});

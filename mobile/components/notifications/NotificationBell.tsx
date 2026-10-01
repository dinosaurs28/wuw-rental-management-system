import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { useNotificationSession, useUnreadNotificationCount } from '../../hooks/useNotifications';
import { notificationsScreenHref, unreadBadgeLabel } from '../../lib/notifications';

/**
 * Header bell with the unread count (capped at 9+). Opens the signed-in
 * user's inbox; renders nothing for guests.
 */
export default function NotificationBell({ style }: { style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const { audience, enabled } = useNotificationSession();
  const count = useUnreadNotificationCount();
  if (!enabled) return null;

  const label = unreadBadgeLabel(count);
  return (
    <TouchableOpacity
      style={[styles.btn, style]}
      onPress={() => router.push(notificationsScreenHref(audience))}
      activeOpacity={0.8}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
    >
      <Ionicons name={count > 0 ? 'notifications' : 'notifications-outline'} size={20} color={Colors.ink2} />
      {label ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{label}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: Colors.orange,
    borderWidth: 2,
    borderColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: Fonts.bodyBold, fontSize: 9, color: Colors.white, lineHeight: 11 },
});

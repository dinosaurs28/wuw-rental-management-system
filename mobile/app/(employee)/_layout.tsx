import { Tabs } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { useUnreadNotificationCount } from '../../hooks/useNotifications';
import { unreadBadgeLabel } from '../../lib/notifications';
import { useRecoveryCount } from '../../components/employee/recovery/useRecovery';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TABS: { name: string; icon: IoniconName; activeIcon: IoniconName }[] = [
  { name: 'dashboard', icon: 'home-outline',        activeIcon: 'home' },
  { name: 'bookings',  icon: 'calendar-outline',    activeIcon: 'calendar' },
  { name: 'recovery',  icon: 'alarm-outline',       activeIcon: 'alarm' },
  { name: 'scan',      icon: 'qr-code-outline',     activeIcon: 'qr-code' },
  { name: 'profile',   icon: 'person-outline',      activeIcon: 'person' },
];

function TabIcon({ focused, icon, activeIcon }: { focused: boolean; icon: IoniconName; activeIcon: IoniconName }) {
  return (
    <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
      <Ionicons
        name={focused ? activeIcon : icon}
        size={22}
        color={focused ? Colors.orange : Colors.ink3}
      />
    </View>
  );
}

// Height of the tab row itself, above the system navigation.
const TAB_ROW_HEIGHT = Platform.OS === 'ios' ? 50 : 56;

export default function EmployeeTabLayout() {
  // A fixed height overrides the bar's own safe-area sizing, so the bottom
  // inset (Android 3-button navigation, iPhone home indicator) is added back.
  const insets = useSafeAreaInsets();
  // Unread notifications (#19) badge the Profile tab, where the inbox lives.
  const unreadBadge = unreadBadgeLabel(useUnreadNotificationCount());
  // Rentals not back after their return time badge the Recovery tab.
  const recoveryBadge = unreadBadgeLabel(useRecoveryCount());
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: Colors.white,
          borderTopWidth: 1,
          borderTopColor: Colors.hairline,
          height: TAB_ROW_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarItemStyle: { paddingVertical: 6 },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            tabBarIcon: ({ focused }) => (
              <TabIcon focused={focused} icon={tab.icon} activeIcon={tab.activeIcon} />
            ),
            ...(tab.name === 'profile'
              ? { tabBarBadge: unreadBadge, tabBarBadgeStyle: styles.badge }
              : tab.name === 'recovery'
                ? { tabBarBadge: recoveryBadge, tabBarBadgeStyle: styles.recoveryBadge }
                : null),
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 48,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: { backgroundColor: '#ff6a1f14' },
  badge: {
    backgroundColor: Colors.orange,
    color: Colors.white,
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
  },
  recoveryBadge: {
    backgroundColor: Colors.availNone,
    color: Colors.white,
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
  },
});

import { Tabs } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TABS: { name: string; icon: IoniconName; activeIcon: IoniconName }[] = [
  { name: 'dashboard', icon: 'home-outline',        activeIcon: 'home' },
  { name: 'bookings',  icon: 'calendar-outline',    activeIcon: 'calendar' },
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

export default function EmployeeTabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: Colors.white,
          borderTopWidth: 1,
          borderTopColor: Colors.hairline,
          height: Platform.OS === 'ios' ? 84 : 64,
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
});

import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TABS: { name: string; label: string; icon: IoniconName }[] = [
  { name: 'index',   label: 'Rent',    icon: 'car-outline' },
  { name: 'trips',   label: 'Trips',   icon: 'map-outline' },
  { name: 'saved',   label: 'Saved',   icon: 'heart-outline' },
  { name: 'profile', label: 'Profile', icon: 'person-outline' },
];

// Sixt-style dark tab bar: labelled tabs, orange active tint.
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.orange,
        tabBarInactiveTintColor: 'rgba(255,255,255,0.55)',
        tabBarStyle: {
          backgroundColor: '#15161a',
          borderTopWidth: 1,
          borderTopColor: 'rgba(255,255,255,0.08)',
          height: Platform.OS === 'ios' ? 88 : 68,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarItemStyle: {
          paddingVertical: 8,
        },
        tabBarLabelStyle: {
          fontFamily: Fonts.bodyMedium,
          fontSize: 12,
        },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.label,
            tabBarIcon: ({ color }) => <Ionicons name={tab.icon} size={23} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}

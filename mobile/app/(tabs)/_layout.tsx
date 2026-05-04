import { Tabs } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TABS: { name: string; icon: IoniconName; iconActive: IoniconName }[] = [
  { name: 'index',   icon: 'grid-outline',   iconActive: 'grid' },
  { name: 'trips',   icon: 'car-outline',    iconActive: 'car' },
  { name: 'saved',   icon: 'heart-outline',  iconActive: 'heart' },
  { name: 'profile', icon: 'person-outline', iconActive: 'person' },
];

function TabIcon({ focused, icon, iconActive }: { focused: boolean; icon: IoniconName; iconActive: IoniconName }) {
  return (
    <View style={styles.iconWrap}>
      <Ionicons
        name={focused ? iconActive : icon}
        size={24}
        color={focused ? Colors.orange : Colors.ink3}
      />
      {focused && <View style={styles.dot} />}
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: Colors.white,
          borderTopWidth: 1,
          borderTopColor: Colors.hairline,
          height: (Platform.OS === 'ios' ? 60 : 58) + insets.bottom,
          paddingBottom: insets.bottom,
          elevation: 0,
          shadowOpacity: 0,
        },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            tabBarIcon: ({ focused }) => (
              <TabIcon focused={focused} icon={tab.icon} iconActive={tab.iconActive} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingTop: 8,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.orange,
  },
});

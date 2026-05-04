import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';
import { useAuthStore } from '../../store/auth';
import Avatar from '../../components/ui/Avatar';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function MenuItem({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.menuIcon, danger && styles.menuIconDanger]}>
        <Ionicons name={icon} size={18} color={danger ? '#e53e3e' : Colors.ink2} />
      </View>
      <Text style={[styles.menuLabel, danger && styles.menuLabelDanger]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={Colors.ink4} />
    </TouchableOpacity>
  );
}

export default function EmployeeProfile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/(auth)/welcome');
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={[styles.root, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
      </View>

      {/* Identity card */}
      <View style={styles.idCard}>
        <Avatar seed={user?.name ?? 'employee'} size={56} />
        <View style={styles.idInfo}>
          <Text style={styles.idName}>{user?.name ?? '—'}</Text>
          <Text style={styles.idEmail}>{user?.email ?? '—'}</Text>
          <View style={styles.roleBadge}>
            <Ionicons name="shield-checkmark-outline" size={12} color={Colors.orange} />
            <Text style={styles.roleText}>Fleet Executive</Text>
          </View>
        </View>
      </View>

      {/* Menu */}
      <View style={styles.menuSection}>
        <Text style={styles.menuSectionLabel}>Shift Management</Text>
        <View style={styles.menuCard}>
          <MenuItem
            icon="business-outline"
            label="Open Shift"
            onPress={() => router.push('/employee/shift/open')}
          />
          <View style={styles.divider} />
          <MenuItem
            icon="checkmark-circle-outline"
            label="Close Current Shift"
            onPress={() => router.push('/employee/shift/close')}
          />
        </View>
      </View>

      <View style={styles.menuSection}>
        <Text style={styles.menuSectionLabel}>Account</Text>
        <View style={styles.menuCard}>
          <MenuItem
            icon="log-out-outline"
            label="Sign Out"
            onPress={handleSignOut}
            danger
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: { paddingBottom: 100 },

  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 26,
    color: Colors.ink,
    letterSpacing: -0.6,
  },

  idCard: {
    marginHorizontal: 20,
    marginBottom: 28,
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.hairline,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  idInfo: { flex: 1, gap: 3 },
  idName: {
    fontFamily: Fonts.displayBold,
    fontSize: 18,
    color: Colors.ink,
    letterSpacing: -0.4,
  },
  idEmail: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink3,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#ff6a1f12',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#ff6a1f25',
  },
  roleText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.orange,
    letterSpacing: 0.3,
  },

  menuSection: { paddingHorizontal: 20, marginBottom: 20 },
  menuSectionLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  menuCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 15,
    gap: 14,
  },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconDanger: { backgroundColor: '#e53e3e12' },
  menuLabel: {
    flex: 1,
    fontFamily: Fonts.bodyMedium,
    fontSize: 15,
    color: Colors.ink,
  },
  menuLabelDanger: { color: '#e53e3e' },
  divider: { height: 1, backgroundColor: Colors.hairline, marginLeft: 66 },
});

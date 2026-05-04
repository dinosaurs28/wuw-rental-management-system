import { useState } from 'react';
import {
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
import ConfirmModal from '../../components/ui/ConfirmModal';

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
  const [showSignOut, setShowSignOut] = useState(false);

  const handleSignOut = async () => {
    setShowSignOut(false);
    await signOut();
    router.replace('/(auth)/welcome');
  };

  return (
    <>
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
            {user?.branchName && (
              <View style={[styles.roleBadge, styles.branchBadge]}>
                <Ionicons name="location-outline" size={12} color={Colors.ink3} />
                <Text style={styles.branchText}>{user.branchName}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Shift management */}
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

        {/* Account */}
        <View style={styles.menuSection}>
          <Text style={styles.menuSectionLabel}>Account</Text>
          <View style={styles.menuCard}>
            <MenuItem
              icon="log-out-outline"
              label="Sign Out"
              onPress={() => setShowSignOut(true)}
              danger
            />
          </View>
        </View>
      </ScrollView>

      <ConfirmModal
        visible={showSignOut}
        icon="log-out-outline"
        iconColor="#e53e3e"
        title="Sign Out"
        message="You'll need to log in again to access your shift and bookings."
        confirmLabel="Sign Out"
        confirmColor="#e53e3e"
        cancelLabel="Stay"
        onConfirm={handleSignOut}
        onCancel={() => setShowSignOut(false)}
      />
    </>
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
  idInfo: { flex: 1, gap: 4 },
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
  branchBadge: {
    backgroundColor: Colors.bg,
    borderColor: Colors.hairline,
  },
  branchText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
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

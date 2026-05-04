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
import { useQuery } from '@tanstack/react-query';
import { Colors, Fonts } from '../../constants/colors';
import { userApi } from '../../lib/api';
import { useAuthStore } from '../../store/auth';

function ProfileRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        {value && <Text style={styles.rowValue}>{value}</Text>}
        {onPress && <Text style={styles.rowChevron}>›</Text>}
      </View>
    </TouchableOpacity>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

export default function Profile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const signOut = useAuthStore((s) => s.signOut);
  const user = useAuthStore((s) => s.user);

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => userApi.profile(),
    select: (res) => res.data.data,
    enabled: !!user,
  });

  const { data: kyc } = useQuery({
    queryKey: ['kyc'],
    queryFn: () => userApi.kyc(),
    select: (res) => res.data.data ?? [],
    enabled: !!user,
  });

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
      style={styles.root}
      contentContainerStyle={[
        styles.inner,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Avatar */}
      <View style={styles.avatarSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(profile?.name ?? user?.name ?? 'U')[0].toUpperCase()}
          </Text>
        </View>
        <Text style={styles.userName}>{profile?.name ?? user?.name ?? '—'}</Text>
        <Text style={styles.userEmail}>{profile?.email ?? user?.email ?? '—'}</Text>
      </View>

      {/* Account */}
      <SectionHeader title="Account" />
      <View style={styles.card}>
        <ProfileRow label="Name" value={profile?.name ?? user?.name} />
        <ProfileRow label="Email" value={profile?.email ?? user?.email} />
        <ProfileRow label="Phone" value={profile?.phone ?? '—'} />
      </View>

      {/* Documents */}
      <SectionHeader title="Documents" />
      <View style={styles.card}>
        <ProfileRow
          label="KYC / License"
          value={
            Array.isArray(kyc) && kyc.length > 0
              ? `${kyc.length} doc${kyc.length > 1 ? 's' : ''} uploaded`
              : 'Not uploaded'
          }
        />
      </View>

      {/* App */}
      <SectionHeader title="App" />
      <View style={styles.card}>
        <ProfileRow label="Version" value="1.0.0" />
      </View>

      {/* Sign out */}
      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.8}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  inner: { paddingHorizontal: 20 },
  avatarSection: { alignItems: 'center', marginBottom: 32 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontFamily: Fonts.displayBold,
    fontSize: 32,
    color: Colors.white,
  },
  userName: {
    fontFamily: Fonts.display,
    fontSize: 22,
    color: Colors.ink,
    letterSpacing: -0.5,
  },
  userEmail: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink3,
    marginTop: 4,
  },
  sectionHeader: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 24,
    marginLeft: 4,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  rowLabel: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 15,
    color: Colors.ink,
  },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowValue: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink3,
  },
  rowChevron: { fontSize: 18, color: Colors.ink3 },
  signOutBtn: {
    marginTop: 32,
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#e53e3e',
  },
  signOutText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: '#e53e3e',
  },
});

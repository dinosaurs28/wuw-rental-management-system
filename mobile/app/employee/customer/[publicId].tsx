import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';

interface CustomerDetail {
  name: string;
  email: string;
  phone: string | null;
  dob: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  isProfileCompleted: boolean;
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1} ellipsizeMode="middle">
        {value ?? '—'}
      </Text>
    </View>
  );
}

export default function CustomerDetailScreen() {
  const { publicId } = useLocalSearchParams<{ publicId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: customer, isLoading, isError } = useQuery<CustomerDetail>({
    queryKey: ['employee', 'customer', publicId],
    queryFn: async () => {
      const res = await employeeApi.getCustomer(publicId as string);
      return res.data?.data as CustomerDetail;
    },
    enabled: !!publicId,
    staleTime: 60_000,
    retry: false,
  });

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>Customer</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator style={styles.loader} color={Colors.orange} size="large" />
      ) : isError ? (
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={40} color={Colors.ink4} />
          <Text style={styles.errorText}>Could not load customer details.</Text>
        </View>
      ) : customer ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Avatar block */}
          <View style={styles.avatarBlock}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{customer.name.charAt(0).toUpperCase()}</Text>
            </View>
            <Text style={styles.customerName}>{customer.name}</Text>
            <View style={[styles.badge, customer.isProfileCompleted ? styles.badgeGreen : styles.badgeAmber]}>
              <Text style={[styles.badgeText, customer.isProfileCompleted ? styles.badgeGreenText : styles.badgeAmberText]}>
                {customer.isProfileCompleted ? 'Profile Complete' : 'Profile Incomplete'}
              </Text>
            </View>
          </View>

          {/* Contact */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Contact</Text>
            <View style={styles.card}>
              <InfoRow label="Email" value={customer.email} />
              <View style={styles.divider} />
              <InfoRow label="Phone" value={customer.phone} />
            </View>
          </View>

          {/* Address */}
          {(customer.addressLine1 || customer.city || customer.state) && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Address</Text>
              <View style={styles.card}>
                {customer.addressLine1 && (
                  <>
                    <InfoRow label="Street" value={customer.addressLine1} />
                    <View style={styles.divider} />
                  </>
                )}
                <InfoRow label="City" value={customer.city} />
                {customer.state && (
                  <>
                    <View style={styles.divider} />
                    <InfoRow label="State" value={customer.state} />
                  </>
                )}
                {customer.zipCode && (
                  <>
                    <View style={styles.divider} />
                    <InfoRow label="Zip Code" value={customer.zipCode} />
                  </>
                )}
                {customer.country && (
                  <>
                    <View style={styles.divider} />
                    <InfoRow label="Country" value={customer.country} />
                  </>
                )}
              </View>
            </View>
          )}

          {/* DOB */}
          {customer.dob && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Personal</Text>
              <View style={styles.card}>
                <InfoRow
                  label="Date of Birth"
                  value={new Date(customer.dob).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric',
                  })}
                />
              </View>
            </View>
          )}

          <TouchableOpacity
            style={styles.startBookingBtn}
            onPress={() =>
              router.push(
                `/employee/booking/customer-select?customerPublicId=${publicId}` as any,
              )
            }
            activeOpacity={0.9}
          >
            <Ionicons name="add-circle-outline" size={18} color={Colors.white} />
            <Text style={styles.startBookingBtnText}>Start new booking</Text>
            <Ionicons name="arrow-forward" size={16} color={Colors.white} />
          </TouchableOpacity>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 12,
  },
  back: { width: 36, height: 36, justifyContent: 'center' },
  title: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  loader: { marginTop: 80 },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink3 },

  content: { paddingHorizontal: 20, paddingBottom: 100, gap: 16 },

  avatarBlock: { alignItems: 'center', gap: 10, paddingVertical: 20 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: Fonts.displayBold, fontSize: 28, color: Colors.white },
  customerName: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  badge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  badgeGreen: { backgroundColor: '#10b98115', borderWidth: 1, borderColor: '#10b98130' },
  badgeAmber: { backgroundColor: '#f59e0b15', borderWidth: 1, borderColor: '#f59e0b30' },
  badgeText: { fontFamily: Fonts.bodySemiBold, fontSize: 12 },
  badgeGreenText: { color: '#10b981' },
  badgeAmberText: { color: '#f59e0b' },

  section: { gap: 8 },
  sectionLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  infoLabel: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink3, flexShrink: 0 },
  infoValue: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink, flex: 1, textAlign: 'right', marginLeft: 16 },
  divider: { height: 1, backgroundColor: Colors.hairline },

  startBookingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.orange,
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 12,
  },
  startBookingBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
    letterSpacing: 0.2,
    flex: 1,
    textAlign: 'center',
  },
});

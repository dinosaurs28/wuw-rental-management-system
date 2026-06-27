import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../constants/colors';
import { userApi } from '../lib/api';

interface Cancellation {
  invoiceNumber: string | null;
  bookingId: string;
  cancellationFee: string;
  reason: string | null;
  date: string | null;
}

interface CancellationData {
  customerId: number;
  cancellations: Cancellation[];
  totalCancellations: number;
  totalOutstanding: string;
}

const inr = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Cancellations() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['cancellation-history'],
    queryFn: async () => {
      const res = await userApi.cancellationHistory();
      return (res.data?.data ?? null) as CancellationData | null;
    },
  });

  const outstanding = data ? Number(data.totalOutstanding) || 0 : 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Cancellations</Text>
        <View style={{ width: 36 }} />
      </View>

      {isLoading ? (
        <ActivityIndicator style={styles.loader} color={Colors.orange} size="large" />
      ) : isError ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Could not load</Text>
          <TouchableOpacity onPress={() => refetch()}>
            <Text style={styles.retry}>Tap to retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={data?.cancellations ?? []}
          keyExtractor={(c, i) => `${c.bookingId}-${i}`}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            outstanding > 0 ? (
              <View style={styles.outstandingCard}>
                <View style={styles.outstandingIcon}>
                  <Ionicons name="alert-circle" size={22} color="#d97706" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.outstandingLabel}>Outstanding cancellation fees</Text>
                  <Text style={styles.outstandingValue}>{inr(outstanding)}</Text>
                  <Text style={styles.outstandingNote}>Please settle these fees with our team.</Text>
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name="checkmark-circle-outline" size={32} color={Colors.ink4} />
              </View>
              <Text style={styles.emptyTitle}>No cancellations</Text>
              <Text style={styles.emptySub}>You have no cancelled bookings or fees.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const fee = Number(item.cancellationFee) || 0;
            return (
              <View style={styles.card}>
                <View style={styles.cardTop}>
                  <Text style={styles.invoice}>{item.invoiceNumber ?? `#${item.bookingId.slice(-8).toUpperCase()}`}</Text>
                  <Text style={styles.fee}>{inr(fee)}</Text>
                </View>
                <View style={styles.metaRow}>
                  <Ionicons name="calendar-outline" size={13} color={Colors.ink3} />
                  <Text style={styles.metaText}>{fmtDate(item.date)}</Text>
                </View>
                {item.reason ? (
                  <View style={styles.metaRow}>
                    <Ionicons name="information-circle-outline" size={13} color={Colors.ink3} />
                    <Text style={styles.metaText}>{item.reason}</Text>
                  </View>
                ) : null}
              </View>
            );
          }}
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
  list: { padding: 20, gap: 12 },

  outstandingCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#fffbeb',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#fcd34d',
    padding: 16,
    marginBottom: 8,
  },
  outstandingIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: '#fef3c7',
    alignItems: 'center', justifyContent: 'center',
  },
  outstandingLabel: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: '#92400e' },
  outstandingValue: { fontFamily: Fonts.displayBold, fontSize: 22, color: '#b45309', letterSpacing: -0.5, marginTop: 2 },
  outstandingNote: { fontFamily: Fonts.body, fontSize: 12, color: '#b45309', marginTop: 4, lineHeight: 16 },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 16,
    gap: 8,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  invoice: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  fee: { fontFamily: Fonts.displayBold, fontSize: 16, color: '#dc3545', letterSpacing: -0.3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, flex: 1 },

  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40, gap: 8 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 20, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.hairline, alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  emptyTitle: { fontFamily: Fonts.display, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  emptySub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, textAlign: 'center', lineHeight: 20 },
  retry: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.orange, marginTop: 8 },
});

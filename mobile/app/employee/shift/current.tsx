// The Fleet Executive's current shift (Oct 2026). Executives open their shift
// and collect; the branch manager closes it at the cash handover. With a shift
// open this goes straight to its detail (running totals + payments); without
// one it offers Open shift.
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Redirect, useRouter, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import type { ActiveShift } from '../../../types/shift';

export default function CurrentShiftScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, refetch } = useQuery<ActiveShift | null>({
    queryKey: ['employee', 'active-shift'],
    queryFn: async () => {
      const res = await employeeApi.getActiveShift();
      return (res.data?.data as ActiveShift | null) ?? null;
    },
    staleTime: 5_000,
  });

  if (data?.publicId) return <Redirect href={`/employee/shift/${data.publicId}` as Href} />;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>Current Shift</Text>
      </View>
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 48 }} color={Colors.orange} size="large" />
      ) : (
        <View style={styles.empty}>
          <Ionicons name={isError ? 'cloud-offline-outline' : 'wallet-outline'} size={40} color={Colors.ink4} />
          <Text style={styles.emptyTitle}>{isError ? 'Could not load your shift' : 'No open shift'}</Text>
          <Text style={styles.emptySub}>
            {isError
              ? 'Check your connection and try again.'
              : 'Open a shift to collect payments. Your branch manager closes it when you hand over the cash.'}
          </Text>
          {isError ? (
            <TouchableOpacity onPress={() => refetch()}>
              <Text style={styles.link}>Tap to retry</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.btn} onPress={() => router.replace('/employee/shift/open')} activeOpacity={0.85}>
              <Ionicons name="add" size={16} color={Colors.white} />
              <Text style={styles.btnText}>Open Shift</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  back: { width: 36, height: 36, justifyContent: 'center' },
  title: { fontFamily: Fonts.displayBold, fontSize: 24, color: Colors.ink, letterSpacing: -0.6 },
  empty: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 64, gap: 10 },
  emptyTitle: { fontFamily: Fonts.displayBold, fontSize: 17, color: Colors.ink },
  emptySub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, textAlign: 'center', lineHeight: 19 },
  link: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.orange, marginTop: 6 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.orange,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    marginTop: 8,
  },
  btnText: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.white },
});

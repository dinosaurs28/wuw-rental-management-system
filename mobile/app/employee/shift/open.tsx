import { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';

export default function OpenShift() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [done, setDone] = useState(false);
  const [openedAt, setOpenedAt] = useState('');

  const mutation = useMutation({
    mutationFn: () => employeeApi.openShift(),
    onSuccess: (res) => {
      const shift = res.data?.data;
      if (shift) {
        setOpenedAt(shift.openedAt);
      }
      setDone(true);
      qc.invalidateQueries({ queryKey: ['employee', 'active-shift'] });
    },
  });

  if (done) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>

        <View style={styles.successBody}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={56} color="#10b981" />
          </View>
          <Text style={styles.successTitle}>Shift Opened</Text>
          <Text style={styles.successSub}>
            Your cash shift has started. All cash collected this session will be tracked.
          </Text>
          {openedAt ? (
            <View style={styles.detailPill}>
              <Ionicons name="time-outline" size={14} color={Colors.ink3} />
              <Text style={styles.detailText}>
                {new Date(openedAt).toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true,
                })}
              </Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity
          style={styles.doneBtn}
          onPress={() => router.replace('/(employee)/dashboard')}
          activeOpacity={0.85}
        >
          <Text style={styles.doneBtnText}>Back to Dashboard</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
        <Ionicons name="arrow-back" size={22} color={Colors.ink} />
      </TouchableOpacity>

      <View style={styles.body}>
        <View style={styles.iconWrap}>
          <Ionicons name="business-outline" size={36} color={Colors.orange} />
        </View>

        <Text style={styles.heading}>Open Cash Shift</Text>
        <Text style={styles.desc}>
          Starting a shift lets you record all cash payments collected during this session.
          Close the shift at the end to reconcile your totals.
        </Text>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={16} color={Colors.ink3} />
            <Text style={styles.infoText}>
              Session starts now — {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="cash-outline" size={16} color={Colors.ink3} />
            <Text style={styles.infoText}>All cash collected will be tracked in this shift</Text>
          </View>
        </View>

        {mutation.isError && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color="#e53e3e" />
            <Text style={styles.errorText}>
              {(mutation.error as any)?.response?.data?.message ?? 'Failed to open shift. Please try again.'}
            </Text>
          </View>
        )}
      </View>

      <TouchableOpacity
        style={[styles.openBtn, mutation.isPending && styles.openBtnLoading]}
        onPress={() => mutation.mutate()}
        disabled={mutation.isPending}
        activeOpacity={0.85}
      >
        {mutation.isPending ? (
          <ActivityIndicator size="small" color={Colors.white} />
        ) : (
          <>
            <Ionicons name="add-circle-outline" size={20} color={Colors.white} />
            <Text style={styles.openBtnText}>Open Shift</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
    paddingHorizontal: 24,
  },
  back: { marginTop: 8, marginBottom: 24, width: 36, height: 36, justifyContent: 'center' },

  body: { flex: 1, gap: 16 },

  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#ff6a1f12',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  heading: {
    fontFamily: Fonts.displayBold,
    fontSize: 28,
    color: Colors.ink,
    letterSpacing: -0.8,
  },
  desc: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink3,
    lineHeight: 22,
  },

  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 12,
    marginTop: 8,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink2, flex: 1 },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#e53e3e10',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e53e3e30',
  },
  errorText: { fontFamily: Fonts.body, fontSize: 13, color: '#e53e3e', flex: 1 },

  openBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.orange,
    borderRadius: 16,
    paddingVertical: 17,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  openBtnLoading: { opacity: 0.7 },
  openBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },

  /* Success state */
  successBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 8,
  },
  successIcon: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: '#10b98115',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  successTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 28,
    color: Colors.ink,
    letterSpacing: -0.8,
  },
  successSub: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink3,
    textAlign: 'center',
    lineHeight: 22,
  },
  detailPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  detailText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2 },

  doneBtn: {
    backgroundColor: Colors.ink,
    borderRadius: 16,
    paddingVertical: 17,
    alignItems: 'center',
  },
  doneBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
});

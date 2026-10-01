import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import { MAX_OPENING_CASH, inr2, money, sanitizeAmount } from '../../../lib/cashShift';

export default function OpenShift() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  // Set by the dashboard's New Booking prompt: carry on into the booking.
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [done, setDone] = useState(false);
  const [adopted, setAdopted] = useState(false);
  const [openedAt, setOpenedAt] = useState('');
  // Opening float counted into the drawer (#22). Required, prefilled 0 — an
  // empty drawer is a valid start.
  const [openingCash, setOpeningCash] = useState('0');
  const [openedWith, setOpenedWith] = useState<number | null>(null);
  // Pushed on top of a flow in this stack (walk-in hold, pickup, drop,
  // extension — via promptOpenShift) → go straight back to it once the shift
  // is open. From the dashboard / profile tabs it is the stack's first screen.
  const [fromFlow] = useState(() => (navigation.getState()?.index ?? 0) > 0);

  const amount = openingCash.trim() === '' ? NaN : Number(openingCash);
  const amountError = isNaN(amount)
    ? 'Enter the cash in the drawer now (₹0 if it is empty).'
    : amount > MAX_OPENING_CASH
      ? 'Opening cash cannot exceed ₹10,00,000.'
      : null;

  const mutation = useMutation({
    mutationFn: async (): Promise<{ openedAt?: string; adopted: boolean; opening: number | null }> => {
      try {
        const res = await employeeApi.openShift({ openingCash: amount });
        const d = res.data?.data;
        return { openedAt: d?.openedAt, adopted: false, opening: money(d?.openingCash) ?? amount };
      } catch (err: any) {
        // 409 = a shift is already open (e.g. started on the web) — adopt it.
        if (err?.response?.status !== 409) throw err;
        const active = await employeeApi.getActiveShift().catch(() => null);
        const shift = active?.data?.data;
        if (!shift) throw err;
        // That shift keeps the opening cash it was opened with.
        return { openedAt: shift.openedAt, adopted: true, opening: money(shift.openingCash) };
      }
    },
    onSuccess: ({ openedAt: at, adopted: wasOpen, opening }) => {
      qc.invalidateQueries({ queryKey: ['employee', 'active-shift'] });
      qc.invalidateQueries({ queryKey: ['employee', 'shifts'] });
      if (next === 'new-booking') {
        router.replace('/employee/customer/search');
        return;
      }
      if (fromFlow && router.canGoBack()) {
        router.back();
        return;
      }
      if (at) setOpenedAt(at);
      setOpenedWith(opening);
      setAdopted(wasOpen);
      setDone(true);
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
          <Text style={styles.successTitle}>{adopted ? 'Shift Already Open' : 'Shift Opened'}</Text>
          <Text style={styles.successSub}>
            {adopted
              ? 'Your cash shift was already open (started on another device). Cash you collect is tracked in it.'
              : 'Your cash shift has started. All cash collected this session will be tracked.'}
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
          {openedWith != null ? (
            <View style={styles.detailPill}>
              <Ionicons name="cash-outline" size={14} color={Colors.ink3} />
              <Text style={styles.detailText}>Opening cash {inr2(openedWith)}</Text>
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
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
        <Ionicons name="arrow-back" size={22} color={Colors.ink} />
      </TouchableOpacity>

      <ScrollView
        style={styles.bodyScroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
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

        {/* Opening cash — the float already in the drawer */}
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>Opening cash in drawer (₹)</Text>
          <Text style={styles.fieldHelp}>
            Count the cash in the drawer before you start. At close you will be expected to hold this plus the
            cash you collect, minus cash refunds.
          </Text>
          <View style={[styles.amountWrap, amountError ? styles.amountWrapError : null]}>
            <Text style={styles.rupeeSymbol}>₹</Text>
            <TextInput
              style={styles.amountInput}
              placeholder="0"
              placeholderTextColor={Colors.ink4}
              value={openingCash}
              onChangeText={(t) => setOpeningCash(sanitizeAmount(t))}
              // Prefilled 0: typing replaces it instead of appending to it.
              selectTextOnFocus
              keyboardType="decimal-pad"
              returnKeyType="done"
              accessibilityLabel="Opening cash in drawer in rupees"
            />
          </View>
          {amountError ? <Text style={styles.fieldError}>{amountError}</Text> : null}
        </View>

        {mutation.isError && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color="#e53e3e" />
            <Text style={styles.errorText}>
              {(mutation.error as any)?.response?.data?.message ?? 'Failed to open shift. Please try again.'}
            </Text>
          </View>
        )}
      </ScrollView>

      <TouchableOpacity
        style={[
          styles.openBtn,
          mutation.isPending && styles.openBtnLoading,
          !!amountError && styles.openBtnDisabled,
        ]}
        onPress={() => mutation.mutate()}
        disabled={mutation.isPending || !!amountError}
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
    paddingHorizontal: 24,
  },
  back: { marginTop: 8, marginBottom: 24, width: 36, height: 36, justifyContent: 'center' },

  bodyScroll: { flex: 1 },
  body: { flexGrow: 1, gap: 16, paddingBottom: 16 },

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

  fieldBlock: { gap: 8, marginTop: 4 },
  fieldLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink2,
    letterSpacing: 0.2,
  },
  fieldHelp: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, lineHeight: 17, marginTop: -2 },
  fieldError: { fontFamily: Fonts.body, fontSize: 12, color: '#e53e3e' },
  amountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 16,
    height: 56,
    gap: 8,
  },
  amountWrapError: { borderColor: '#e53e3e' },
  rupeeSymbol: { fontFamily: Fonts.bodySemiBold, fontSize: 20, color: Colors.ink2 },
  amountInput: {
    flex: 1,
    fontFamily: Fonts.displayBold,
    fontSize: 22,
    color: Colors.ink,
    letterSpacing: -0.5,
    padding: 0,
  },

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
  openBtnDisabled: { opacity: 0.4 },
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

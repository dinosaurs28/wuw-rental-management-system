import { useState, useEffect } from 'react';
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
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';

interface ActiveShift {
  publicId: string;
  status: string;
  openedAt: string;
  expectedTotal?: number | string;
}

const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export default function CloseShift() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [actualTotal, setActualTotal] = useState('');
  const [explanation, setExplanation] = useState('');
  const [done, setDone] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [closeResult, setCloseResult] = useState<{ discrepancy?: number; status?: string }>({});

  const { data: shift, isLoading: shiftLoading } = useQuery<ActiveShift | null>({
    queryKey: ['employee', 'active-shift'],
    queryFn: async () => {
      const res = await employeeApi.getActiveShift();
      return (res.data?.data ?? null) as ActiveShift | null;
    },
    staleTime: 10_000,
  });

  const mutation = useMutation({
    mutationFn: () => {
      if (!shift) throw new Error('No active shift');
      return employeeApi.closeShift(shift.publicId, {
        actualTotal: parseFloat(actualTotal),
        discrepancyExplanation: explanation.trim() || undefined,
      });
    },
    onSuccess: (res) => {
      setResultMsg(res.data?.message ?? 'Shift closed successfully');
      const d = res.data?.data ?? {};
      setCloseResult({
        discrepancy: d.discrepancy != null ? Number(d.discrepancy) : undefined,
        status: d.status,
      });
      setDone(true);
      qc.invalidateQueries({ queryKey: ['employee', 'active-shift'] });
    },
  });

  const isValid = actualTotal.trim() !== '' && !isNaN(parseFloat(actualTotal)) && parseFloat(actualTotal) >= 0;
  const expected = shift?.expectedTotal != null ? Number(shift.expectedTotal) : null;
  // Backend requires a discrepancyExplanation whenever counted cash != expected.
  const hasDiscrepancy = isValid && expected != null && parseFloat(actualTotal) !== expected;
  const explanationRequired = hasDiscrepancy && explanation.trim() === '';
  const canSubmit = isValid && !!shift && !mutation.isPending && !explanationRequired;

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
          <Text style={styles.successTitle}>Shift Closed</Text>
          <Text style={styles.successSub}>{resultMsg}</Text>
          {closeResult.discrepancy != null && (
            <View style={[styles.discrepancyBox, closeResult.status === 'DISCREPANCY_FLAGGED' && styles.discrepancyBoxFlagged]}>
              <Ionicons
                name={closeResult.status === 'DISCREPANCY_FLAGGED' ? 'alert-circle' : 'checkmark-circle-outline'}
                size={18}
                color={closeResult.status === 'DISCREPANCY_FLAGGED' ? '#d97706' : '#10b981'}
              />
              <Text style={styles.discrepancyText}>
                {closeResult.discrepancy === 0
                  ? 'Cash matched the expected total exactly.'
                  : `Discrepancy of ${inr(Math.abs(closeResult.discrepancy))} (${closeResult.discrepancy > 0 ? 'over' : 'short'})${closeResult.status === 'DISCREPANCY_FLAGGED' ? ' — flagged for reconciliation.' : '.'}`}
              </Text>
            </View>
          )}
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
      style={{ flex: 1, backgroundColor: Colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={[styles.root, { paddingTop: insets.top }]}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>

        <View style={styles.iconWrap}>
          <Ionicons name="lock-closed-outline" size={36} color={Colors.ink2} />
        </View>
        <Text style={styles.heading}>Close Shift</Text>
        <Text style={styles.desc}>
          Enter the actual cash you have on hand. A discrepancy report will be flagged if amounts differ.
        </Text>

        {/* Shift info */}
        {shiftLoading ? (
          <ActivityIndicator color={Colors.orange} style={{ marginVertical: 16 }} />
        ) : !shift ? (
          <View style={styles.noShiftBox}>
            <Ionicons name="alert-circle-outline" size={20} color={Colors.ink3} />
            <Text style={styles.noShiftText}>No active shift found. Open a shift first.</Text>
          </View>
        ) : (
          <View style={styles.shiftInfoCard}>
            <View style={styles.shiftInfoRow}>
              <Ionicons name="time-outline" size={15} color={Colors.ink3} />
              <Text style={styles.shiftInfoText}>Opened at {formatTime(shift.openedAt)}</Text>
            </View>
            <View style={styles.shiftInfoRow}>
              <Ionicons name="key-outline" size={15} color={Colors.ink3} />
              <Text style={styles.shiftInfoText}>{shift.publicId.slice(-8).toUpperCase()}</Text>
            </View>
            {expected != null && (
              <View style={styles.shiftInfoRow}>
                <Ionicons name="cash-outline" size={15} color={Colors.ink3} />
                <Text style={styles.shiftInfoText}>Expected cash: {inr(expected)}</Text>
              </View>
            )}
          </View>
        )}

        {/* Actual total input */}
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>Actual Cash in Hand (₹)</Text>
          {expected != null && (
            <Text style={styles.expectedHint}>System expects {inr(expected)} in the drawer</Text>
          )}
          <View style={[styles.amountWrap, !isValid && actualTotal ? styles.amountWrapError : null]}>
            <Text style={styles.rupeeSymbol}>₹</Text>
            <TextInput
              style={styles.amountInput}
              placeholder="0.00"
              placeholderTextColor={Colors.ink4}
              value={actualTotal}
              onChangeText={(t) => setActualTotal(t.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              returnKeyType="done"
            />
          </View>
        </View>

        {/* Notes */}
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>
            {hasDiscrepancy ? 'Notes / Explanation (required — cash differs from expected)' : 'Notes / Explanation (optional)'}
          </Text>
          <TextInput
            style={[styles.notesInput, explanationRequired && styles.notesInputError]}
            placeholder="Explain any discrepancy..."
            placeholderTextColor={Colors.ink4}
            value={explanation}
            onChangeText={setExplanation}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
          {explanationRequired && (
            <Text style={styles.fieldHint}>An explanation is required when the counted cash doesn’t match the expected total.</Text>
          )}
        </View>

        {mutation.isError && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color="#e53e3e" />
            <Text style={styles.errorText}>
              {(mutation.error as any)?.response?.data?.message ?? 'Failed to close shift. Try again.'}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Bottom CTA */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.closeBtn, !canSubmit && styles.closeBtnDisabled]}
          onPress={() => mutation.mutate()}
          disabled={!canSubmit}
          activeOpacity={0.85}
        >
          {mutation.isPending ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <>
              <Ionicons name="lock-closed-outline" size={18} color={Colors.white} />
              <Text style={styles.closeBtnText}>Close Shift</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  scrollContent: { paddingHorizontal: 24, gap: 16 },
  back: { marginTop: 8, marginBottom: 16, width: 36, height: 36, justifyContent: 'center' },

  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
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

  shiftInfoCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 10,
  },
  shiftInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shiftInfoText: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink2 },

  noShiftBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  noShiftText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink3, flex: 1 },

  fieldBlock: { gap: 8 },
  fieldLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink2,
    letterSpacing: 0.2,
  },
  expectedHint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: -2 },
  discrepancyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#10b98112',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 4,
  },
  discrepancyBoxFlagged: { backgroundColor: '#f59e0b15' },
  discrepancyText: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink2, lineHeight: 18 },
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
  rupeeSymbol: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 20,
    color: Colors.ink2,
  },
  amountInput: {
    flex: 1,
    fontFamily: Fonts.displayBold,
    fontSize: 22,
    color: Colors.ink,
    letterSpacing: -0.5,
    padding: 0,
  },
  notesInput: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 16,
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
    minHeight: 100,
  },
  notesInputError: { borderColor: '#e53e3e' },
  fieldHint: { fontFamily: Fonts.body, fontSize: 12, color: '#e53e3e', marginTop: 6 },

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

  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
    backgroundColor: Colors.bg,
  },
  closeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.ink,
    borderRadius: 16,
    paddingVertical: 17,
  },
  closeBtnDisabled: { opacity: 0.4 },
  closeBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },

  successBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
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
  doneBtn: {
    backgroundColor: Colors.ink,
    borderRadius: 16,
    paddingVertical: 17,
    alignItems: 'center',
    marginHorizontal: 24,
  },
  doneBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
});

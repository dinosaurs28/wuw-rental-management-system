// "Save changes" of an edited pickup / drop (client item 1, full edit): the
// money difference the edit makes (old → new per line, then Collect ₹X more /
// Refund ₹Y / No change in money), the save, and — when money moves at the
// counter — settling the difference straight away.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { apiErrorMessage } from '../../../lib/counterErrors';
import AdjustmentSettle, { AdjustmentLines } from './AdjustmentSettle';
import type { ReturnSession } from '../../../types/api';
import type { AdjustmentPlan, EditPreview } from '../../../types/completedOperation';

const num = (x: unknown) => Number(x ?? 0) || 0;
const inr = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export interface EditSaveResult {
  adjustment?: (AdjustmentPlan & { session: ReturnSession | null }) | null;
}

interface Props {
  visible: boolean;
  phase: 'pickup' | 'return';
  preview: EditPreview | null;
  loading: boolean;
  // Saves the edit with the previewed difference; throws the API error
  save: (expectedDelta: number) => Promise<EditSaveResult>;
  // The difference moved since the preview: preview again
  onRefresh: () => void;
  onClose: () => void;
  // Saved (and the difference settled, when it moved at the counter)
  onFinished: (note: string | null) => void;
}

// What happens to the money, in one line.
export function adjustmentOutcome(plan: AdjustmentPlan): string {
  const amount = num(plan.amount);
  if (plan.action === 'NONE') return 'No change in money';
  if (plan.settledBy === 'BRANCH_MANAGER') {
    return plan.action === 'COLLECT'
      ? `₹${amount.toLocaleString('en-IN')} more — the branch manager collects it in Settlements`
      : `₹${amount.toLocaleString('en-IN')} less — the branch manager takes it off what's due, or refunds it in Settlements if it was already paid`;
  }
  return plan.action === 'COLLECT' ? `Collect ${inr(amount)} more` : `Refund ${inr(amount)}`;
}

export default function EditReviewSheet({ visible, phase, preview, loading, save, onRefresh, onClose, onFinished }: Props) {
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Saved; the difference still to settle at the counter
  const [toSettle, setToSettle] = useState<{ session: ReturnSession; plan: AdjustmentPlan } | null>(null);

  useEffect(() => {
    if (!visible) {
      setError(null);
      setToSettle(null);
    }
  }, [visible]);

  const plan = preview?.adjustment ?? null;
  // The last edit's unsettled difference this save replaces
  const replaces = preview?.supersedes ?? null;

  const onSave = async () => {
    if (!plan || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await save(num(plan.delta));
      const adjustment = result.adjustment ?? null;
      const session = adjustment?.session ?? null;
      if (session && session.status !== 'COMPLETED' && adjustment?.settledBy === 'COUNTER') {
        setToSettle({ session, plan: adjustment });
      } else {
        onFinished(
          adjustment && adjustment.action !== 'NONE' && adjustment.settledBy === 'BRANCH_MANAGER'
            ? adjustmentOutcome(adjustment)
            : null,
        );
      }
    } catch (err: any) {
      const code = err?.response?.data?.code;
      if (code === 'EDIT_DELTA_CHANGED') {
        setError(apiErrorMessage(err, 'The money difference changed. Check it and save again.'));
        onRefresh();
      } else {
        setError(apiErrorMessage(err, 'Could not save the changes. Try again.'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={toSettle ? undefined : onClose}>
      <View style={[styles.root, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{toSettle ? 'Settle the difference' : 'Review changes'}</Text>
          {!toSettle && (
            <TouchableOpacity onPress={onClose} hitSlop={10} disabled={saving}>
              <Ionicons name="close" size={24} color={Colors.ink} />
            </TouchableOpacity>
          )}
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {loading || !plan ? (
            <ActivityIndicator color={Colors.orange} style={{ marginTop: 40 }} />
          ) : toSettle ? (
            <>
              <Text style={styles.hint}>The changes are saved. Settle the difference with the customer now.</Text>
              <AdjustmentSettle
                session={toSettle.session}
                lines={toSettle.plan.lines}
                collectMethods={toSettle.plan.methods.collect}
                onSettled={onFinished}
              />
              {/* Left for later: it waits on the summary (and shows as due on the booking) */}
              <TouchableOpacity
                onPress={() => onFinished('The difference is still to be settled — settle it from the summary.')}
                hitSlop={8}
                style={styles.later}
              >
                <Text style={styles.laterText}>Settle later</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {replaces && (
                <View style={styles.warn}>
                  <Ionicons name="alert-circle-outline" size={16} color={Colors.availLow} />
                  <Text style={styles.warnText}>
                    This replaces the last edit's difference ({inr(num(replaces.netPayable))}), which wasn't settled — the
                    amount below covers both edits.
                  </Text>
                </View>
              )}
              <Text style={styles.sectionLabel}>{phase === 'return' ? 'Drop charges' : 'Money'}</Text>
              <View style={styles.card}>
                <AdjustmentLines lines={plan.lines} showUnchanged />
              </View>
              <View
                style={[
                  styles.outcome,
                  plan.action === 'COLLECT' ? styles.outcomeCollect : plan.action === 'REFUND' ? styles.outcomeRefund : styles.outcomeNone,
                ]}
              >
                <Text style={styles.outcomeText}>{adjustmentOutcome(plan)}</Text>
              </View>
              {plan.action !== 'NONE' && plan.settledBy === 'COUNTER' && (
                <Text style={styles.hint}>
                  {plan.action === 'COLLECT'
                    ? 'After saving, collect it by cash, UPI, split or credit.'
                    : 'After saving, refund it by cash or UPI.'}
                </Text>
              )}
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </>
          )}
        </ScrollView>
        {!toSettle && (
          <TouchableOpacity
            style={[styles.button, (saving || loading || !plan) && styles.buttonBusy]}
            onPress={onSave}
            disabled={saving || loading || !plan}
            activeOpacity={0.85}
          >
            {saving ? <ActivityIndicator color={Colors.white} /> : <Ionicons name="checkmark" size={18} color={Colors.white} />}
            <Text style={styles.buttonText}>Save changes</Text>
          </TouchableOpacity>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  title: { fontFamily: Fonts.displayBold, fontSize: 20, color: Colors.ink, letterSpacing: -0.4 },
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  sectionLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 4,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 16,
  },
  outcome: { borderRadius: 12, padding: 14 },
  outcomeCollect: { backgroundColor: Colors.availLowSoft },
  outcomeRefund: { backgroundColor: Colors.availGoodSoft },
  outcomeNone: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.hairline },
  outcomeText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  hint: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3, lineHeight: 18 },
  warn: { flexDirection: 'row', gap: 8, backgroundColor: Colors.availLowSoft, borderRadius: 12, padding: 12 },
  warnText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: Colors.ink2, lineHeight: 18 },
  error: { fontFamily: Fonts.body, fontSize: 13, color: Colors.availNone, lineHeight: 18 },
  later: { alignSelf: 'center', paddingVertical: 6 },
  laterText: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.ink3 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.orange,
    borderRadius: 16,
    paddingVertical: 17,
    marginHorizontal: 20,
  },
  buttonBusy: { opacity: 0.5 },
  buttonText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },
});

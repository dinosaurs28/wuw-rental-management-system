// Void a payment (Oct 2026) — reverse a wrong entry, the same rules as the
// branch manager's web portal (own branch). The row stays in the history as
// voided and counts in no total; the booking owes the amount again (a voided
// refund: the customer is owed it again). The booking status is not changed.
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import { apiErrorMessage } from '../../../lib/counterErrors';
import type { PaymentVoidResult } from '../../../types/paymentVoid';
import { sheetStyles as styles } from './sheetStyles';

const REASON_MIN = 3;
const REASON_MAX = 500;

export interface VoidTarget {
  transactionPublicId: string;
  amount: string | number;
  /** e.g. "Cash · Balance payment" */
  label: string;
  isRefund?: boolean;
}

const inr = (v: string | number) => `₹${(Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function VoidPaymentSheet({
  target,
  onClose,
  onDone,
}: {
  target: VoidTarget | null;
  onClose: () => void;
  /** Voided: the server's message (with the closed-shift warning when there is one) */
  onDone: (message: string, result: PaymentVoidResult) => void;
}) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason('');
    setError(null);
  }, [target?.transactionPublicId]);

  const len = reason.trim().length;
  const valid = len >= REASON_MIN && len <= REASON_MAX;
  const close = () => {
    if (!submitting) onClose();
  };

  const submit = async () => {
    if (!target || !valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await employeeApi.voidPayment(target.transactionPublicId, reason.trim());
      onDone(res.data.message || 'Payment voided.', res.data.data);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not void the payment.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={!!target} transparent animationType="slide" statusBarTranslucent onRequestClose={close}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={close}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.kav, { paddingTop: insets.top + 8 }]}
          pointerEvents="box-none"
        >
          <View style={[styles.sheet, styles.content, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>Void {target?.isRefund ? 'refund' : 'payment'}</Text>
              <TouchableOpacity onPress={close} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={Colors.ink} />
              </TouchableOpacity>
            </View>
            {target ? (
              <>
                <View style={styles.card}>
                  <View style={styles.moneyRow}>
                    <Text style={styles.moneyLabel}>{target.label}</Text>
                    <Text style={styles.moneyValue}>{inr(target.amount)}</Text>
                  </View>
                </View>
                <View style={styles.warnBox}>
                  <Ionicons name="warning-outline" size={16} color={Colors.availLow} />
                  <Text style={styles.warnText}>
                    {target.isRefund
                      ? `The customer will be owed this ${inr(target.amount)} again.`
                      : `The booking will owe ${inr(target.amount)} again.`}{' '}
                    Use this only for a wrong entry. The booking, pickup and drop stay as they are. This can't be undone.
                  </Text>
                </View>
                <Text style={styles.sectionLabel}>Reason</Text>
                <TextInput
                  style={[styles.input, styles.multiline]}
                  value={reason}
                  onChangeText={(t) => {
                    setReason(t.slice(0, REASON_MAX));
                    setError(null);
                  }}
                  placeholder="e.g. Entered twice, wrong amount"
                  placeholderTextColor={Colors.ink4}
                  multiline
                  maxLength={REASON_MAX}
                  editable={!submitting}
                />
                <Text style={styles.counter}>
                  {len}/{REASON_MAX}
                </Text>
                {error ? (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle-outline" size={16} color={Colors.availNone} />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={close} disabled={submitting} activeOpacity={0.85}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmBtn, styles.confirmDanger, (!valid || submitting) && styles.confirmDisabled]}
                    onPress={submit}
                    disabled={!valid || submitting}
                    activeOpacity={0.85}
                  >
                    {submitting ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.confirmText}>Void {inr(target.amount)}</Text>}
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

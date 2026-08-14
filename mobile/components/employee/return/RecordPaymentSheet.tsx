import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import type { PaymentMethod } from '../../../types/return';

const { height } = Dimensions.get('window');

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Default amount to fill in (e.g. session.netPayable). User can override. */
  amount: number;
  /** True when the session is in refund state (negative netPayable). */
  isRefund?: boolean;
  /** Called with collected fields. Parent does the API call. */
  onSubmit: (input: {
    method: PaymentMethod;
    amount: number;
    notes: string;
    onlineTransactionRef?: string;
    onlineGateway?: string;
    /** Stable across retries within the same sheet open — caller MUST forward this to the API. */
    idempotencyKey: string;
  }) => Promise<void>;
}

const generateIdempotencyKey = () =>
  `pay_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export default function RecordPaymentSheet({
  visible,
  onClose,
  amount,
  isRefund = false,
  onSubmit,
}: Props) {
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amountStr, setAmountStr] = useState(String(Math.abs(amount).toFixed(2)));
  const [notes, setNotes] = useState('');
  const [txnRef, setTxnRef] = useState('');
  const [gateway, setGateway] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Generate idempotencyKey once per sheet open. Reused for retries.
  const [idempotencyKey, setIdempotencyKey] = useState<string>(generateIdempotencyKey());

  useEffect(() => {
    if (visible) {
      // Fresh key per open
      setIdempotencyKey(generateIdempotencyKey());
      setAmountStr(String(Math.abs(amount).toFixed(2)));
      setMethod('CASH');
      setNotes('');
      setTxnRef('');
      setGateway('');
      setErrorMsg(null);
      setSubmitting(false);
    }
  }, [visible, amount]);

  const parsedAmount = useMemo(() => {
    const n = parseFloat(amountStr || '0');
    return Number.isFinite(n) ? n : 0;
  }, [amountStr]);

  const canSubmit =
    parsedAmount > 0 &&
    !submitting &&
    (method === 'CASH' || (method === 'ONLINE' && txnRef.trim().length > 0));

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await onSubmit({
        method,
        amount: parsedAmount,
        notes: notes.trim(),
        onlineTransactionRef: method === 'ONLINE' ? txnRef.trim() : undefined,
        onlineGateway: method === 'ONLINE' ? gateway.trim() || undefined : undefined,
        idempotencyKey,
      });
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message ?? err.message ?? 'Payment failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <Text style={styles.title}>{isRefund ? 'Issue refund' : 'Collect payment'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={20} color={Colors.ink2} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Method picker */}
            <Text style={styles.fieldLabel}>Method</Text>
            <View style={styles.methodRow}>
              {(['CASH', 'ONLINE'] as PaymentMethod[]).map((m) => {
                const active = method === m;
                return (
                  <TouchableOpacity
                    key={m}
                    style={[styles.methodPill, active && styles.methodPillActive]}
                    onPress={() => setMethod(m)}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name={m === 'CASH' ? 'cash-outline' : 'card-outline'}
                      size={16}
                      color={active ? Colors.white : Colors.ink2}
                    />
                    <Text style={[styles.methodLabel, active && styles.methodLabelActive]}>
                      {m === 'CASH' ? 'Cash' : 'Online'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Amount */}
            <Text style={styles.fieldLabel}>Amount (₹)</Text>
            <TextInput
              style={styles.amountInput}
              value={amountStr}
              onChangeText={setAmountStr}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={Colors.ink3}
            />

            {/* Online-only fields */}
            {method === 'ONLINE' && (
              <>
                <Text style={styles.fieldLabel}>Transaction reference</Text>
                <TextInput
                  style={styles.input}
                  value={txnRef}
                  onChangeText={setTxnRef}
                  placeholder="Required for online payment"
                  placeholderTextColor={Colors.ink3}
                  autoCapitalize="characters"
                />
                <Text style={styles.fieldLabel}>Gateway / app (optional)</Text>
                <TextInput
                  style={styles.input}
                  value={gateway}
                  onChangeText={setGateway}
                  placeholder="e.g. PhonePe, GPay"
                  placeholderTextColor={Colors.ink3}
                />
              </>
            )}

            {/* Notes */}
            <Text style={styles.fieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything to record about this payment"
              placeholderTextColor={Colors.ink3}
              multiline
            />

            {errorMsg ? (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={16} color="#dc2626" />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={!canSubmit}
              activeOpacity={0.9}
            >
              {submitting ? (
                <ActivityIndicator color={Colors.white} size="small" />
              ) : (
                <Text style={styles.submitText}>
                  {isRefund ? `Issue ₹${parsedAmount.toLocaleString('en-IN')} refund` : `Record ₹${parsedAmount.toLocaleString('en-IN')}`}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: height * 0.88,
    overflow: 'hidden',
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 999,
    backgroundColor: Colors.ink4,
    alignSelf: 'center',
    marginTop: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 18,
    color: Colors.ink,
    letterSpacing: -0.4,
  },
  body: { flexGrow: 0 },
  bodyContent: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 4,
  },
  fieldLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 14,
    marginBottom: 8,
  },
  methodRow: {
    flexDirection: 'row',
    gap: 8,
  },
  methodPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  methodPillActive: {
    backgroundColor: Colors.ink,
    borderColor: Colors.ink,
  },
  methodLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink2,
  },
  methodLabelActive: { color: Colors.white },
  amountInput: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: Fonts.displayBold,
    fontSize: 22,
    color: Colors.ink,
    letterSpacing: -0.4,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
  },
  notesInput: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: { fontFamily: Fonts.body, fontSize: 12.5, color: '#dc2626', flex: 1 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
    backgroundColor: Colors.surface,
  },
  submitBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitBtnDisabled: { backgroundColor: Colors.ink4 },
  submitText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
    letterSpacing: 0.2,
  },
});

// "Refund to customer" from the staff app (Oct 2026) — the same fields and rules
// as the branch manager's web dialog, own branch only: any booking, any status,
// any amount, paid out now by cash, UPI or bank transfer. More than the money
// received (after refunds) shows a warning and needs a tick. Cash comes out of
// the Fleet Executive's drawer, so it needs their open cash shift. The booking
// itself is not changed.
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import { apiErrorMessage, handleShiftRequired } from '../../../lib/counterErrors';
import { REFUND_PROOF_REQUIRED_MESSAGE, proofProblem } from '../../../lib/counterPayment';
import ImageViewer from '../../ui/ImageViewer';
import { fmtDateTime } from '../../../lib/dates';
import { PaymentProofCapture, useProofShot } from '../CounterPaymentPicker';
import type { StaffRefundMethod, StaffRefundResult } from '../../../types/paymentVoid';
import { sheetStyles as styles } from './sheetStyles';

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
const num = (v: string | null | undefined) => {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : 0;
};
const inr = (v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const newRequestId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export function RefundToCustomerSheet({
  visible,
  bookingPublicId,
  onClose,
  onDone,
}: {
  visible: boolean;
  bookingPublicId: string;
  onClose: () => void;
  /** Recorded: the server's message */
  onDone: (message: string, result: StaffRefundResult) => void;
}) {
  const insets = useSafeAreaInsets();
  const query = useQuery({
    queryKey: ['employee', 'refund-to-customer', bookingPublicId],
    queryFn: async () => (await employeeApi.refundToCustomerOptions(bookingPublicId)).data.data,
    enabled: visible,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const options = query.data;

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<StaffRefundMethod>('CASH');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [confirmOver, setConfirmOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(newRequestId);
  const proof = useProofShot(() => setError(null));
  const [viewing, setViewing] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setAmount('');
    setMethod('CASH');
    setReference('');
    setReason('');
    setConfirmOver(false);
    setError(null);
    setRequestId(newRequestId());
    proof.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, bookingPublicId]);

  const reasonMin = options?.limits.reasonMin ?? 3;
  const reasonMax = options?.limits.reasonMax ?? 500;
  const referenceMax = options?.limits.referenceMax ?? 64;
  const amountValid = AMOUNT_PATTERN.test(amount.trim()) && num(amount) > 0;
  const amountNum = amountValid ? num(amount) : 0;
  const netReceived = num(options?.money.netReceived);
  const overBy = Math.max(0, amountNum - Math.max(0, netReceived));
  const needsTick = amountValid && overBy > 0;
  const isCash = method === 'CASH';

  const problem = useMemo(() => {
    if (!amountValid) return 'Enter the amount to refund (more than ₹0, at most 2 decimals).';
    if (reason.trim().length < reasonMin) return `Enter the reason (at least ${reasonMin} characters).`;
    if (needsTick && !confirmOver) return 'Tick the confirmation to refund more than was received.';
    // Oct 25 2026: a UPI / bank refund needs the photo of its payment-success screen
    if (!isCash) return proof.shot ? proofProblem(proof.shot, true) : REFUND_PROOF_REQUIRED_MESSAGE;
    return null;
  }, [amountValid, reason, reasonMin, needsTick, confirmOver, isCash, proof.shot]);

  const close = () => {
    if (!submitting) onClose();
  };

  const submit = async () => {
    if (problem || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await employeeApi.refundToCustomer(bookingPublicId, {
        amount: amountNum,
        method,
        reason: reason.trim(),
        reference: !isCash && reference.trim() ? reference.trim() : undefined,
        proofFileId: !isCash && proof.shot?.status === 'ready' ? proof.shot.proof.proofFileId : undefined,
        confirmOverReceived: needsTick ? confirmOver : undefined,
        requestId,
      });
      onDone(res.data.message || 'Refund recorded.', res.data.data);
    } catch (err: any) {
      if (handleShiftRequired(err)) return;
      const code = err?.response?.data?.code;
      if (code === 'CONFIRM_OVER_RECEIVED') setConfirmOver(false);
      setError(apiErrorMessage(err, 'Could not record the refund.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={close}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={close}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.kav, { paddingTop: insets.top + 8 }]}
          pointerEvents="box-none"
        >
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>Refund to customer</Text>
              <TouchableOpacity onPress={close} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={Colors.ink} />
              </TouchableOpacity>
            </View>

            {query.isLoading ? (
              <View style={styles.center}>
                <ActivityIndicator color={Colors.orange} />
                <Text style={styles.infoText}>Loading the booking…</Text>
              </View>
            ) : query.isError || !options ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={16} color={Colors.availNone} />
                <Text style={styles.errorText}>{apiErrorMessage(query.error, 'Could not load the booking.')}</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <Text style={styles.body}>
                  Pay money back to {options.customer.name} now. The booking and its status stay as they are.
                </Text>
                <View style={styles.card}>
                  {[
                    ['Paid', options.money.paid],
                    ['Refunded so far', options.money.refunded],
                    ['Received (after refunds)', options.money.netReceived],
                    ['Owed back to the customer', options.money.owedBack],
                    ['Customer still owes', options.money.amountDue],
                  ].map(([label, v]) => (
                    <View key={label} style={styles.moneyRow}>
                      <Text style={styles.moneyLabel}>{label}</Text>
                      <Text style={styles.moneyValue}>{inr(num(v))}</Text>
                    </View>
                  ))}
                  {num(options.money.safetyDepositHeld) > 0 ? (
                    <Text style={styles.infoText}>
                      Safety deposit held {inr(num(options.money.safetyDepositHeld))} — paid back on the drop bill.
                    </Text>
                  ) : null}
                </View>

                <Text style={styles.sectionLabel}>Amount</Text>
                <TextInput
                  style={styles.input}
                  value={amount}
                  onChangeText={(t) => {
                    setAmount(t.replace(/[^0-9.]/g, ''));
                    setError(null);
                  }}
                  placeholder="₹0"
                  placeholderTextColor={Colors.ink4}
                  keyboardType="decimal-pad"
                  editable={!submitting}
                />
                {needsTick ? (
                  <>
                    <View style={styles.warnBox}>
                      <Ionicons name="warning-outline" size={16} color={Colors.availLow} />
                      <Text style={styles.warnText}>
                        {netReceived > 0
                          ? `This is ${inr(overBy)} more than the ${inr(netReceived)} received on this booking (after refunds).`
                          : 'Nothing received on this booking is left after refunds.'}
                      </Text>
                    </View>
                    <TouchableOpacity style={styles.tickRow} onPress={() => setConfirmOver((v) => !v)} activeOpacity={0.8}>
                      <View style={[styles.checkbox, confirmOver && styles.checkboxOn]}>
                        {confirmOver ? <Ionicons name="checkmark" size={15} color={Colors.white} /> : null}
                      </View>
                      <Text style={styles.tickText}>I confirm refunding {inr(amountNum)} anyway</Text>
                    </TouchableOpacity>
                  </>
                ) : null}

                <Text style={styles.sectionLabel}>Paid back by</Text>
                <View style={styles.chips}>
                  {options.methods.map((m) => (
                    <TouchableOpacity
                      key={m.value}
                      style={[styles.chip, method === m.value && styles.chipOn]}
                      onPress={() => {
                        setMethod(m.value);
                        setError(null);
                      }}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.chipText, method === m.value && styles.chipTextOn]}>{m.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {isCash ? (
                  <Text style={styles.infoText}>
                    {options.cashShiftOpen
                      ? 'Paid out of your cash drawer — recorded against your open cash shift.'
                      : 'Cash comes out of your drawer: open your cash shift first.'}
                  </Text>
                ) : (
                  <>
                    <Text style={styles.sectionLabel}>Reference / UTR (optional)</Text>
                    <TextInput
                      style={styles.input}
                      value={reference}
                      onChangeText={(t) => setReference(t.slice(0, referenceMax))}
                      placeholder="Transfer reference"
                      placeholderTextColor={Colors.ink4}
                      autoCapitalize="characters"
                      maxLength={referenceMax}
                      editable={!submitting}
                    />
                    {options.proofPhotoSupported ? (
                      <PaymentProofCapture
                        ctl={proof}
                        required
                        label="Refund payment-success photo"
                        helper="Required — photo of the UPI / bank transfer success screen."
                        disabled={submitting}
                      />
                    ) : null}
                  </>
                )}

                <Text style={styles.sectionLabel}>Reason</Text>
                <TextInput
                  style={[styles.input, styles.multiline]}
                  value={reason}
                  onChangeText={(t) => {
                    setReason(t.slice(0, reasonMax));
                    setError(null);
                  }}
                  placeholder={`Why is the money paid back? (${reasonMin}–${reasonMax} characters)`}
                  placeholderTextColor={Colors.ink4}
                  multiline
                  maxLength={reasonMax}
                  editable={!submitting}
                />

                {options.refunds.length > 0 ? (
                  <View style={styles.card}>
                    <Text style={styles.sectionLabel}>Earlier refunds to the customer</Text>
                    {options.refunds.map((r) => (
                      <View key={r.publicId}>
                        <View style={styles.moneyRow}>
                          <Text style={[styles.moneyLabel, r.voided && styles.struck]}>
                            {fmtDateTime(r.at)}
                            {r.by ? ` · ${r.by}` : ''}
                            {r.cashOutsideShift ? ' · outside a shift' : ''}
                          </Text>
                          <Text style={[styles.moneyValue, r.voided && styles.struck]}>{inr(num(r.amount))}</Text>
                        </View>
                        {/* Oct 25 2026: the refund's payment-success photo */}
                        {r.proofPhotoUrl ? (
                          <TouchableOpacity onPress={() => setViewing(r.proofPhotoUrl ?? null)} activeOpacity={0.8}>
                            <Image source={{ uri: r.proofPhotoUrl }} style={{ width: 40, height: 52, borderRadius: 6, marginTop: 4 }} />
                          </TouchableOpacity>
                        ) : null}
                        {r.voided ? (
                          <Text style={styles.infoText}>
                            Voided{r.voidReason ? `: ${r.voidReason}` : ''}
                            {r.voidedBy ? ` · ${r.voidedBy}` : ''}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : null}

                {error ? (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle-outline" size={16} color={Colors.availNone} />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : problem && amount.trim() !== '' ? (
                  <Text style={styles.infoText}>{problem}</Text>
                ) : null}

                <View style={styles.actions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={close} disabled={submitting} activeOpacity={0.85}>
                    <Text style={styles.cancelText}>Close</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmBtn, styles.confirmOrange, (!!problem || submitting) && styles.confirmDisabled]}
                    onPress={submit}
                    disabled={!!problem || submitting}
                    activeOpacity={0.85}
                  >
                    {submitting ? (
                      <ActivityIndicator color={Colors.white} />
                    ) : (
                      <Text style={styles.confirmText}>{amountValid ? `Refund ${inr(amountNum)}` : 'Refund'}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
      <ImageViewer
        visible={!!viewing}
        images={viewing ? [{ url: viewing, label: 'Refund payment photo' }] : []}
        onClose={() => setViewing(null)}
      />
    </Modal>
  );
}

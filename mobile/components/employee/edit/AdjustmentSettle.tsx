// Settles the money difference of an edit to a completed pickup / drop (client
// item 1, full edit): its ADJUSTMENT session is collected (cash / UPI photo /
// split / credit — cash needs the open shift) or refunded (cash / UPI) with the
// same counter endpoints as any bill.
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../../constants/colors';
import { employeeApi } from '../../../lib/api';
import { apiErrorMessage, handleShiftRequired } from '../../../lib/counterErrors';
import { COUNTER_PAYMENT_METHODS, counterChoiceLabel, type CounterPaymentMethod } from '../../../lib/counterPayment';
import CounterPaymentPicker, {
  CounterRefundPicker,
  useCounterPayment,
  useCounterRefund,
} from '../CounterPaymentPicker';
import type { ReturnSession } from '../../../types/api';
import type { AdjustmentLine } from '../../../types/completedOperation';

const num = (x: unknown) => Number(x ?? 0) || 0;
const inr = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// "Extra km  ₹500 → ₹750  (+₹250)" rows of an edit's difference.
export function AdjustmentLines({ lines, showUnchanged = false }: { lines: AdjustmentLine[]; showUnchanged?: boolean }) {
  const shown = showUnchanged ? lines : lines.filter((l) => num(l.delta) !== 0);
  if (shown.length === 0) return <Text style={styles.hint}>No charge changes.</Text>;
  return (
    <View style={{ gap: 10 }}>
      {shown.map((l) => {
        const delta = num(l.delta);
        return (
          <View key={l.key} style={styles.lineRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.lineLabel, delta === 0 && styles.unchanged]}>{l.label}</Text>
              <Text style={styles.lineSub}>
                {inr(num(l.oldAmount))} → {inr(num(l.newAmount))}
                {l.part === 'PICKUP' ? ' · pickup' : ''}
              </Text>
            </View>
            <Text style={[styles.lineDelta, delta > 0 && styles.more, delta < 0 && styles.less]}>
              {delta === 0 ? 'No change' : `${delta > 0 ? '+' : '−'}${inr(delta)}`}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

interface Props {
  session: ReturnSession;
  lines: AdjustmentLine[];
  // Methods the server allows (a safety deposit is never taken on credit)
  collectMethods?: string[];
  onSettled: (note: string | null) => void;
}

export default function AdjustmentSettle({ session, lines, collectMethods, onSettled }: Props) {
  const net = num(session.netPayable);
  const pay = useCounterPayment('CASH');
  const refundPay = useCounterRefund();
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const methods = COUNTER_PAYMENT_METHODS.filter(
    (m) => !collectMethods || collectMethods.includes(m as CounterPaymentMethod),
  );

  const settle = async () => {
    if (busyRef.current || net === 0) return;
    const choice = net > 0 ? pay.resolve(net) : null;
    if (net > 0 && !choice) return;
    const refundChoice = net < 0 ? refundPay.resolve() : null;
    if (net < 0 && !refundChoice) return;
    busyRef.current = true;
    setSettling(true);
    setError(null);
    const idempotencyKey = `adjust-settle:${session.publicId}`;
    try {
      if (net < 0 && refundChoice) {
        await employeeApi.recordSessionRefund(session.publicId, {
          method: refundChoice.method,
          amount: Math.abs(net),
          idempotencyKey,
          notes: 'Refund of the difference after an edit',
          ...(refundChoice.proofFileId ? { proof_file_id: refundChoice.proofFileId } : {}),
        });
        onSettled(
          refundChoice.method === 'CASH'
            ? `${inr(net)} refunded in cash — the branch manager acknowledges it.`
            : `${inr(net)} refunded by UPI.`,
        );
      } else if (choice) {
        await employeeApi.recordSessionPayment(
          session.publicId,
          choice.method === 'SPLIT'
            ? {
              method: 'SPLIT',
              amount: net,
              idempotencyKey,
              notes: `Split: ₹${choice.cashAmount.toFixed(2)} cash + ₹${choice.upiAmount.toFixed(2)} UPI`,
              cashAmount: choice.cashAmount,
              onlineAmount: choice.upiAmount,
              onlineGateway: 'UPI',
              proof_file_id: choice.proofFileId,
            }
            : choice.method === 'UPI'
              ? { method: 'UPI', amount: net, idempotencyKey, proof_file_id: choice.proofFileId }
              : choice.method === 'CREDIT'
                ? { method: 'CREDIT', amount: net, idempotencyKey, collateral: choice.collateral }
                : { method: 'CASH', amount: net, idempotencyKey },
        );
        onSettled(
          choice.method === 'CREDIT'
            ? `${inr(net)} ${counterChoiceLabel(choice).charAt(0).toLowerCase()}${counterChoiceLabel(choice).slice(1)} — the branch manager clears it when the customer pays.`
            : `Collected ${inr(net)} · ${counterChoiceLabel(choice)}.`,
        );
      }
    } catch (err: any) {
      if (handleShiftRequired(err)) return;
      if (net > 0 && pay.showServerError(err)) return;
      if (net < 0 && refundPay.showServerError(err)) return;
      setError(apiErrorMessage(err, 'Could not settle the difference. Try again.'));
    } finally {
      busyRef.current = false;
      setSettling(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={[styles.outcome, net > 0 ? styles.outcomeCollect : styles.outcomeRefund]}>
        <Ionicons name={net > 0 ? 'arrow-down-circle' : 'arrow-up-circle'} size={20} color={net > 0 ? Colors.availLow : Colors.availGood} />
        <Text style={styles.outcomeText}>{net > 0 ? `Collect ${inr(net)} more` : `Refund ${inr(net)}`}</Text>
      </View>
      <AdjustmentLines lines={lines} />
      {net > 0 ? (
        <CounterPaymentPicker ctl={pay} amount={net} methods={methods} disabled={settling} />
      ) : (
        <CounterRefundPicker ctl={refundPay} amount={Math.abs(net)} disabled={settling} />
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={[styles.button, settling && styles.buttonBusy]} onPress={settle} disabled={settling} activeOpacity={0.85}>
        {settling ? <ActivityIndicator color={Colors.white} /> : null}
        <Text style={styles.buttonText}>{net > 0 ? `Collect ${inr(net)}` : `Refund ${inr(net)}`}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  hint: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lineLabel: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink },
  unchanged: { color: Colors.ink3 },
  lineSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink3, marginTop: 2 },
  lineDelta: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink3 },
  more: { color: Colors.availLow },
  less: { color: Colors.availGood },
  outcome: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, padding: 12 },
  outcomeCollect: { backgroundColor: Colors.availLowSoft },
  outcomeRefund: { backgroundColor: Colors.availGoodSoft },
  outcomeText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  error: { fontFamily: Fonts.body, fontSize: 13, color: Colors.availNone, lineHeight: 18 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.orange,
    borderRadius: 16,
    paddingVertical: 16,
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { fontFamily: Fonts.bodySemiBold, fontSize: 16, color: Colors.white },
});

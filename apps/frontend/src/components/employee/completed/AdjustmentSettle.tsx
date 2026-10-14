import { useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { isAxiosError } from "axios";

import { cn } from "@/lib/utils";
import {
  COUNTER_PAYMENT_METHODS,
  apiCode,
  counterFieldErrors,
  counterPaymentProblem,
  emptyCounterPayment,
  sessionPaymentFields,
  type CounterFieldErrors,
  type CounterPaymentMethod,
  type CounterPaymentValue,
  type CounterProof,
  type CounterRefundMethod,
} from "@/lib/counterPayment";
import { paymentSessionService, type PaymentSession } from "@/services/paymentSession.service";
import type { AdjustmentLine } from "@/services/completedOperation.service";
import { CounterPaymentFields, RefundMethodFields } from "@/components/payment/counter/CounterPaymentFields";
import { ShiftRequiredNotice } from "@/components/employee/counter/ShiftRequiredNotice";
import { Button } from "@/components/ui/button";

/**
 * The money difference of an edit to a completed pickup / drop (client item 1,
 * full edit): its lines (old → new) and — while unsettled — collecting it (cash /
 * UPI photo / split / credit) or refunding it (cash / UPI) on its ADJUSTMENT
 * session with the usual record-payment / record-refund endpoints.
 */

const num = (x: unknown) => Number(x ?? 0) || 0;
const inr = (n: number) => `₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function AdjustmentLinesTable({ lines, showUnchanged = false }: { lines: AdjustmentLine[]; showUnchanged?: boolean }) {
  const shown = showUnchanged ? lines : lines.filter((l) => num(l.delta) !== 0);
  if (shown.length === 0) return <p className="text-sm text-muted-foreground">No charge changes.</p>;
  return (
    <div className="divide-y">
      {shown.map((l) => {
        const delta = num(l.delta);
        return (
          <div key={l.key} className="flex items-start justify-between gap-4 py-2 text-sm">
            <div>
              <p className={cn("font-medium", delta === 0 ? "text-muted-foreground" : "text-gray-900")}>{l.label}</p>
              <p className="text-xs text-muted-foreground">
                {inr(num(l.oldAmount))} → {inr(num(l.newAmount))}
                {l.part === "PICKUP" ? " · pickup" : ""}
              </p>
            </div>
            <span
              className={cn(
                "font-semibold whitespace-nowrap",
                delta > 0 ? "text-amber-700" : delta < 0 ? "text-emerald-700" : "text-muted-foreground",
              )}
            >
              {delta === 0 ? "No change" : `${delta > 0 ? "+" : "−"}${inr(delta)}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface AdjustmentSettleProps {
  session: PaymentSession;
  lines: AdjustmentLine[];
  /** Methods the server allows (a safety deposit is never taken on credit) */
  collectMethods?: string[];
  onSettled: (note: string) => void;
  /**
   * The counter can't settle it any more (409 ADJUSTMENT_ALREADY_COLLECTED — collected
   * in Settlements meanwhile; ADJUSTMENT_ALREADY_REFUNDED — more than was paid): the
   * server's message, for the caller to reload what it shows.
   */
  onRefused?: (message: string) => void;
}

/** Settling refusals that leave nothing for the counter to do. */
const REFUSED_CODES = new Set(["ADJUSTMENT_ALREADY_COLLECTED", "ADJUSTMENT_ALREADY_REFUNDED"]);

export function AdjustmentSettle({ session, lines, collectMethods, onSettled, onRefused }: AdjustmentSettleProps) {
  const net = num(session.netPayable);
  const [pay, setPay] = useState<CounterPaymentValue>(() => emptyCounterPayment());
  const [payErrors, setPayErrors] = useState<CounterFieldErrors>({});
  const [refundMethod, setRefundMethod] = useState<CounterRefundMethod>("CASH");
  const [refundProof, setRefundProof] = useState<CounterProof | null>(null);
  const [refundProofError, setRefundProofError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsShift, setNeedsShift] = useState(false);
  const methods = COUNTER_PAYMENT_METHODS.filter(
    (m) => !collectMethods || collectMethods.includes(m as CounterPaymentMethod),
  );
  const idempotencyKey = `adjust-settle:${session.publicId}`;

  const settle = async () => {
    setError(null);
    setNeedsShift(false);
    if (net > 0) {
      const problem = counterPaymentProblem(pay, net);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setSaving(true);
    try {
      if (net < 0) {
        await paymentSessionService.recordRefund(session.publicId, {
          method: refundMethod,
          amount: Math.abs(net),
          idempotencyKey,
          notes: "Refund of the difference after an edit",
          ...(refundProof ? { proof_file_id: refundProof.proofFileId } : {}),
        });
        toast.success(`Refunded ${inr(net)}`);
        onSettled(refundMethod === "CASH" ? `${inr(net)} refunded in cash — the branch manager acknowledges it.` : `${inr(net)} refunded by UPI.`);
      } else {
        await paymentSessionService.recordPayment(session.publicId, {
          ...sessionPaymentFields(pay, net),
          amount: net,
          idempotencyKey,
        });
        toast.success(pay.method === "CREDIT" ? `${inr(net)} put on credit` : `Collected ${inr(net)}`);
        onSettled(pay.method === "CREDIT" ? `${inr(net)} put on credit — the branch manager clears it when the customer pays.` : `Collected ${inr(net)}.`);
      }
    } catch (err) {
      const code = apiCode(err);
      if (code === "SHIFT_REQUIRED") {
        setNeedsShift(true);
      } else if (code && REFUSED_CODES.has(code)) {
        const message = isAxiosError<{ message?: string }>(err)
          ? err.response?.data?.message ?? "This difference can't be settled at the counter."
          : "This difference can't be settled at the counter.";
        setError(message);
        onRefused?.(message);
      } else if (net > 0 && Object.keys(counterFieldErrors(err)).length > 0) {
        setPayErrors(counterFieldErrors(err));
      } else if (net < 0 && counterFieldErrors(err).proof) {
        setRefundProofError(counterFieldErrors(err).proof ?? null);
      } else {
        setError(
          isAxiosError<{ message?: string }>(err)
            ? err.response?.data?.message ?? "Couldn't settle the difference. Try again."
            : "Couldn't settle the difference. Try again.",
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border p-3 text-sm font-semibold",
          net > 0 ? "bg-amber-50 border-amber-200 text-amber-900" : "bg-emerald-50 border-emerald-200 text-emerald-900",
        )}
      >
        {net > 0 ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
        {net > 0 ? `Collect ${inr(net)} more` : `Refund ${inr(net)}`}
      </div>
      <AdjustmentLinesTable lines={lines} />
      {net > 0 ? (
        <CounterPaymentFields
          value={pay}
          onChange={setPay}
          amount={net}
          proofRole="staff"
          methods={methods}
          errors={payErrors}
          onEdit={() => setPayErrors({})}
          disabled={saving}
          idPrefix={`adjust-${session.publicId}`}
        />
      ) : (
        <RefundMethodFields
          method={refundMethod}
          onMethodChange={setRefundMethod}
          proof={refundProof}
          onProofChange={(p) => {
            setRefundProof(p);
            setRefundProofError(null);
          }}
          proofRole="staff"
          proofError={refundProofError}
          disabled={saving}
          idPrefix={`adjust-refund-${session.publicId}`}
        />
      )}
      {needsShift && <ShiftRequiredNotice onShiftOpened={() => setNeedsShift(false)} />}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button onClick={settle} disabled={saving} className="w-full bg-[#FF5F00] hover:bg-[#e65500]">
        {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
        {net > 0 ? `Collect ${inr(net)}` : `Refund ${inr(net)}`}
      </Button>
    </div>
  );
}

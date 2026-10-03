import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CREDIT_NOT_FOR_DEPOSIT_MESSAGE } from "@repo/schemas";
import type { PaymentSession, RecordPaymentResult } from "@/services/paymentSession.service";
import { paymentSessionService } from "@/services/paymentSession.service";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiErrorMessage, counterErrorCode } from "@/lib/counterErrors";
import {
  chargesSafetyDeposit,
  counterFieldErrors,
  counterMethodTakesMoney,
  depositRefundOnSession,
  counterPaymentErrorField,
  counterPaymentParts,
  counterPaymentProblem,
  emptyCounterPayment,
  formatRupees,
  sessionPaymentFields,
  type CounterPaymentValue,
  type CounterProof,
  type CounterRefundMethod,
} from "@/lib/counterPayment";
import { CounterPaymentFields, RefundMethodFields } from "@/components/payment/counter/CounterPaymentFields";
import { ShiftRequiredNotice } from "@/components/employee/counter/ShiftRequiredNotice";
import { dlConflictLabel } from "@/lib/dlInUse";
import { useActiveShift } from "@/components/employee/counter/useActiveShift";
import { usePaymentStore } from "@/store/payment.store";

// Cash / UPI (photo of the customer's payment screen) / Split / Credit (#3, #11).
// UPI is the branch's merchant QR — no UTR box; the photo backs the payment.

interface RecordPaymentPanelProps {
  session: PaymentSession;
  /** The updated session; `credit` / `depositRefund` say what this settlement put on credit / refunded. */
  onSuccess: (updatedSession: RecordPaymentResult) => void;
  /**
   * Called with any failed record/refund call (e.g. a stale drop bill) so the
   * parent can react. The panel still shows the server's message itself.
   */
  onError?: (error: unknown) => void;
  /** Pickup bill: take the safety deposit off so the rest can go on credit. */
  onRemoveDeposit?: () => void;
  removingDeposit?: boolean;
  className?: string;
}

export function RecordPaymentPanel({
  session,
  onSuccess,
  onError,
  onRemoveDeposit,
  removingDeposit = false,
  className,
}: RecordPaymentPanelProps) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [payment, setPayment] = useState<CounterPaymentValue>(() => emptyCounterPayment());
  // Refund of a drop remainder (deposit set off, more than the charges)
  const [refundMethod, setRefundMethod] = useState<CounterRefundMethod>("CASH");
  const [refundProof, setRefundProof] = useState<CounterProof | null>(null);
  // Deposit refunded in full on a drop bill (#6) — paid back with this settlement
  const [depositMethod, setDepositMethod] = useState<CounterRefundMethod>("CASH");
  const [depositProof, setDepositProof] = useState<CounterProof | null>(null);
  const { activeShift, needsShift } = useActiveShift();

  const netPayable = parseFloat(session.netPayable);
  const isZeroBalance = netPayable === 0;
  const isRefund = netPayable < 0;
  const amount = Math.abs(netPayable);
  const depositRefundDue = depositRefundOnSession(session);
  const depositRefund =
    depositRefundDue > 0
      ? {
          method: depositMethod,
          ...(depositMethod === "UPI" && depositProof ? { proof_file_id: depositProof.proofFileId } : {}),
        }
      : undefined;
  // A safety deposit can't go on credit (CREDIT_NOT_FOR_DEPOSIT)
  const creditBlocked = payment.method === "CREDIT" && chargesSafetyDeposit(session);

  const zeroMutation = useMutation({
    mutationFn: () =>
      paymentSessionService.recordPayment(session.publicId, {
        method: "CASH",
        amount: 0,
        idempotencyKey,
        notes: depositRefund
          ? "No charges to collect — safety deposit refunded in full"
          : "No payment required — zero balance",
        ...(depositRefund ? { depositRefund } : {}),
      }),
    onSuccess,
    onError,
  });

  const payMutation = useMutation({
    mutationFn: () => {
      const parts = counterPaymentParts(payment, amount);
      const notes =
        payment.method === "CASH"
          ? `Cash payment of ₹${amount.toFixed(2)}`
          : payment.method === "UPI"
            ? `UPI payment of ₹${amount.toFixed(2)}`
            : payment.method === "SPLIT"
              ? `Split: ₹${parts.cash.toFixed(2)} cash + ₹${parts.upi.toFixed(2)} UPI`
              : undefined; // Credit: the server notes the collateral
      return paymentSessionService.recordPayment(session.publicId, {
        ...sessionPaymentFields(payment, amount),
        amount,
        idempotencyKey,
        notes,
        ...(depositRefund ? { depositRefund } : {}),
      });
    },
    onSuccess,
    onError: (err) => {
      // The server just said there's no open shift — drop any stale one so the
      // notice stays until a shift is actually opened (see effect below).
      if (counterErrorCode(err) === "SHIFT_REQUIRED") {
        usePaymentStore.getState().setActiveShift(null);
      }
      onError?.(err);
    },
  });

  const refundMutation = useMutation({
    mutationFn: () =>
      paymentSessionService.recordRefund(session.publicId, {
        method: refundMethod,
        amount,
        idempotencyKey,
        notes: `${refundMethod === "CASH" ? "Cash" : "UPI"} refund of ₹${amount.toFixed(2)}`,
        ...(refundMethod === "UPI" && refundProof ? { proof_file_id: refundProof.proofFileId } : {}),
      }),
    onSuccess,
    onError,
  });

  // A shift opened anywhere (this notice or the navbar banner) clears a
  // SHIFT_REQUIRED failure so staff can collect straight away.
  const { error: payError, reset: resetPay } = payMutation;
  useEffect(() => {
    if (activeShift && counterErrorCode(payError) === "SHIFT_REQUIRED") resetPay();
  }, [activeShift, payError, resetPay]);

  // A recomputed bill (new session / amount) makes earlier failures stale.
  const { reset: resetRefund } = refundMutation;
  const { reset: resetZero } = zeroMutation;
  useEffect(() => {
    resetPay();
    resetRefund();
    resetZero();
  }, [session.publicId, session.netPayable, resetPay, resetRefund, resetZero]);

  const isLoading = payMutation.isPending || refundMutation.isPending || zeroMutation.isPending;
  const error = payMutation.error || refundMutation.error || zeroMutation.error;
  const errorCode = counterErrorCode(error);
  // Cash, UPI and split take money and need an open shift; credit and refunds
  // don't (the server returns SHIFT_REQUIRED only for the gated methods).
  const shiftGated = !isRefund && !isZeroBalance && counterMethodTakesMoney(payment.method);
  const shiftRequired =
    shiftGated && (needsShift || counterErrorCode(payError) === "SHIFT_REQUIRED");
  // Server errors are shown at the field they concern. A photo error while the
  // payment itself carries no photo is about the refund photo.
  const errorField = counterPaymentErrorField(error);
  const fieldErrors = counterFieldErrors(error);
  const paymentHasPhoto = !isRefund && !isZeroBalance && (payment.method === "UPI" || payment.method === "SPLIT");
  const paymentErrors = paymentHasPhoto ? fieldErrors : { ...fieldErrors, proof: null };
  const refundPhotoError = errorField === "proof" && !paymentHasPhoto ? fieldErrors.proof ?? null : null;
  const generalError = !!error && !errorField && errorCode !== "SHIFT_REQUIRED";
  const problem = isRefund || isZeroBalance ? null : counterPaymentProblem(payment, amount);
  const canSubmit = !shiftRequired && !problem && !creditBlocked;

  // Staff changed the input a server error referred to — clear it.
  const clearErrors = () => {
    if (payMutation.error) resetPay();
    if (refundMutation.error) resetRefund();
    if (zeroMutation.error) resetZero();
  };

  const generalErrorText = generalError && (
    <p className="text-sm text-destructive">
      {apiErrorMessage(error, "Something went wrong. Try again.")}
      {/* DL_IN_USE (X3): the booking holding this driving licence */}
      {dlConflictLabel(error) && <span className="mt-1 block font-medium">{dlConflictLabel(error)}</span>}
    </p>
  );

  // Deposit refunded in full with this settlement (#6)
  const depositRefundSection = depositRefundDue > 0 && (
    <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-blue-900">
          <Undo2 className="h-4 w-4" /> Safety deposit refund
        </span>
        <span className="text-sm font-semibold text-blue-900">{formatRupees(depositRefundDue)}</span>
      </div>
      <RefundMethodFields
        idPrefix="rpp-deposit-refund"
        label="Refund the deposit by"
        method={depositMethod}
        onMethodChange={(m) => {
          setDepositMethod(m);
          clearErrors();
        }}
        proof={depositProof}
        onProofChange={(p) => {
          setDepositProof(p);
          clearErrors();
        }}
        proofRole="staff"
        proofError={refundPhotoError}
        disabled={isLoading}
      />
    </div>
  );

  if (session.status === "COMPLETED") {
    return (
      <div className={cn("rounded-lg border bg-green-50 border-green-200 px-4 py-3 text-sm text-green-700 font-medium", className)}>
        Payment complete
      </div>
    );
  }

  if (session.status !== "AWAITING_PAYMENT" && session.status !== "PAYMENT_INITIATED") {
    return null;
  }

  if (isZeroBalance) {
    return (
      <div className={cn("rounded-lg border bg-card shadow-sm", className)}>
        <div className="px-4 py-4 space-y-3">
          <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2.5 text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span className="font-medium">
              {depositRefundDue > 0
                ? "No charges to collect."
                : "No payment required — charges are fully covered."}
            </span>
          </div>
          {depositRefundSection}
          {generalErrorText}
          <Button
            className="w-full"
            disabled={zeroMutation.isPending}
            onClick={() => zeroMutation.mutate()}
          >
            {zeroMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing…</>
            ) : depositRefundDue > 0 ? (
              `Complete — refund deposit ${formatRupees(depositRefundDue)} (${depositMethod === "CASH" ? "Cash" : "UPI"})`
            ) : (
              "Complete — No Payment Needed"
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border bg-card shadow-sm", className)}>
      <div className="px-4 py-3 border-b">
        <span className="text-sm font-medium text-muted-foreground">
          {isRefund ? "Issue refund" : "Collect payment"}
        </span>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Amount */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {isRefund ? "Refund amount" : "Amount to collect"}
          </span>
          <span className={cn("text-xl font-bold", isRefund ? "text-green-600" : "text-foreground")}>
            ₹{amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </span>
        </div>

        {/* Cash / UPI (photo) / Split / Credit — payments only */}
        {!isRefund && (
          <CounterPaymentFields
            idPrefix="rpp"
            value={payment}
            onChange={setPayment}
            amount={amount}
            proofRole="staff"
            errors={paymentErrors}
            onEdit={clearErrors}
            disabled={isLoading}
            cashNote={
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                Cash payments require manager confirmation. The booking will be processed immediately, but a manager must verify the cash.
              </p>
            }
            creditNote={
              chargesSafetyDeposit(session) && (
                <div className="space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
                  <p className="text-xs text-red-700">{CREDIT_NOT_FOR_DEPOSIT_MESSAGE}</p>
                  {onRemoveDeposit && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 border-red-200 text-red-700 hover:bg-red-100"
                      disabled={removingDeposit}
                      onClick={onRemoveDeposit}
                    >
                      {removingDeposit && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      Remove safety deposit
                    </Button>
                  )}
                </div>
              )
            }
          />
        )}

        {/* Refund of the remainder — Cash, or UPI with an optional photo */}
        {isRefund && (
          <RefundMethodFields
            idPrefix="rpp-refund"
            method={refundMethod}
            onMethodChange={(m) => {
              setRefundMethod(m);
              clearErrors();
            }}
            proof={refundProof}
            onProofChange={(p) => {
              setRefundProof(p);
              clearErrors();
            }}
            proofRole="staff"
            proofError={refundPhotoError}
            disabled={isLoading}
          />
        )}

        {!isRefund && depositRefundSection}

        {shiftRequired ? <ShiftRequiredNotice onShiftOpened={resetPay} /> : generalErrorText}

        <Button
          className="w-full"
          disabled={isLoading || (!isRefund && !canSubmit)}
          onClick={() => isRefund ? refundMutation.mutate() : payMutation.mutate()}
        >
          {isLoading
            ? "Processing…"
            : isRefund
              ? `Refund ${formatRupees(amount)} (${refundMethod === "UPI" ? "UPI" : "Cash"})`
              : `${
                  payment.method === "CASH"
                    ? `Mark ${formatRupees(amount)} as collected (Cash)`
                    : payment.method === "UPI"
                      ? `Record UPI payment ${formatRupees(amount)}`
                      : payment.method === "SPLIT"
                        ? `Record split payment ${formatRupees(amount)}`
                        : `Put ${formatRupees(amount)} on credit`
                }${depositRefundDue > 0 ? ` · refund deposit ${formatRupees(depositRefundDue)}` : ""}`}
        </Button>
        {!isRefund && !shiftRequired && problem && (payment.method !== "SPLIT" || payment.splitCash !== "") && (
          <p className="text-center text-xs text-muted-foreground">{problem}</p>
        )}
      </div>
    </div>
  );
}

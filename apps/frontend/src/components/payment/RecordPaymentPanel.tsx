import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { PaymentSession } from "@/services/paymentSession.service";
import { paymentSessionService } from "@/services/paymentSession.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  apiErrorMessage,
  cleanUtr,
  counterErrorCode,
  isValidUtr,
} from "@/lib/counterErrors";
import { ShiftRequiredNotice } from "@/components/employee/counter/ShiftRequiredNotice";
import { useActiveShift } from "@/components/employee/counter/useActiveShift";
import { usePaymentStore } from "@/store/payment.store";

// UPI = customer paid the shop's UPI QR, recorded by its 12-digit UTR.
// OTHER = a reference from another gateway. Both are sent as method ONLINE.
type Method = "CASH" | "UPI" | "SPLIT" | "OTHER";
type Gateway = "Razorpay" | "Other";

const METHODS: Method[] = ["CASH", "UPI", "SPLIT", "OTHER"];
const METHOD_LABELS: Record<Method, string> = {
  CASH: "Cash",
  UPI: "UPI (UTR)",
  SPLIT: "Split",
  OTHER: "Other online",
};
const GATEWAYS: Gateway[] = ["Razorpay", "Other"];

interface RecordPaymentPanelProps {
  session: PaymentSession;
  onSuccess: (updatedSession: PaymentSession) => void;
  /**
   * Called with any failed record/refund call (e.g. a stale drop bill) so the
   * parent can react. The panel still shows the server's message itself.
   */
  onError?: (error: unknown) => void;
  className?: string;
}

export function RecordPaymentPanel({ session, onSuccess, onError, className }: RecordPaymentPanelProps) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [method, setMethod] = useState<Method>("CASH");
  const [utr, setUtr] = useState("");
  const [utrTouched, setUtrTouched] = useState(false);
  const [txnRef, setTxnRef] = useState("");
  const [gateway, setGateway] = useState<Gateway>("Razorpay");
  const [splitCash, setSplitCash] = useState("");
  const [splitOnline, setSplitOnline] = useState("");
  const { activeShift, needsShift } = useActiveShift();

  const netPayable = parseFloat(session.netPayable);
  const isZeroBalance = netPayable === 0;
  const isRefund = netPayable < 0;
  const amount = Math.abs(netPayable);

  // Validate split amounts
  const splitCashNum = parseFloat(splitCash) || 0;
  const splitOnlineNum = parseFloat(splitOnline) || 0;
  const splitTotal = splitCashNum + splitOnlineNum;
  const splitValid = method !== "SPLIT" || Math.abs(splitTotal - amount) < 0.01;
  const needsUtr = method === "UPI" || (method === "SPLIT" && splitOnlineNum > 0);
  const utrValid = isValidUtr(utr);

  const zeroMutation = useMutation({
    mutationFn: () =>
      paymentSessionService.recordPayment(session.publicId, {
        method: "CASH",
        amount: 0,
        idempotencyKey,
        notes: "No payment required — zero balance",
      }),
    onSuccess,
    onError,
  });

  const payMutation = useMutation({
    mutationFn: () => {
      if (method === "SPLIT") {
        return paymentSessionService.recordPayment(session.publicId, {
          method: "SPLIT",
          amount,
          idempotencyKey,
          notes: `Split: ₹${splitCashNum.toFixed(2)} cash + ₹${splitOnlineNum.toFixed(2)} UPI`,
          cashAmount: splitCashNum,
          onlineAmount: splitOnlineNum,
          onlineTransactionRef: splitOnlineNum > 0 ? cleanUtr(utr) : undefined,
          onlineGateway: splitOnlineNum > 0 ? "UPI" : undefined,
        });
      }
      if (method === "UPI") {
        return paymentSessionService.recordPayment(session.publicId, {
          method: "ONLINE",
          amount,
          idempotencyKey,
          notes: `UPI payment of ₹${amount.toFixed(2)}`,
          onlineTransactionRef: cleanUtr(utr),
          onlineGateway: "UPI",
        });
      }
      if (method === "OTHER") {
        return paymentSessionService.recordPayment(session.publicId, {
          method: "ONLINE",
          amount,
          idempotencyKey,
          notes: `Online payment of ₹${amount.toFixed(2)}`,
          onlineTransactionRef: txnRef.trim(),
          onlineGateway: gateway,
        });
      }
      return paymentSessionService.recordPayment(session.publicId, {
        method: "CASH",
        amount,
        idempotencyKey,
        notes: `Cash payment of ₹${amount.toFixed(2)}`,
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

  const refundMethod = method === "UPI" || method === "OTHER" ? "ONLINE" : "CASH";
  const refundMutation = useMutation({
    mutationFn: () =>
      paymentSessionService.recordRefund(session.publicId, {
        method: refundMethod,
        amount,
        idempotencyKey,
        notes: `${refundMethod === "CASH" ? "Cash" : "Online"} refund of ₹${amount.toFixed(2)}`,
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

  const isLoading = payMutation.isPending || refundMutation.isPending;
  const error = payMutation.error || refundMutation.error;
  const errorCode = counterErrorCode(error);
  // Cash, split and UPI (UTR) need an open shift; refunds and other online
  // gateways don't (server returns SHIFT_REQUIRED only for the gated methods).
  const shiftGated = !isRefund && method !== "OTHER";
  const shiftRequired =
    shiftGated && (needsShift || counterErrorCode(payError) === "SHIFT_REQUIRED");
  const utrServerError =
    errorCode === "INVALID_UTR" || errorCode === "DUPLICATE_UTR"
      ? apiErrorMessage(error, "Check the UTR number and try again.")
      : null;
  const utrError =
    utrServerError ?? (utrTouched && !utrValid ? "Enter the 12-digit UTR number." : null);
  const canSubmit = (() => {
    if (shiftRequired) return false;
    if (method === "CASH") return true;
    if (method === "UPI") return utrValid;
    if (method === "OTHER") return txnRef.trim().length > 0;
    // SPLIT
    return splitValid && (!needsUtr || utrValid);
  })();

  const handleUtrChange = (value: string) => {
    setUtr(value);
    // A server UTR error refers to the old value — clear it once staff edit.
    if (utrServerError) resetPay();
  };

  const utrField = (
    <div className="space-y-1.5">
      <Label htmlFor="rpp-utr" className={method === "SPLIT" ? "text-xs" : "text-sm"}>
        UTR number <span className="text-red-500">*</span>
      </Label>
      <Input
        id="rpp-utr"
        inputMode="numeric"
        autoComplete="off"
        maxLength={20}
        placeholder="12-digit UTR"
        value={utr}
        onChange={(e) => handleUtrChange(e.target.value)}
        onBlur={() => setUtrTouched(true)}
        aria-invalid={!!utrError}
        className="h-10 font-mono tracking-wide"
      />
      {utrError ? (
        <p className="text-xs text-red-600">{utrError}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          From the customer's UPI app after paying the shop's QR.
        </p>
      )}
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
            <span className="font-medium">No payment required — charges are fully covered.</span>
          </div>
          {!!zeroMutation.error && (
            <p className="text-sm text-destructive">
              {apiErrorMessage(zeroMutation.error, "Something went wrong. Try again.")}
            </p>
          )}
          <Button
            className="w-full"
            disabled={zeroMutation.isPending}
            onClick={() => zeroMutation.mutate()}
          >
            {zeroMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing…</>
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

        {/* Method toggle — only for payments, not refunds */}
        {!isRefund && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={cn(
                  "px-3 py-2.5 rounded-lg border text-sm font-medium transition-all",
                  method === m
                    ? "border-orange-500 bg-orange-50 text-orange-700"
                    : "border-neutral-200 hover:border-neutral-300 text-neutral-700",
                )}
              >
                {METHOD_LABELS[m]}
              </button>
            ))}
          </div>
        )}

        {/* UPI (UTR) fields */}
        {!isRefund && method === "UPI" && utrField}

        {/* Other online gateway fields */}
        {!isRefund && method === "OTHER" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rpp-txnRef" className="text-sm">
                Transaction Reference <span className="text-red-500">*</span>
              </Label>
              <Input
                id="rpp-txnRef"
                placeholder="e.g. pay_xyz789"
                value={txnRef}
                onChange={(e) => setTxnRef(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rpp-gateway" className="text-sm">Gateway</Label>
              <Select value={gateway} onValueChange={(v) => setGateway(v as Gateway)}>
                <SelectTrigger id="rpp-gateway" className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GATEWAYS.map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Split fields */}
        {!isRefund && method === "SPLIT" && (
          <div className="space-y-3 p-3 rounded-lg bg-neutral-50 border">
            <p className="text-xs text-muted-foreground font-medium">
              Total to split: ₹{amount.toFixed(2)}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Cash Amount (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  max={amount}
                  placeholder="0"
                  value={splitCash}
                  onChange={(e) => {
                    setSplitCash(e.target.value);
                    const cash = parseFloat(e.target.value) || 0;
                    setSplitOnline(String(Math.max(0, amount - cash).toFixed(2)));
                  }}
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">UPI Amount (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  max={amount}
                  placeholder="0"
                  value={splitOnline}
                  onChange={(e) => {
                    setSplitOnline(e.target.value);
                    const online = parseFloat(e.target.value) || 0;
                    setSplitCash(String(Math.max(0, amount - online).toFixed(2)));
                  }}
                  className="h-10"
                />
              </div>
            </div>
            {!splitValid && splitCash && splitOnline && (
              <p className="text-xs text-red-600">Cash + UPI must equal ₹{amount.toFixed(2)}</p>
            )}
            {splitOnlineNum > 0 && utrField}
          </div>
        )}

        {!isRefund && method === "CASH" && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            Cash payments require manager confirmation. The booking will be processed immediately, but a manager must verify the cash.
          </p>
        )}

        {shiftRequired ? (
          <ShiftRequiredNotice onShiftOpened={resetPay} />
        ) : (
          !!error && !utrServerError && errorCode !== "SHIFT_REQUIRED" && (
            <p className="text-sm text-destructive">
              {apiErrorMessage(error, "Something went wrong. Try again.")}
            </p>
          )
        )}

        <Button
          className="w-full"
          disabled={isLoading || (!isRefund && !canSubmit)}
          onClick={() => isRefund ? refundMutation.mutate() : payMutation.mutate()}
        >
          {isLoading
            ? "Processing…"
            : isRefund
              ? `Refund ₹${amount.toFixed(2)} (${refundMethod === "ONLINE" ? "Online" : "Cash"})`
              : method === "CASH"
                ? `Mark ₹${amount.toFixed(2)} as collected (Cash)`
                : method === "UPI"
                  ? `Record UPI Payment ₹${amount.toFixed(2)}`
                  : method === "OTHER"
                    ? `Record Online Payment ₹${amount.toFixed(2)}`
                    : `Record Split Payment ₹${amount.toFixed(2)}`}
        </Button>
      </div>
    </div>
  );
}

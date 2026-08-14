import { useState } from "react";
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

type Method = "CASH" | "ONLINE" | "SPLIT";
type Gateway = "UPI" | "Razorpay" | "Other";

const GATEWAYS: Gateway[] = ["UPI", "Razorpay", "Other"];

interface RecordPaymentPanelProps {
  session: PaymentSession;
  onSuccess: (updatedSession: PaymentSession) => void;
  className?: string;
}

export function RecordPaymentPanel({ session, onSuccess, className }: RecordPaymentPanelProps) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [method, setMethod] = useState<Method>("CASH");
  const [txnRef, setTxnRef] = useState("");
  const [gateway, setGateway] = useState<Gateway>("UPI");
  const [splitCash, setSplitCash] = useState("");
  const [splitOnline, setSplitOnline] = useState("");

  const netPayable = parseFloat(session.netPayable);
  const isZeroBalance = netPayable === 0;
  const isRefund = netPayable < 0;
  const amount = Math.abs(netPayable);

  // Validate split amounts
  const splitCashNum = parseFloat(splitCash) || 0;
  const splitOnlineNum = parseFloat(splitOnline) || 0;
  const splitTotal = splitCashNum + splitOnlineNum;
  const splitValid = method !== "SPLIT" || Math.abs(splitTotal - amount) < 0.01;
  const splitNeedsRef = method === "SPLIT" && splitOnlineNum > 0 && !txnRef.trim();

  const zeroMutation = useMutation({
    mutationFn: () =>
      paymentSessionService.recordPayment(session.publicId, {
        method: "CASH",
        amount: 0,
        idempotencyKey,
        notes: "No payment required — zero balance",
      }),
    onSuccess,
  });

  const payMutation = useMutation({
    mutationFn: () => {
      if (method === "SPLIT") {
        return paymentSessionService.recordPayment(session.publicId, {
          method: "SPLIT",
          amount,
          idempotencyKey,
          notes: `Split: ₹${splitCashNum.toFixed(2)} cash + ₹${splitOnlineNum.toFixed(2)} online`,
          cashAmount: splitCashNum,
          onlineAmount: splitOnlineNum,
          onlineTransactionRef: txnRef || undefined,
          onlineGateway: splitOnlineNum > 0 ? gateway : undefined,
        });
      }
      return paymentSessionService.recordPayment(session.publicId, {
        method,
        amount,
        idempotencyKey,
        notes: `${method === "CASH" ? "Cash" : "Online"} payment of ₹${amount.toFixed(2)}`,
        onlineTransactionRef: method === "ONLINE" ? txnRef : undefined,
        onlineGateway: method === "ONLINE" ? gateway : undefined,
      });
    },
    onSuccess,
  });

  const refundMutation = useMutation({
    mutationFn: () =>
      paymentSessionService.recordRefund(session.publicId, {
        method: method === "SPLIT" ? "CASH" : method,
        amount,
        idempotencyKey,
        notes: `${method === "CASH" ? "Cash" : "Online"} refund of ₹${amount.toFixed(2)}`,
      }),
    onSuccess,
  });

  const isLoading = payMutation.isPending || refundMutation.isPending;
  const error = payMutation.error || refundMutation.error;
  const canSubmit = (() => {
    if (method === "CASH") return true;
    if (method === "ONLINE") return txnRef.trim().length > 0;
    // SPLIT
    return splitValid && !splitNeedsRef;
  })();

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
          <div className="grid grid-cols-3 gap-2">
            {(["CASH", "ONLINE", "SPLIT"] as Method[]).map((m) => (
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
                {m === "CASH" ? "Cash" : m === "ONLINE" ? "Online" : "Split"}
              </button>
            ))}
          </div>
        )}

        {/* Online fields */}
        {!isRefund && method === "ONLINE" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rpp-txnRef" className="text-sm">
                Transaction Reference <span className="text-red-500">*</span>
              </Label>
              <Input
                id="rpp-txnRef"
                placeholder="e.g. pay_xyz789 / UPI ref"
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
                <Label className="text-xs">Online Amount (₹)</Label>
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
              <p className="text-xs text-red-600">Cash + Online must equal ₹{amount.toFixed(2)}</p>
            )}
            {splitOnlineNum > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">
                  UPI / Transaction ID <span className="text-red-500">*</span>
                </Label>
                <Input
                  placeholder="e.g. UPI ref / txn ID"
                  value={txnRef}
                  onChange={(e) => setTxnRef(e.target.value)}
                  className="h-10"
                />
              </div>
            )}
          </div>
        )}

        {!isRefund && method === "CASH" && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            Cash payments require manager confirmation. The booking will be processed immediately, but a manager must verify the cash.
          </p>
        )}

        {error && (
          <p className="text-sm text-destructive">
            {(error as any)?.response?.data?.message ?? "Something went wrong. Try again."}
          </p>
        )}

        <Button
          className="w-full"
          disabled={isLoading || !canSubmit}
          onClick={() => isRefund ? refundMutation.mutate() : payMutation.mutate()}
        >
          {isLoading
            ? "Processing…"
            : isRefund
              ? `Refund ₹${amount.toFixed(2)} (${method === "ONLINE" ? "Online" : "Cash"})`
              : method === "CASH"
                ? `Mark ₹${amount.toFixed(2)} as collected (Cash)`
                : method === "ONLINE"
                  ? `Record Online Payment ₹${amount.toFixed(2)}`
                  : `Record Split Payment ₹${amount.toFixed(2)}`}
        </Button>
      </div>
    </div>
  );
}

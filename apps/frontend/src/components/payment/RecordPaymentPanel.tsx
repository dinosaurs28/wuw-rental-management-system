import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { PaymentSession } from "@/services/paymentSession.service";
import { paymentSessionService } from "@/services/paymentSession.service";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RecordPaymentPanelProps {
  session: PaymentSession;
  onSuccess: (updatedSession: PaymentSession) => void;
  className?: string;
}

export function RecordPaymentPanel({ session, onSuccess, className }: RecordPaymentPanelProps) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const netPayable = parseFloat(session.netPayable);
  const isRefund = netPayable < 0;
  const amount = Math.abs(netPayable);

  const payMutation = useMutation({
    mutationFn: () =>
      paymentSessionService.recordPayment(session.publicId, {
        method: "CASH",
        amount,
        idempotencyKey,
        notes: isRefund ? undefined : `Cash ${isRefund ? "refund" : "payment"} of ₹${amount.toFixed(2)}`,
      }),
    onSuccess,
  });

  const refundMutation = useMutation({
    mutationFn: () =>
      paymentSessionService.recordRefund(session.publicId, {
        method: "CASH",
        amount,
        idempotencyKey,
        notes: `Cash refund of ₹${amount.toFixed(2)}`,
      }),
    onSuccess,
  });

  const isLoading = payMutation.isPending || refundMutation.isPending;
  const error = payMutation.error || refundMutation.error;

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

  return (
    <div className={cn("rounded-lg border bg-card shadow-sm", className)}>
      <div className="px-4 py-3 border-b">
        <span className="text-sm font-medium text-muted-foreground">
          {isRefund ? "Issue refund" : "Collect payment"}
        </span>
      </div>

      <div className="px-4 py-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{isRefund ? "Refund amount" : "Amount to collect"}</span>
          <span className={cn("text-xl font-bold", isRefund ? "text-green-600" : "text-foreground")}>
            ₹{amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </span>
        </div>

        {error && (
          <p className="text-sm text-destructive">
            {(error as any)?.response?.data?.message ?? "Something went wrong. Try again."}
          </p>
        )}

        <Button
          className="w-full"
          disabled={isLoading}
          onClick={() => isRefund ? refundMutation.mutate() : payMutation.mutate()}
        >
          {isLoading
            ? "Processing…"
            : isRefund
              ? `Refund ₹${amount.toFixed(2)} (Cash)`
              : `Mark ₹${amount.toFixed(2)} as collected (Cash)`}
        </Button>
      </div>
    </div>
  );
}

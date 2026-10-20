import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Ban, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiErrorMessage } from "@/lib/counterErrors";
import { formatRupees } from "@/lib/counterPayment";
import { paymentVoidService, type PaymentVoidPortal, type PaymentVoidResult } from "@/services/paymentVoid.service";

const REASON_MIN = 3;
const REASON_MAX = 500;

export interface VoidTarget {
  transactionPublicId: string;
  bookingPublicId: string;
  amount: string | number;
  /** e.g. "Cash · Remaining balance" */
  label: string;
  isRefund?: boolean;
}

/**
 * Branch Manager / Admin: void a payment — reverse a wrong entry. The row stays
 * in the history (struck through, "Voided") and counts in no total; the booking
 * owes that amount again (a voided refund: the customer is owed it again). The
 * booking status is not changed. Needs a reason.
 */
export function VoidPaymentDialog({
  target,
  onOpenChange,
  portal = "manager",
  onVoided,
}: {
  target: VoidTarget | null;
  onOpenChange: (open: boolean) => void;
  portal?: PaymentVoidPortal;
  onVoided?: (result: PaymentVoidResult) => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason("");
    setError(null);
    setSubmitting(false);
  }, [target?.transactionPublicId]);

  const trimmed = reason.trim();
  const valid = trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;
  const amount = target ? Number(target.amount) || 0 : 0;

  const submit = async () => {
    if (!target || !valid) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await paymentVoidService.voidPayment(target.transactionPublicId, trimmed, portal);
      if (res.data.warning) toast.warning(res.message);
      else toast.success(res.message);
      onVoided?.(res.data);
      onOpenChange(false);
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't void the payment. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="size-4 text-red-600" />
            Void {target?.isRefund ? "refund" : "payment"}
          </DialogTitle>
          <DialogDescription>
            Reverse a wrong entry. It stays in the history as voided and counts in no total.
          </DialogDescription>
        </DialogHeader>
        {target && (
          <div className="space-y-3">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-zinc-600">{target.label}</span>
                <span className="font-semibold tabular-nums">{formatRupees(amount)}</span>
              </div>
              <p className="mt-0.5 font-mono text-xs text-zinc-400">{target.bookingPublicId}</p>
            </div>
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {target.isRefund
                  ? `The customer will be owed this ${formatRupees(amount)} again.`
                  : `The booking will owe ${formatRupees(amount)} again.`}{" "}
                The booking status, pickup and drop stay as they are. This can't be undone.
              </span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="void-reason">Reason</Label>
              <Textarea
                id="void-reason"
                value={reason}
                maxLength={REASON_MAX}
                rows={3}
                placeholder="e.g. Entered twice, wrong amount, recorded on the wrong booking"
                onChange={(e) => setReason(e.target.value)}
              />
              <p className="text-right text-[11px] text-zinc-400">
                {trimmed.length}/{REASON_MAX}
              </p>
            </div>
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button className="flex-1 bg-red-600 hover:bg-red-700" onClick={() => void submit()} disabled={!valid || submitting}>
                {submitting ? <Loader2 className="size-4 animate-spin" /> : `Void ${formatRupees(amount)}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The "Voided" note under a struck-through payment: reason, who and when. */
export function VoidedNote({
  voidReason,
  voidedBy,
  voidedAt,
  voidShiftClosed,
  formatAt,
}: {
  voidReason?: string | null;
  voidedBy?: string | null;
  voidedAt?: string | null;
  voidShiftClosed?: boolean;
  formatAt: (iso: string) => string;
}) {
  return (
    <span className="mt-0.5 block text-[11px] text-zinc-500">
      <span className="mr-1 rounded bg-zinc-200 px-1 py-px text-[10px] font-semibold uppercase text-zinc-600">Voided</span>
      {voidReason}
      {voidedBy ? ` · ${voidedBy}` : ""}
      {voidedAt ? ` · ${formatAt(voidedAt)}` : ""}
      {voidShiftClosed && <span className="block text-amber-700">Shift already closed — counted cash didn't change</span>}
    </span>
  );
}

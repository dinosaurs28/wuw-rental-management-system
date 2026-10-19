import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, AlertTriangle, Car, Info, Loader2, Undo2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PaymentProofField } from "@/components/payment/counter/PaymentProofField";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/counterErrors";
import { formatRupees, type CounterProof } from "@/lib/counterPayment";
import { formatIstDateTime } from "@/utils/overdueReturns";
import {
  customerRefundService,
  type CustomerRefundMethod,
  type CustomerRefundOptions,
  type CustomerRefundPortal,
  type CustomerRefundResult,
} from "@/services/customerRefund.service";

interface RefundToCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingPublicId: string;
  /** Branch manager (own branch, default) or admin (any branch). */
  portal?: CustomerRefundPortal;
  /** After the refund is recorded — refresh the booking's money. */
  onRefunded?: (result: CustomerRefundResult) => void;
}

const STATUS_LABELS: Record<string, string> = {
  HOLD: "Hold",
  CONFIRMED: "Upcoming",
  PICKED_UP: "Active",
  RETURNED: "Completed",
  CANCELLED: "Cancelled",
  HOLD_EXPIRED: "Hold expired",
};

const toNumber = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Branch Manager / Admin: pay money back to the customer on any booking — any
 * status, any amount, at any time (after the drop is settled too). Cash, UPI or
 * bank transfer, recorded as paid out now; the booking itself is not changed.
 * Refunding more than the money received shows a warning and needs a tick.
 */
export function RefundToCustomerDialog({
  open,
  onOpenChange,
  bookingPublicId,
  portal = "manager",
  onRefunded,
}: RefundToCustomerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="size-4 text-orange-600" />
            Refund to customer
          </DialogTitle>
          <DialogDescription>
            Pay money back to the customer now. The booking and its status stay as they are.
          </DialogDescription>
        </DialogHeader>
        {/* Rendered only while open, so each opening reads the booking afresh */}
        {open && (
          <RefundBody
            bookingPublicId={bookingPublicId}
            portal={portal}
            onClose={() => onOpenChange(false)}
            onRefunded={onRefunded}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RefundBody({
  bookingPublicId,
  portal,
  onClose,
  onRefunded,
}: {
  bookingPublicId: string;
  portal: CustomerRefundPortal;
  onClose: () => void;
  onRefunded?: (result: CustomerRefundResult) => void;
}) {
  const query = useQuery({
    queryKey: ["customer-refund-options", portal, bookingPublicId],
    queryFn: () => customerRefundService.getOptions(bookingPublicId, portal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const options = query.data;

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
        <Loader2 className="size-4 animate-spin" />
        Loading the booking…
      </div>
    );
  }
  if (query.isError || !options) {
    return (
      <div className="space-y-4">
        <Notice tone="error">{apiErrorMessage(query.error, "Couldn't load this booking. Please try again.")}</Notice>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Close
          </Button>
          <Button className="flex-1" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  return (
    <RefundForm
      options={options}
      portal={portal}
      onClose={onClose}
      onRefunded={onRefunded}
      refetch={() => void query.refetch()}
    />
  );
}

function RefundForm({
  options,
  portal,
  onClose,
  onRefunded,
  refetch,
}: {
  options: CustomerRefundOptions;
  portal: CustomerRefundPortal;
  onClose: () => void;
  onRefunded?: (result: CustomerRefundResult) => void;
  refetch: () => void;
}) {
  // One id per opening: a retried submission is refused by the server instead of paid twice
  const [requestId] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<CustomerRefundMethod | "">("");
  const [reference, setReference] = useState("");
  const [proof, setProof] = useState<CounterProof | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirmOver, setConfirmOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountValid = AMOUNT_PATTERN.test(amount.trim()) && toNumber(amount) > 0;
  const amountNum = amountValid ? toNumber(amount) : 0;
  const netReceived = toNumber(options.money.netReceived);
  const owedBack = toNumber(options.money.owedBack);
  const overBy = amountValid ? Math.max(0, amountNum - Math.max(0, netReceived)) : 0;
  const goodwill = amountValid ? Math.max(0, amountNum - owedBack) : 0;
  const transfer = method === "UPI" || method === "BANK_TRANSFER";
  const depositHeld = toNumber(options.money.safetyDepositHeld);
  const depositToRefund = toNumber(options.money.depositToRefund);

  const problem = (() => {
    if (!amountValid) return "Enter the amount to refund — more than ₹0, with at most 2 decimals.";
    if (!method) return "Choose how the money is paid back.";
    if (reason.trim().length < options.limits.reasonMin) {
      return `Enter the reason (at least ${options.limits.reasonMin} characters).`;
    }
    if (overBy > 0.004 && !confirmOver) return "Tick the confirmation to refund more than was received.";
    return null;
  })();

  const submit = async () => {
    if (problem || submitting || !method) return;
    setSubmitting(true);
    setError(null);
    setProofError(null);
    try {
      const res = await customerRefundService.refund(
        options.bookingPublicId,
        {
          amount: amountNum,
          method,
          reason: reason.trim(),
          ...(transfer && reference.trim() ? { reference: reference.trim() } : {}),
          ...(transfer && proof ? { proofFileId: proof.proofFileId } : {}),
          ...(overBy > 0.004 ? { confirmOverReceived: true } : {}),
          requestId,
        },
        portal,
      );
      if (res.data.cashOutsideShift) toast.warning(res.message, { duration: 10000 });
      else toast.success(res.message || "Refund recorded.");
      onRefunded?.(res.data);
      onClose();
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      const message = apiErrorMessage(err, "Couldn't record the refund. Please try again.");
      if (code === "INVALID_PAYMENT_PROOF" || code === "DUPLICATE_PAYMENT_PROOF") setProofError(message);
      else setError(message);
      // The server re-reads the money — show the fresh figures (the tick reappears if needed)
      if (code !== "DUPLICATE_REFUND") refetch();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <BookingSummary options={options} />

        {/* Money on the booking */}
        <div className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 text-sm">
          <MoneyRow label="Received" value={formatRupees(toNumber(options.money.paid))} />
          {toNumber(options.money.refunded) > 0 && (
            <MoneyRow label="Already refunded" value={`− ${formatRupees(toNumber(options.money.refunded))}`} />
          )}
          <MoneyRow label="Net received" value={formatRupees(netReceived)} strong />
          {owedBack > 0 && <MoneyRow label="Paid beyond what the booking owes" value={formatRupees(owedBack)} />}
          {toNumber(options.money.amountDue) > 0 && (
            <MoneyRow label="Customer still owes" value={formatRupees(toNumber(options.money.amountDue))} />
          )}
        </div>

        {(toNumber(options.money.pendingCash) > 0 || depositToRefund > 0 || (depositHeld > 0 && options.status === "PICKED_UP")) && (
          <ul className="space-y-1 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-xs text-zinc-600">
            {toNumber(options.money.pendingCash) > 0 && (
              <li>
                {formatRupees(toNumber(options.money.pendingCash))} of cash is still awaiting confirmation — not counted as
                received.
              </li>
            )}
            {depositHeld > 0 && options.status === "PICKED_UP" && (
              <li>The {formatRupees(depositHeld)} safety deposit is paid back on the drop bill — don't refund it here too.</li>
            )}
            {depositToRefund > 0 && (
              <li>
                {formatRupees(depositToRefund)} of safety deposit is waiting in Settlements — refund it there so it is marked
                refunded.
              </li>
            )}
          </ul>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="ctr-amount">
            Amount <span className="text-red-500">*</span>
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">₹</span>
            <Input
              id="ctr-amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              className="h-10 pl-7"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setConfirmOver(false);
              }}
            />
          </div>
          {amountValid && goodwill > 0.004 && owedBack > 0 && (
            <p className="text-[11px] text-zinc-500">
              {formatRupees(Math.min(amountNum, owedBack))} pays back what the booking owes the customer; the other{" "}
              {formatRupees(goodwill)} is a goodwill refund.
            </p>
          )}
        </div>

        {overBy > 0.004 && (
          <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                {netReceived > 0
                  ? `This is ${formatRupees(overBy)} more than the ${formatRupees(netReceived)} received on this booking (after refunds).`
                  : "Nothing received on this booking is left after refunds."}
              </span>
            </p>
            <label className="flex items-start gap-2 text-xs font-medium">
              <Checkbox
                checked={confirmOver}
                onCheckedChange={(v) => setConfirmOver(v === true)}
                className="mt-0.5 bg-white"
              />
              <span>I confirm refunding {formatRupees(amountNum)} — more than was received.</span>
            </label>
          </div>
        )}

        <div className="space-y-2">
          <Label>
            Paid back by <span className="text-red-500">*</span>
          </Label>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Paid back by">
            {options.methods.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={method === m.value}
                onClick={() => setMethod(m.value)}
                className={cn(
                  "rounded-lg border-2 px-2 py-2 text-xs font-medium transition-all",
                  method === m.value
                    ? "border-orange-500 bg-orange-50 text-orange-700"
                    : "border-zinc-200 text-zinc-600 hover:border-zinc-300",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          {method === "CASH" &&
            (options.cashShiftOpen ? (
              <p className="text-xs text-zinc-500">Paid from your cash drawer — recorded on your open cash shift.</p>
            ) : (
              <Notice tone="warning">
                You have no cash shift open. The refund is still recorded, but outside a shift — it won't be in any drawer's
                reconciliation and is flagged in the reports.
              </Notice>
            ))}
        </div>

        {transfer && (
          <div className="space-y-3 rounded-xl border border-zinc-200 px-4 py-3">
            <div className="space-y-1.5">
              <Label htmlFor="ctr-reference">Reference / UTR (optional)</Label>
              <Input
                id="ctr-reference"
                value={reference}
                maxLength={options.limits.referenceMax}
                onChange={(e) => setReference(e.target.value)}
                placeholder={method === "UPI" ? "e.g. 12-digit UPI reference" : "e.g. NEFT / IMPS reference"}
                className="h-10 font-mono text-sm"
              />
            </div>
            {options.proofPhotoSupported && (
              <PaymentProofField
                id="ctr-proof"
                role="manager"
                value={proof}
                onChange={(p) => {
                  setProof(p);
                  setProofError(null);
                }}
                error={proofError}
                required={false}
                label={method === "UPI" ? "Photo of the UPI transfer (optional)" : "Photo of the bank transfer (optional)"}
                helper="After sending the money, photograph the transfer screen."
              />
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="ctr-reason">
            Reason / note <span className="text-red-500">*</span>
          </Label>
          <Textarea
            id="ctr-reason"
            value={reason}
            maxLength={options.limits.reasonMax}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Goodwill refund for the late pickup"
            className="min-h-[72px] text-sm"
          />
          <p className="text-right text-[11px] text-zinc-400">
            {reason.length}/{options.limits.reasonMax}
          </p>
        </div>

        {options.refunds.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Earlier refunds to the customer</p>
            <ul className="space-y-1 text-xs text-zinc-600">
              {options.refunds.map((r) => (
                <li key={r.publicId} className="flex justify-between gap-2">
                  <span>
                    {formatIstDateTime(r.at)}
                    {r.by ? ` · ${r.by}` : ""}
                    {r.cashOutsideShift ? " · outside a shift" : ""}
                  </span>
                  <span className="tabular-nums">{formatRupees(toNumber(r.amount))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <Notice tone="error">{error}</Notice>}
      </div>

      <div className="space-y-2 border-t border-zinc-100 pt-3">
        {problem && amount.trim() !== "" && <p className="text-xs text-zinc-500">{problem}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={submitting}>
            Close
          </Button>
          <Button
            className="flex-1 bg-orange-600 hover:bg-orange-700"
            onClick={() => void submit()}
            disabled={!!problem || submitting}
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : amountValid ? (
              `Refund ${formatRupees(amountNum)}`
            ) : (
              "Refund"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function BookingSummary({ options }: { options: CustomerRefundOptions }) {
  const vehicles = options.vehicles.map((v) => `${v.make} ${v.model} (${v.regNo})`).join(", ") || "—";
  return (
    <div className="space-y-1.5 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 font-medium text-zinc-900">
          <Car className="size-3.5 shrink-0 text-zinc-400" />
          {vehicles}
        </p>
        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600">
          {STATUS_LABELS[options.status] ?? options.status}
        </span>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-zinc-600">
        <User className="size-3 shrink-0 text-zinc-400" />
        {options.customer.name}
        {options.customer.phone ? ` · ${options.customer.phone}` : ""}
      </p>
      <p className="text-xs text-zinc-500">
        Pickup {formatIstDateTime(options.startAt)} · Return {formatIstDateTime(options.endAt)}
      </p>
      <p className="font-mono text-[11px] text-zinc-400">
        #{options.bookingPublicId.slice(-6).toUpperCase()} · {options.branch.name}
      </p>
    </div>
  );
}

function MoneyRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2">
      <span className={strong ? "font-semibold text-zinc-900" : "text-zinc-600"}>{label}</span>
      <span className={cn("tabular-nums", strong ? "font-semibold text-zinc-900" : "text-zinc-700")}>{value}</span>
    </div>
  );
}

function Notice({ tone, children }: { tone: "error" | "warning"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "flex items-start gap-2 rounded-xl border px-4 py-3 text-sm",
        tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800",
      )}
    >
      {tone === "error" ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
      <span>{children}</span>
    </div>
  );
}

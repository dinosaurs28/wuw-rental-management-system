import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/counterErrors";
import { formatRupees } from "@/lib/counterPayment";
import { ProofPhotoThumb } from "@/components/payment/counter/ProofPhotoThumb";
import { formatIstDateTime } from "@/utils/overdueReturns";
import { RefundToCustomerDialog } from "@/components/manager/RefundToCustomerDialog";
import { VoidPaymentDialog, VoidedNote, type VoidTarget } from "@/components/manager/payments/VoidPaymentDialog";
import { paymentVoidService, type BookingPaymentRow, type PaymentVoidPortal } from "@/services/paymentVoid.service";

export const PAYMENT_PURPOSE_LABELS: Record<string, string> = {
  FULL_PAYMENT: "Full payment",
  ADVANCE: "Advance",
  REMAINING_BALANCE: "Remaining balance",
  EXTENSION: "Extension",
  DAMAGE_FEE: "Damage fee",
  SAFETY_DEPOSIT: "Safety deposit",
  OVERPAYMENT_REFUND: "Refund",
  CANCELLATION_REFUND: "Cancellation refund",
};

const METHOD_LABELS: Record<string, string> = { CASH: "Cash", ONLINE: "Online", SPLIT: "Split" };

export const paymentRowLabel = (t: Pick<BookingPaymentRow, "purpose" | "method" | "isCustomerRefund" | "onlineGateway">) => {
  const purpose = t.isCustomerRefund ? "Refund to customer" : (PAYMENT_PURPOSE_LABELS[t.purpose] ?? t.purpose);
  const method = t.method === "ONLINE" && t.onlineGateway ? t.onlineGateway.replace(/_/g, " ").toLowerCase() : (METHOD_LABELS[t.method] ?? t.method);
  return `${purpose} · ${method}`;
};

const num = (v: string | null | undefined) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};

/**
 * Branch Manager / Admin: one booking's payments with the money actions —
 * "Refund to customer" and "Void" on each CONFIRMED staff-recorded entry.
 * Used where there is no booking drawer (admin report rows, BM Settlements and
 * period bookings rows).
 */
export function BookingPaymentsDialog({
  bookingPublicId,
  onOpenChange,
  portal = "manager",
  onChanged,
}: {
  bookingPublicId: string | null;
  onOpenChange: (open: boolean) => void;
  portal?: PaymentVoidPortal;
  /** After a refund or a void — refresh the list behind */
  onChanged?: () => void;
}) {
  const open = !!bookingPublicId;
  const [refundOpen, setRefundOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);
  const query = useQuery({
    queryKey: ["booking-payments", portal, bookingPublicId],
    queryFn: () => paymentVoidService.bookingPayments(bookingPublicId!, portal),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const d = query.data;
  const changed = () => {
    void query.refetch();
    onChanged?.();
  };

  return (
    <>
      <Dialog open={open && !refundOpen && !voidTarget} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Payments</DialogTitle>
            <DialogDescription>
              {d ? `${d.customer.name} · ${d.bookingPublicId} · ${d.branch.name}` : bookingPublicId}
            </DialogDescription>
          </DialogHeader>
          {query.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
              <Loader2 className="size-4 animate-spin" /> Loading payments…
            </div>
          ) : query.isError || !d ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {apiErrorMessage(query.error, "Couldn't load the payments.")}
            </p>
          ) : (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
              <div className="grid grid-cols-3 gap-2 text-xs">
                {[
                  ["Paid", d.money.paid],
                  ["Refunded", d.money.refunded],
                  ["Amount due", d.money.amountDue],
                ].map(([label, v]) => (
                  <div key={label} className="rounded-lg border border-zinc-200 px-2.5 py-2">
                    <p className="text-zinc-500">{label}</p>
                    <p className="font-semibold tabular-nums">{formatRupees(num(v))}</p>
                  </div>
                ))}
              </div>
              <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                {d.transactions.length === 0 && <li className="px-3 py-4 text-center text-sm text-zinc-400">No payments recorded.</li>}
                {d.transactions.map((t) => (
                  <li key={t.publicId} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className={cn("font-medium text-zinc-800", t.voided && "text-zinc-400 line-through")}>{paymentRowLabel(t)}</p>
                      <p className={cn("text-xs text-zinc-500", t.voided && "line-through")}>
                        {formatIstDateTime(t.confirmedAt ?? t.collectedAt ?? t.createdAt)}
                        {t.collectedBy ? ` · ${t.collectedBy}` : ""}
                        {t.onlineTransactionRef ? ` · ${t.onlineTransactionRef}` : ""}
                        {!t.voided && t.status !== "CONFIRMED" ? ` · ${t.status.toLowerCase()}` : ""}
                      </p>
                      {t.voided && (
                        <VoidedNote
                          voidReason={t.voidReason}
                          voidedBy={t.voidedBy}
                          voidedAt={t.voidedAt}
                          voidShiftClosed={t.voidShiftClosed}
                          formatAt={formatIstDateTime}
                        />
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {/* Oct 25 2026: the payment / refund success-screen photo */}
                      {t.proofPhoto && (
                        <ProofPhotoThumb photo={t.proofPhoto} photos={t.proofs} size="sm" caption={`${paymentRowLabel(t)} · ${formatRupees(num(t.totalAmount))}`} />
                      )}
                      <span className={cn("font-semibold tabular-nums", t.isRefund && "text-orange-700", t.voided && "text-zinc-400 line-through")}>
                        {t.isRefund ? "−" : ""}
                        {formatRupees(num(t.totalAmount))}
                      </span>
                      {t.voidable && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 border-red-200 px-2 text-xs text-red-700 hover:bg-red-50"
                          onClick={() =>
                            setVoidTarget({
                              transactionPublicId: t.publicId,
                              bookingPublicId: d.bookingPublicId,
                              amount: t.totalAmount,
                              label: paymentRowLabel(t),
                              isRefund: t.isRefund,
                            })
                          }
                        >
                          <Ban className="size-3" /> Void
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-2 border-t border-zinc-100 pt-3">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                <Button className="gap-1.5 bg-orange-600 hover:bg-orange-700" onClick={() => setRefundOpen(true)}>
                  <Undo2 className="size-4" /> Refund to customer
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {bookingPublicId && (
        <RefundToCustomerDialog
          open={refundOpen}
          onOpenChange={setRefundOpen}
          bookingPublicId={bookingPublicId}
          portal={portal}
          onRefunded={changed}
        />
      )}
      <VoidPaymentDialog target={voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)} portal={portal} onVoided={changed} />
    </>
  );
}

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ExtensionStatusBadge } from "@/components/manager/payment/PaymentStateBadge";
import { ProofPhotoThumb } from "@/components/payment/counter/ProofPhotoThumb";
import { paymentService } from "@/services/payment.service";
import type { BookingExtension, ExtensionPayment } from "@/services/extension.service";
import { formatIstDateTime } from "@/utils/overdueReturns";

export function fmtInr(val: string | number | null | undefined) {
  const n = Number(val ?? 0);
  return "₹ " + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** The extension's payment is waiting for the manager (counter cash / UPI / card). */
export function needsConfirmation(ext: BookingExtension): boolean {
  return ext.extensionStatus === "PAYMENT_COLLECTED" && ext.payment?.status === "COLLECTED";
}

export function paymentMethodLabel(p: ExtensionPayment): string {
  const cash = Number(p.cashAmount);
  const online = Number(p.onlineAmount);
  const onlineName = p.isCard ? "Card" : p.isUpi ? "UPI" : p.onlineGateway ? "Online" : "Online";
  if (cash > 0 && online > 0) return `Cash ${fmtInr(cash)} + ${onlineName} ${fmtInr(online)}`;
  if (online > 0) return onlineName;
  return "Cash";
}

const PAYMENT_STATUS: Record<string, { label: string; cls: string }> = {
  INITIATED: { label: "Not paid yet", cls: "bg-gray-100 text-gray-700" },
  COLLECTED: { label: "Waiting for your confirmation", cls: "bg-amber-100 text-amber-800" },
  CONFIRMED: { label: "Confirmed", cls: "bg-emerald-100 text-emerald-800" },
  REJECTED: { label: "Rejected", cls: "bg-red-100 text-red-700" },
  VOIDED: { label: "Voided", cls: "bg-gray-100 text-gray-600" },
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-right font-medium text-gray-900 min-w-0 break-words">{children}</span>
    </div>
  );
}

interface Props {
  extension: BookingExtension | null;
  onClose: () => void;
  /** Called after a confirm / reject so the list reloads. */
  onChanged: () => void;
}

/**
 * Every detail of one extension, and — when its cash / UPI / card payment is
 * waiting for the manager — Confirm and Reject (the same calls as Settlements).
 * Confirming finalises the extension: the booking's end moves to the new time
 * and the return can be completed.
 */
export function ExtensionDetailSheet({ extension: ext, onClose, onChanged }: Props) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const close = () => {
    setRejecting(false);
    setReason("");
    onClose();
  };

  const confirm = useMutation({
    mutationFn: (txnId: string) => paymentService.confirmCash(txnId),
    onSuccess: () => {
      toast.success("Payment confirmed — the extension is now confirmed.");
      onChanged();
      close();
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? "Could not confirm the payment."),
  });

  const reject = useMutation({
    mutationFn: ({ txnId, why }: { txnId: string; why: string }) => paymentService.rejectCash(txnId, why),
    onSuccess: () => {
      toast.success("Payment rejected.");
      onChanged();
      close();
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? "Could not reject the payment."),
  });

  const pay = ext?.payment ?? null;
  const pending = !!ext && needsConfirmation(ext);
  const busy = confirm.isPending || reject.isPending;
  const payStatus = pay ? PAYMENT_STATUS[pay.status] ?? { label: pay.status, cls: "bg-gray-100 text-gray-700" } : null;

  return (
    <Sheet open={!!ext} onOpenChange={(open) => !open && close()}>
      <SheetContent side="right" className="w-full sm:max-w-lg gap-0 p-0 overflow-y-auto">
        {ext && (
          <>
            <SheetHeader className="border-b border-neutral-100 bg-neutral-50/60 px-5 py-4">
              <SheetTitle className="flex items-center gap-2">
                Extension
                <span className="font-mono text-sm text-orange-600">
                  {(ext.bookingPublicId || "").slice(0, 8).toUpperCase()}
                </span>
              </SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-2">
                  <ExtensionStatusBadge status={ext.extensionStatus} />
                  {ext.isRenewal && (
                    <span className="rounded bg-orange-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-orange-700">
                      Renewal
                    </span>
                  )}
                </div>
              </SheetDescription>
            </SheetHeader>

            <div className="px-5 py-4 space-y-5">
              {pending && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Staff collected this payment. Check it and confirm — until then the vehicle's return can't be
                  completed.
                </div>
              )}

              <section className="divide-y divide-gray-100">
                <Row label="Customer">
                  {ext.customerName ?? "—"}
                  {ext.customerPhone && <span className="block text-xs font-normal text-gray-500">{ext.customerPhone}</span>}
                </Row>
                {ext.vehicle && (
                  <Row label="Vehicle">
                    {ext.vehicle.regNo}
                    <span className="block text-xs font-normal text-gray-500">
                      {ext.vehicle.make} {ext.vehicle.model}
                    </span>
                  </Row>
                )}
                <Row label="Return was">{formatIstDateTime(ext.oldEndAt)}</Row>
                <Row label="Extended to">{formatIstDateTime(ext.actualNewEndAt || ext.requestedEndAt)}</Row>
                <Row label="Extra rent">
                  {fmtInr(ext.additionalAmount)}
                  {ext.taxAmount != null && (
                    <span className="block text-xs font-normal text-gray-500">incl. GST {fmtInr(ext.taxAmount)}</span>
                  )}
                </Row>
                <Row label="Requested by">
                  <span className="capitalize">{(ext.actorRole || "").toLowerCase() || "—"}</span>
                </Row>
                <Row label="Created">{formatIstDateTime(ext.createdAt)}</Row>
                {ext.notes && <Row label="Note">{ext.notes}</Row>}
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Payment</h3>
                {!pay ? (
                  <p className="text-sm text-gray-500">No payment recorded for this extension yet.</p>
                ) : (
                  <div className="rounded-lg border border-gray-200 px-4 py-1">
                    <div className="divide-y divide-gray-100">
                      <Row label="Status">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${payStatus!.cls}`}>
                          {payStatus!.label}
                        </span>
                      </Row>
                      <Row label="Amount">{fmtInr(pay.amount)}</Row>
                      <Row label="Paid by">{paymentMethodLabel(pay)}</Row>
                      {pay.collectedAt && (
                        <Row label="Collected">
                          {formatIstDateTime(pay.collectedAt)}
                          {pay.collectedByName && (
                            <span className="block text-xs font-normal text-gray-500">by {pay.collectedByName}</span>
                          )}
                        </Row>
                      )}
                      {pay.onlineTransactionRef && !(pay.proofPhoto || pay.proofPhotoUrl) && (
                        <Row label="UTR">
                          <span className="font-mono">{pay.onlineTransactionRef}</span>
                        </Row>
                      )}
                      {pay.confirmedAt && <Row label="Confirmed">{formatIstDateTime(pay.confirmedAt)}</Row>}
                      {pay.rejectionReason && <Row label="Rejected because">{pay.rejectionReason}</Row>}
                      {pay.notes && <Row label="Staff note">{pay.notes}</Row>}
                    </div>
                    {(pay.proofPhoto || pay.proofPhotoUrl) && (
                      <div className="py-3">
                        <ProofPhotoThumb
                          size="read"
                          kind={pay.isCard ? "Card receipt" : "UPI payment"}
                          photo={pay.proofPhoto ?? { url: pay.proofPhotoUrl! }}
                          photos={pay.proofs}
                          caption={`${(ext.bookingPublicId || "").slice(0, 8).toUpperCase()}${ext.customerName ? ` · ${ext.customerName}` : ""} · ${fmtInr(pay.amount)}`}
                        />
                      </div>
                    )}
                  </div>
                )}
              </section>

              {pending && pay && (
                <section className="space-y-3">
                  {rejecting ? (
                    <>
                      <Textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Why is this payment being rejected? (at least 5 characters, e.g. amount not received)"
                        rows={3}
                        maxLength={500}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button variant="outline" className="flex-1" onClick={() => setRejecting(false)} disabled={busy}>
                          Back
                        </Button>
                        <Button
                          variant="destructive"
                          className="flex-1"
                          disabled={busy || reason.trim().length < 5}
                          onClick={() => reject.mutate({ txnId: pay.publicId, why: reason.trim() })}
                        >
                          {reject.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                          Reject payment
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => setRejecting(true)} disabled={busy}>
                        Reject
                      </Button>
                      <Button
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                        disabled={busy}
                        onClick={() => confirm.mutate(pay.publicId)}
                      >
                        {confirm.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        Confirm {fmtInr(pay.amount)}
                      </Button>
                    </div>
                  )}
                </section>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

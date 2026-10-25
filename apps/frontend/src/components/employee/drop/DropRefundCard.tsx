import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { RefundMethodFields, refundProofMissing } from "@/components/payment/counter/CounterPaymentFields";
import { apiErrorMessage, counterErrorCode } from "@/lib/counterErrors";
import { counterFieldErrors, formatRupees, type CounterProof, type CounterRefundMethod } from "@/lib/counterPayment";
import { dropRefundService } from "@/services/dropRefund.service";

/**
 * Fleet refund at the drop (Oct 25 2026, client: "Refund during drop should be
 * given to fleet members") — shown once a legacy drop (no drop bill) is recorded.
 * What is owed back (the deposit under the drop's choice, or money paid beyond
 * what the booking owes) is paid out now — Cash / UPI / Bank, the UPI / bank
 * success-screen photo required — against the executive's open shift. "Refund
 * later" leaves it to the branch manager's Pending Settlements.
 */
export function DropRefundCard({ bookingPublicId }: { bookingPublicId: string }) {
  const qc = useQueryClient();
  const [method, setMethod] = useState<CounterRefundMethod>("CASH");
  const [proof, setProof] = useState<CounterProof | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneNote, setDoneNote] = useState<string | null>(null);
  const [later, setLater] = useState(false);

  const query = useQuery({
    queryKey: ["employee", "drop-refund", bookingPublicId],
    queryFn: () => dropRefundService.get(bookingPublicId),
  });

  if (query.isLoading) return <Loader2 className="mx-auto h-4 w-4 animate-spin text-neutral-400" />;
  if (doneNote) return <p className="text-sm text-green-800">{doneNote}</p>;
  const data = query.data;
  if (!data) return null;
  const owed = parseFloat(data.owedBack) || 0;
  if (owed <= 0) return null;
  if (later) {
    return <p className="text-sm text-blue-800">{formatRupees(owed)} refund left to the branch manager (Pending Settlements).</p>;
  }
  if (!data.canRefund) {
    return (
      <p className="text-sm text-blue-800">
        {formatRupees(owed)} is owed back to the customer — the branch manager settles it.
        {data.blockedReason ? ` ${data.blockedReason}` : ""}
      </p>
    );
  }

  const submit = async () => {
    if (refundProofMissing(method, proof)) {
      setProofError("Add the photo of the refund's payment-success screen.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await dropRefundService.refund(bookingPublicId, {
        method,
        ...(method !== "CASH" && proof ? { proof_file_id: proof.proofFileId } : {}),
      });
      toast.success(res.message || "Refund recorded.");
      void qc.invalidateQueries({ queryKey: ["booking"] });
      setDoneNote(
        method === "CASH"
          ? `${formatRupees(parseFloat(res.data.amount))} refunded in cash — the branch manager acknowledges it.`
          : `${formatRupees(parseFloat(res.data.amount))} refunded by ${method === "UPI" ? "UPI" : "bank transfer"}.`,
      );
    } catch (err) {
      const fieldErr = counterFieldErrors(err).proof;
      if (fieldErr) setProofError(fieldErr);
      else setError(apiErrorMessage(err, "Couldn't record the refund. Try again."));
      if (counterErrorCode(err) !== "SHIFT_REQUIRED") void query.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-left">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-blue-900">
          <Undo2 className="h-4 w-4" /> Refund to the customer
        </span>
        <span className="text-sm font-semibold text-blue-900">{formatRupees(owed)}</span>
      </div>
      {parseFloat(data.depositToRefund) > 0 && (
        <p className="text-xs text-blue-800">Safety deposit {formatRupees(parseFloat(data.depositToRefund))}</p>
      )}
      <RefundMethodFields
        idPrefix="drop-refund"
        method={method}
        onMethodChange={(m) => {
          setMethod(m);
          setProofError(null);
          setError(null);
        }}
        proof={proof}
        onProofChange={(p) => {
          setProof(p);
          setProofError(null);
        }}
        proofRole="staff"
        proofError={proofError}
        disabled={busy}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Button className="w-full" disabled={busy} onClick={() => void submit()}>
        {busy ? "Recording…" : `Refund ${formatRupees(owed)} now`}
      </Button>
      <Button variant="outline" className="w-full" disabled={busy} onClick={() => setLater(true)}>
        Refund later (send to branch manager)
      </Button>
    </div>
  );
}

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiCode } from "@/lib/counterPayment";
import type { PaymentSession } from "@/services/paymentSession.service";
import type {
  AdjustmentPlan,
  EditOperationResponse,
  EditPreview,
  PickupSummary,
  ReturnSummary,
} from "@/services/completedOperation.service";
import { EditReview, SettleStep } from "@/components/employee/completed/CompletedOperation";
import { adjustmentOutcome, summaryKey, useReviewedSave } from "@/components/employee/completed/completedEdit";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Edit Pickup / Edit Return on the workflow pages (client item 1, full edit).
 * The page holds the form, prefilled from what was recorded; this is the rest:
 * Save changes → the money difference (old → new per line, then Collect ₹X more /
 * Refund ₹Y / No change in money) → the save, sent with that difference → settling
 * it at the counter on the edit's ADJUSTMENT session (or later) → Changes saved.
 * The page's other parts are in OperationEditFlow.tsx.
 */

type Phase = "PICKUP" | "RETURN";
type Summary = PickupSummary | ReturnSummary;

/** Refusals that mean what the summary says changed under the form — reload it. */
const SUMMARY_CHANGED_CODES = new Set([
  // a payment was started on the last edit's unsettled difference: settle it first (top of the page)
  "ADJUSTMENT_PAYMENT_STARTED",
  "DEPOSIT_LOCKED",
  "DEPOSIT_DISABLED",
  "DROP_BILL_OPEN",
  "DAMAGE_REVIEWED",
  "DAMAGE_NOT_FOUND",
]);

interface EditSaveFlowOptions<B extends object, T extends Summary> {
  phase: Phase;
  bookingId: string;
  preview: (body: B) => Promise<EditPreview>;
  save: (body: B & { expectedDelta: number }) => Promise<EditOperationResponse<T>>;
  /** A refusal that belongs to the form (a bad reading) — shown at the field. */
  onFormError: (error: unknown) => void;
  /** Saved (before the difference is settled). */
  onSaved: () => void;
}

/**
 * Review → save → settle of a page edit. `open(body)` previews the body's money
 * difference in a dialog (and any unsettled earlier difference it replaces);
 * Save changes sends that body with the previewed difference as expectedDelta
 * (409 EDIT_DELTA_CHANGED → previewed again); a difference settled at the counter
 * is collected / refunded in the same dialog. `finished` is set once it's all done.
 */
export function useEditSaveFlow<B extends object, T extends Summary>(opts: EditSaveFlowOptions<B, T>) {
  const qc = useQueryClient();
  // Saved; the difference still to settle at the counter
  const [settle, setSettle] = useState<{ session: PaymentSession; plan: AdjustmentPlan } | null>(null);
  const [finished, setFinished] = useState<{ note: string | null } | null>(null);
  const key = summaryKey(opts.phase, opts.bookingId);

  const refreshMoney = () => {
    void qc.invalidateQueries({ queryKey: ["employee-financial-state", opts.bookingId] });
    void qc.invalidateQueries({ queryKey: ["booking", opts.bookingId] });
  };

  /** Runs a preview / save; a refusal over a changed summary reloads it, then is rethrown. */
  const refreshingOnConflict = async <R,>(run: () => Promise<R>): Promise<R> => {
    try {
      return await run();
    } catch (err) {
      const code = apiCode(err);
      if (code && SUMMARY_CHANGED_CODES.has(code)) void qc.invalidateQueries({ queryKey: key });
      throw err;
    }
  };

  const review = useReviewedSave<B, T>({
    preview: (body) => refreshingOnConflict(() => opts.preview(body)),
    save: (body) => refreshingOnConflict(() => opts.save(body)),
    onFormError: opts.onFormError,
    onSaved: ({ next, adjustment }) => {
      qc.setQueryData(key, next);
      refreshMoney();
      opts.onSaved();
      toast.success(opts.phase === "PICKUP" ? "Pickup updated" : "Return updated");
      if (adjustment?.session && adjustment.session.status !== "COMPLETED" && adjustment.settledBy === "COUNTER") {
        setSettle({ session: adjustment.session, plan: adjustment });
        return;
      }
      setFinished({
        note:
          adjustment && adjustment.action !== "NONE" && adjustment.settledBy === "BRANCH_MANAGER"
            ? adjustmentOutcome(adjustment)
            : null,
      });
    },
  });

  const dialog = (
    <Dialog
      open={(review.reviewing && !finished) || !!settle}
      onOpenChange={(open) => {
        // Once saved, the dialog closes through settling or "Settle later" only
        if (!open && !settle && !review.saving) review.back();
      }}
    >
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto" showCloseButton={!settle}>
        <DialogHeader>
          <DialogTitle>{settle ? "Settle the difference" : "Review changes"}</DialogTitle>
          <DialogDescription>
            {opts.phase === "PICKUP" ? "Edit Pickup" : "Edit Return"} · #{opts.bookingId.slice(-6).toUpperCase()}
          </DialogDescription>
        </DialogHeader>
        {settle ? (
          <SettleStep
            session={settle.session}
            plan={settle.plan}
            onDone={(note) => {
              setSettle(null);
              setFinished({ note });
              void qc.invalidateQueries({ queryKey: key });
              refreshMoney();
            }}
          />
        ) : (
          <EditReview
            phase={opts.phase}
            preview={review.preview}
            error={review.error}
            saving={review.saving}
            onBack={review.back}
            onConfirm={review.confirm}
          />
        )}
      </DialogContent>
    </Dialog>
  );

  return { open: review.open, busy: review.reviewing || review.saving, dialog, finished };
}

import { Link } from "react-router-dom";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import type { PickupSummary, ReturnSummary } from "@/services/completedOperation.service";
import { PendingAdjustment } from "@/components/employee/completed/CompletedOperation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Parts of Edit Pickup / Edit Return on the workflow pages (client item 1): the
 * earlier edit's unsettled difference, the Save changes bar and the saved card.
 * The review → save → settle itself is useEditSaveFlow.
 */

type Phase = "PICKUP" | "RETURN";
type Summary = PickupSummary | ReturnSummary;

/**
 * An earlier edit's difference, still to settle — shown first on the edit page.
 * A new edit that moves money replaces it (the review says so), unless a payment
 * was already started on it (409 ADJUSTMENT_PAYMENT_STARTED: settle it first).
 */
export function PendingAdjustmentCard({ summary }: { summary: Summary }) {
  if (!summary.pendingAdjustment) return null;
  return (
    <Card className="shadow-sm border-amber-200 bg-amber-50/40">
      <CardHeader className="pb-3 border-b border-amber-200">
        <CardTitle className="text-base font-semibold text-amber-900 flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          The last edit's difference isn't settled
        </CardTitle>
        <p className="text-xs text-amber-800">
          Settle it here, or save new changes — their difference replaces this one and covers both edits.
        </p>
      </CardHeader>
      <CardContent className="pt-2">
        <PendingAdjustment summary={summary} record={summary.pendingAdjustment} />
      </CardContent>
    </Card>
  );
}

/** Footer of the edit page: Cancel (back to the summary) and Save changes. */
export function EditSaveBar({
  blocker,
  changed,
  busy,
  onSave,
}: {
  /** Why the changes can't be saved yet */
  blocker: string | null;
  changed: boolean;
  busy: boolean;
  onSave: () => void;
}) {
  return (
    <div className="pt-2 space-y-2">
      <div className="flex flex-col-reverse sm:flex-row gap-3">
        <Button variant="outline" asChild className="h-12 sm:w-40 rounded-xl">
          <Link to={{ search: "" }}>Cancel</Link>
        </Button>
        <Button
          type="button"
          className="flex-1 bg-[#FF5F00] hover:bg-[#e65600] h-12 text-sm font-semibold rounded-xl"
          disabled={!!blocker || !changed || busy}
          onClick={onSave}
        >
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save changes
        </Button>
      </div>
      <p className="text-xs text-center text-muted-foreground">
        {blocker ?? (changed ? "You'll see what changes in the bill before anything is saved." : "Nothing has been changed yet.")}
      </p>
    </div>
  );
}

/** The edit is saved (and its difference settled or left for later). */
export function EditSavedCard({ phase, note, detail }: { phase: Phase; note: string | null; detail: string }) {
  return (
    <Card className="max-w-md mx-auto text-center p-6 border-green-200 bg-green-50/50">
      <CardContent className="space-y-4 pt-6">
        <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold text-green-800">Changes saved</h2>
        <p className="text-sm text-gray-700">{detail}</p>
        {note && <p className="text-sm font-medium text-gray-900">{note}</p>}
        <div className="flex flex-col gap-2 pt-2">
          <Button asChild className="w-full bg-[#FF5F00] hover:bg-[#e65600]">
            <Link to={{ search: "" }} replace>
              Back to the {phase === "PICKUP" ? "pickup" : "return"} summary
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link to="/employee/dashboard">Back to Dashboard</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

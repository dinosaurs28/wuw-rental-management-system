import { ArrowRightLeft } from "lucide-react";
import type { SwapChargePreview } from "@/types/drop";
import { inr } from "./dropFormat";

interface SwapChargesNoteProps {
  charges: SwapChargePreview[];
  /** Drop-bill branches bill it; without a drop bill it is recorded for the branch manager to collect. */
  billedOnDropBill: boolean;
}

/** Vehicle-swap price differences staff chose to charge at the swap (server preview). */
export function SwapChargesNote({ charges, billedOnDropBill }: SwapChargesNoteProps) {
  if (charges.length === 0) return null;
  return (
    <div className="space-y-2 p-4 rounded-lg border bg-blue-50/40 border-blue-200">
      <p className="text-sm font-semibold flex items-center gap-2 text-blue-900">
        <ArrowRightLeft className="h-4 w-4" /> Vehicle swap difference
      </p>
      {charges.map((c) => (
        <div key={c.swapPublicId} className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-gray-800 min-w-0 break-words">{c.label}</span>
          <span className="shrink-0 tabular-nums text-gray-900">
            {inr(c.taxable)}
            {c.gst != null && c.total != null ? (
              <span className="text-xs text-muted-foreground"> + GST {inr(c.gst)} = {inr(c.total)}</span>
            ) : (
              <span className="text-xs text-muted-foreground"> + GST</span>
            )}
          </span>
        </div>
      ))}
      {charges.some((c) => c.gstUnavailableReason === "GST_RULE_MISSING") && (
        <p className="text-xs text-amber-700">
          GST rates aren't set up for this branch — ask the branch manager to set the GST rule before billing.
        </p>
      )}
      <p className="text-xs text-blue-800/80">
        {billedOnDropBill
          ? "Added to the drop bill automatically when you compute the charges."
          : "Recorded with GST when you complete the return — the branch manager collects it at settlement."}
      </p>
    </div>
  );
}

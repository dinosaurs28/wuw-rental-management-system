import { useEffect, useState } from "react";
import { RotateCcw, Scale } from "lucide-react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { paymentService } from "@/services/payment.service";
import { usePaymentStore } from "@/store/payment.store";
import { SettlementsTab } from "@/pages/manager/payment/SettlementsPage";
import { RefundsTab } from "@/pages/manager/payment/RefundsPage";

export type ActionQueue = "settlements" | "refunds";

/**
 * Money actions that used to be Financials tabs and have no better home (Oct 2026):
 *   - Pending settlements: settle a returned booking's balance, pay back a legacy
 *     drop's safety deposit / an over-payment, credit notes;
 *   - Refund requests: approve / reject / mark paid.
 * Shown as two small links above the sub-tabs; each opens the old view unchanged
 * in a side sheet (also reachable as ?queue=settlements / ?queue=refunds, which the
 * old /manager/payment/settlements and /refunds routes redirect to).
 */
export function ActionQueues({ open, onOpenChange }: { open: ActionQueue | null; onOpenChange: (q: ActionQueue | null) => void }) {
  const { pendingRefundCount, setPendingRefundCount } = usePaymentStore();
  const [settlementCount, setSettlementCount] = useState<number | null>(null);

  // Counts for the links; refreshed when a sheet closes
  useEffect(() => {
    if (open) return;
    paymentService
      .getSettlements(1, 1)
      .then((r) => setSettlementCount(r.total || 0))
      .catch(() => setSettlementCount(null));
    paymentService
      .getPendingRefunds()
      .then((r) => setPendingRefundCount(r.length))
      .catch(() => {});
  }, [open, setPendingRefundCount]);

  const link = (q: ActionQueue, Icon: typeof Scale, label: string, count: number | null) => (
    <button
      type="button"
      onClick={() => onOpenChange(q)}
      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
    >
      <Icon className="h-3.5 w-3.5 text-neutral-500" />
      {label}
      {count != null && count > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">{count}</span>
      )}
    </button>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {link("settlements", Scale, "Pending settlements", settlementCount)}
        {link("refunds", RotateCcw, "Refund requests", pendingRefundCount)}
      </div>
      <Sheet open={open !== null} onOpenChange={(o) => !o && onOpenChange(null)}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>{open === "refunds" ? "Refund requests" : "Pending settlements"}</SheetTitle>
            <SheetDescription>
              {open === "refunds"
                ? "Approve, reject or mark refund requests as paid."
                : "Returned bookings with an outstanding balance or a deposit / over-payment to pay back."}
            </SheetDescription>
          </SheetHeader>
          {open === "settlements" && <SettlementsTab />}
          {open === "refunds" && <RefundsTab />}
        </SheetContent>
      </Sheet>
    </>
  );
}

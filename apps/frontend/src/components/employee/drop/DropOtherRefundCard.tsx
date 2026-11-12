import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RefundToCustomerDialog } from "@/components/manager/RefundToCustomerDialog";
import { formatRupees } from "@/lib/counterPayment";
import { formatIstDateTime } from "@/utils/overdueReturns";
import { customerRefundService } from "@/services/customerRefund.service";
import { cn } from "@/lib/utils";

/**
 * Client TODO 9 (Nov 2026): "Refund to customer (other reasons)" during the drop —
 * money paid back for a reason other than rent adjustments or discounts. Cash or
 * UPI (UPI: the success-screen photo), a required reason, recorded on its own
 * (`kind: DROP_OTHER`): never set against the extra charges, the rent or the
 * drop bill, which stay as they are. Usable before or after the bill is settled.
 */
export function DropOtherRefundCard({ bookingPublicId }: { bookingPublicId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["employee", "drop-other-refunds", bookingPublicId],
    queryFn: () => customerRefundService.getOptions(bookingPublicId, "employee"),
    staleTime: 15_000,
  });
  const refunds = (query.data?.refunds ?? []).filter((r) => r.kind === "DROP_OTHER");

  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="px-6 pt-6 pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Undo2 className="h-4 w-4 text-orange-600" />
          Refund to customer (other reasons)
        </CardTitle>
        <CardDescription>
          For money paid back for anything other than rent adjustments or discounts. It doesn't change the drop bill, the
          charges or the amount due.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6 pb-6 space-y-3">
        {refunds.length > 0 && (
          <ul className="space-y-1 text-sm">
            {refunds.map((r) => (
              <li key={r.publicId} className="flex justify-between gap-2">
                <span className={cn("text-zinc-600", r.voided && "line-through text-zinc-400")}>
                  {formatIstDateTime(r.at)} · {r.method === "CASH" ? "Cash" : "UPI"}
                  {r.by ? ` · ${r.by}` : ""}
                  {r.notes ? ` — ${r.notes.replace(/^Drop refund \(other\) \([^)]*\): /, "")}` : ""}
                  {r.voided ? " (voided)" : ""}
                </span>
                <span className={cn("tabular-nums font-medium", r.voided && "line-through text-zinc-400")}>
                  {formatRupees(parseFloat(r.amount) || 0)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="outline"
          className="w-full border-orange-500 text-orange-600 hover:bg-orange-50"
          onClick={() => setOpen(true)}
        >
          <Undo2 className="mr-2 h-4 w-4" />
          Record a refund
        </Button>
      </CardContent>
      <RefundToCustomerDialog
        open={open}
        onOpenChange={setOpen}
        bookingPublicId={bookingPublicId}
        portal="employee"
        kind="DROP_OTHER"
        onRefunded={() => {
          void qc.invalidateQueries({ queryKey: ["employee", "drop-other-refunds", bookingPublicId] });
          void query.refetch();
        }}
      />
    </Card>
  );
}

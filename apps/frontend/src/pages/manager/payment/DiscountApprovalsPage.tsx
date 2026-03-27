import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  CheckCircle2,
  X,
  Clock,
  PercentCircle,
  Loader2,
  ChevronRight,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  managerDiscountService,
  type ManualDiscount,
} from "@/services/discount.service";

const fmt = (v: string | number) =>
  `₹ ${parseFloat(String(v)).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

// ── Review Modal ──────────────────────────────────────────────────────────────

function ReviewModal({
  discount,
  onClose,
  onDone,
}: {
  discount: ManualDiscount;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [, setAction] = useState<"approve" | "reject" | null>(null);
  const queryClient = useQueryClient();

  const bookingTotal = discount.booking?.totalFinal ? parseFloat(discount.booking.totalFinal) : null;
  const afterDiscount = bookingTotal !== null ? bookingTotal - parseFloat(discount.amount) : null;

  const approveMutation = useMutation({
    mutationFn: () => managerDiscountService.approveManualDiscount(discount.publicId, note || undefined),
    onSuccess: () => {
      toast.success("Discount approved.");
      queryClient.invalidateQueries({ queryKey: ["pending-manual-discounts"] });
      onDone();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || "Failed to approve.");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => managerDiscountService.rejectManualDiscount(discount.publicId, note || undefined),
    onSuccess: () => {
      toast.success("Discount rejected.");
      queryClient.invalidateQueries({ queryKey: ["pending-manual-discounts"] });
      onDone();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || "Failed to reject.");
    },
  });

  const isLoading = approveMutation.isPending || rejectMutation.isPending;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Review Manual Discount Request</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Summary row */}
          <div className="bg-neutral-50 rounded-lg px-4 py-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-neutral-500">Booking</span>
              <span className="font-mono text-neutral-900">{discount.booking?.publicId ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Customer</span>
              <span>{discount.booking?.customer?.user.name ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Requested by</span>
              <span>{discount.appliedBy}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Discount amount</span>
              <span className="font-semibold text-neutral-900">{fmt(discount.amount)}</span>
            </div>
            {bookingTotal !== null && (
              <>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Booking total</span>
                  <span>{fmt(bookingTotal)}</span>
                </div>
                {afterDiscount !== null && (
                  <div className="flex justify-between border-t border-neutral-200 pt-2">
                    <span className="text-neutral-500">After discount</span>
                    <span className="font-semibold text-green-700">{fmt(afterDiscount)}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Reason */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Reason provided</p>
            <p className="text-sm text-neutral-800 bg-neutral-50 rounded-lg px-3 py-2 border border-neutral-100">
              {discount.reason}
            </p>
          </div>

          {/* Manager note */}
          <div className="space-y-2">
            <Label htmlFor="manager-note">Manager note (optional)</Label>
            <Textarea
              id="manager-note"
              placeholder="Add a note for the employee…"
              rows={2}
              className="resize-none"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={isLoading}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 border-red-200 text-red-600 hover:bg-red-50"
            onClick={() => { setAction("reject"); rejectMutation.mutate(); }}
            disabled={isLoading}
          >
            {rejectMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4 mr-1.5" />}
            Reject
          </Button>
          <Button
            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            onClick={() => { setAction("approve"); approveMutation.mutate(); }}
            disabled={isLoading}
          >
            {approveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
            Approve
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function DiscountApprovalsTab() {
  const [selected, setSelected] = useState<ManualDiscount | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["pending-manual-discounts"],
    queryFn: () => managerDiscountService.getPendingManualDiscounts(),
    refetchInterval: 30_000,
  });

  const discounts: ManualDiscount[] = data?.data ?? [];

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">Discount Approvals</h2>
            <p className="text-sm text-neutral-500 mt-1">Manual discount requests waiting for your review</p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading || isFetching}
              className="h-9 px-3 text-neutral-600 border-neutral-200"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {discounts.length > 0 && (
              <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-full px-4 py-1.5">
                <Clock className="w-4 h-4 text-yellow-600" />
                <span className="text-sm font-semibold text-yellow-800">{discounts.length} pending</span>
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-lg border h-16 animate-pulse" />
            ))}
          </div>
        ) : discounts.length === 0 ? (
          <div className="bg-white rounded-lg border shadow-sm flex flex-col items-center py-16 text-center">
            <PercentCircle className="w-12 h-12 text-neutral-200 mb-3" />
            <p className="font-medium text-neutral-600">No pending discount requests</p>
            <p className="text-sm text-neutral-400 mt-1">All manual discount requests have been reviewed.</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-neutral-50">
                    <th className="text-left px-5 py-3 font-medium text-neutral-500">Booking</th>
                    <th className="text-left px-4 py-3 font-medium text-neutral-500">Customer</th>
                    <th className="text-left px-4 py-3 font-medium text-neutral-500">Amount</th>
                    <th className="text-left px-4 py-3 font-medium text-neutral-500">Reason</th>
                    <th className="text-left px-4 py-3 font-medium text-neutral-500">Employee</th>
                    <th className="text-left px-4 py-3 font-medium text-neutral-500">Requested</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {discounts.map((d) => (
                    <tr key={d.publicId} className="hover:bg-neutral-50 transition-colors">
                      <td className="px-5 py-3.5 font-mono text-xs text-neutral-600">{d.booking?.publicId ?? "—"}</td>
                      <td className="px-4 py-3.5">{d.booking?.customer?.user.name ?? "—"}</td>
                      <td className="px-4 py-3.5 font-semibold text-neutral-900">{fmt(d.amount)}</td>
                      <td className="px-4 py-3.5 max-w-[200px]">
                        <p className="truncate text-neutral-600">{d.reason}</p>
                      </td>
                      <td className="px-4 py-3.5 text-neutral-600">{d.appliedBy}</td>
                      <td className="px-4 py-3.5 text-neutral-500 text-xs">
                        {format(new Date(d.requestedAt), "dd MMM, HH:mm")}
                      </td>
                      <td className="px-4 py-3.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          onClick={() => setSelected(d)}
                        >
                          Review <ChevronRight className="w-3 h-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-neutral-100">
              {discounts.map((d) => (
                <div
                  key={d.publicId}
                  className="px-4 py-4 space-y-2 cursor-pointer hover:bg-neutral-50"
                  onClick={() => setSelected(d)}
                >
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="font-semibold text-neutral-900">{fmt(d.amount)}</p>
                      <p className="text-xs text-neutral-500 font-mono">{d.booking?.publicId ?? "—"}</p>
                    </div>
                    <Badge variant="outline" className="border-yellow-400 text-yellow-700 bg-yellow-50 gap-1 text-xs">
                      <Clock className="w-3 h-3" /> Pending
                    </Badge>
                  </div>
                  <p className="text-sm text-neutral-600 truncate">{d.reason}</p>
                  <p className="text-xs text-neutral-400">
                    {d.appliedBy} • {format(new Date(d.requestedAt), "dd MMM, HH:mm")}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {selected && (
        <ReviewModal
          discount={selected}
          onClose={() => setSelected(null)}
          onDone={() => setSelected(null)}
        />
      )}
    </>
  );
}

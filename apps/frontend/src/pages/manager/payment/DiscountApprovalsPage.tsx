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
  DialogFooter,
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
      <DialogContent className="sm:max-w-md p-0 overflow-hidden">
        <div className="px-6 py-5 border-b border-neutral-100 bg-neutral-50/60">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Review Discount Request</DialogTitle>
            <p className="text-xs text-neutral-500 mt-0.5">
              {discount.booking?.customer?.user.name ?? "—"} — {fmt(discount.amount)}
            </p>
          </DialogHeader>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Details */}
          <div className="bg-neutral-50 rounded-xl border border-neutral-100 divide-y divide-neutral-100 text-sm overflow-hidden">
            {[
              ["Booking", discount.booking?.publicId ?? "—"],
              ["Customer", discount.booking?.customer?.user.name ?? "—"],
              ["Requested by", discount.appliedBy],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between items-center px-4 py-2.5">
                <span className="text-neutral-500 text-xs">{label}</span>
                <span className="text-xs font-medium text-neutral-800 font-mono">{value}</span>
              </div>
            ))}
            {bookingTotal !== null && (
              <div className="flex justify-between items-center px-4 py-2.5">
                <span className="text-neutral-500 text-xs">Booking total</span>
                <span className="text-xs font-medium text-neutral-800">{fmt(bookingTotal)}</span>
              </div>
            )}
            <div className="flex justify-between items-center px-4 py-2.5">
              <span className="text-neutral-500 text-xs">Discount amount</span>
              <span className="text-sm font-bold text-neutral-900">{fmt(discount.amount)}</span>
            </div>
            {afterDiscount !== null && (
              <div className="flex justify-between items-center px-4 py-3 bg-green-50/60">
                <span className="text-xs font-semibold text-neutral-700">After discount</span>
                <span className="text-sm font-bold text-green-700">{fmt(afterDiscount)}</span>
              </div>
            )}
          </div>

          {/* Reason */}
          <div>
            <p className="text-xs text-neutral-500 mb-1.5 font-medium uppercase tracking-wide">Reason</p>
            <p className="text-sm text-neutral-800 bg-neutral-50 border border-neutral-100 rounded-xl px-4 py-3 leading-relaxed">
              {discount.reason}
            </p>
          </div>

          {/* Manager note */}
          <div className="space-y-1.5">
            <Label className="text-xs text-neutral-600">Manager note <span className="text-neutral-400 font-normal">(optional)</span></Label>
            <Textarea
              placeholder="Add a note for the employee…"
              rows={2}
              className="resize-none text-sm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={isLoading}
            />
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-neutral-100 bg-neutral-50/40 gap-2">
          <Button
            variant="outline"
            className="flex-1 h-11 border-red-200 text-red-600 hover:bg-red-50 gap-1.5"
            onClick={() => { setAction("reject"); rejectMutation.mutate(); }}
            disabled={isLoading}
          >
            {rejectMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
            Reject
          </Button>
          <Button
            className="flex-1 h-11 bg-green-600 hover:bg-green-700 text-white gap-1.5"
            onClick={() => { setAction("approve"); approveMutation.mutate(); }}
            disabled={isLoading}
          >
            {approveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────

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
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">Discount Approvals</h2>
            <p className="text-xs text-neutral-500 mt-0.5">Manual discount requests waiting for your review</p>
          </div>
          <div className="flex items-center gap-2">
            {discounts.length > 0 && (
              <span className="bg-orange-100 text-orange-700 text-xs font-semibold px-2.5 py-1 rounded-full">
                {discounts.length} pending
              </span>
            )}
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading || isFetching} className="h-8 gap-1.5 text-xs">
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
          {isLoading ? (
            <div className="divide-y divide-neutral-100">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-28" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-32 flex-1" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-20" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-24" />
                  <div className="h-8 bg-neutral-100 rounded-lg animate-pulse w-20" />
                </div>
              ))}
            </div>
          ) : discounts.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-3">
                <PercentCircle className="w-6 h-6 text-green-500" />
              </div>
              <p className="font-medium text-neutral-700">No pending discount requests</p>
              <p className="text-sm text-neutral-400 mt-1">All manual discount requests have been reviewed.</p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-neutral-100 bg-neutral-50/80">
                      {["Booking", "Customer", "Amount", "Reason", "Employee", "Requested", ""].map((h, i) => (
                        <th key={i} className={`px-5 py-3.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide ${h === "Amount" || h === "" ? "text-right" : "text-left"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {discounts.map((d) => (
                      <tr key={d.publicId} className="hover:bg-neutral-50/60 transition-colors">
                        <td className="px-5 py-3.5 font-mono text-xs text-neutral-500">{d.booking?.publicId ?? "—"}</td>
                        <td className="px-5 py-3.5 font-medium text-neutral-900 text-sm">{d.booking?.customer?.user.name ?? "—"}</td>
                        <td className="px-5 py-3.5 text-right font-bold text-neutral-900 text-sm">{fmt(d.amount)}</td>
                        <td className="px-5 py-3.5 max-w-[200px]">
                          <p className="truncate text-sm text-neutral-600">{d.reason}</p>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-neutral-600">{d.appliedBy}</td>
                        <td className="px-5 py-3.5 text-xs text-neutral-500 whitespace-nowrap">{format(new Date(d.requestedAt), "dd MMM, HH:mm")}</td>
                        <td className="px-5 py-3.5 text-right">
                          <Button size="sm" className="h-8 text-xs bg-orange-500 hover:bg-orange-600 text-white px-3" onClick={() => setSelected(d)}>
                            Review
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
                  <div key={d.publicId} className="px-4 py-4 space-y-2.5 cursor-pointer hover:bg-neutral-50/60 active:bg-neutral-100/60" onClick={() => setSelected(d)}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold text-neutral-900">{fmt(d.amount)}</p>
                        <p className="text-xs text-neutral-400 font-mono mt-0.5">{d.booking?.publicId ?? "—"}</p>
                      </div>
                      <Badge variant="outline" className="border-yellow-300 text-yellow-700 bg-yellow-50 gap-1 text-xs">
                        <Clock className="w-3 h-3" /> Pending
                      </Badge>
                    </div>
                    <p className="text-sm text-neutral-600 line-clamp-2">{d.reason}</p>
                    <p className="text-xs text-neutral-400">{d.appliedBy} · {format(new Date(d.requestedAt), "dd MMM, HH:mm")}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {selected && (
        <ReviewModal discount={selected} onClose={() => setSelected(null)} onDone={() => setSelected(null)} />
      )}
    </>
  );
}

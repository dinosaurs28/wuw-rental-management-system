import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { CheckCircle, XCircle, Clock, AlertTriangle } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { paymentService, type PendingCashItem } from "@/services/payment.service";
import { usePaymentStore } from "@/store/payment.store";

const purposeLabels: Record<string, string> = {
  FULL_PAYMENT: "Full Payment",
  ADVANCE: "Advance",
  REMAINING_BALANCE: "Remaining Balance",
  EXTENSION_FEE: "Extension Fee",
  EXTENSION: "Extension Fee",
  DAMAGE_FEE: "Damage Fee",
};

function formatCollectedAt(iso: string): { label: string; isOld: boolean } {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffH = diffMs / (1000 * 60 * 60);

  let label: string;
  if (diffH < 1) {
    const mins = Math.round(diffMs / 60000);
    label = `${mins}m ago`;
  } else if (diffH < 24) {
    const hrs = Math.floor(diffH);
    label = `${hrs}h ago`;
  } else {
    const days = Math.floor(diffH / 24);
    label = days === 1 ? "Yesterday" : `${days}d ago`;
  }

  return { label, isOld: diffH > 2 };
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Confirm/Reject Modal ──────────────────────────────────────────────────────

function ReviewModal({
  item,
  onClose,
  onDone,
}: {
  item: PendingCashItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await paymentService.confirmCash(item.transactionPublicId, notes || undefined);
      toast.success("Cash payment confirmed.");
      onDone();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to confirm.");
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if ((rejectionReason || "").trim().length < 5) {
      toast.error("Rejection reason must be at least 5 characters.");
      return;
    }
    setLoading(true);
    try {
      await paymentService.rejectCash(item.transactionPublicId, rejectionReason.trim());
      toast.success("Cash payment rejected.");
      onDone();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to reject.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {rejectMode ? "Reject Cash Payment" : "Confirm Cash Payment"}
          </DialogTitle>
        </DialogHeader>

        {!rejectMode ? (
          <div className="space-y-4 py-2">
            {/* Details */}
            <div className="bg-neutral-50 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-neutral-500">Booking</span>
                <span className="font-medium">{item.bookingPublicId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Customer</span>
                <span className="font-medium">{item.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Purpose</span>
                <span className="font-medium">{purposeLabels[item.purpose] ?? item.purpose}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Amount</span>
                <span className="font-semibold text-neutral-900">
                  ₹ {parseFloat(item.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Collected by</span>
                <span className="font-medium">{item.employeeName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Collected at</span>
                <span className="font-medium">{formatDateTime(item.collectedAt)}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder="Any notes for the record…"
                rows={2}
                className="resize-none"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <p className="text-sm text-neutral-600">
              Provide a reason for rejecting this cash payment of{" "}
              <strong>₹ {parseFloat(item.amount).toLocaleString("en-IN")}</strong> from{" "}
              <strong>{item.customerName}</strong>.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="reason">
                Rejection reason <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="reason"
                placeholder="e.g. Cash amount was short by ₹500"
                rows={3}
                className="resize-none"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
              />
              {(rejectionReason || "").length > 0 && (rejectionReason || "").trim().length < 5 && (
                <p className="text-xs text-red-500">Minimum 5 characters required.</p>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {!rejectMode ? (
            <>
              <Button
                variant="outline"
                className="text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => setRejectMode(true)}
                disabled={loading}
              >
                <XCircle className="w-4 h-4 mr-1.5" />
                Reject
              </Button>
              <Button
                className="bg-orange-500 hover:bg-orange-600 text-white"
                onClick={handleConfirm}
                disabled={loading}
              >
                <CheckCircle className="w-4 h-4 mr-1.5" />
                {loading ? "Confirming…" : "Confirm Cash"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setRejectMode(false)} disabled={loading}>
                Cancel
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={handleReject}
                disabled={loading}
              >
                {loading ? "Rejecting…" : "Confirm Rejection"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function CashConfirmationsPage() {
  const { setPendingCashCount } = usePaymentStore();
  const [items, setItems] = useState<PendingCashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<PendingCashItem | null>(null);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await paymentService.getPendingCash(page, pageSize);
      setItems(res.data || []);
      setTotal(res.total || 0);
      setPendingCashCount(res.total || 0);
    } catch {
      toast.error("Failed to load pending confirmations.");
    } finally {
      setLoading(false);
    }
  }, [page, setPendingCashCount]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDone = () => {
    setSelected(null);
    load();
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <ManagerLayout>
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 py-6 space-y-6">
        {/* Header */}
        <div>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/manager/dashboard">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Cash Confirmations</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <div className="mt-4 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-neutral-900">Pending Cash Confirmations</h1>
              <p className="text-sm text-neutral-500 mt-1">
                Review and confirm cash collected by employees
              </p>
            </div>
            {total > 0 && (
              <span className="bg-orange-100 text-orange-700 text-sm font-semibold px-3 py-1 rounded-full">
                {total} pending
              </span>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-neutral-400 text-sm">Loading…</div>
          ) : (!items || items.length === 0) ? (
            <div className="py-16 text-center">
              <CheckCircle className="w-10 h-10 text-green-400 mx-auto mb-3" />
              <p className="font-medium text-neutral-700">All caught up!</p>
              <p className="text-sm text-neutral-400 mt-1">No pending cash confirmations.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-neutral-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Booking
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Customer
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Purpose
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Amount
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Employee
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Collected
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(items || []).map((item) => {
                    const { label, isOld } = formatCollectedAt(item.collectedAt);
                    return (
                      <tr
                        key={item.transactionPublicId}
                        className={`hover:bg-neutral-50 transition-colors ${isOld ? "bg-red-50/30" : ""}`}
                      >
                        <td className="px-4 py-3.5 font-mono text-xs text-neutral-600">
                          {item.bookingPublicId}
                        </td>
                        <td className="px-4 py-3.5 font-medium text-neutral-900">
                          {item.customerName}
                        </td>
                        <td className="px-4 py-3.5 text-neutral-600">
                          {purposeLabels[item.purpose] ?? item.purpose}
                        </td>
                        <td className="px-4 py-3.5 text-right font-semibold text-neutral-900">
                          ₹ {parseFloat(item.amount).toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                          })}
                        </td>
                        <td className="px-4 py-3.5 text-neutral-600">{item.employeeName}</td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-medium ${
                              isOld ? "text-red-600" : "text-neutral-500"
                            }`}
                          >
                            {isOld && <AlertTriangle className="w-3.5 h-3.5" />}
                            {!isOld && <Clock className="w-3.5 h-3.5" />}
                            {label}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <Button
                            size="sm"
                            className="bg-orange-500 hover:bg-orange-600 text-white h-8 text-xs"
                            onClick={() => setSelected(item)}
                          >
                            Review
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-neutral-500">
            <span>
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <ReviewModal
          item={selected}
          onClose={() => setSelected(null)}
          onDone={handleDone}
        />
      )}
    </ManagerLayout>
  );
}

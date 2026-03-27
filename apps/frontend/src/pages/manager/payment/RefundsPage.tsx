import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { CheckCircle, XCircle, Send, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

import { RefundStatusBadge } from "@/components/manager/payment/PaymentStateBadge";
import { paymentService, type RefundItem } from "@/services/payment.service";
import { usePaymentStore } from "@/store/payment.store";

// ── Refund Detail Modal ───────────────────────────────────────────────────────

function RefundDetailModal({
  publicId,
  onClose,
  onDone,
}: {
  publicId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [refund, setRefund] = useState<RefundItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [txnRef, setTxnRef] = useState("");

  useEffect(() => {
    paymentService
      .getRefund(publicId)
      .then(setRefund)
      .catch(() => toast.error("Failed to load refund details."))
      .finally(() => setLoading(false));
  }, [publicId]);

  const handleApprove = async () => {
    setActionLoading(true);
    try {
      await paymentService.approveRefund(publicId);
      toast.success("Refund approved.");
      onDone();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to approve refund.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (rejectionReason.trim().length < 5) {
      toast.error("Rejection reason must be at least 5 characters.");
      return;
    }
    setActionLoading(true);
    try {
      await paymentService.rejectRefund(publicId, rejectionReason.trim());
      toast.success("Refund rejected.");
      onDone();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to reject refund.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisburse = async () => {
    setActionLoading(true);
    try {
      await paymentService.completeRefund(publicId, txnRef || undefined);
      toast.success("Refund disbursed successfully.");
      onDone();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to mark refund as disbursed.");
    } finally {
      setActionLoading(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {rejectMode ? "Reject Refund" : "Refund Request Detail"}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-neutral-400">Loading…</div>
        ) : refund ? (
          <>
            {!rejectMode ? (
              <div className="space-y-4 py-2">
                {/* Status badge */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-neutral-500">Status</span>
                  <RefundStatusBadge status={refund.status} />
                </div>

                {/* Details */}
                <div className="bg-neutral-50 rounded-lg px-4 py-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Booking</span>
                    <span className="font-medium">{refund.bookingPublicId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Customer</span>
                    <span className="font-medium">{refund.customerName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Amount</span>
                    <span className="font-semibold text-neutral-900">
                      ₹ {parseFloat(refund.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Method</span>
                    <span className="font-medium capitalize">{refund.method.toLowerCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Requested by</span>
                    <span className="font-medium">{refund.requestedBy}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Requested at</span>
                    <span className="font-medium">{formatDate(refund.requestedAt)}</span>
                  </div>
                  {refund.approvedBy && refund.approvedAt && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-neutral-500">Approved by</span>
                        <span className="font-medium">{refund.approvedBy}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-500">Approved at</span>
                        <span className="font-medium">{formatDate(refund.approvedAt)}</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Reason */}
                <div className="text-sm">
                  <p className="text-neutral-500 mb-1">Reason</p>
                  <p className="text-neutral-800 bg-neutral-50 rounded-lg px-3 py-2.5">
                    {refund.reason}
                  </p>
                </div>

                {/* APPROVED state — disburse form */}
                {refund.status === "APPROVED" && (
                  <div className="space-y-3 pt-2">
                    <p className="text-sm font-medium text-green-700 bg-green-50 rounded-lg px-3 py-2">
                      ✓ Refund approved — mark as disbursed when payment is sent.
                    </p>
                    {refund.method === "ONLINE" && (
                      <div className="space-y-1.5">
                        <Label htmlFor="disburseRef">Online Transaction Reference (optional)</Label>
                        <Input
                          id="disburseRef"
                          placeholder="e.g. refund_pay_abc123"
                          className="h-12"
                          value={txnRef}
                          onChange={(e) => setTxnRef(e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4 py-2">
                <p className="text-sm text-neutral-600">
                  Provide a reason for rejecting the refund of{" "}
                  <strong>₹ {parseFloat(refund.amount).toLocaleString("en-IN")}</strong>.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="refundRejectReason">
                    Rejection reason <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    id="refundRejectReason"
                    placeholder="e.g. Refund policy does not apply after 48h"
                    rows={3}
                    className="resize-none"
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                  />
                  {rejectionReason.length > 0 && rejectionReason.trim().length < 5 && (
                    <p className="text-xs text-red-500">Minimum 5 characters required.</p>
                  )}
                </div>
              </div>
            )}

            <DialogFooter className="gap-2">
              {refund.status === "PENDING_APPROVAL" && !rejectMode && (
                <>
                  <Button
                    variant="outline"
                    className="text-red-600 border-red-200 hover:bg-red-50"
                    onClick={() => setRejectMode(true)}
                    disabled={actionLoading}
                  >
                    <XCircle className="w-4 h-4 mr-1.5" />
                    Reject
                  </Button>
                  <Button
                    className="bg-orange-500 hover:bg-orange-600 text-white"
                    onClick={handleApprove}
                    disabled={actionLoading}
                  >
                    <CheckCircle className="w-4 h-4 mr-1.5" />
                    {actionLoading ? "Approving…" : "Approve Refund"}
                  </Button>
                </>
              )}
              {refund.status === "APPROVED" && !rejectMode && (
                <>
                  <Button variant="outline" onClick={onClose} disabled={actionLoading}>
                    Close
                  </Button>
                  <Button
                    className="bg-green-600 hover:bg-green-700 text-white"
                    onClick={handleDisburse}
                    disabled={actionLoading}
                  >
                    <Send className="w-4 h-4 mr-1.5" />
                    {actionLoading ? "Marking…" : "Mark as Disbursed"}
                  </Button>
                </>
              )}
              {rejectMode && (
                <>
                  <Button variant="outline" onClick={() => setRejectMode(false)} disabled={actionLoading}>
                    Cancel
                  </Button>
                  <Button
                    className="bg-red-600 hover:bg-red-700 text-white"
                    onClick={handleReject}
                    disabled={actionLoading}
                  >
                    {actionLoading ? "Rejecting…" : "Confirm Rejection"}
                  </Button>
                </>
              )}
              {(refund.status === "COMPLETED" || refund.status === "REJECTED") && (
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
              )}
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function RefundsTab() {
  const { setPendingRefundCount } = usePaymentStore();
  const [items, setItems] = useState<RefundItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await paymentService.getPendingRefunds();
      setItems(data);
      setPendingRefundCount(data.length);
    } catch {
      toast.error("Failed to load pending refunds.");
    } finally {
      setLoading(false);
    }
  }, [setPendingRefundCount]);

  useEffect(() => {
    load();
  }, [load]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">Pending Refund Approvals</h2>
            <p className="text-sm text-neutral-500 mt-1">
              Approve or reject customer refund requests
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={load}
              disabled={loading}
              className="h-9 px-3 text-neutral-600 border-neutral-200"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {items.length > 0 && (
              <span className="bg-orange-100 text-orange-700 text-sm font-semibold px-3 py-1 rounded-full">
                {items.length} pending
              </span>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-neutral-400 text-sm">Loading…</div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center">
              <CheckCircle className="w-10 h-10 text-green-400 mx-auto mb-3" />
              <p className="font-medium text-neutral-700">No pending refund approvals</p>
              <p className="text-sm text-neutral-400 mt-1">All refund requests have been handled.</p>
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
                    <th className="px-4 py-3 text-right text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Amount
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Method
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Requested
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {items.map((item) => (
                    <tr key={item.publicId} className="hover:bg-neutral-50 transition-colors">
                      <td className="px-4 py-3.5 font-mono text-xs text-neutral-600">
                        {item.bookingPublicId}
                      </td>
                      <td className="px-4 py-3.5 font-medium text-neutral-900">
                        {item.customerName}
                      </td>
                      <td className="px-4 py-3.5 text-right font-semibold text-neutral-900">
                        ₹ {parseFloat(item.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3.5 text-neutral-600 capitalize">
                        {item.method.toLowerCase()}
                      </td>
                      <td className="px-4 py-3.5">
                        <RefundStatusBadge status={item.status} />
                      </td>
                      <td className="px-4 py-3.5 text-neutral-500 text-xs">
                        {formatDate(item.requestedAt)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Button
                          size="sm"
                          className="bg-orange-500 hover:bg-orange-600 text-white h-8 text-xs"
                          onClick={() => setSelected(item.publicId)}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <RefundDetailModal
          publicId={selected}
          onClose={() => setSelected(null)}
          onDone={() => {
            setSelected(null);
            load();
          }}
        />
      )}
    </>
  );
}

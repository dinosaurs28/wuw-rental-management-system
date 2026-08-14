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
    } finally { setActionLoading(false); }
  };

  const handleReject = async () => {
    if (rejectionReason.trim().length < 5) { toast.error("Rejection reason must be at least 5 characters."); return; }
    setActionLoading(true);
    try {
      await paymentService.rejectRefund(publicId, rejectionReason.trim());
      toast.success("Refund rejected.");
      onDone();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to reject refund.");
    } finally { setActionLoading(false); }
  };

  const handleDisburse = async () => {
    setActionLoading(true);
    try {
      await paymentService.completeRefund(publicId, txnRef || undefined);
      toast.success("Refund disbursed successfully.");
      onDone();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to mark refund as disbursed.");
    } finally { setActionLoading(false); }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden">
        <div className="px-6 py-5 border-b border-neutral-100 bg-neutral-50/60">
          <DialogHeader>
            <DialogTitle className="text-[15px]">
              {rejectMode ? "Reject Refund" : "Refund Request Detail"}
            </DialogTitle>
            {refund && !loading && (
              <p className="text-xs text-neutral-500 mt-0.5">
                {refund.customerName} — ₹ {parseFloat(refund.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </p>
            )}
          </DialogHeader>
        </div>

        <div className="px-6 py-5">
          {loading ? (
            <div className="py-8 flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex justify-between items-center">
                  <div className="h-3 bg-neutral-100 rounded animate-pulse w-24" />
                  <div className="h-3 bg-neutral-100 rounded animate-pulse w-32" />
                </div>
              ))}
            </div>
          ) : refund ? (
            <>
              {!rejectMode ? (
                <div className="space-y-4">
                  {/* Status + details */}
                  <div className="bg-neutral-50 rounded-xl border border-neutral-100 divide-y divide-neutral-100 text-sm overflow-hidden">
                    <div className="flex justify-between items-center px-4 py-2.5">
                      <span className="text-neutral-500 text-xs">Status</span>
                      <RefundStatusBadge status={refund.status} />
                    </div>
                    {[
                      ["Booking", refund.bookingPublicId],
                      ["Customer", refund.customerName],
                      ["Method", refund.method.toLowerCase()],
                      ["Requested by", refund.requestedBy],
                      ["Requested at", formatDate(refund.requestedAt)],
                      ...(refund.approvedBy && refund.approvedAt
                        ? [["Approved by", refund.approvedBy], ["Approved at", formatDate(refund.approvedAt)]]
                        : []),
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between items-center px-4 py-2.5">
                        <span className="text-neutral-500 text-xs">{label}</span>
                        <span className="text-xs font-medium text-neutral-800 capitalize">{value}</span>
                      </div>
                    ))}
                    <div className="flex justify-between items-center px-4 py-3 bg-neutral-100/60">
                      <span className="text-sm font-semibold text-neutral-800">Amount</span>
                      <span className="text-sm font-bold text-neutral-900">
                        ₹ {parseFloat(refund.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  {/* Reason */}
                  <div>
                    <p className="text-xs text-neutral-500 mb-1.5 font-medium">Reason</p>
                    <p className="text-sm text-neutral-800 bg-neutral-50 rounded-xl border border-neutral-100 px-4 py-3 leading-relaxed">
                      {refund.reason}
                    </p>
                  </div>

                  {/* APPROVED disburse */}
                  {refund.status === "APPROVED" && (
                    <div className="space-y-3 pt-1">
                      <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-xl px-4 py-2.5 text-sm text-green-700">
                        <CheckCircle className="w-4 h-4 shrink-0" />
                        Approved — mark as disbursed once payment is sent.
                      </div>
                      {refund.method === "ONLINE" && (
                        <div className="space-y-1.5">
                          <Label className="text-xs text-neutral-600">Transaction Reference (optional)</Label>
                          <Input placeholder="e.g. refund_pay_abc123" className="h-11" value={txnRef} onChange={(e) => setTxnRef(e.target.value)} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700">
                    Rejecting refund of <strong>₹ {parseFloat(refund.amount).toLocaleString("en-IN")}</strong> for <strong>{refund.customerName}</strong>.
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-neutral-600">Rejection reason <span className="text-red-500">*</span></Label>
                    <Textarea placeholder="e.g. Refund policy does not apply after 48h" rows={3} className="resize-none text-sm" value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} />
                    {rejectionReason.length > 0 && rejectionReason.trim().length < 5 && (
                      <p className="text-xs text-red-500">Minimum 5 characters required.</p>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {refund && !loading && (
          <DialogFooter className="px-6 py-4 border-t border-neutral-100 bg-neutral-50/40 gap-2">
            {refund.status === "PENDING_APPROVAL" && !rejectMode && (
              <>
                <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 gap-1.5" onClick={() => setRejectMode(true)} disabled={actionLoading}>
                  <XCircle className="w-4 h-4" /> Reject
                </Button>
                <Button className="bg-orange-500 hover:bg-orange-600 text-white gap-1.5" onClick={handleApprove} disabled={actionLoading}>
                  <CheckCircle className="w-4 h-4" /> {actionLoading ? "Approving…" : "Approve Refund"}
                </Button>
              </>
            )}
            {refund.status === "APPROVED" && !rejectMode && (
              <>
                <Button variant="outline" onClick={onClose} disabled={actionLoading}>Close</Button>
                <Button className="bg-green-600 hover:bg-green-700 text-white gap-1.5" onClick={handleDisburse} disabled={actionLoading}>
                  <Send className="w-4 h-4" /> {actionLoading ? "Marking…" : "Mark as Disbursed"}
                </Button>
              </>
            )}
            {rejectMode && (
              <>
                <Button variant="outline" onClick={() => setRejectMode(false)} disabled={actionLoading}>Back</Button>
                <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={handleReject} disabled={actionLoading}>
                  {actionLoading ? "Rejecting…" : "Confirm Rejection"}
                </Button>
              </>
            )}
            {(refund.status === "COMPLETED" || refund.status === "REJECTED") && (
              <Button variant="outline" onClick={onClose}>Close</Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────

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
    } catch { toast.error("Failed to load pending refunds."); }
    finally { setLoading(false); }
  }, [setPendingRefundCount]);

  useEffect(() => { load(); }, [load]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">Pending Refund Approvals</h2>
            <p className="text-xs text-neutral-500 mt-0.5">Approve or reject customer refund requests</p>
          </div>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <span className="bg-orange-100 text-orange-700 text-xs font-semibold px-2.5 py-1 rounded-full">
                {items.length} pending
              </span>
            )}
            <Button variant="outline" size="sm" onClick={load} disabled={loading} className="h-8 gap-1.5 text-xs">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
          {loading ? (
            <div className="divide-y divide-neutral-100">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-28" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-36 flex-1" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-20" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-16" />
                  <div className="h-8 bg-neutral-100 rounded-lg animate-pulse w-16" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-3">
                <CheckCircle className="w-6 h-6 text-green-500" />
              </div>
              <p className="font-medium text-neutral-700">No pending refund approvals</p>
              <p className="text-sm text-neutral-400 mt-1">All refund requests have been handled.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neutral-100 bg-neutral-50/80">
                    {["Booking", "Customer", "Amount", "Method", "Status", "Requested", ""].map((h, i) => (
                      <th key={i} className={`px-5 py-3.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide ${h === "Amount" || h === "" ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {items.map((item) => (
                    <tr key={item.publicId} className="hover:bg-neutral-50/60 transition-colors">
                      <td className="px-5 py-3.5 font-mono text-xs text-neutral-500">{item.bookingPublicId}</td>
                      <td className="px-5 py-3.5 font-medium text-neutral-900 text-sm">{item.customerName}</td>
                      <td className="px-5 py-3.5 text-right font-semibold text-neutral-900 text-sm">
                        ₹ {parseFloat(item.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-neutral-600 capitalize">{item.method.toLowerCase()}</td>
                      <td className="px-5 py-3.5"><RefundStatusBadge status={item.status} /></td>
                      <td className="px-5 py-3.5 text-xs text-neutral-500">{formatDate(item.requestedAt)}</td>
                      <td className="px-5 py-3.5 text-right">
                        <Button size="sm" className="h-8 text-xs bg-orange-500 hover:bg-orange-600 text-white px-3" onClick={() => setSelected(item.publicId)}>
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
        <RefundDetailModal publicId={selected} onClose={() => setSelected(null)} onDone={() => { setSelected(null); load(); }} />
      )}
    </>
  );
}

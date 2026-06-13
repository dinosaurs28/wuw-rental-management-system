import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { CheckCircle, XCircle, Clock, AlertTriangle, RefreshCw, Banknote, ChevronLeft, ChevronRight } from "lucide-react";

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
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Review Modal ──────────────────────────────────────────────────────────────

function ReviewModal({ item, onClose, onDone }: { item: PendingCashItem; onClose: () => void; onDone: () => void }) {
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
    } finally { setLoading(false); }
  };

  const handleReject = async () => {
    if ((rejectionReason || "").trim().length < 5) { toast.error("Rejection reason must be at least 5 characters."); return; }
    setLoading(true);
    try {
      await paymentService.rejectCash(item.transactionPublicId, rejectionReason.trim());
      toast.success("Cash payment rejected.");
      onDone();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to reject.");
    } finally { setLoading(false); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden">
        <div className="px-6 py-5 border-b border-neutral-100 bg-neutral-50/60">
          <DialogHeader>
            <DialogTitle className="text-[15px]">
              {rejectMode ? "Reject Cash Payment" : "Review Cash Payment"}
            </DialogTitle>
            <p className="text-xs text-neutral-500 mt-0.5">
              {item.customerName} — ₹ {parseFloat(item.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </p>
          </DialogHeader>
        </div>

        <div className="px-6 py-5">
          {!rejectMode ? (
            <div className="space-y-4">
              <div className="bg-neutral-50 rounded-xl border border-neutral-100 divide-y divide-neutral-100 text-sm overflow-hidden">
                {[
                  ["Booking", item.bookingPublicId],
                  ["Customer", item.customerName],
                  ["Purpose", purposeLabels[item.purpose] ?? item.purpose],
                  ["Amount", `₹ ${parseFloat(item.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`],
                  ["Collected by", item.employeeName],
                  ["Collected at", formatDateTime(item.collectedAt)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between items-center px-4 py-2.5">
                    <span className="text-neutral-500 text-xs">{label}</span>
                    <span className={`font-medium text-xs ${label === "Amount" ? "text-neutral-900 font-semibold text-sm" : "text-neutral-800"}`}>{value}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-neutral-600">Notes (optional)</Label>
                <Textarea placeholder="Any notes for the record…" rows={2} className="resize-none text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700">
                Rejecting payment of <strong>₹ {parseFloat(item.amount).toLocaleString("en-IN")}</strong> from <strong>{item.customerName}</strong>.
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-neutral-600">Rejection reason <span className="text-red-500">*</span></Label>
                <Textarea placeholder="e.g. Cash amount was short by ₹500" rows={3} className="resize-none text-sm" value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} />
                {(rejectionReason || "").length > 0 && (rejectionReason || "").trim().length < 5 && (
                  <p className="text-xs text-red-500">Minimum 5 characters required.</p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-neutral-100 bg-neutral-50/40 gap-2">
          {!rejectMode ? (
            <>
              <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 gap-1.5" onClick={() => setRejectMode(true)} disabled={loading}>
                <XCircle className="w-4 h-4" /> Reject
              </Button>
              <Button className="bg-orange-500 hover:bg-orange-600 text-white gap-1.5" onClick={handleConfirm} disabled={loading}>
                <CheckCircle className="w-4 h-4" /> {loading ? "Confirming…" : "Confirm Cash"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setRejectMode(false)} disabled={loading}>Back</Button>
              <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={handleReject} disabled={loading}>
                {loading ? "Rejecting…" : "Confirm Rejection"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export function CashConfirmationsTab() {
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
    } catch { toast.error("Failed to load pending confirmations."); }
    finally { setLoading(false); }
  }, [page, setPendingCashCount]);

  useEffect(() => { load(); }, [load]);

  const handleDone = () => { setSelected(null); load(); };
  const totalPages = Math.ceil(total / pageSize);

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">Pending Cash Confirmations</h2>
            <p className="text-xs text-neutral-500 mt-0.5">Review and confirm cash collected by employees</p>
          </div>
          <div className="flex items-center gap-2">
            {total > 0 && (
              <span className="bg-orange-100 text-orange-700 text-xs font-semibold px-2.5 py-1 rounded-full">
                {total} pending
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
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-24" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-16" />
                  <div className="h-8 bg-neutral-100 rounded-lg animate-pulse w-20" />
                </div>
              ))}
            </div>
          ) : (!items || items.length === 0) ? (
            <div className="py-20 flex flex-col items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-3">
                <CheckCircle className="w-6 h-6 text-green-500" />
              </div>
              <p className="font-medium text-neutral-700">All caught up!</p>
              <p className="text-sm text-neutral-400 mt-1">No pending cash confirmations.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neutral-100 bg-neutral-50/80">
                    {["Booking", "Customer", "Purpose", "Amount", "Employee", "Collected", ""].map((h) => (
                      <th key={h} className={`px-5 py-3.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide ${h === "Amount" || h === "" ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(items || []).map((item) => {
                    const { label, isOld } = formatCollectedAt(item.collectedAt);
                    return (
                      <tr key={item.transactionPublicId} className={`hover:bg-neutral-50/60 transition-colors ${isOld ? "bg-red-50/20" : ""}`}>
                        <td className="px-5 py-3.5 font-mono text-xs text-neutral-500">{item.bookingPublicId}</td>
                        <td className="px-5 py-3.5 font-medium text-neutral-900 text-sm">{item.customerName}</td>
                        <td className="px-5 py-3.5 text-sm text-neutral-600">{purposeLabels[item.purpose] ?? item.purpose}</td>
                        <td className="px-5 py-3.5 text-right font-semibold text-neutral-900 text-sm">
                          ₹ {parseFloat(item.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-neutral-600">{item.employeeName}</td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${isOld ? "text-red-600" : "text-neutral-500"}`}>
                            {isOld ? <AlertTriangle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                            {label}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white h-8 text-xs px-3" onClick={() => setSelected(item)}>
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
          <div className="flex items-center justify-between">
            <p className="text-sm text-neutral-500">
              Showing <span className="font-medium text-neutral-700">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}</span> of <span className="font-medium text-neutral-700">{total}</span>
            </p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-neutral-600 px-2">Page {page} of {totalPages}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {selected && <ReviewModal item={selected} onClose={() => setSelected(null)} onDone={handleDone} />}
    </>
  );
}

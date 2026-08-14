import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw, X, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

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

import { ShiftStatusBadge } from "@/components/manager/payment/PaymentStateBadge";
import { paymentService, type CashShift } from "@/services/payment.service";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtMoney(val?: string) {
  if (!val) return "—";
  return "₹ " + parseFloat(val).toLocaleString("en-IN", { minimumFractionDigits: 2 });
}

// ── Reconcile Modal ───────────────────────────────────────────────────────────

function ReconcileModal({ shift, onClose, onDone }: { shift: CashShift; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  const discrepancy =
    shift.expectedTotal && shift.actualTotal
      ? parseFloat(shift.actualTotal) - parseFloat(shift.expectedTotal)
      : null;

  const handleReconcile = async () => {
    if ((note || "").trim().length < 10) { toast.error("Manager note must be at least 10 characters."); return; }
    setLoading(true);
    try {
      await paymentService.reconcileShift(shift.publicId, note.trim());
      toast.success("Shift reconciled.");
      onDone();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to reconcile shift.");
    } finally { setLoading(false); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
        <div className="px-6 py-5 border-b border-neutral-100 bg-neutral-50/60">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Shift Detail</DialogTitle>
            <p className="text-xs text-neutral-500 mt-0.5">{shift.employeeName}</p>
          </DialogHeader>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Shift summary */}
          <div className="bg-neutral-50 rounded-xl border border-neutral-100 divide-y divide-neutral-100 text-sm overflow-hidden">
            {[
              ["Employee", shift.employeeName],
              ["Opened", formatDateTime(shift.openedAt)],
              ...(shift.closedAt ? [["Closed", formatDateTime(shift.closedAt)]] : []),
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between items-center px-4 py-2.5">
                <span className="text-neutral-500 text-xs">{label}</span>
                <span className="text-xs font-medium text-neutral-800">{value}</span>
              </div>
            ))}
            <div className="flex justify-between items-center px-4 py-2.5">
              <span className="text-neutral-500 text-xs">Expected Total</span>
              <span className="text-xs font-semibold text-neutral-800">{fmtMoney(shift.expectedTotal)}</span>
            </div>
            <div className="flex justify-between items-center px-4 py-2.5">
              <span className="text-neutral-500 text-xs">Actual Total</span>
              <span className="text-xs font-semibold text-neutral-800">{fmtMoney(shift.actualTotal)}</span>
            </div>
            {discrepancy !== null && (
              <div className="flex justify-between items-center px-4 py-3 bg-neutral-100/60">
                <span className="text-sm font-semibold text-neutral-700">Discrepancy</span>
                <span className={`text-sm font-bold ${discrepancy < 0 ? "text-red-600" : "text-green-600"}`}>
                  {discrepancy >= 0 ? "+" : "−"}₹ {Math.abs(discrepancy).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}
          </div>

          {shift.discrepancyExplanation && (
            <div>
              <p className="text-xs text-neutral-500 mb-1.5 font-medium">Employee Note</p>
              <p className="text-sm text-neutral-800 bg-neutral-50 border border-neutral-100 rounded-xl px-4 py-3 italic leading-relaxed">
                "{shift.discrepancyExplanation}"
              </p>
            </div>
          )}

          <div className="flex items-start gap-2 bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 text-sm text-orange-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-orange-500" />
            Review the discrepancy and add a manager note to reconcile this shift.
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-neutral-600">Manager Reconciliation Note <span className="text-red-500">*</span></Label>
            <Textarea
              placeholder="e.g. Verified with employee — customer shortfall noted. Acceptable."
              rows={3}
              className="resize-none text-sm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {(note || "").length > 0 && (note || "").trim().length < 10 && (
              <p className="text-xs text-red-500">Minimum 10 characters required.</p>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-neutral-100 bg-neutral-50/40 gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button className="bg-orange-500 hover:bg-orange-600 text-white" onClick={handleReconcile} disabled={loading}>
            {loading ? "Reconciling…" : "Mark as Reconciled"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export function CashShiftsTab() {
  const [shifts, setShifts] = useState<CashShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<CashShift | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filters: { from?: string; to?: string } = {};
      if (fromDate) filters.from = fromDate;
      if (toDate) filters.to = toDate;
      const res = await paymentService.getAllShifts(page, pageSize, filters);
      setShifts(res.data || []);
      setTotal(res.total || 0);
    } catch { toast.error("Failed to load shifts."); }
    finally { setLoading(false); }
  }, [page, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <>
      <div className="space-y-5">
        {/* Header + filters */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-4">
          <div className="flex-1">
            <h2 className="text-base font-semibold text-neutral-900">Cash Shifts</h2>
            <p className="text-xs text-neutral-500 mt-0.5">All employee cash shift records for this branch</p>
          </div>

          {/* Date filter bar */}
          <div className="flex items-end gap-2 flex-wrap">
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide flex items-center gap-1">
                <CalendarDays className="w-3 h-3" /> From
              </span>
              <Input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} className="h-9 w-36 text-sm" />
            </div>
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide">To</span>
              <Input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} className="h-9 w-36 text-sm" />
            </div>
            {(fromDate || toDate) && (
              <Button variant="ghost" size="sm" className="h-9 text-neutral-500 hover:text-neutral-700 gap-1" onClick={() => { setFromDate(""); setToDate(""); setPage(1); }}>
                <X className="w-3.5 h-3.5" /> Clear
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={load} disabled={loading} className="h-9 gap-1.5 text-xs">
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
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-32 flex-1" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-24" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-20" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-16" />
                  <div className="h-6 bg-neutral-100 rounded-full animate-pulse w-24" />
                </div>
              ))}
            </div>
          ) : (!shifts || shifts.length === 0) ? (
            <div className="py-20 flex flex-col items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mb-3">
                <CalendarDays className="w-6 h-6 text-neutral-400" />
              </div>
              <p className="font-medium text-neutral-700">No shifts recorded</p>
              <p className="text-sm text-neutral-400 mt-1">Shifts will appear once employees open them.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neutral-100 bg-neutral-50/80">
                    {["Employee", "Opened At", "Closed At", "Expected", "Actual", "Status", ""].map((h, i) => (
                      <th key={i} className={`px-5 py-3.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide ${h === "Expected" || h === "Actual" ? "text-right" : h === "" ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(shifts || []).map((shift) => {
                    const isDiscrepancy = shift.status === "DISCREPANCY_FLAGGED";
                    return (
                      <tr key={shift.publicId} className={`hover:bg-neutral-50/60 transition-colors ${isDiscrepancy ? "border-l-4 border-l-red-400" : ""}`}>
                        <td className="px-5 py-3.5 font-medium text-neutral-900 text-sm">{shift.employeeName}</td>
                        <td className="px-5 py-3.5 text-xs text-neutral-500">{formatDateTime(shift.openedAt)}</td>
                        <td className="px-5 py-3.5 text-xs text-neutral-500">{shift.closedAt ? formatDateTime(shift.closedAt) : <span className="text-neutral-300">—</span>}</td>
                        <td className="px-5 py-3.5 text-right text-sm text-neutral-700">{fmtMoney(shift.expectedTotal)}</td>
                        <td className="px-5 py-3.5 text-right text-sm text-neutral-700">{fmtMoney(shift.actualTotal)}</td>
                        <td className="px-5 py-3.5"><ShiftStatusBadge status={shift.status} /></td>
                        <td className="px-5 py-3.5 text-right">
                          {isDiscrepancy && (
                            <Button size="sm" className="h-8 text-xs bg-orange-500 hover:bg-orange-600 text-white px-3" onClick={() => setSelected(shift)}>
                              Reconcile
                            </Button>
                          )}
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
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="text-sm text-neutral-600 px-2">Page {page} of {totalPages}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </div>

      {selected && <ReconcileModal shift={selected} onClose={() => setSelected(null)} onDone={() => { setSelected(null); load(); }} />}
    </>
  );
}

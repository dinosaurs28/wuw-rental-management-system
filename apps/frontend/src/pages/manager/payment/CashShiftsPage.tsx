import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { ShiftStatusBadge } from "@/components/manager/payment/PaymentStateBadge";
import { paymentService, type CashShift } from "@/services/payment.service";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtMoney(val?: string) {
  if (!val) return "—";
  return "₹ " + parseFloat(val).toLocaleString("en-IN", { minimumFractionDigits: 2 });
}

// ── Reconcile Modal ───────────────────────────────────────────────────────────

function ReconcileModal({
  shift,
  onClose,
  onDone,
}: {
  shift: CashShift;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  const discrepancy =
    shift.expectedTotal && shift.actualTotal
      ? parseFloat(shift.actualTotal) - parseFloat(shift.expectedTotal)
      : null;

  const handleReconcile = async () => {
    if ((note || "").trim().length < 10) {
      toast.error("Manager note must be at least 10 characters.");
      return;
    }
    setLoading(true);
    try {
      await paymentService.reconcileShift(shift.publicId, note.trim());
      toast.success("Shift reconciled.");
      onDone();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to reconcile shift.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Shift Detail — {shift.employeeName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Shift info */}
          <div className="bg-neutral-50 rounded-lg px-4 py-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-neutral-500">Employee</span>
              <span className="font-medium">{shift.employeeName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Opened</span>
              <span className="font-medium">{formatDateTime(shift.openedAt)}</span>
            </div>
            {shift.closedAt && (
              <div className="flex justify-between">
                <span className="text-neutral-500">Closed</span>
                <span className="font-medium">{formatDateTime(shift.closedAt)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 border-t border-neutral-200">
              <span className="text-neutral-500">Expected Total</span>
              <span className="font-semibold">{fmtMoney(shift.expectedTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Actual Total</span>
              <span className="font-semibold">{fmtMoney(shift.actualTotal)}</span>
            </div>
            {discrepancy !== null && (
              <div className="flex justify-between">
                <span className="text-neutral-500">Discrepancy</span>
                <span className={`font-semibold ${discrepancy < 0 ? "text-red-600" : "text-green-600"}`}>
                  {discrepancy >= 0 ? "+" : ""}₹{" "}
                  {Math.abs(discrepancy).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}
            {shift.discrepancyExplanation && (
              <div className="pt-1 border-t border-neutral-200">
                <p className="text-neutral-500 mb-1">Employee note</p>
                <p className="text-neutral-800 italic">"{shift.discrepancyExplanation}"</p>
              </div>
            )}
          </div>

          <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2.5 flex items-start gap-2 text-sm text-orange-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-orange-500" />
            <span>Review the discrepancy and add a manager note to reconcile this shift.</span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="managerNote">
              Manager Reconciliation Note <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="managerNote"
              placeholder="e.g. Verified with employee — customer shortfall noted. Acceptable."
              rows={3}
              className="resize-none"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {(note || "").length > 0 && (note || "").trim().length < 10 && (
              <p className="text-xs text-red-500">Minimum 10 characters required.</p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            className="bg-orange-500 hover:bg-orange-600 text-white"
            onClick={handleReconcile}
            disabled={loading}
          >
            {loading ? "Reconciling…" : "Mark as Reconciled"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function CashShiftsPage() {
  const [shifts, setShifts] = useState<CashShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<CashShift | null>(null);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await paymentService.getAllShifts(page, pageSize);
      setShifts(res.data || []);
      setTotal(res.total || 0);
    } catch {
      toast.error("Failed to load shifts.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

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
                <BreadcrumbPage>Cash Shifts</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <div className="mt-4">
            <h1 className="text-2xl font-bold text-neutral-900">Cash Shifts</h1>
            <p className="text-sm text-neutral-500 mt-1">
              All employee cash shift records for this branch
            </p>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-neutral-400 text-sm">Loading…</div>
          ) : (!shifts || shifts.length === 0) ? (
            <div className="py-16 text-center">
              <p className="font-medium text-neutral-700">No shifts recorded yet</p>
              <p className="text-sm text-neutral-400 mt-1">
                Shifts will appear here once employees open them.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-neutral-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Employee
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Opened At
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Closed At
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Expected
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Actual
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(shifts || []).map((shift) => {
                    const isDiscrepancy = shift.status === "DISCREPANCY_FLAGGED";
                    return (
                      <tr
                        key={shift.publicId}
                        className={`hover:bg-neutral-50 transition-colors ${
                          isDiscrepancy ? "border-l-4 border-l-red-400" : ""
                        }`}
                      >
                        <td className="px-4 py-3.5 font-medium text-neutral-900">
                          {shift.employeeName}
                        </td>
                        <td className="px-4 py-3.5 text-neutral-600 text-xs">
                          {formatDateTime(shift.openedAt)}
                        </td>
                        <td className="px-4 py-3.5 text-neutral-600 text-xs">
                          {shift.closedAt ? formatDateTime(shift.closedAt) : "—"}
                        </td>
                        <td className="px-4 py-3.5 text-right text-neutral-600">
                          {fmtMoney(shift.expectedTotal)}
                        </td>
                        <td className="px-4 py-3.5 text-right text-neutral-600">
                          {fmtMoney(shift.actualTotal)}
                        </td>
                        <td className="px-4 py-3.5">
                          <ShiftStatusBadge status={shift.status} />
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          {isDiscrepancy && (
                            <Button
                              size="sm"
                              className="bg-orange-500 hover:bg-orange-600 text-white h-8 text-xs"
                              onClick={() => setSelected(shift)}
                            >
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
        <ReconcileModal
          shift={selected}
          onClose={() => setSelected(null)}
          onDone={() => {
            setSelected(null);
            load();
          }}
        />
      )}
    </ManagerLayout>
  );
}

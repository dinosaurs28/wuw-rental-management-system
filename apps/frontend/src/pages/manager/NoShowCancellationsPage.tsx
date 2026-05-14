import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle, RefreshCw, XCircle, ChevronLeft, ChevronRight,
  Clock, Ban, CheckCircle2, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { managerDashboardService, type NoShowBooking } from "@/services/managerDashboard.service";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtMoney(val: string | null | undefined) {
  if (!val) return "—";
  return "₹" + parseFloat(val).toLocaleString("en-IN", { minimumFractionDigits: 2 });
}

function overdueLabel(startAt: string): { text: string; urgent: boolean } {
  const ms = Date.now() - new Date(startAt).getTime();
  const hours = ms / (1000 * 60 * 60);
  if (hours < 24) {
    return { text: `${Math.floor(hours)}h overdue`, urgent: hours < 6 };
  }
  const days = Math.floor(hours / 24);
  return { text: `${days}d overdue`, urgent: false };
}

const PRESET_REASONS = [
  "Customer did not show up",
  "Customer unreachable after multiple attempts",
  "Customer requested cancellation",
  "Other",
];

// ── Cancel Modal ──────────────────────────────────────────────────────────────

function CancelModal({
  booking,
  onConfirm,
  onClose,
}: {
  booking: NoShowBooking;
  onConfirm: (reason: string, refundCustomer: boolean, refundMethod?: string, refundAmount?: number) => Promise<void>;
  onClose: () => void;
}) {
  const [preset, setPreset] = useState(PRESET_REASONS[0]);
  const [custom, setCustom] = useState("");
  const [refundCustomer, setRefundCustomer] = useState(false);
  const [refundMethod, setRefundMethod] = useState<"CASH" | "ONLINE">("ONLINE");
  const [refundAmount, setRefundAmount] = useState("");
  const [loading, setLoading] = useState(false);

  const isOther = preset === "Other";
  const finalReason = isOther ? custom.trim() : preset;

  const totalPaid = booking.isAdvancePayment
    ? parseFloat(booking.advanceAmount ?? "0")
    : parseFloat(booking.totalFinal);

  // Pre-fill refund amount when toggle is turned on
  const handleRefundToggle = (checked: boolean) => {
    setRefundCustomer(checked);
    if (checked && !refundAmount) setRefundAmount(totalPaid.toFixed(2));
  };

  const canSubmit =
    (!isOther || custom.trim().length > 0) &&
    (!refundCustomer || (parseFloat(refundAmount) > 0 && parseFloat(refundAmount) <= totalPaid));

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
      await onConfirm(
        finalReason,
        refundCustomer,
        refundCustomer ? refundMethod : undefined,
        refundCustomer ? parseFloat(refundAmount) : undefined,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <Ban className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h3 className="font-semibold text-neutral-900">Cancel Booking</h3>
            <p className="text-sm text-neutral-500 mt-0.5 font-mono">{booking.publicId}</p>
          </div>
        </div>

        {/* Booking summary */}
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-neutral-500">Customer</span>
            <span className="font-medium text-neutral-900">{booking.customer.user.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Vehicle</span>
            <span className="text-neutral-700">
              {booking.items[0]?.vehicle
                ? `${booking.items[0].vehicle.make} ${booking.items[0].vehicle.model}`
                : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Pickup was scheduled</span>
            <span className="text-red-700 font-medium">{fmtDateTime(booking.startAt)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Total paid</span>
            <span className="font-semibold text-neutral-900">{fmtMoney(totalPaid.toString())}</span>
          </div>
        </div>

        {/* Financial impact */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800">
            {booking.isAdvancePayment
              ? `Advance of ${fmtMoney(booking.advanceAmount)} will be forfeited as cancellation fee.`
              : `Full payment booking — decide below whether to refund the customer.`}
          </p>
        </div>

        {/* Reason */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-neutral-700">
            Cancellation reason <span className="text-red-500">*</span>
          </label>
          <div className="space-y-2">
            {PRESET_REASONS.map((r) => (
              <label key={r} className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="reason"
                  value={r}
                  checked={preset === r}
                  onChange={() => setPreset(r)}
                  className="accent-orange-600"
                />
                <span className="text-sm text-neutral-700">{r}</span>
              </label>
            ))}
          </div>
          {isOther && (
            <textarea
              className="mt-2 w-full h-20 rounded-lg border border-neutral-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-300"
              placeholder="Describe the reason..."
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
          )}
        </div>

        {/* Refund toggle */}
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 space-y-3">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium text-neutral-800">Refund customer</p>
              <p className="text-xs text-neutral-400 mt-0.5">
                Creates a refund request in Financials → Refunds
              </p>
            </div>
            <div
              onClick={() => handleRefundToggle(!refundCustomer)}
              className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${refundCustomer ? "bg-green-500" : "bg-neutral-300"}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${refundCustomer ? "translate-x-5" : "translate-x-0"}`}
              />
            </div>
          </label>

          {refundCustomer && (
            <div className="space-y-3 pt-1 border-t border-neutral-200">
              <div className="flex gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-medium text-neutral-600">Refund amount (₹)</label>
                  <input
                    type="number"
                    min="0"
                    max={totalPaid}
                    step="0.01"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                    className="w-full h-9 rounded-lg border border-neutral-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                  />
                  <p className="text-xs text-neutral-400">Max: {fmtMoney(totalPaid.toString())}</p>
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-medium text-neutral-600">Refund method</label>
                  <select
                    value={refundMethod}
                    onChange={(e) => setRefundMethod(e.target.value as "CASH" | "ONLINE")}
                    className="w-full h-9 rounded-lg border border-neutral-200 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                  >
                    <option value="ONLINE">Online / Bank transfer</option>
                    <option value="CASH">Cash</option>
                  </select>
                </div>
              </div>
              {parseFloat(refundAmount) > totalPaid && (
                <p className="text-xs text-red-600">Refund cannot exceed the amount paid.</p>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={loading}>
            Go Back
          </Button>
          <Button
            className="flex-1 bg-red-600 hover:bg-red-700 text-white gap-2"
            disabled={!canSubmit || loading}
            onClick={handleConfirm}
          >
            {loading
              ? <RefreshCw className="w-4 h-4 animate-spin" />
              : <Ban className="w-4 h-4" />}
            {refundCustomer ? "Cancel & Request Refund" : "Cancel Booking"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Booking Card (mobile) ─────────────────────────────────────────────────────

function BookingCard({
  booking,
  onCancel,
}: {
  booking: NoShowBooking;
  onCancel: (b: NoShowBooking) => void;
}) {
  const { text: overdueText, urgent } = overdueLabel(booking.startAt);
  const vehicle = booking.items[0]?.vehicle;
  const paidAmount = booking.isAdvancePayment ? booking.advanceAmount : booking.totalFinal;

  return (
    <div className="p-4 space-y-3">
      {/* Top row: overdue badge + booking id */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span
            className={`inline-flex items-center gap-1 self-start rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              urgent ? "bg-orange-100 text-orange-700" : "bg-red-100 text-red-700"
            }`}
          >
            <Clock className="w-3 h-3" />
            {overdueText}
          </span>
          <span className="font-mono text-[11px] text-neutral-400">{booking.publicId}</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-red-200 text-red-600 hover:bg-red-50 gap-1.5 shrink-0"
          onClick={() => onCancel(booking)}
        >
          <Ban className="w-3.5 h-3.5" />
          Cancel
        </Button>
      </div>

      {/* Customer + vehicle row */}
      <div className="flex items-start gap-3">
        {vehicle?.images[0]?.file?.url ? (
          <img
            src={vehicle.images[0].file.url}
            alt=""
            className="w-14 h-10 rounded-lg object-cover border border-neutral-200 shrink-0 mt-0.5"
          />
        ) : (
          <div className="w-14 h-10 rounded-lg bg-neutral-100 border border-neutral-200 shrink-0 mt-0.5" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-neutral-900 truncate">{booking.customer.user.name}</p>
          <p className="text-xs text-neutral-400 truncate">{booking.customer.user.phone ?? booking.customer.user.email}</p>
          {vehicle && (
            <p className="text-xs text-neutral-600 mt-0.5">
              {vehicle.make} {vehicle.model}
              <span className="font-mono text-neutral-400 ml-1">· {vehicle.regNo}</span>
            </p>
          )}
        </div>
      </div>

      {/* Dates + amount row */}
      <div className="grid grid-cols-2 gap-3 pt-1 border-t border-neutral-100">
        <div>
          <p className="text-[10px] text-neutral-400 uppercase tracking-wide mb-0.5">Pickup scheduled</p>
          <p className="text-sm font-medium text-red-700">{fmtDate(booking.startAt)}</p>
          <p className="text-xs text-neutral-400">→ {fmtDate(booking.endAt)}</p>
        </div>
        <div>
          <p className="text-[10px] text-neutral-400 uppercase tracking-wide mb-0.5">Amount paid</p>
          <p className="text-sm font-semibold text-neutral-900">{fmtMoney(paidAmount)}</p>
          <p className="text-xs text-neutral-400">{booking.isAdvancePayment ? "advance" : "full payment"}</p>
        </div>
      </div>

      {/* On cancel tag */}
      <div>
        {booking.isAdvancePayment ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs text-amber-700">
            <AlertTriangle className="w-3 h-3" />
            Advance forfeited on cancel
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs text-blue-700">
            <Info className="w-3 h-3" />
            Refund needed
          </span>
        )}
      </div>
    </div>
  );
}

// ── Row (desktop table) ───────────────────────────────────────────────────────

function BookingRow({
  booking,
  onCancel,
}: {
  booking: NoShowBooking;
  onCancel: (b: NoShowBooking) => void;
}) {
  const { text: overdueText, urgent } = overdueLabel(booking.startAt);
  const vehicle = booking.items[0]?.vehicle;
  const paidAmount = booking.isAdvancePayment ? booking.advanceAmount : booking.totalFinal;

  return (
    <tr className="hover:bg-neutral-50 transition-colors">
      <td className="px-4 py-3.5">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
            urgent ? "bg-orange-100 text-orange-700" : "bg-red-100 text-red-700"
          }`}
        >
          <Clock className="w-3 h-3" />
          {overdueText}
        </span>
        <p className="font-mono text-[11px] text-neutral-400 mt-1">{booking.publicId}</p>
      </td>

      <td className="px-4 py-3.5">
        <p className="text-sm font-medium text-neutral-900">{booking.customer.user.name}</p>
        <p className="text-xs text-neutral-400">{booking.customer.user.phone ?? booking.customer.user.email}</p>
      </td>

      <td className="px-4 py-3.5">
        {vehicle ? (
          <div className="flex items-center gap-2">
            {vehicle.images[0]?.file?.url ? (
              <img src={vehicle.images[0].file.url} alt="" className="w-10 h-8 rounded object-cover border border-neutral-200 shrink-0" />
            ) : (
              <div className="w-10 h-8 rounded bg-neutral-100 border border-neutral-200 shrink-0" />
            )}
            <div>
              <p className="text-sm text-neutral-800">{vehicle.make} {vehicle.model}</p>
              <p className="text-xs font-mono text-neutral-400">{vehicle.regNo}</p>
            </div>
          </div>
        ) : <span className="text-neutral-400 text-sm">—</span>}
      </td>

      <td className="px-4 py-3.5">
        <p className="text-sm text-red-700 font-medium">{fmtDate(booking.startAt)}</p>
        <p className="text-xs text-neutral-400">→ {fmtDate(booking.endAt)}</p>
      </td>

      <td className="px-4 py-3.5 text-right">
        <p className="text-sm font-semibold text-neutral-900">{fmtMoney(paidAmount)}</p>
        <p className="text-xs text-neutral-400">{booking.isAdvancePayment ? "advance" : "full payment"}</p>
      </td>

      <td className="px-4 py-3.5">
        {booking.isAdvancePayment ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs text-amber-700">
            <AlertTriangle className="w-3 h-3" />
            Forfeited
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs text-blue-700">
            <Info className="w-3 h-3" />
            Refund needed
          </span>
        )}
      </td>

      <td className="px-4 py-3.5">
        <Button
          size="sm"
          variant="outline"
          className="border-red-200 text-red-600 hover:bg-red-50 gap-1.5 whitespace-nowrap"
          onClick={() => onCancel(booking)}
        >
          <Ban className="w-3.5 h-3.5" />
          Cancel
        </Button>
      </td>
    </tr>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function NoShowCancellationsPage() {
  const [items, setItems] = useState<NoShowBooking[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [graceHours, setGraceHours] = useState(0);

  const [selected, setSelected] = useState<NoShowBooking | null>(null);
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set());
  const [successCount, setSuccessCount] = useState(0);
  const [lastRefunded, setLastRefunded] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const load = useCallback(async (p: number, grace: number) => {
    setLoading(true);
    try {
      const res = await managerDashboardService.getNoShowEligible(p, 20, grace);
      setItems(res.data);
      setTotal(res.pagination.total);
      setTotalPages(res.pagination.totalPages);
      setPage(p);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(1, graceHours); }, [load, graceHours]);

  const handleConfirmCancel = async (
    reason: string,
    refundCustomer: boolean,
    refundMethod?: string,
    refundAmount?: number,
  ) => {
    if (!selected) return;
    setCancelError(null);
    try {
      await managerDashboardService.cancelNoShow(
        selected.publicId,
        reason,
        refundCustomer,
        refundMethod,
        refundAmount,
      );
      setCancelledIds((prev) => new Set(prev).add(selected.publicId));
      setSuccessCount((n) => n + 1);
      setLastRefunded(refundCustomer);
      setItems((prev) => prev.filter((b) => b.publicId !== selected.publicId));
      setTotal((n) => n - 1);
      setSelected(null);
    } catch (err: any) {
      setCancelError(err?.response?.data?.message ?? "Cancellation failed. Please retry.");
      throw err;
    }
  };

  const visibleItems = items.filter((b) => !cancelledIds.has(b.publicId));

  return (
    <ManagerLayout>
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 space-y-6">
        {/* Header */}
        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-xl font-bold text-neutral-900 sm:text-2xl">No-Show Cancellations</h1>
            {total > 0 && (
              <div className="flex items-center gap-1.5 rounded-full bg-red-100 text-red-700 px-3 py-1 text-xs font-semibold sm:text-sm sm:px-4 sm:py-1.5">
                <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                {total} pending review
              </div>
            )}
          </div>
          <p className="text-sm text-neutral-500 mt-1">
            Confirmed bookings whose pickup date has passed and vehicle was never collected.
          </p>
        </div>

        {/* Business logic info */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3">
          <div className="flex gap-2.5">
            <Info className="w-4 h-4 text-neutral-400 mt-0.5 shrink-0" />
            <div className="text-sm text-neutral-500 space-y-1">
              <p>
                Showing <strong>CONFIRMED + payment SUCCESS</strong> bookings where the scheduled
                pickup date has already passed.
              </p>
              <p>
                <span className="font-medium text-amber-700">Advance payment bookings:</span>{" "}
                cancelling forfeits the advance (no-show policy) — a Cancellation Invoice is generated.
              </p>
              <p>
                <span className="font-medium text-blue-700">Full payment bookings:</span>{" "}
                cancelling does not auto-refund. Use <strong>Financials → Refunds</strong> to initiate
                the refund after cancellation.
              </p>
            </div>
          </div>

          {/* Grace period control */}
          <div className="pt-1 border-t border-neutral-100 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-neutral-600 font-medium">Grace period:</span>
              {[0, 1, 2, 4, 6].map((h) => (
                <button
                  key={h}
                  onClick={() => { setGraceHours(h); load(1, h); }}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    graceHours === h
                      ? "bg-orange-600 text-white border-orange-600"
                      : "bg-white text-neutral-600 border-neutral-200 hover:border-orange-300"
                  }`}
                >
                  {h === 0 ? "None" : `${h}h`}
                </button>
              ))}
            </div>
            <p className="text-xs text-neutral-400">
              Only flag bookings overdue by more than the selected hours
            </p>
          </div>
        </div>

        {/* Success banner */}
        {successCount > 0 && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 flex gap-2.5 items-center">
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
            <p className="text-sm text-green-800">
              {successCount} booking{successCount !== 1 ? "s" : ""} cancelled.
              {lastRefunded && " Refund request created — approve it in Financials → Refunds."}
            </p>
          </div>
        )}

        {cancelError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex gap-2.5 items-center">
            <XCircle className="w-4 h-4 text-red-500 shrink-0" />
            <p className="text-sm text-red-700">{cancelError}</p>
          </div>
        )}

        {/* Table */}
        <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
            <h2 className="font-semibold text-neutral-900">Eligible Bookings</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => load(page, graceHours)}
              disabled={loading}
              className="gap-1.5"
            >
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {loading ? (
            <div className="py-16 flex items-center justify-center gap-2 text-neutral-400">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading...</span>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="py-16 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-3" />
              <p className="text-sm font-medium text-neutral-600">No no-show bookings</p>
              <p className="text-xs text-neutral-400 mt-1">
                All confirmed bookings with past pickup dates have been handled.
              </p>
            </div>
          ) : (
            <>
              {/* Mobile: card list */}
              <div className="md:hidden divide-y divide-neutral-100">
                {visibleItems.map((b) => (
                  <BookingCard
                    key={b.publicId}
                    booking={b}
                    onCancel={(b) => { setCancelError(null); setSelected(b); }}
                  />
                ))}
              </div>

              {/* Desktop: table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      <th className="px-4 py-3">Overdue</th>
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Vehicle</th>
                      <th className="px-4 py-3">Pickup → Return</th>
                      <th className="px-4 py-3 text-right">Paid</th>
                      <th className="px-4 py-3">On Cancel</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {visibleItems.map((b) => (
                      <BookingRow
                        key={b.publicId}
                        booking={b}
                        onCancel={(b) => { setCancelError(null); setSelected(b); }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {totalPages > 1 && (
            <div className="px-5 py-3 border-t border-neutral-100 flex items-center justify-between text-sm text-neutral-500">
              <span>{total} booking{total !== 1 ? "s" : ""}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => load(page - 1, graceHours)} disabled={page === 1}>
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="text-xs">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => load(page + 1, graceHours)} disabled={page === totalPages}>
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <CancelModal
          booking={selected}
          onConfirm={handleConfirmCancel}
          onClose={() => setSelected(null)}
        />
      )}
    </ManagerLayout>
  );
}

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Search, RefreshCw, ShieldCheck, AlertTriangle, CheckCircle2,
  Clock, XCircle, Info, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import {
  paymentService,
  type RecheckBookingInfo,
  type GatewayCheckResult,
  type PendingPaymentBooking,
} from "@/services/payment.service";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string) {
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

const statusColors: Record<string, string> = {
  HOLD: "bg-yellow-50 text-yellow-700 border-yellow-200",
  CONFIRMED: "bg-green-50 text-green-700 border-green-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
  PICKED_UP: "bg-blue-50 text-blue-700 border-blue-200",
  RETURNED: "bg-neutral-100 text-neutral-600 border-neutral-200",
  HOLD_EXPIRED: "bg-red-50 text-red-600 border-red-200",
};

const paymentStatusColors: Record<string, string> = {
  CREATED: "bg-yellow-50 text-yellow-700 border-yellow-200",
  SUCCESS: "bg-green-50 text-green-700 border-green-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
  REFUNDED: "bg-purple-50 text-purple-700 border-purple-200",
};

const txnStatusColors: Record<string, string> = {
  INITIATED: "bg-blue-50 text-blue-700",
  COLLECTED: "bg-yellow-50 text-yellow-700",
  CONFIRMED: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-700",
  FAILED: "bg-red-50 text-red-700",
  REFUNDED: "bg-purple-50 text-purple-700",
};

// ── Manual Confirm Modal ──────────────────────────────────────────────────────

function ManualConfirmModal({
  bookingId,
  onConfirm,
  onClose,
}: {
  bookingId: string;
  onConfirm: (note: string) => Promise<void>;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!note.trim()) return;
    setLoading(true);
    try {
      await onConfirm(note.trim());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <h3 className="font-semibold text-neutral-900 text-base">Manual Payment Confirmation</h3>
            <p className="text-sm text-neutral-500 mt-0.5">
              Booking <span className="font-mono">{bookingId}</span>
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 flex gap-2.5">
          <AlertTriangle className="w-4 h-4 text-orange-600 mt-0.5 shrink-0" />
          <p className="text-sm text-orange-800">
            This bypasses the payment gateway and directly confirms the booking. Only proceed if the customer has provided verifiable bank proof.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-neutral-700">
            Reason / Note <span className="text-red-500">*</span>
          </label>
          <textarea
            className="w-full h-24 rounded-lg border border-neutral-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-300"
            placeholder="e.g. Customer shared bank statement showing deduction on 14 May 2026 at 3:41 PM, ref XXXX..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="flex gap-3 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            className="flex-1 bg-orange-600 hover:bg-orange-700 text-white"
            disabled={!note.trim() || loading}
            onClick={handleSubmit}
          >
            {loading
              ? <RefreshCw className="w-4 h-4 animate-spin mr-2" />
              : <ShieldCheck className="w-4 h-4 mr-2" />}
            Confirm Payment
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Gateway Result Banner ─────────────────────────────────────────────────────

function GatewayResultBanner({ result }: { result: GatewayCheckResult }) {
  const map: Record<string, { icon: React.ReactNode; bg: string; text: string }> = {
    SUCCESS: { icon: <CheckCircle2 className="w-5 h-5 text-green-600" />, bg: "bg-green-50 border-green-200", text: "text-green-800" },
    PENDING: { icon: <Clock className="w-5 h-5 text-yellow-600" />, bg: "bg-yellow-50 border-yellow-200", text: "text-yellow-800" },
    FAILED: { icon: <XCircle className="w-5 h-5 text-red-600" />, bg: "bg-red-50 border-red-200", text: "text-red-800" },
    GATEWAY_UNREACHABLE: { icon: <AlertTriangle className="w-5 h-5 text-orange-600" />, bg: "bg-orange-50 border-orange-200", text: "text-orange-800" },
    ALREADY_SUCCESS: { icon: <CheckCircle2 className="w-5 h-5 text-green-600" />, bg: "bg-green-50 border-green-200", text: "text-green-800" },
  };
  const cfg = map[result.gatewayResult] ?? map["GATEWAY_UNREACHABLE"];
  return (
    <div className={`rounded-xl border px-4 py-3.5 flex gap-3 items-start ${cfg.bg}`}>
      <div className="mt-0.5 shrink-0">{cfg.icon}</div>
      <div>
        <p className={`text-sm font-semibold ${cfg.text}`}>
          Gateway: {result.gatewayResult.replace(/_/g, " ")}
        </p>
        <p className={`text-sm mt-0.5 ${cfg.text}`}>{result.message}</p>
        {result.gatewayCode && (
          <p className={`text-xs mt-1 font-mono opacity-70 ${cfg.text}`}>Code: {result.gatewayCode}</p>
        )}
      </div>
    </div>
  );
}

// ── Pending List ──────────────────────────────────────────────────────────────

function PendingList({
  items,
  total,
  page,
  totalPages,
  loading,
  onSelect,
  onPageChange,
  onRefresh,
}: {
  items: PendingPaymentBooking[];
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  onSelect: (id: string) => void;
  onPageChange: (p: number) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-neutral-900">Pending Payment Bookings</h2>
          <p className="text-xs text-neutral-400 mt-0.5">
            Bookings in HOLD with payment not yet received by gateway
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">{total} booking{total !== 1 ? "s" : ""}</span>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="gap-1.5">
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 flex items-center justify-center gap-2 text-neutral-400">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center">
          <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-2" />
          <p className="text-sm text-neutral-500">No pending payment bookings</p>
          <p className="text-xs text-neutral-400 mt-1">All bookings have been resolved</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                  <th className="px-4 py-3">Booking ID</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3">Rental Dates</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Booked At</th>
                  <th className="px-4 py-3">Hold Expires</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {items.map((b) => {
                  const amount = b.isAdvancePayment ? b.advanceAmount : b.totalFinal;
                  const vehicle = b.items[0]?.vehicle;
                  const isExpiringSoon =
                    b.holdExpiresAt && new Date(b.holdExpiresAt).getTime() - Date.now() < 30 * 60 * 1000;

                  return (
                    <tr key={b.publicId} className="hover:bg-neutral-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-neutral-700 whitespace-nowrap">
                        {b.publicId}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-neutral-900 text-sm">{b.customer.user.name}</p>
                        {b.customer.user.phone && (
                          <p className="text-xs text-neutral-400">{b.customer.user.phone}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-neutral-700 text-sm whitespace-nowrap">
                        {vehicle ? `${vehicle.make} ${vehicle.model}` : "—"}
                        {vehicle && (
                          <p className="text-xs text-neutral-400 font-mono">{vehicle.regNo}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-neutral-600 text-xs whitespace-nowrap">
                        {fmtDate(b.startAt)} – {fmtDate(b.endAt)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-neutral-900 whitespace-nowrap">
                        {fmtMoney(amount)}
                        {b.isAdvancePayment && (
                          <p className="text-xs text-neutral-400 font-normal">advance</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-neutral-500 text-xs whitespace-nowrap">
                        {fmt(b.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {b.holdExpiresAt ? (
                          <span className={isExpiringSoon ? "text-red-600 font-medium" : "text-neutral-500"}>
                            {fmt(b.holdExpiresAt)}
                          </span>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-orange-600 border-orange-200 hover:bg-orange-50 whitespace-nowrap"
                          onClick={() => onSelect(b.publicId)}
                        >
                          Recheck
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="px-5 py-3 border-t border-neutral-100 flex items-center justify-between text-sm text-neutral-500">
              <span>{total} booking{total !== 1 ? "s" : ""}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page === 1}>
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="text-xs">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page === totalPages}>
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Booking Detail Panel ──────────────────────────────────────────────────────

function BookingDetailPanel({
  booking,
  gatewayResult,
  gatewayLoading,
  manualDone,
  manualError,
  onGatewayRecheck,
  onOpenManualConfirm,
  onBack,
}: {
  booking: RecheckBookingInfo;
  gatewayResult: GatewayCheckResult | null;
  gatewayLoading: boolean;
  manualDone: boolean;
  manualError: string | null;
  onGatewayRecheck: () => void;
  onOpenManualConfirm: () => void;
  onBack: () => void;
}) {
  const confirmed = booking.status === "CONFIRMED" && booking.paymentStatus === "SUCCESS";
  const canManualConfirm =
    booking.isRecheckable &&
    !confirmed &&
    !manualDone &&
    (gatewayResult?.gatewayResult === "PENDING" ||
      gatewayResult?.gatewayResult === "GATEWAY_UNREACHABLE" ||
      gatewayResult?.gatewayResult === "FAILED");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-neutral-500 gap-1.5 -ml-2">
          <ChevronLeft className="w-4 h-4" />
          Back to list
        </Button>
      </div>

      {(confirmed || manualDone) && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3.5 flex gap-3 items-center">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <p className="text-sm font-medium text-green-800">
            Booking <span className="font-mono">{booking.publicId}</span> is now{" "}
            <strong>CONFIRMED</strong>. Payment has been recorded.
          </p>
        </div>
      )}

      {/* Status overview */}
      <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
          <h2 className="font-semibold text-neutral-900">Booking Overview</h2>
          <span className="font-mono text-xs text-neutral-500">{booking.publicId}</span>
        </div>
        <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
          <div>
            <p className="text-xs text-neutral-400 uppercase tracking-wide mb-1">Booking Status</p>
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusColors[booking.status] ?? "bg-neutral-100 text-neutral-600 border-neutral-200"}`}>
              {booking.status}
            </span>
          </div>
          <div>
            <p className="text-xs text-neutral-400 uppercase tracking-wide mb-1">Payment Status</p>
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${paymentStatusColors[booking.paymentStatus] ?? "bg-neutral-100 text-neutral-600 border-neutral-200"}`}>
              {booking.paymentStatus}
            </span>
          </div>
          <div>
            <p className="text-xs text-neutral-400 uppercase tracking-wide mb-1">Amount</p>
            <p className="text-sm font-semibold text-neutral-900">
              {booking.isAdvancePayment ? `${fmtMoney(booking.advanceAmount)} advance` : fmtMoney(booking.totalFinal)}
            </p>
            {booking.isAdvancePayment && (
              <p className="text-xs text-neutral-400">of {fmtMoney(booking.totalFinal)} total</p>
            )}
          </div>
          <div>
            <p className="text-xs text-neutral-400 uppercase tracking-wide mb-1">Rental Period</p>
            <p className="text-sm text-neutral-700">{fmtDate(booking.startAt)} – {fmtDate(booking.endAt)}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-400 uppercase tracking-wide mb-1">Booked At</p>
            <p className="text-sm text-neutral-700">{fmt(booking.createdAt)}</p>
          </div>
          {booking.holdExpiresAt && (
            <div>
              <p className="text-xs text-neutral-400 uppercase tracking-wide mb-1">Hold Expires</p>
              <p className="text-sm text-yellow-700 font-medium">{fmt(booking.holdExpiresAt)}</p>
            </div>
          )}
        </div>
        {booking.transactionId && (
          <div className="px-5 pb-4">
            <p className="text-xs text-neutral-400 uppercase tracking-wide mb-1">Gateway Transaction ID</p>
            <code className="text-xs bg-neutral-100 rounded px-2 py-1 font-mono text-neutral-700">
              {booking.transactionId}
            </code>
          </div>
        )}
      </div>

      {/* Customer */}
      <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-100">
          <h2 className="font-semibold text-neutral-900">Customer</h2>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-neutral-400 uppercase tracking-wide mb-1">Name</p>
            <p className="text-sm font-medium text-neutral-900">{booking.customer.user.name}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-400 uppercase tracking-wide mb-1">Phone</p>
            <p className="text-sm text-neutral-700">{booking.customer.user.phone ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-400 uppercase tracking-wide mb-1">Email</p>
            <p className="text-sm text-neutral-700 truncate">{booking.customer.user.email}</p>
          </div>
        </div>
      </div>

      {/* Vehicles */}
      <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-100">
          <h2 className="font-semibold text-neutral-900">Vehicle{booking.items.length > 1 ? "s" : ""}</h2>
        </div>
        <div className="divide-y divide-neutral-100">
          {booking.items.map((item, idx) => (
            <div key={idx} className="px-5 py-4 flex items-center gap-4">
              {item.vehicle.images[0]?.file?.url ? (
                <img
                  src={item.vehicle.images[0].file.url}
                  alt={`${item.vehicle.make} ${item.vehicle.model}`}
                  className="w-16 h-12 rounded-lg object-cover border border-neutral-200 shrink-0"
                />
              ) : (
                <div className="w-16 h-12 rounded-lg bg-neutral-100 border border-neutral-200 flex items-center justify-center shrink-0">
                  <span className="text-xs text-neutral-400">No img</span>
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-neutral-900">
                  {item.vehicle.make} {item.vehicle.model}
                </p>
                <p className="text-xs text-neutral-500 font-mono mt-0.5">{item.vehicle.regNo}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Transactions history */}
      {booking.paymentTransactions.length > 0 && (
        <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-100">
            <h2 className="font-semibold text-neutral-900">Recent Transactions</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Purpose</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">Gateway Ref</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {booking.paymentTransactions.map((txn) => (
                  <tr key={txn.publicId} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 whitespace-nowrap text-neutral-500 text-xs">{fmt(txn.createdAt)}</td>
                    <td className="px-4 py-3 text-neutral-700 capitalize text-xs">{txn.purpose.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3 text-neutral-600 text-xs">{txn.method}</td>
                    <td className="px-4 py-3 font-mono text-xs text-neutral-500">{txn.onlineTransactionRef ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold text-neutral-900">{fmtMoney(txn.totalAmount)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${txnStatusColors[txn.status] ?? "bg-neutral-100 text-neutral-600"}`}>
                        {txn.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recheck Actions */}
      {booking.isRecheckable && !confirmed && !manualDone && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-4">
          <h2 className="font-semibold text-neutral-900">Recheck Actions</h2>

          {gatewayResult && <GatewayResultBanner result={gatewayResult} />}

          {manualError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
              <XCircle className="w-4 h-4 text-red-500 shrink-0" />
              <p className="text-sm text-red-700">{manualError}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              className="gap-2 border-neutral-300"
              onClick={onGatewayRecheck}
              disabled={gatewayLoading}
            >
              {gatewayLoading
                ? <RefreshCw className="w-4 h-4 animate-spin" />
                : <RefreshCw className="w-4 h-4" />}
              Recheck with Gateway
            </Button>

            {canManualConfirm && (
              <Button
                className="gap-2 bg-orange-600 hover:bg-orange-700 text-white"
                onClick={onOpenManualConfirm}
              >
                <ShieldCheck className="w-4 h-4" />
                Mark as Received
              </Button>
            )}
          </div>

          {!gatewayResult && (
            <p className="text-xs text-neutral-400">
              Click <strong>Recheck with Gateway</strong> to check the latest status from PhonePe.
              If it returns Pending and the customer has bank proof, you can manually confirm.
            </p>
          )}
        </div>
      )}

      {!booking.isRecheckable && !confirmed && !manualDone && (
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3.5 flex gap-2.5 items-start">
          <Info className="w-4 h-4 text-neutral-400 mt-0.5 shrink-0" />
          <p className="text-sm text-neutral-600">
            This booking is not eligible for a payment recheck. Only bookings in{" "}
            <strong>HOLD</strong> status with a pending PhonePe transaction can be rechecked.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function PaymentRecheckPage() {
  // Pending list state
  const [listItems, setListItems] = useState<PendingPaymentBooking[]>([]);
  const [listTotal, setListTotal] = useState(0);
  const [listPage, setListPage] = useState(1);
  const [listTotalPages, setListTotalPages] = useState(1);
  const [listLoading, setListLoading] = useState(true);

  // Search state
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Detail panel state
  const [booking, setBooking] = useState<RecheckBookingInfo | null>(null);
  const [gatewayLoading, setGatewayLoading] = useState(false);
  const [gatewayResult, setGatewayResult] = useState<GatewayCheckResult | null>(null);
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualDone, setManualDone] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async (page: number) => {
    setListLoading(true);
    try {
      const res = await paymentService.listPendingPayments(page, 20);
      setListItems(res.data);
      setListTotal(res.pagination.total);
      setListTotalPages(res.pagination.totalPages);
      setListPage(page);
    } catch {
      // non-fatal — list stays empty
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => { loadList(1); }, [loadList]);

  const openBooking = async (id: string) => {
    setSearching(true);
    setSearchError(null);
    setBooking(null);
    setGatewayResult(null);
    setManualDone(false);
    setManualError(null);
    try {
      const data = await paymentService.getRecheckInfo(id);
      setBooking(data);
      setQuery(id);
    } catch (err: any) {
      setSearchError(err?.response?.data?.message ?? "Booking not found.");
    } finally {
      setSearching(false);
    }
  };

  const handleSearch = () => openBooking(query.trim());

  const handleBack = () => {
    setBooking(null);
    setGatewayResult(null);
    setManualDone(false);
    setManualError(null);
    setSearchError(null);
    loadList(listPage);
  };

  const handleGatewayRecheck = async () => {
    if (!booking) return;
    setGatewayLoading(true);
    setGatewayResult(null);
    setManualError(null);
    try {
      const result = await paymentService.gatewayRecheck(booking.publicId);
      setGatewayResult(result);
      if (result.gatewayResult === "SUCCESS") {
        setBooking((prev) => prev ? { ...prev, status: "CONFIRMED", paymentStatus: "SUCCESS", isRecheckable: false } : prev);
        loadList(listPage);
      }
    } catch (err: any) {
      setGatewayResult({
        gatewayResult: "GATEWAY_UNREACHABLE",
        message: err?.response?.data?.message ?? "Gateway check failed. Please retry.",
      });
    } finally {
      setGatewayLoading(false);
    }
  };

  const handleManualConfirm = async (note: string) => {
    if (!booking) return;
    setManualError(null);
    try {
      await paymentService.manualConfirmPayment(booking.publicId, note);
      setManualDone(true);
      setShowManualModal(false);
      setBooking((prev) => prev ? { ...prev, status: "CONFIRMED", paymentStatus: "SUCCESS", isRecheckable: false } : prev);
      loadList(listPage);
    } catch (err: any) {
      setManualError(err?.response?.data?.message ?? "Manual confirmation failed. Please retry.");
      throw err;
    }
  };

  return (
    <ManagerLayout>
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Payment Recheck</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Recheck payment status with the gateway or manually confirm if the customer has bank proof.
          </p>
        </div>

        {/* Search bar — always visible */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-3">
          <p className="text-sm font-medium text-neutral-700">Search by Booking ID</p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Enter Booking ID (e.g. BK_abc123...)"
                className="w-full h-10 rounded-lg border border-neutral-200 pl-9 pr-3 text-sm text-neutral-800 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-300"
              />
            </div>
            <Button
              className="bg-orange-600 hover:bg-orange-700 text-white gap-1.5 px-5"
              onClick={handleSearch}
              disabled={searching || !query.trim()}
            >
              {searching
                ? <RefreshCw className="w-4 h-4 animate-spin" />
                : <Search className="w-4 h-4" />}
              Search
            </Button>
          </div>
          {searchError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
              <XCircle className="w-4 h-4 text-red-500 shrink-0" />
              <p className="text-sm text-red-700">{searchError}</p>
            </div>
          )}
        </div>

        {/* Detail panel or pending list */}
        {booking ? (
          <BookingDetailPanel
            booking={booking}
            gatewayResult={gatewayResult}
            gatewayLoading={gatewayLoading}
            manualDone={manualDone}
            manualError={manualError}
            onGatewayRecheck={handleGatewayRecheck}
            onOpenManualConfirm={() => setShowManualModal(true)}
            onBack={handleBack}
          />
        ) : (
          <PendingList
            items={listItems}
            total={listTotal}
            page={listPage}
            totalPages={listTotalPages}
            loading={listLoading}
            onSelect={openBooking}
            onPageChange={loadList}
            onRefresh={() => loadList(listPage)}
          />
        )}
      </div>

      {showManualModal && booking && (
        <ManualConfirmModal
          bookingId={booking.publicId}
          onConfirm={handleManualConfirm}
          onClose={() => setShowManualModal(false)}
        />
      )}
    </ManagerLayout>
  );
}

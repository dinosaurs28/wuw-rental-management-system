import { useState, useEffect, useCallback } from "react";
import { RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { paymentService, type BranchTransaction, type TransactionStatus } from "@/services/payment.service";

const purposeLabels: Record<string, string> = {
  FULL_PAYMENT: "Full Payment",
  ADVANCE: "Advance",
  REMAINING_BALANCE: "Remaining Balance",
  EXTENSION_FEE: "Extension Fee",
  EXTENSION: "Extension",
  DAMAGE_FEE: "Damage Fee",
  SAFETY_DEPOSIT: "Safety Deposit",
  OVERPAYMENT_REFUND: "Overpayment Refund",
  CANCELLATION_REFUND: "Cancellation Refund",
};

const methodLabels: Record<string, string> = {
  CASH: "Cash",
  ONLINE: "Online",
  SPLIT: "Split",
};

const statusConfig: Record<TransactionStatus, { label: string; className: string }> = {
  INITIATED: { label: "Initiated", className: "bg-blue-50 text-blue-700" },
  COLLECTED: { label: "Collected", className: "bg-yellow-50 text-yellow-700" },
  CONFIRMED: { label: "Confirmed", className: "bg-green-50 text-green-700" },
  REJECTED: { label: "Rejected", className: "bg-red-50 text-red-700" },
  FAILED: { label: "Failed", className: "bg-red-50 text-red-700" },
  REFUNDED: { label: "Refunded", className: "bg-purple-50 text-purple-700" },
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All Statuses" },
  { value: "INITIATED", label: "Initiated" },
  { value: "COLLECTED", label: "Collected" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "REJECTED", label: "Rejected" },
  { value: "FAILED", label: "Failed" },
  { value: "REFUNDED", label: "Refunded" },
];

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TransactionsTab() {
  const [transactions, setTransactions] = useState<BranchTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await paymentService.getAllTransactions(page, pageSize, statusFilter || undefined);
      setTransactions(result.data);
      setTotal(result.total);
    } catch {
      // silently fail — table stays empty
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <Button
          variant="outline"
          size="sm"
          onClick={load}
          disabled={loading}
          className="ml-auto gap-1.5"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        {transactions.length === 0 && !loading ? (
          <div className="py-16 text-center text-sm text-neutral-400">
            No transactions found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Booking</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Purpose</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">Ref #</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {transactions.map((txn) => {
                  const sc = statusConfig[txn.status] ?? { label: txn.status, className: "bg-neutral-100 text-neutral-600" };
                  return (
                    <tr key={txn.transactionPublicId} className="hover:bg-neutral-50 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap text-neutral-500">
                        {formatDateTime(txn.createdAt)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-neutral-700">
                        {txn.bookingPublicId}
                      </td>
                      <td className="px-4 py-3 text-neutral-800 font-medium">
                        {txn.customerName}
                      </td>
                      <td className="px-4 py-3 text-neutral-600">
                        {purposeLabels[txn.purpose] ?? txn.purpose}
                      </td>
                      <td className="px-4 py-3 text-neutral-600">
                        {methodLabels[txn.method] ?? txn.method}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                        {txn.onlineTransactionRef ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-neutral-900">
                        ₹{parseFloat(txn.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${sc.className}`}>
                          {sc.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-neutral-500 text-xs">
                        {txn.status === "CONFIRMED" && txn.confirmedByName
                          ? txn.confirmedByName
                          : txn.employeeName ?? "—"}
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
          <span>{total} transaction{total !== 1 ? "s" : ""}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-xs">Page {page} of {totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

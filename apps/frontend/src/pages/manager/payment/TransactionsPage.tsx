import { useState, useEffect, useCallback } from "react";
import { RefreshCw, ChevronLeft, ChevronRight, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  INITIATED: { label: "Initiated", className: "bg-blue-50 text-blue-700 border-blue-100" },
  COLLECTED: { label: "Collected", className: "bg-yellow-50 text-yellow-700 border-yellow-100" },
  CONFIRMED: { label: "Confirmed", className: "bg-green-50 text-green-700 border-green-100" },
  REJECTED: { label: "Rejected", className: "bg-red-50 text-red-700 border-red-100" },
  FAILED: { label: "Failed", className: "bg-red-50 text-red-700 border-red-100" },
  REFUNDED: { label: "Refunded", className: "bg-purple-50 text-purple-700 border-purple-100" },
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
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
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
    } finally { setLoading(false); }
  }, [page, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setPage(1);
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h2 className="text-base font-semibold text-neutral-900">All Transactions</h2>
          <p className="text-xs text-neutral-500 mt-0.5">Complete payment history for this branch</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter || "__all__"} onValueChange={(v) => handleStatusChange(v === "__all__" ? "" : v)}>
            <SelectTrigger className="h-9 w-44 text-sm">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value || "__all__"} value={o.value || "__all__"}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="h-9 gap-1.5 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
        {loading ? (
          <div className="divide-y divide-neutral-100">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="h-3 bg-neutral-100 rounded animate-pulse w-24" />
                <div className="h-3 bg-neutral-100 rounded animate-pulse w-28" />
                <div className="h-3 bg-neutral-100 rounded animate-pulse w-28 flex-1" />
                <div className="h-3 bg-neutral-100 rounded animate-pulse w-20" />
                <div className="h-3 bg-neutral-100 rounded animate-pulse w-16" />
                <div className="h-3 bg-neutral-100 rounded animate-pulse w-20 text-right" />
                <div className="h-5 bg-neutral-100 rounded-full animate-pulse w-20" />
              </div>
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mb-3">
              <ReceiptText className="w-6 h-6 text-neutral-400" />
            </div>
            <p className="font-medium text-neutral-700">No transactions found</p>
            <p className="text-sm text-neutral-400 mt-1">
              {statusFilter ? `No transactions with status "${statusFilter.toLowerCase()}".` : "No payment transactions recorded yet."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50/80">
                  {["Date", "Booking", "Customer", "Purpose", "Method", "Ref #", "Amount", "Status", "By"].map((h) => (
                    <th key={h} className={`px-5 py-3.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide ${h === "Amount" ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {transactions.map((txn) => {
                  const sc = statusConfig[txn.status] ?? { label: txn.status, className: "bg-neutral-100 text-neutral-600 border-neutral-200" };
                  return (
                    <tr key={txn.transactionPublicId} className="hover:bg-neutral-50/60 transition-colors">
                      <td className="px-5 py-3.5 text-xs text-neutral-500 whitespace-nowrap">{formatDateTime(txn.createdAt)}</td>
                      <td className="px-5 py-3.5 font-mono text-xs text-neutral-500">{txn.bookingPublicId}</td>
                      <td className="px-5 py-3.5 font-medium text-neutral-900 text-sm whitespace-nowrap">{txn.customerName}</td>
                      <td className="px-5 py-3.5 text-sm text-neutral-600">{purposeLabels[txn.purpose] ?? txn.purpose}</td>
                      <td className="px-5 py-3.5 text-sm text-neutral-600">{methodLabels[txn.method] ?? txn.method}</td>
                      <td className="px-5 py-3.5 font-mono text-xs text-neutral-400">{txn.onlineTransactionRef ?? <span className="text-neutral-200">—</span>}</td>
                      <td className="px-5 py-3.5 text-right font-semibold text-neutral-900 text-sm whitespace-nowrap">
                        ₹ {parseFloat(txn.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${sc.className}`}>
                          {sc.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-neutral-500">{txn.employeeName ?? "—"}</td>
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
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="text-sm text-neutral-600 px-2">Page {page} of {totalPages}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { PlusCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LifecycleBadge, TransactionBadge } from "./PaymentStateBadge";
import { RecordPaymentModal } from "./RecordPaymentModal";
import {
  paymentService,
  employeePaymentService,
  type FinancialState,
  type PaymentTransaction,
  type PaymentPurpose,
} from "@/services/payment.service";

const purposeLabels: Record<PaymentPurpose, string> = {
  FULL_PAYMENT: "Full Payment",
  ADVANCE: "Advance",
  REMAINING_BALANCE: "Remaining Balance",
  EXTENSION_FEE: "Extension Fee",
  DAMAGE_FEE: "Damage Fee",
};

const methodLabels: Record<string, string> = {
  CASH: "Cash",
  ONLINE: "Online",
  SPLIT: "Split",
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface BookingPaymentPanelProps {
  bookingPublicId: string;
  role?: "employee" | "manager";
}

export function BookingPaymentPanel({ bookingPublicId, role = "manager" }: BookingPaymentPanelProps) {
  const [state, setState] = useState<FinancialState | null>(null);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [recordModalOpen, setRecordModalOpen] = useState(false);

  const svc = role === "employee" ? employeePaymentService : paymentService;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [financialState, txns] = await Promise.all([
        svc.getFinancialState(bookingPublicId),
        svc.getTransactions(bookingPublicId),
      ]);
      setState(financialState);
      setTransactions(txns);
    } catch {
      toast.error("Failed to load payment information.");
    } finally {
      setLoading(false);
    }
  }, [bookingPublicId, svc]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="bg-white rounded-lg border shadow-sm p-6 animate-pulse">
        <div className="h-5 w-32 bg-neutral-100 rounded mb-4" />
        <div className="space-y-2">
          <div className="h-4 w-full bg-neutral-100 rounded" />
          <div className="h-4 w-3/4 bg-neutral-100 rounded" />
        </div>
      </div>
    );
  }

  if (!state) return null;

  const amountDue = parseFloat(state.amountRemaining);

  return (
    <div className="space-y-4">
      {/* Payment State Card */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h3 className="font-semibold text-neutral-900">Payment Status</h3>
          <div className="flex items-center gap-2">
            <LifecycleBadge state={state.lifecycleState} />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-neutral-400 hover:text-neutral-700"
              onClick={load}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="space-y-3">
              <div>
                <p className="text-neutral-500 text-xs mb-0.5">Total Due</p>
                <p className="font-semibold text-neutral-900">
                  ₹ {parseFloat(state.totalDue).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <p className="text-neutral-500 text-xs mb-0.5">Collected</p>
                <p className="font-semibold text-green-700">
                  ₹ {parseFloat(state.totalCollected).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-neutral-500 text-xs mb-0.5">Pending Confirmation</p>
                <p className="font-semibold text-yellow-700">
                  ₹ {parseFloat(state.totalPendingConfirmation).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <p className="text-neutral-500 text-xs mb-0.5">Amount Remaining</p>
                <p className={`font-semibold ${amountDue > 0 ? "text-red-600" : "text-neutral-500"}`}>
                  ₹ {amountDue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </div>

          <Button
            className="w-full bg-orange-500 hover:bg-orange-600 text-white mt-2"
            onClick={() => setRecordModalOpen(true)}
          >
            <PlusCircle className="w-4 h-4 mr-2" />
            Record Payment
          </Button>
        </div>
      </div>

      {/* Transaction History */}
      {transactions.length > 0 && (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b">
            <h3 className="font-semibold text-neutral-900 text-sm">Transaction History</h3>
          </div>
          <div className="divide-y divide-neutral-100">
            {transactions.map((txn, i) => (
              <div key={txn.publicId} className="px-5 py-3.5 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="text-xs text-neutral-400 font-mono mt-0.5 shrink-0">
                    #{i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900 truncate">
                      {purposeLabels[txn.purpose] ?? txn.purpose}
                    </p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {methodLabels[txn.method] ?? txn.method} • {txn.collectedBy} •{" "}
                      {formatDateTime(txn.collectedAt)}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-neutral-900">
                    ₹ {parseFloat(txn.totalAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </p>
                  <div className="mt-1">
                    <TransactionBadge status={txn.status} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <RecordPaymentModal
        open={recordModalOpen}
        bookingPublicId={bookingPublicId}
        amountDue={amountDue}
        role={role}
        onClose={() => setRecordModalOpen(false)}
        onSuccess={load}
      />
    </div>
  );
}

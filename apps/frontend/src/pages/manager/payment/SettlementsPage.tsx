import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { ArrowRight, TrendingDown, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  paymentService,
  type SettlementItem,
  type SettlementSummary,
  type PaymentMethod,
  type OnlineGateway,
} from "@/services/payment.service";

const gateways: OnlineGateway[] = ["UPI", "Razorpay", "Other"];

// ── Settle Modal ──────────────────────────────────────────────────────────────

function SettleModal({
  bookingPublicId,
  onClose,
  onDone,
}: {
  bookingPublicId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [summary, setSummary] = useState<SettlementSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [amount, setAmount] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [txnRef, setTxnRef] = useState("");
  const [gateway, setGateway] = useState<OnlineGateway>("UPI");
  const [loading, setLoading] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    paymentService
      .getSettlementSummary(bookingPublicId)
      .then((s) => {
        setSummary(s);
        setAmount(parseFloat(s.netPayable).toFixed(2));
      })
      .catch(() => toast.error("Failed to load settlement details."))
      .finally(() => setLoadingSummary(false));
  }, [bookingPublicId]);

  const totalNum = parseFloat(amount) || 0;
  const cashNum = parseFloat(cashAmount) || 0;
  const onlineNum = method === "SPLIT" ? Math.max(0, totalNum - cashNum) : 0;

  const handleSubmit = async () => {
    if (totalNum <= 0) {
      toast.error("Please enter a valid amount.");
      return;
    }
    if ((method === "ONLINE" || method === "SPLIT") && !txnRef.trim()) {
      toast.error("Transaction reference is required for online payments.");
      return;
    }
    if (method === "SPLIT" && (cashNum <= 0 || onlineNum <= 0)) {
      toast.error("Both cash and online portions must be greater than 0.");
      return;
    }

    setLoading(true);
    try {
      await paymentService.recordSettlement(bookingPublicId, {
        purpose: "REMAINING_BALANCE",
        method,
        totalAmount: totalNum,
        cashAmount: method !== "ONLINE" ? (method === "SPLIT" ? cashNum : totalNum) : undefined,
        onlineAmount: method !== "CASH" ? (method === "SPLIT" ? onlineNum : totalNum) : undefined,
        onlineTransactionRef: method !== "CASH" ? txnRef : undefined,
        onlineGateway: method !== "CASH" ? gateway : undefined,
        idempotencyKey: idempotencyKey.current,
      });
      toast.success("Settlement payment recorded.");
      onDone();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to record settlement.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settlement — {bookingPublicId}</DialogTitle>
        </DialogHeader>

        {loadingSummary ? (
          <div className="py-8 text-center text-sm text-neutral-400">Loading summary…</div>
        ) : summary ? (
          <div className="space-y-5 py-2">
            {/* Summary breakdown */}
            <div className="bg-neutral-50 rounded-lg px-4 py-4 space-y-2 text-sm">
              <div className="flex justify-between text-neutral-600">
                <span>Rental Balance Remaining</span>
                <span>₹ {parseFloat(summary.rentalBalanceRemaining).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-neutral-600">
                <span>Damage Charges</span>
                <span>₹ {parseFloat(summary.damageCharges).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-neutral-600">
                <span>Extension Charges</span>
                <span>₹ {parseFloat(summary.extensionCharges).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-neutral-600">
                <span>Already Paid (confirmed)</span>
                <span className="text-green-600">
                  − ₹ {parseFloat(summary.alreadyPaid).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between font-semibold text-neutral-900 pt-2 border-t border-neutral-200">
                <span>Net Payable by Customer</span>
                <span>₹ {parseFloat(summary.netPayable).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            {/* Method selector */}
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <div className="grid grid-cols-3 gap-2">
                {(["CASH", "ONLINE", "SPLIT"] as PaymentMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                      method === m
                        ? "border-orange-500 bg-orange-50 text-orange-700"
                        : "border-neutral-200 hover:border-neutral-300 text-neutral-700"
                    }`}
                  >
                    {m === "SPLIT" ? "Split" : m.charAt(0) + m.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Amount */}
            {method !== "SPLIT" ? (
              <div className="space-y-2">
                <Label htmlFor="settleAmount">
                  Amount <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                  <Input
                    id="settleAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    className="pl-8 h-12"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Total Amount</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="pl-8 h-12"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Cash Portion <span className="text-red-500">*</span></Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="pl-8 h-12"
                        value={cashAmount}
                        onChange={(e) => setCashAmount(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Online Portion</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                      <Input
                        className="pl-8 h-12 bg-neutral-50 text-neutral-500"
                        value={onlineNum > 0 ? onlineNum.toFixed(2) : "0.00"}
                        readOnly
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Online fields */}
            {(method === "ONLINE" || method === "SPLIT") && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="settleTxnRef">
                    Transaction Reference <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="settleTxnRef"
                    placeholder="e.g. pay_xyz789"
                    className="h-12"
                    value={txnRef}
                    onChange={(e) => setTxnRef(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Gateway</Label>
                  <Select value={gateway} onValueChange={(v) => setGateway(v as OnlineGateway)}>
                    <SelectTrigger className="h-12">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {gateways.map((g) => (
                        <SelectItem key={g} value={g}>{g}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={onClose} className="flex-1">
                Cancel
              </Button>
              <Button
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                onClick={handleSubmit}
                disabled={loading}
              >
                {loading ? "Recording…" : "Record Settlement"}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SettlementsTab() {
  const [items, setItems] = useState<SettlementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await paymentService.getSettlements(page, pageSize);
      setItems(res.data || []);
      setTotal(res.total || 0);
    } catch {
      toast.error("Failed to load settlements.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">Pending Settlements</h2>
            <p className="text-sm text-neutral-500 mt-1">
              Returned bookings with outstanding balances
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
            {total > 0 && (
              <span className="bg-orange-100 text-orange-700 text-sm font-semibold px-3 py-1 rounded-full">
                {total} pending
              </span>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-neutral-400 text-sm">Loading…</div>
          ) : (!items || items.length === 0) ? (
            <div className="py-16 text-center">
              <TrendingDown className="w-10 h-10 text-green-400 mx-auto mb-3" />
              <p className="font-medium text-neutral-700">No pending settlements</p>
              <p className="text-sm text-neutral-400 mt-1">All returned bookings are settled.</p>
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
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Vehicle
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Net Payable
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(items || []).map((item) => {
                    const net = parseFloat(item.netPayable);
                    const isRefundDue = net < 0;
                    return (
                      <tr key={item.bookingPublicId} className="hover:bg-neutral-50 transition-colors">
                        <td className="px-4 py-3.5 font-mono text-xs text-neutral-600">
                          {item.bookingPublicId}
                        </td>
                        <td className="px-4 py-3.5 font-medium text-neutral-900">
                          {item.customerName}
                        </td>
                        <td className="px-4 py-3.5 text-neutral-600">{item.vehicleRegNo}</td>
                        <td className={`px-4 py-3.5 text-right font-semibold ${isRefundDue ? "text-blue-600" : "text-neutral-900"}`}>
                          {isRefundDue ? "−" : ""}₹{" "}
                          {Math.abs(net).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          {isRefundDue ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs text-blue-600 border-blue-200 hover:bg-blue-50"
                              onClick={() => setSelected(item.bookingPublicId)}
                            >
                              Refund Due
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              className="bg-orange-500 hover:bg-orange-600 text-white h-8 text-xs"
                              onClick={() => setSelected(item.bookingPublicId)}
                            >
                              Settle
                              <ArrowRight className="w-3.5 h-3.5 ml-1" />
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
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <SettleModal
          bookingPublicId={selected}
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

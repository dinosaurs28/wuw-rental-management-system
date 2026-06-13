import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { ArrowRight, TrendingDown, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";

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

function SettleModal({ bookingPublicId, onClose, onDone }: { bookingPublicId: string; onClose: () => void; onDone: () => void }) {
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
    paymentService.getSettlementSummary(bookingPublicId)
      .then((s) => { setSummary(s); setAmount(parseFloat(s.netPayable).toFixed(2)); })
      .catch(() => toast.error("Failed to load settlement details."))
      .finally(() => setLoadingSummary(false));
  }, [bookingPublicId]);

  const totalNum = parseFloat(amount) || 0;
  const cashNum = parseFloat(cashAmount) || 0;
  const onlineNum = method === "SPLIT" ? Math.max(0, totalNum - cashNum) : 0;

  const handleSubmit = async () => {
    if (totalNum <= 0) { toast.error("Please enter a valid amount."); return; }
    if ((method === "ONLINE" || method === "SPLIT") && !txnRef.trim()) { toast.error("Transaction reference is required for online payments."); return; }
    if (method === "SPLIT" && (cashNum <= 0 || onlineNum <= 0)) { toast.error("Both cash and online portions must be greater than 0."); return; }
    setLoading(true);
    try {
      await paymentService.recordSettlement(bookingPublicId, {
        purpose: "REMAINING_BALANCE", method, totalAmount: totalNum,
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
    } finally { setLoading(false); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
        <div className="px-6 py-5 border-b border-neutral-100 bg-neutral-50/60">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Settlement</DialogTitle>
            <p className="text-xs text-neutral-500 font-mono mt-0.5">{bookingPublicId}</p>
          </DialogHeader>
        </div>

        <div className="px-6 py-5">
          {loadingSummary ? (
            <div className="py-8 text-center text-sm text-neutral-400">Loading summary…</div>
          ) : summary ? (
            <div className="space-y-5">
              {/* Summary breakdown */}
              <div className="bg-neutral-50 rounded-xl border border-neutral-100 divide-y divide-neutral-100 text-sm overflow-hidden">
                {[
                  ["Rental Balance", summary.rentalBalanceRemaining],
                  ["Damage Charges", summary.damageCharges],
                  ["Extension Charges", summary.extensionCharges],
                ].map(([label, val]) => (
                  <div key={label} className="flex justify-between items-center px-4 py-2.5">
                    <span className="text-neutral-500 text-xs">{label}</span>
                    <span className="text-xs text-neutral-700">₹ {parseFloat(val).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center px-4 py-2.5">
                  <span className="text-neutral-500 text-xs">Already Paid</span>
                  <span className="text-xs text-green-600 font-medium">− ₹ {parseFloat(summary.alreadyPaid).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between items-center px-4 py-3 bg-neutral-100/60">
                  <span className="text-sm font-semibold text-neutral-800">Net Payable</span>
                  <span className="text-sm font-bold text-neutral-900">₹ {parseFloat(summary.netPayable).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

              {/* Method */}
              <div className="space-y-2">
                <Label className="text-xs text-neutral-600 font-medium">Payment Method</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(["CASH", "ONLINE", "SPLIT"] as PaymentMethod[]).map((m) => (
                    <button key={m} type="button" onClick={() => setMethod(m)}
                      className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${method === m ? "border-orange-500 bg-orange-50 text-orange-700" : "border-neutral-200 hover:border-neutral-300 text-neutral-600"}`}>
                      {m === "SPLIT" ? "Split" : m.charAt(0) + m.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount fields */}
              {method !== "SPLIT" ? (
                <div className="space-y-1.5">
                  <Label className="text-xs text-neutral-600">Amount <span className="text-red-500">*</span></Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">₹</span>
                    <Input type="number" min="0" step="0.01" className="pl-7 h-11" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-neutral-600">Total Amount</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">₹</span>
                      <Input type="number" min="0" step="0.01" className="pl-7 h-11" value={amount} onChange={(e) => setAmount(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-neutral-600">Cash <span className="text-red-500">*</span></Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">₹</span>
                        <Input type="number" min="0" step="0.01" className="pl-7 h-11" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-neutral-500">Online (auto)</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">₹</span>
                        <Input className="pl-7 h-11 bg-neutral-50 text-neutral-400" value={onlineNum > 0 ? onlineNum.toFixed(2) : "0.00"} readOnly />
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Online fields */}
              {(method === "ONLINE" || method === "SPLIT") && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-neutral-600">Transaction Ref <span className="text-red-500">*</span></Label>
                    <Input placeholder="e.g. pay_xyz789" className="h-11" value={txnRef} onChange={(e) => setTxnRef(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-neutral-600">Gateway</Label>
                    <Select value={gateway} onValueChange={(v) => setGateway(v as OnlineGateway)}>
                      <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>{gateways.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button variant="outline" onClick={onClose} className="flex-1 h-11">Cancel</Button>
                <Button className="flex-1 h-11 bg-orange-500 hover:bg-orange-600 text-white" onClick={handleSubmit} disabled={loading}>
                  {loading ? "Recording…" : "Record Settlement"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────

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
    } catch { toast.error("Failed to load settlements."); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">Pending Settlements</h2>
            <p className="text-xs text-neutral-500 mt-0.5">Returned bookings with outstanding balances</p>
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
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-20" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-16" />
                  <div className="h-8 bg-neutral-100 rounded-lg animate-pulse w-20" />
                </div>
              ))}
            </div>
          ) : (!items || items.length === 0) ? (
            <div className="py-20 flex flex-col items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-3">
                <TrendingDown className="w-6 h-6 text-green-500" />
              </div>
              <p className="font-medium text-neutral-700">No pending settlements</p>
              <p className="text-sm text-neutral-400 mt-1">All returned bookings are settled.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neutral-100 bg-neutral-50/80">
                    {["Booking", "Customer", "Vehicle", "Net Payable", ""].map((h, i) => (
                      <th key={i} className={`px-5 py-3.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide ${h === "Net Payable" || h === "" ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(items || []).map((item) => {
                    const net = parseFloat(item.netPayable);
                    const isRefundDue = net < 0;
                    return (
                      <tr key={item.bookingPublicId} className="hover:bg-neutral-50/60 transition-colors">
                        <td className="px-5 py-3.5 font-mono text-xs text-neutral-500">{item.bookingPublicId}</td>
                        <td className="px-5 py-3.5 font-medium text-neutral-900 text-sm">{item.customerName}</td>
                        <td className="px-5 py-3.5 text-sm text-neutral-600">{item.vehicleRegNo}</td>
                        <td className={`px-5 py-3.5 text-right font-semibold text-sm ${isRefundDue ? "text-blue-600" : "text-neutral-900"}`}>
                          {isRefundDue ? "−" : ""}₹ {Math.abs(net).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {isRefundDue ? (
                            <Button size="sm" variant="outline" className="h-8 text-xs text-blue-600 border-blue-200 hover:bg-blue-50" onClick={() => setSelected(item.bookingPublicId)}>
                              Refund Due
                            </Button>
                          ) : (
                            <Button size="sm" className="h-8 text-xs bg-orange-500 hover:bg-orange-600 text-white gap-1" onClick={() => setSelected(item.bookingPublicId)}>
                              Settle <ArrowRight className="w-3 h-3" />
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

      {selected && <SettleModal bookingPublicId={selected} onClose={() => setSelected(null)} onDone={() => { setSelected(null); load(); }} />}
    </>
  );
}

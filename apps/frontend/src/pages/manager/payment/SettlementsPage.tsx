import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
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
import { apiErrorMessage } from "@/lib/counterErrors";
import {
  counterPaymentErrorField,
  formatRupees,
  type CounterProof,
  type CounterRefundMethod,
} from "@/lib/counterPayment";
import { PaymentProofField } from "@/components/payment/counter/PaymentProofField";
import { RefundMethodFields } from "@/components/payment/counter/CounterPaymentFields";
import apiClient from "@/lib/axios";
import { CreditNoteDialog, type CreditNote } from "@/components/manager/CreditNoteDialog";

const gateways: OnlineGateway[] = ["UPI", "Razorpay", "Other"];

/** Money on credit (#11) stays in netPayable but is collected on the Customer Credit page, not here. */
const payableHere = (s: SettlementSummary) =>
  s.payableExcludingCredit != null
    ? parseFloat(s.payableExcludingCredit) || 0
    : Math.max(0, (parseFloat(s.netPayable) || 0) - (parseFloat(s.creditPending ?? "0") || 0));

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
  // Shown at the reference / photo field (client check or a refused photo)
  const [refError, setRefError] = useState<string | null>(null);
  // UPI at the counter is backed by a photo of the customer's payment screen (#3)
  const [proof, setProof] = useState<CounterProof | null>(null);
  // Legacy drop (#6): the held safety deposit paid back by the branch manager
  const [depositMethod, setDepositMethod] = useState<CounterRefundMethod>("CASH");
  const [depositProof, setDepositProof] = useState<CounterProof | null>(null);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const isUpi = gateway === "UPI";

  useEffect(() => {
    paymentService.getSettlementSummary(bookingPublicId)
      .then((s) => { setSummary(s); setAmount(payableHere(s).toFixed(2)); })
      .catch(() => toast.error("Failed to load settlement details."))
      .finally(() => setLoadingSummary(false));
  }, [bookingPublicId]);

  // Credit notes already issued on this booking (shown in the credit-note dialog)
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  useEffect(() => {
    apiClient
      .get<{ data: CreditNote[] }>(`/branchManager/credit-notes/${bookingPublicId}`)
      .then((res) => setCreditNotes(res.data?.data ?? []))
      .catch(() => setCreditNotes([]));
  }, [bookingPublicId]);

  const totalNum = parseFloat(amount) || 0;
  const cashNum = parseFloat(cashAmount) || 0;
  const onlineNum = method === "SPLIT" ? Math.max(0, totalNum - cashNum) : 0;

  const handleSubmit = async () => {
    if (totalNum <= 0) { toast.error("Please enter a valid amount."); return; }
    if ((method === "ONLINE" || method === "SPLIT") && (isUpi ? !proof : !txnRef.trim())) {
      setRefError(
        isUpi
          ? "Add a photo of the customer's UPI payment-success screen."
          : "Transaction reference is required for online payments.",
      );
      return;
    }
    if (method === "SPLIT" && (cashNum <= 0 || onlineNum <= 0)) { toast.error("Both cash and online portions must be greater than 0."); return; }
    setLoading(true);
    try {
      await paymentService.recordSettlement(bookingPublicId, {
        purpose: "REMAINING_BALANCE", method, totalAmount: totalNum,
        cashAmount: method !== "ONLINE" ? (method === "SPLIT" ? cashNum : totalNum) : undefined,
        onlineAmount: method !== "CASH" ? (method === "SPLIT" ? onlineNum : totalNum) : undefined,
        onlineTransactionRef: method !== "CASH" && !isUpi ? txnRef.trim() : undefined,
        proof_file_id: method !== "CASH" && isUpi ? proof?.proofFileId : undefined,
        onlineGateway: method !== "CASH" ? gateway : undefined,
        idempotencyKey: idempotencyKey.current,
      });
      toast.success("Settlement payment recorded.");
      onDone();
    } catch (err) {
      if (counterPaymentErrorField(err) === "proof") {
        setRefError(apiErrorMessage(err, "Check the payment photo and try again."));
      } else {
        toast.error(apiErrorMessage(err, "Failed to record settlement."));
      }
    } finally { setLoading(false); }
  };

  // Legacy drop (#6): pay the held safety deposit back — all of what is still to refund
  const depositToRefund = parseFloat(summary?.safetyDepositToRefund ?? "0") || 0;
  // On credit (#11): part of Net Payable, collected on the Customer Credit page
  const creditHere = parseFloat(summary?.creditPending ?? "0") || 0;
  const handleRefundDeposit = async () => {
    setRefunding(true);
    setDepositError(null);
    try {
      const res = await paymentService.refundSettlementDeposit(bookingPublicId, {
        method: depositMethod,
        ...(depositMethod === "UPI" && depositProof ? { proof_file_id: depositProof.proofFileId } : {}),
      });
      toast.success(res.message || "Safety deposit refunded.");
      setSummary(res.data.settlement);
      setAmount(payableHere(res.data.settlement).toFixed(2));
      setDepositProof(null);
    } catch (err) {
      setDepositError(apiErrorMessage(err, "Couldn't record the deposit refund."));
    } finally {
      setRefunding(false);
    }
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
                  // Confirmed extensions (taxable + GST) — informational, already inside the rental total
                  ["Extension Charges (incl. GST, part of rental total)", summary.extensionCharges],
                  // Extra km / late return recorded at a legacy drop, or the drop bill — part of Net Payable.
                  // No GST on drop charges (item 8); bills completed before keep the GST they carried.
                  ...(summary.returnCharges != null && parseFloat(summary.returnCharges) > 0
                    ? [["Return Charges (drop bill / extra km / late return)", summary.returnCharges]]
                    : []),
                  // Refundable safety deposit still held — counted in Net Payable and in Already Paid
                  ...(summary.safetyDepositHeld != null && parseFloat(summary.safetyDepositHeld) > 0
                    ? [["Safety Deposit Held (refundable)", summary.safetyDepositHeld]]
                    : []),
                  // Refunds paid out — already taken off Already Paid
                  ...(summary.refunded != null && parseFloat(summary.refunded) > 0
                    ? [["Refunded to Customer", summary.refunded]]
                    : []),
                  // Left owed at the counter against collateral (#11) — part of Net Payable until cleared
                  ...(summary.creditPending != null && parseFloat(summary.creditPending) > 0
                    ? [[
                        `On Credit${summary.creditCollateral?.length ? ` (collateral: ${summary.creditCollateral.join(", ")})` : ""}`,
                        summary.creditPending,
                      ]]
                    : []),
                  // Legacy drop's deposit choice (#6) — what is still to pay back
                  ...(summary.safetyDepositToRefund != null && parseFloat(summary.safetyDepositToRefund) > 0
                    ? [[
                        `Safety Deposit to Refund${summary.safetyDepositHandling === "REFUND_IN_FULL" ? " (refund in full)" : " (left after set-off)"}`,
                        summary.safetyDepositToRefund,
                      ]]
                    : []),
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

              {/* Credit note against this booking's invoice (reverses taxable value + CGST/SGST first) */}
              <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-100 px-4 py-2.5">
                <p className="text-xs text-neutral-500">
                  {creditNotes.length > 0
                    ? `${creditNotes.length} credit note${creditNotes.length === 1 ? "" : "s"} issued.`
                    : "Correcting the invoice?"}{" "}
                  A credit note doesn't change the amount to collect here.
                </p>
                <CreditNoteDialog
                  bookingPublicId={bookingPublicId}
                  existingCreditNotes={creditNotes}
                  onIssued={(cn) => setCreditNotes((prev) => [cn, ...prev])}
                />
              </div>

              {/* Money on credit (#11) is collected only on the Customer Credit page, whose
                  clearing records the payment and closes the credit — never through this form */}
              {creditHere > 0 && (
                <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-xs text-amber-900">
                  <p>
                    <span className="font-semibold">{formatRupees(creditHere)} is on customer credit</span>
                    {summary.creditCollateral?.length ? ` (collateral held: ${summary.creditCollateral.join(", ")})` : ""}.
                  </p>
                  <p>
                    Collect it on the Customer Credit page — clearing it there records the payment.
                    {summary.customerPublicId && (
                      <>
                        {" "}
                        <Link to={`/manager/ledger/${summary.customerPublicId}`} className="font-medium underline">
                          Open Customer Credit
                        </Link>
                      </>
                    )}
                  </p>
                </div>
              )}

              {/* Legacy drop (#6): the held safety deposit paid back to the customer */}
              {depositToRefund > 0 && (
                <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-blue-900">Refund the safety deposit</span>
                    <span className="text-sm font-bold text-blue-900">{formatRupees(depositToRefund)}</span>
                  </div>
                  <p className="text-xs text-blue-800">
                    {summary.safetyDepositHandling === "REFUND_IN_FULL"
                      ? "Staff chose to refund the deposit in full at the drop; collect the charges below separately."
                      : "The deposit covered the charges; this is what is left to give back."}
                  </p>
                  <RefundMethodFields
                    idPrefix="settle-deposit"
                    method={depositMethod}
                    onMethodChange={(m) => { setDepositMethod(m); setDepositError(null); }}
                    proof={depositProof}
                    onProofChange={(p) => { setDepositProof(p); setDepositError(null); }}
                    proofRole="manager"
                    disabled={refunding}
                  />
                  {depositError && <p className="text-xs text-red-600">{depositError}</p>}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full h-10 border-blue-300 text-blue-800 hover:bg-blue-100"
                    disabled={refunding}
                    onClick={handleRefundDeposit}
                  >
                    {refunding ? "Recording…" : `Refund ${formatRupees(depositToRefund)} (${depositMethod === "UPI" ? "UPI" : "Cash"})`}
                  </Button>
                </div>
              )}

              {/* Nothing left to collect here (e.g. only the deposit goes back, or only credit is left) — no payment form */}
              {payableHere(summary) > 0 ? (<>
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
                    <Label className="text-xs text-neutral-600">Gateway</Label>
                    <Select value={gateway} onValueChange={(v) => { setGateway(v as OnlineGateway); setRefError(null); }}>
                      <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>{gateways.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {isUpi ? (
                    // Counter UPI (#3): a photo of the customer's payment screen, no UTR box
                    <PaymentProofField
                      id="settle-proof"
                      className="col-span-2"
                      role="manager"
                      value={proof}
                      onChange={(p) => { setProof(p); setRefError(null); }}
                      error={refError}
                    />
                  ) : (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-neutral-600">Transaction Ref <span className="text-red-500">*</span></Label>
                      <Input
                        placeholder="e.g. pay_xyz789"
                        autoComplete="off"
                        aria-invalid={!!refError}
                        className="h-11"
                        value={txnRef}
                        onChange={(e) => { setTxnRef(e.target.value); setRefError(null); }}
                      />
                    </div>
                  )}
                  {refError && !isUpi && <p className="col-span-2 -mt-1 text-xs text-red-600">{refError}</p>}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button variant="outline" onClick={onClose} className="flex-1 h-11">Cancel</Button>
                <Button className="flex-1 h-11 bg-orange-500 hover:bg-orange-600 text-white" onClick={handleSubmit} disabled={loading}>
                  {loading ? "Recording…" : "Record Settlement"}
                </Button>
              </div>
              </>) : (
                <div className="space-y-3">
                  <p className="rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3 text-xs text-neutral-600">
                    Nothing to collect here.
                    {depositToRefund > 0 ? " Refund the safety deposit above to settle it." : ""}
                    {creditHere > 0 ? " The amount on credit is cleared on the Customer Credit page." : ""}
                  </p>
                  <Button variant="outline" onClick={depositToRefund > 0 ? onClose : onDone} className="w-full h-11">
                    Close
                  </Button>
                </div>
              )}
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
                          {/* Collected on the Customer Credit page (#11) */}
                          {parseFloat(item.creditPending ?? "0") > 0 && (
                            <span className="block text-[11px] font-normal text-amber-700">
                              {net > 0 ? "incl. " : ""}₹ {parseFloat(item.creditPending!).toLocaleString("en-IN", { minimumFractionDigits: 2 })} on credit
                            </span>
                          )}
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

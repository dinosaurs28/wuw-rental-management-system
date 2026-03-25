import { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { paymentService, employeePaymentService } from "@/services/payment.service";
import type { PaymentPurpose, PaymentMethod, OnlineGateway } from "@/services/payment.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

interface RecordPaymentModalProps {
  open: boolean;
  bookingPublicId: string;
  amountDue: number;
  onClose: () => void;
  onSuccess: () => void;
  role?: "employee" | "manager";
}

const purposeLabels: Record<PaymentPurpose, string> = {
  FULL_PAYMENT: "Full Payment",
  ADVANCE: "Advance",
  REMAINING_BALANCE: "Remaining Balance",
  EXTENSION_FEE: "Extension Fee",
  DAMAGE_FEE: "Damage Fee",
  EXTENSION: "Extension Fee",
};

const methodLabels: Record<PaymentMethod, string> = {
  CASH: "Cash",
  ONLINE: "Online",
  SPLIT: "Split (Cash + Online)",
};

const gateways: OnlineGateway[] = ["UPI", "Razorpay", "Other"];

export function RecordPaymentModal({
  open,
  bookingPublicId,
  amountDue,
  onClose,
  onSuccess,
  role = "manager",
}: RecordPaymentModalProps) {
  const svc = role === "employee" ? employeePaymentService : paymentService;
  const [step, setStep] = useState<1 | 2>(1);
  const [purpose, setPurpose] = useState<PaymentPurpose | "">("");
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [amount, setAmount] = useState(amountDue.toString());
  const [cashAmount, setCashAmount] = useState("");
  const [txnRef, setTxnRef] = useState("");
  const [gateway, setGateway] = useState<OnlineGateway>("UPI");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  const totalNum = parseFloat(amount) || 0;
  const cashNum = parseFloat(cashAmount) || 0;
  const onlineNum = method === "SPLIT" ? Math.max(0, totalNum - cashNum) : 0;

  const resetAndClose = () => {
    setStep(1);
    setPurpose("");
    setMethod("");
    setAmount(amountDue.toString());
    setCashAmount("");
    setTxnRef("");
    setGateway("UPI");
    setNotes("");
    // Re-roll idempotency key for next session
    idempotencyKey.current = crypto.randomUUID();
    onClose();
  };

  const handleNext = () => {
    if (!purpose || !method) {
      toast.error("Please select a purpose and payment method.");
      return;
    }
    setStep(2);
  };

  const handleSubmit = async () => {
    if (!purpose || !method) return;
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
      const res = await svc.recordPayment({
        bookingPublicId,
        purpose: purpose as PaymentPurpose,
        method: method as PaymentMethod,
        totalAmount: totalNum,
        cashAmount: method !== "ONLINE" ? (method === "SPLIT" ? cashNum : totalNum) : undefined,
        onlineAmount: method !== "CASH" ? (method === "SPLIT" ? onlineNum : totalNum) : undefined,
        onlineTransactionRef: method !== "CASH" ? txnRef : undefined,
        onlineGateway: method !== "CASH" ? gateway : undefined,
        notes: notes || undefined,
        idempotencyKey: idempotencyKey.current,
      });

      if (res.data.status === "CONFIRMED") {
        toast.success("Payment recorded and confirmed.");
      } else if (res.data.status === "COLLECTED") {
        toast.info("Cash collected — awaiting manager confirmation.");
      } else {
        toast.success(res.message || "Payment recorded.");
      }

      onSuccess();
      resetAndClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to record payment.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Record Payment</DialogTitle>
            <span className="text-xs text-neutral-400 font-medium">
              Step {step} of 2
            </span>
          </div>
          {/* Step indicator */}
          <div className="flex gap-1 mt-3">
            <div className={`h-1 flex-1 rounded-full transition-colors ${step >= 1 ? "bg-orange-500" : "bg-neutral-200"}`} />
            <div className={`h-1 flex-1 rounded-full transition-colors ${step >= 2 ? "bg-orange-500" : "bg-neutral-200"}`} />
          </div>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {step === 1 ? (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-5 py-2"
            >
              {/* Purpose */}
              <div className="space-y-2">
                <Label>Payment Purpose</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(purposeLabels) as PaymentPurpose[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPurpose(p)}
                      className={`px-3 py-2.5 rounded-lg border text-sm font-medium text-left transition-all ${
                        purpose === p
                          ? "border-orange-500 bg-orange-50 text-orange-700"
                          : "border-neutral-200 hover:border-neutral-300 text-neutral-700"
                      }`}
                    >
                      {purposeLabels[p]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Method */}
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(methodLabels) as PaymentMethod[]).map((m) => (
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
                      {m === "SPLIT" ? "Split" : methodLabels[m]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={resetAndClose} className="flex-1">
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                  onClick={handleNext}
                  disabled={!purpose || !method}
                >
                  Next →
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4 py-2"
            >
              {/* Amount due info */}
              <div className="bg-neutral-50 rounded-lg px-4 py-3 text-sm flex justify-between items-center">
                <span className="text-neutral-500">
                  {purposeLabels[purpose as PaymentPurpose]} •{" "}
                  {methodLabels[method as PaymentMethod]}
                </span>
                <span className="font-semibold text-neutral-900">
                  Due: ₹ {amountDue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>

              {/* Amount field (cash or total) */}
              {method !== "SPLIT" && (
                <div className="space-y-2">
                  <Label htmlFor="amount">
                    Amount <span className="text-red-500">*</span>
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                    <Input
                      id="amount"
                      type="number"
                      min="0"
                      step="0.01"
                      className="pl-8 h-12"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Split fields */}
              {method === "SPLIT" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="totalAmount">
                      Total Amount <span className="text-red-500">*</span>
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                      <Input
                        id="totalAmount"
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
                      <Label htmlFor="cashPortion">
                        Cash Portion <span className="text-red-500">*</span>
                      </Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                        <Input
                          id="cashPortion"
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
                  {cashAmount && (
                    <p className={`text-xs ${Math.abs(cashNum + onlineNum - totalNum) < 0.01 ? "text-green-600" : "text-red-500"}`}>
                      {Math.abs(cashNum + onlineNum - totalNum) < 0.01
                        ? "✓ Cash + Online = ₹" + totalNum.toLocaleString("en-IN")
                        : `⚠ Cash + Online must equal ₹${totalNum.toLocaleString("en-IN")}`}
                    </p>
                  )}
                </>
              )}

              {/* Online fields */}
              {(method === "ONLINE" || method === "SPLIT") && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="txnRef">
                      Transaction Reference <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="txnRef"
                      placeholder="e.g. pay_xyz789"
                      className="h-12"
                      value={txnRef}
                      onChange={(e) => setTxnRef(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Gateway</Label>
                    <Select
                      value={gateway}
                      onValueChange={(v) => setGateway(v as OnlineGateway)}
                    >
                      <SelectTrigger className="h-12">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {gateways.map((g) => (
                          <SelectItem key={g} value={g}>
                            {g}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {/* Notes (cash only) */}
              {method === "CASH" && (
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes (optional)</Label>
                  <Textarea
                    id="notes"
                    placeholder="Any additional notes…"
                    rows={2}
                    className="resize-none"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  disabled={loading}
                  className="flex-1"
                >
                  ← Back
                </Button>
                <Button
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                  onClick={handleSubmit}
                  disabled={loading}
                >
                  {loading
                    ? "Recording…"
                    : method === "CASH"
                    ? "Record Cash Payment"
                    : method === "ONLINE"
                    ? "Record Online Payment"
                    : "Record Split Payment"}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

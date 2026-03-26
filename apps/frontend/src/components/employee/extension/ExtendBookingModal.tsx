import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { CalendarIcon, Car } from "lucide-react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  extensionService,
  type ExtensionEvaluation,
  type ResolutionOption,
  type ExtensionResolutionType,
} from "@/services/extension.service";
import type { PaymentMethod, OnlineGateway } from "@/services/payment.service";
import { paymentSessionService, type PaymentSession } from "@/services/paymentSession.service";
import { LedgerSummaryCard } from "@/components/payment/LedgerSummaryCard";
import { RecordPaymentPanel } from "@/components/payment/RecordPaymentPanel";

interface ExtendBookingModalProps {
  open: boolean;
  bookingPublicId: string;
  currentEndAt: string;
  role: "employee" | "manager";
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 1 | 2 | 3 | 4;

const resolutionLabels: Record<ExtensionResolutionType, string> = {
  SAME_VEHICLE: "Same vehicle (no conflict)",
  SWAP_CURRENT_TO_OTHER: "Swap to an available equivalent vehicle",
  SWAP_FUTURE_BOOKING: "Reassign the conflicting booking's vehicle",
  PARTIAL_EXTENSION: "Partial extension (until last available date)",
  NO_RESOLUTION: "No extension available",
};

const gateways: OnlineGateway[] = ["UPI", "Razorpay", "Other"];

function fmt(iso: string) {
  return format(parseISO(iso), "dd MMM yyyy, hh:mm a");
}

function fmtMoney(val: string) {
  return "₹ " + parseFloat(val).toLocaleString("en-IN", { minimumFractionDigits: 2 });
}

export function ExtendBookingModal({
  open,
  bookingPublicId,
  currentEndAt,
  role,
  onClose,
  onSuccess,
}: ExtendBookingModalProps) {
  const [step, setStep] = useState<Step>(1);

  // Step 1 state
  const [newDate, setNewDate] = useState<Date | undefined>();
  const [newHour, setNewHour] = useState("18");
  const [newMinute, setNewMinute] = useState("00");
  const [notes, setNotes] = useState("");
  const [evaluating, setEvaluating] = useState(false);

  // Step 2 state
  const [evaluation, setEvaluation] = useState<ExtensionEvaluation | null>(null);
  const [selectedResolution, setSelectedResolution] = useState<ExtensionResolutionType | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");

  // Step 3 state (payment)
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [cashAmount, setCashAmount] = useState("");
  const [txnRef, setTxnRef] = useState("");
  const [gateway, setGateway] = useState<OnlineGateway>("UPI");
  const [committing, setCommitting] = useState(false);
  const [extensionSession, setExtensionSession] = useState<PaymentSession | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());

  const reset = useCallback(() => {
    setStep(1);
    setNewDate(undefined);
    setNewHour("18");
    setNewMinute("00");
    setNotes("");
    setEvaluation(null);
    setSelectedResolution(null);
    setSelectedVehicleId("");
    setMethod("CASH");
    setCashAmount("");
    setTxnRef("");
    setGateway("UPI");
    setExtensionSession(null);
    idempotencyKey.current = crypto.randomUUID();
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  // ── Step 1 → 2: Evaluate ──────────────────────────────────────────────────

  const handleEvaluate = async () => {
    if (!newDate) {
      toast.error("Please select a new end date.");
      return;
    }
    const isoDate = new Date(newDate);
    isoDate.setHours(parseInt(newHour), parseInt(newMinute), 0, 0);
    const currentEnd = new Date(currentEndAt);
    if (isoDate <= currentEnd) {
      toast.error("New end date must be after the current end date.");
      return;
    }

    setEvaluating(true);
    try {
      const fn = role === "manager" ? extensionService.managerEvaluate : extensionService.employeeEvaluate;
      const res = await fn(bookingPublicId, isoDate.toISOString(), notes || undefined);
      setEvaluation(res.data);
      const recommended = res.data.recommendedResolution;
      setSelectedResolution(recommended !== "NO_RESOLUTION" ? recommended : null);
      // pre-select first available vehicle if SWAP_CURRENT
      const swapOpt = res.data.resolutionOptions.find((o) => o.type === "SWAP_CURRENT_TO_OTHER");
      if (recommended === "SWAP_CURRENT_TO_OTHER" && swapOpt?.availableVehicles?.[0]) {
        setSelectedVehicleId(swapOpt.availableVehicles[0].publicId);
      }
      setStep(2);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to evaluate extension.");
    } finally {
      setEvaluating(false);
    }
  };

  // ── Step 2 → 3: Proceed to payment ───────────────────────────────────────

  const handleProceed = () => {
    if (!selectedResolution) {
      toast.error("Please select a resolution option.");
      return;
    }
    if (selectedResolution === "NO_RESOLUTION") {
      toast.error("No extension is possible for the requested dates.");
      return;
    }
    if (selectedResolution === "SWAP_CURRENT_TO_OTHER" && !selectedVehicleId) {
      toast.error("Please select an alternative vehicle.");
      return;
    }
    // Pre-fill amount from selected resolution
    const opt = evaluation?.resolutionOptions.find((o) => o.type === selectedResolution);
    if (opt) setCashAmount(parseFloat(opt.additionalAmount).toFixed(2));
    setStep(3);
  };

  // ── Step 3: Commit ────────────────────────────────────────────────────────

  const additionalAmount = evaluation
    ? parseFloat(
        evaluation.resolutionOptions.find((o) => o.type === selectedResolution)?.additionalAmount ?? "0"
      )
    : 0;

  const totalNum = additionalAmount;
  const cashNum = parseFloat(cashAmount) || 0;
  const onlineNum = method === "SPLIT" ? Math.max(0, totalNum - cashNum) : 0;

  const handleCommit = async () => {
    if (!evaluation || !selectedResolution) return;
    if ((method === "ONLINE" || method === "SPLIT") && !txnRef.trim()) {
      toast.error("Transaction reference is required for online payments.");
      return;
    }
    if (method === "SPLIT" && (cashNum <= 0 || onlineNum <= 0)) {
      toast.error("Both cash and online portions must be greater than 0.");
      return;
    }

    const opt = evaluation.resolutionOptions.find((o) => o.type === selectedResolution);
    const fn = role === "manager" ? extensionService.managerCommit : extensionService.employeeCommit;

    setCommitting(true);
    try {
      const res = await fn({
        extensionPublicId: evaluation.extensionPublicId,
        resolutionType: selectedResolution,
        selectedVehicleId: selectedResolution === "SWAP_CURRENT_TO_OTHER" ? selectedVehicleId : undefined,
        affectedBookingSwaps:
          selectedResolution === "SWAP_FUTURE_BOOKING" && opt?.affectedBookings
            ? opt.affectedBookings.map((ab) => ({
                bookingPublicId: ab.bookingPublicId,
                newVehiclePublicId: ab.newVehicle.publicId,
              }))
            : undefined,
        partialNewEndAt: selectedResolution === "PARTIAL_EXTENSION" ? opt?.partialNewEndAt : undefined,
        paymentMethod: method,
        cashAmount: method !== "ONLINE" ? (method === "SPLIT" ? cashNum : totalNum) : undefined,
        onlineAmount: method !== "CASH" ? (method === "SPLIT" ? onlineNum : totalNum) : undefined,
        onlineTransactionRef: method !== "CASH" ? txnRef : undefined,
        onlineGateway: method !== "CASH" ? gateway : undefined,
        idempotencyKey: idempotencyKey.current,
      });

      // Session flow: backend returns { extension, session } when usePaymentSessions=true
      const resData = res.data as any;
      const sessionData = resData?.session;
      const extensionData = resData?.extension ?? resData;

      if (sessionData) {
        // Session mode — need to collect payment in step 4
        const sessionDetail = await paymentSessionService.getSession(sessionData.publicId);
        setExtensionSession(sessionDetail);
        setStep(4);
        return;
      }

      if (extensionData?.extensionStatus === "CONFIRMED") {
        toast.success(`Booking extended to ${fmt(extensionData.actualNewEndAt ?? evaluation.requestedEndAt)}. Payment confirmed.`);
      } else if (extensionData?.extensionStatus === "PAYMENT_COLLECTED") {
        toast.info("Cash collected — awaiting manager confirmation to finalize extension.");
      } else {
        toast.success(res.message || "Extension recorded.");
      }

      onSuccess();
      handleClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to commit extension.");
    } finally {
      setCommitting(false);
    }
  };

  const selectedOpt: ResolutionOption | undefined = evaluation?.resolutionOptions.find(
    (o) => o.type === selectedResolution
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Extend Booking</DialogTitle>
            <span className="text-xs text-neutral-400 font-medium">Step {step} of {extensionSession ? 4 : 3}</span>
          </div>
          {/* Progress bar */}
          <div className="flex gap-1 mt-3">
            {([1, 2, 3] as Step[]).map((s) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${step >= s ? "bg-orange-500" : "bg-neutral-200"}`}
              />
            ))}
            {extensionSession && (
              <div className={`h-1 flex-1 rounded-full transition-colors ${step >= 4 ? "bg-orange-500" : "bg-neutral-200"}`} />
            )}
          </div>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {/* ── Step 1: Date Selection ── */}
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-5 py-2"
            >
              {/* Current end info */}
              <div className="bg-neutral-50 rounded-lg px-4 py-3 text-sm flex justify-between items-center">
                <span className="text-neutral-500">Current end date</span>
                <span className="font-semibold text-neutral-900">{fmt(currentEndAt)}</span>
              </div>

              {/* New end date picker */}
              <div className="space-y-2">
                <Label>New End Date <span className="text-red-500">*</span></Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full h-12 justify-start text-left font-normal"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4 text-neutral-400" />
                      {newDate ? format(newDate, "dd MMM yyyy") : <span className="text-neutral-400">Pick a date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={newDate}
                      onSelect={setNewDate}
                      disabled={(d) => d <= new Date(currentEndAt)}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Time pickers */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="newHour">Hour</Label>
                  <Select value={newHour} onValueChange={setNewHour}>
                    <SelectTrigger id="newHour" className="h-12">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map((h) => (
                        <SelectItem key={h} value={h}>{h}:00</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="newMinute">Minute</Label>
                  <Select value={newMinute} onValueChange={setNewMinute}>
                    <SelectTrigger id="newMinute" className="h-12">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["00", "15", "30", "45"].map((m) => (
                        <SelectItem key={m} value={m}>:{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label htmlFor="extNotes">Notes (optional)</Label>
                <Textarea
                  id="extNotes"
                  placeholder="e.g. Customer requested extension due to travel plans"
                  rows={2}
                  className="resize-none"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                  onClick={handleEvaluate}
                  disabled={evaluating || !newDate}
                >
                  {evaluating ? "Checking…" : "Check Availability →"}
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Step 2: Resolution Options ── */}
          {step === 2 && evaluation && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4 py-2"
            >
              {/* Pricing summary */}
              <div className="bg-neutral-50 rounded-lg px-4 py-3.5 text-sm space-y-2">
                <div className="flex justify-between text-neutral-600">
                  <span>Duration</span>
                  <span>
                    {evaluation.pricing.originalDays} day{evaluation.pricing.originalDays !== 1 ? "s" : ""}{" "}
                    → {evaluation.pricing.newDays} day{evaluation.pricing.newDays !== 1 ? "s" : ""}
                    <span className="text-orange-600 ml-1">
                      (+{evaluation.pricing.newDays - evaluation.pricing.originalDays})
                    </span>
                  </span>
                </div>
                <div className="flex justify-between text-neutral-600">
                  <span>New end date</span>
                  <span className="font-medium">{fmt(evaluation.requestedEndAt)}</span>
                </div>
                <div className="flex justify-between font-semibold text-neutral-900 pt-1 border-t border-neutral-200">
                  <span>Additional due</span>
                  <span className="text-orange-600">{fmtMoney(evaluation.pricing.additionalAmount)}</span>
                </div>
              </div>

              {/* Resolution options */}
              <div className="space-y-2">
                <Label className="text-sm text-neutral-600">Resolution</Label>
                {evaluation.resolutionOptions.map((opt) => {
                  const isSelected = selectedResolution === opt.type;
                  const isDisabled = opt.type === "NO_RESOLUTION";
                  return (
                    <div key={opt.type}>
                      <button
                        type="button"
                        disabled={isDisabled}
                        onClick={() => {
                          setSelectedResolution(opt.type);
                          setSelectedVehicleId("");
                        }}
                        className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition-all ${
                          isDisabled
                            ? "border-neutral-100 bg-neutral-50 opacity-50 cursor-not-allowed"
                            : isSelected
                            ? "border-orange-500 bg-orange-50"
                            : "border-neutral-200 hover:border-neutral-300"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                            isSelected ? "border-orange-500" : "border-neutral-300"
                          }`}>
                            {isSelected && <div className="w-2 h-2 rounded-full bg-orange-500" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`font-medium ${isSelected ? "text-orange-700" : "text-neutral-700"}`}>
                              {resolutionLabels[opt.type]}
                            </p>
                            {opt.type !== "NO_RESOLUTION" && (
                              <p className="text-xs text-neutral-500 mt-0.5">
                                Additional:{" "}
                                <span className="font-semibold">{fmtMoney(opt.additionalAmount)}</span>
                              </p>
                            )}
                            {opt.type === "PARTIAL_EXTENSION" && opt.partialNewEndAt && (
                              <p className="text-xs text-neutral-500 mt-0.5">
                                Until: {fmt(opt.partialNewEndAt)}
                              </p>
                            )}
                            {opt.type === "SWAP_FUTURE_BOOKING" && opt.affectedBookings?.map((ab) => (
                              <p key={ab.bookingPublicId} className="text-xs text-neutral-500 mt-0.5">
                                Booking {ab.bookingPublicId} → {ab.newVehicle.regNo}
                              </p>
                            ))}
                          </div>
                        </div>
                      </button>

                      {/* Vehicle selector for SWAP_CURRENT */}
                      {isSelected && opt.type === "SWAP_CURRENT_TO_OTHER" && opt.availableVehicles && (
                        <div className="mt-2 ml-7">
                          <Select value={selectedVehicleId} onValueChange={setSelectedVehicleId}>
                            <SelectTrigger className="h-10 text-sm">
                              <SelectValue placeholder="Select alternative vehicle…" />
                            </SelectTrigger>
                            <SelectContent>
                              {opt.availableVehicles.map((v) => (
                                <SelectItem key={v.publicId} value={v.publicId}>
                                  <span className="flex items-center gap-2">
                                    <Car className="w-3.5 h-3.5 text-neutral-400" />
                                    {v.make} {v.model} — {v.regNo}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                  ← Back
                </Button>
                <Button
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                  onClick={handleProceed}
                  disabled={!selectedResolution || selectedResolution === "NO_RESOLUTION"}
                >
                  Proceed to Payment →
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Step 3: Payment ── */}
          {step === 3 && evaluation && selectedOpt && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4 py-2"
            >
              {/* Summary */}
              <div className="bg-neutral-50 rounded-lg px-4 py-3 text-sm flex justify-between items-center">
                <span className="text-neutral-500">
                  Extension Fee •{" "}
                  <span className="text-neutral-700">{resolutionLabels[selectedOpt.type]}</span>
                </span>
                <span className="font-semibold text-neutral-900">
                  {fmtMoney(selectedOpt.additionalAmount)}
                </span>
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

              {/* Amount — pre-filled, read-only for non-split */}
              {method !== "SPLIT" && (
                <div className="space-y-2">
                  <Label>Amount</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                    <Input
                      type="number"
                      className="pl-8 h-12 bg-neutral-50"
                      value={totalNum.toFixed(2)}
                      readOnly
                    />
                  </div>
                  <p className="text-xs text-neutral-400">Amount is fixed to the extension fee.</p>
                </div>
              )}

              {/* Split fields */}
              {method === "SPLIT" && (
                <>
                  <div className="space-y-2">
                    <Label>Total Amount</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
                      <Input className="pl-8 h-12 bg-neutral-50" value={totalNum.toFixed(2)} readOnly />
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
                    <Label htmlFor="extTxnRef">
                      Transaction Reference <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="extTxnRef"
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
                <Button variant="outline" className="flex-1" onClick={() => setStep(2)} disabled={committing}>
                  ← Back
                </Button>
                <Button
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                  onClick={handleCommit}
                  disabled={committing}
                >
                  {committing
                    ? "Processing…"
                    : method === "CASH"
                    ? "Collect Cash & Confirm"
                    : "Record Payment & Confirm"}
                </Button>
              </div>
            </motion.div>
          )}
          {/* ── Step 4: Session Payment ── */}
          {step === 4 && extensionSession && (
            <motion.div
              key="step4"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4 py-2"
            >
              <p className="text-sm text-muted-foreground">
                Collect payment to confirm the extension.
              </p>
              <LedgerSummaryCard session={extensionSession} />
              <RecordPaymentPanel
                session={extensionSession}
                onSuccess={(updatedSession) => {
                  setExtensionSession(updatedSession);
                  if (updatedSession.status === "COMPLETED") {
                    toast.success("Extension payment collected and confirmed.");
                    onSuccess();
                    handleClose();
                  }
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

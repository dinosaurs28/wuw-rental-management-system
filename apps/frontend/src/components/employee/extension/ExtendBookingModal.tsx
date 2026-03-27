import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { CalendarIcon, Car } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  type CommitExtensionResult,
} from "@/services/extension.service";

export interface ExtendBookingModalSuccessResult {
  /** True when the branch uses deferred payment sessions — charge was NOT collected here. */
  usePaymentSession?: boolean;
  extensionPublicId?: string;
  amount?: string;
}

interface ExtendBookingModalProps {
  open: boolean;
  bookingPublicId: string;
  currentEndAt: string;
  role: "employee" | "manager";
  onClose: () => void;
  onSuccess: (result?: ExtendBookingModalSuccessResult) => void;
  /**
   * "standalone" (default): shows Step 3 payment collection in the modal.
   * "pickup-session": skips Step 3 — extension charge is deferred to the active
   *   pickup payment session. onSuccess is called with { usePaymentSession: true }.
   */
  mode?: "standalone" | "pickup-session";
}

type Step = 1 | 2 | 3;

const resolutionLabels: Record<ExtensionResolutionType, string> = {
  SAME_VEHICLE: "Same vehicle (no conflict)",
  SWAP_CURRENT_TO_OTHER: "Swap to an available equivalent vehicle",
  SWAP_FUTURE_BOOKING: "Reassign the conflicting booking's vehicle",
  PARTIAL_EXTENSION: "Partial extension (until last available date)",
  NO_RESOLUTION: "No extension available",
};

function fmt(iso: string) {
  return format(parseISO(iso), "dd MMM yyyy, hh:mm a");
}

export function ExtendBookingModal({
  open,
  bookingPublicId,
  currentEndAt,
  role,
  onClose,
  onSuccess,
  mode = "standalone",
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
  const [committing, setCommitting] = useState(false);

  // Step 3 state
  const [committedExtension, setCommittedExtension] = useState<CommitExtensionResult | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [collected, setCollected] = useState(false);

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
    setCommitting(false);
    setCommittedExtension(null);
    setCollecting(false);
    setCollected(false);
    idempotencyKey.current = crypto.randomUUID();
  }, []);

  const handleClose = async () => {
    // In standalone mode: if we're on Step 3 with a committed (but unpaid) extension,
    // cancel it so the vehicle hold is released.
    // In pickup-session mode: the extension stays PENDING_PAYMENT and will be confirmed
    // when the session payment is recorded (or the employee can cancel via history panel).
    if (mode === "standalone" && step === 3 && committedExtension && !collected) {
      try {
        await extensionService.employeeCancel(committedExtension.publicId);
      } catch {
        // best-effort — vehicle hold will expire via Redis TTL
      }
    }
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
      setSelectedResolution(recommended !== "NO_RESOLUTION" ? (recommended as ExtensionResolutionType) : null);
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

  // ── Step 2 → 3: Commit + open session ────────────────────────────────────

  const handleProceed = async () => {
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

    const opt = evaluation?.resolutionOptions.find((o) => o.type === selectedResolution);
    const fn = role === "manager" ? extensionService.managerCommit : extensionService.employeeCommit;

    setCommitting(true);
    try {
      const res = await fn({
        extensionPublicId: evaluation!.extensionPublicId,
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
        idempotencyKey: idempotencyKey.current,
      });

      // In pickup-session mode, if the backend confirms deferred payment,
      // skip Step 3 — the charge will be bundled into the pickup session.
      if (mode === "pickup-session" && (res.data as any).usePaymentSession) {
        toast.success(`Extension committed — ₹${res.data.additionalAmount} added to pickup payment.`);
        onSuccess({
          usePaymentSession: true,
          extensionPublicId: res.data.publicId,
          amount: res.data.additionalAmount,
        });
        reset();
        onClose();
        return;
      }

      setCommittedExtension(res.data as CommitExtensionResult);
      setStep(3);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to commit extension.");
    } finally {
      setCommitting(false);
    }
  };

  // ── Step 3: Collect payment ───────────────────────────────────────────────

  const handleCollect = async () => {
    if (!committedExtension) return;
    setCollecting(true);
    try {
      const result = await extensionService.employeeCollect(committedExtension.publicId, {
        method: "CASH",
      });
      setCollected(true);
      if (result.data.payment === "confirmed") {
        toast.success("Extension confirmed and booking updated.");
      } else {
        toast.success("Payment collected. Awaiting manager confirmation.");
      }
      onSuccess();
      reset();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to collect payment.");
    } finally {
      setCollecting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Extend Booking</DialogTitle>
            <span className="text-xs text-neutral-400 font-medium">
              Step {step} of {mode === "pickup-session" ? 2 : 3}
            </span>
          </div>
          {/* Progress bar */}
          <div className="flex gap-1 mt-3">
            {(mode === "pickup-session" ? [1, 2] : [1, 2, 3]).map((s) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${step >= s ? "bg-orange-500" : "bg-neutral-200"}`}
              />
            ))}
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
                  <span className="text-orange-600">
                    ₹{parseFloat(evaluation.pricing.additionalAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Resolution options */}
              <div className="space-y-2">
                <Label className="text-sm text-neutral-600">Resolution</Label>
                {evaluation.resolutionOptions.map((opt: ResolutionOption) => {
                  const isSelected = selectedResolution === opt.type;
                  const isDisabled = opt.type === "NO_RESOLUTION";
                  return (
                    <div key={opt.type}>
                      <button
                        type="button"
                        disabled={isDisabled}
                        onClick={() => {
                          setSelectedResolution(opt.type as ExtensionResolutionType);
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
                              {resolutionLabels[opt.type as ExtensionResolutionType]}
                            </p>
                            {opt.type !== "NO_RESOLUTION" && (
                              <p className="text-xs text-neutral-500 mt-0.5">
                                Additional:{" "}
                                <span className="font-semibold">
                                  ₹{parseFloat(opt.additionalAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                </span>
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
                  disabled={committing || !selectedResolution || selectedResolution === "NO_RESOLUTION"}
                >
                  {committing ? "Processing…" : mode === "pickup-session" ? "Confirm →" : "Confirm & Pay →"}
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Step 3: Collect Payment ── */}
          {step === 3 && committedExtension && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4 py-2"
            >
              {/* Amount due */}
              <div className="bg-neutral-50 rounded-lg px-4 py-4 space-y-1 text-sm">
                <div className="flex justify-between text-neutral-600">
                  <span>Amount due</span>
                  <span className="font-bold text-lg text-orange-600">
                    ₹{parseFloat(committedExtension.remainAmount.extension).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <p className="text-xs text-neutral-400">
                  Vehicle is on hold until payment is collected or this window is closed.
                </p>
              </div>

              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={handleClose} disabled={collecting}>
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                  onClick={handleCollect}
                  disabled={collecting}
                >
                  {collecting ? "Processing…" : "Mark as Collected"}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

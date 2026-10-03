import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { validateExtensionWindow } from "@repo/schemas";
import { CalendarIcon } from "lucide-react";
import { ExtensionVehiclePicker } from "@/components/swap/ExtensionVehiclePicker";
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
import { ShiftRequiredNotice } from "@/components/employee/counter/ShiftRequiredNotice";
import { refreshActiveShift, useActiveShift } from "@/components/employee/counter/useActiveShift";
import { apiErrorMessage, counterErrorCode } from "@/lib/counterErrors";
import {
  counterFieldErrors,
  counterMethodTakesMoney,
  counterPaymentErrorField,
  counterPaymentProblem,
  emptyCounterPayment,
  extensionCollectFields,
  type CounterPaymentValue,
} from "@/lib/counterPayment";
import { CounterPaymentFields } from "@/components/payment/counter/CounterPaymentFields";
import { dlInUseToastOptions } from "@/lib/dlInUse";
import { cn } from "@/lib/utils";
import {
  formatExtensionHours,
  formatInrExact,
  formatRentalHours,
  gstSplitText,
} from "@/lib/gst";
import { ExtensionChargeBreakdown } from "@/components/extension/ExtensionChargeBreakdown";
import { ExtensionFreeKmLine } from "@/components/extension/ExtensionFreeKmLine";
import { BranchHoursBadge } from "@/components/booking/BranchHoursBadge";
import {
  buildScheduleUserMessage,
  isClosedCalendarDay,
  isReturnSlotAllowed,
  validateReturnTime,
} from "@/utils/branchScheduleValidator";
import { istCalendarParts, istInstant } from "@/utils/bookingPickers";

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
   * "standalone" (default): commits with collectNow and shows Step 3 payment
   *   collection in the modal (also used for rentals already out, from the drop page).
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

const EXT_MINUTES = ["00", "15", "30", "45"];

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
  const [selectedVehiclePublicId, setSelectedVehiclePublicId] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<unknown>(null);

  // Step 3 state
  const [committedExtension, setCommittedExtension] = useState<CommitExtensionResult | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [collected, setCollected] = useState(false);
  // Cash / UPI (photo) / Split / Credit (#12)
  const [payment, setPayment] = useState<CounterPaymentValue>(() => emptyCounterPayment());
  const [collectError, setCollectError] = useState<unknown>(null);

  const idempotencyKey = useRef(crypto.randomUUID());

  // Managers aren't shift-gated; staff need an open cash shift to collect cash / UPI / split.
  // A SHIFT_REQUIRED error stops blocking as soon as a shift is open (here or via
  // the shift banner); the store is re-read on that error so a stale shift can't hide it.
  const { activeShift, needsShift } = useActiveShift();
  const blockedByShift = (err: unknown) => counterErrorCode(err) === "SHIFT_REQUIRED" && !activeShift;
  const collectErrorCode = counterErrorCode(collectError);
  // Credit takes no money, so only cash / UPI / split need the open shift (#11)
  const shiftRequired =
    role === "employee" &&
    counterMethodTakesMoney(payment.method) &&
    (needsShift || blockedByShift(collectError));
  // The commit takes no money — the method is chosen in Step 3, where cash / UPI /
  // split need the shift and Credit doesn't (#11). Only a server that still refuses
  // the commit for a closed shift blocks here.
  const commitShiftRequired =
    role === "employee" && mode === "standalone" && blockedByShift(commitError);
  // Photo / collateral / split problems the server reported are shown at their field
  const collectFieldErrors = counterFieldErrors(collectError);
  const collectGeneralError =
    !!collectError && !counterPaymentErrorField(collectError) && collectErrorCode !== "SHIFT_REQUIRED";
  const collectAmount = committedExtension ? parseFloat(committedExtension.remainAmount.extension) || 0 : 0;
  const collectProblem = counterPaymentProblem(payment, collectAmount);

  // 15-day cap (#15) and office hours (#2) for the new end
  const { data: eligibility } = useQuery({
    queryKey: ["staff-extension-eligibility", role, bookingPublicId],
    queryFn: () =>
      role === "manager"
        ? extensionService.managerCheckEligibility(bookingPublicId)
        : extensionService.employeeCheckEligibility(bookingPublicId),
    enabled: open && !!bookingPublicId,
    staleTime: 30_000,
    retry: false,
  });
  const officeHours = eligibility?.officeHours;
  const maxEndAt = eligibility?.maxEndAt ? new Date(eligibility.maxEndAt) : null;
  const maxEndDay = maxEndAt ? istCalendarParts(maxEndAt).day : null;
  const capReached = eligibility?.eligible === false;
  const currentEndDay = istCalendarParts(new Date(currentEndAt)).day;

  const newEndAt = newDate ? istInstant(newDate, `${newHour}:${newMinute}`) : null;
  const windowMessage = (() => {
    if (!newEndAt || !eligibility?.bookingStartAt) return null;
    const res = validateExtensionWindow({
      bookingStartAt: eligibility.bookingStartAt,
      newEndAt,
      monthly: !!eligibility.isMonthly,
    });
    return res.ok ? null : res.message;
  })();
  const hoursVerdict = newEndAt && officeHours ? validateReturnTime(officeHours, newEndAt) : null;
  const hoursMessage =
    hoursVerdict?.status === "RETURN_OUTSIDE_HOURS" ? buildScheduleUserMessage(hoursVerdict) : null;

  // Return slots the branch accepts on the picked day, up to the cap
  const slotDisabled = (h: number, m: number) => {
    if (!newDate) return false;
    if (!isReturnSlotAllowed(officeHours, newDate, h * 60 + m)) return true;
    return !!maxEndAt && istInstant(newDate, `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`) > maxEndAt;
  };
  const hourDisabled = (h: number) => EXT_MINUTES.every((m) => slotDisabled(h, Number(m)));

  // A new day can have different hours — move the time into them
  useEffect(() => {
    if (!newDate || !slotDisabled(Number(newHour), Number(newMinute))) return;
    for (let h = 0; h < 24; h++) {
      const m = EXT_MINUTES.find((mm) => !slotDisabled(h, Number(mm)));
      if (m !== undefined) {
        setNewHour(String(h).padStart(2, "0"));
        setNewMinute(m);
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newDate?.getTime(), officeHours, eligibility?.maxEndAt]);

  // "+12 hours" / "+1 day" from the current end, when the branch accepts that return
  const quickOptions = [12, 24].map((hours) => {
    const target = new Date(new Date(currentEndAt).getTime() + hours * 3_600_000);
    const parts = istCalendarParts(target);
    const [h, m] = parts.time.split(":").map(Number);
    // Round up to the 15-minute steps the selects offer
    const total = Math.min(Math.ceil((h * 60 + m) / 15) * 15, 23 * 60 + 45);
    const hour = String(Math.floor(total / 60)).padStart(2, "0");
    const minute = String(total % 60).padStart(2, "0");
    const at = istInstant(parts.day, `${hour}:${minute}`);
    const verdict = officeHours ? validateReturnTime(officeHours, at) : null;
    const blocked = (!!maxEndAt && at > maxEndAt) || verdict?.status === "RETURN_OUTSIDE_HOURS";
    return { hours, day: parts.day, hour, minute, at, blocked };
  });

  const reset = useCallback(() => {
    setStep(1);
    setNewDate(undefined);
    setNewHour("18");
    setNewMinute("00");
    setNotes("");
    setEvaluation(null);
    setSelectedResolution(null);
    setSelectedVehiclePublicId("");
    setCommitting(false);
    setCommitError(null);
    setCommittedExtension(null);
    setCollecting(false);
    setCollected(false);
    setPayment(emptyCounterPayment());
    setCollectError(null);
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
    // The picked day + time is IST wall clock, whatever the browser's timezone
    const isoDate = istInstant(newDate, `${newHour}:${newMinute}`);
    const currentEnd = new Date(currentEndAt);
    if (isoDate <= currentEnd) {
      toast.error("New end time must be after the current end time.");
      return;
    }
    // Same checks as the server (15-day limit, office hours) — clearer up front
    if (capReached) {
      toast.error(eligibility?.reason ?? "This booking can't be extended any further.");
      return;
    }
    if (windowMessage || hoursMessage) {
      toast.error((windowMessage ?? hoursMessage)!);
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
        setSelectedVehiclePublicId(swapOpt.availableVehicles[0].publicId);
      }
      setStep(2);
    } catch (err) {
      // DL_IN_USE (X3) adds the booking holding this driving licence
      toast.error(apiErrorMessage(err, "Failed to evaluate extension."), dlInUseToastOptions(err));
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
    if (selectedResolution === "SWAP_CURRENT_TO_OTHER" && !selectedVehiclePublicId) {
      toast.error("Please select an alternative vehicle.");
      return;
    }

    const opt = evaluation?.resolutionOptions.find((o) => o.type === selectedResolution);
    const fn = role === "manager" ? extensionService.managerCommit : extensionService.employeeCommit;

    setCommitting(true);
    setCommitError(null);
    try {
      const res = await fn({
        extensionPublicId: evaluation!.extensionPublicId,
        resolutionType: selectedResolution,
        selectedVehiclePublicId:
          selectedResolution === "SWAP_CURRENT_TO_OTHER" ? selectedVehiclePublicId : undefined,
        affectedBookingSwaps:
          selectedResolution === "SWAP_FUTURE_BOOKING" && opt?.affectedBookings
            ? opt.affectedBookings.map((ab) => ({
                bookingPublicId: ab.bookingPublicId,
                newVehiclePublicId: ab.newVehicle.publicId,
              }))
            : undefined,
        partialNewEndAt: selectedResolution === "PARTIAL_EXTENSION" ? opt?.partialNewEndAt : undefined,
        idempotencyKey: idempotencyKey.current,
        // Standalone collects in Step 3 — never defer the charge to a pickup session.
        collectNow: mode === "standalone" ? true : undefined,
      });

      // In pickup-session mode, if the backend confirms deferred payment,
      // skip Step 3 — the charge will be bundled into the pickup session.
      if (mode === "pickup-session" && (res.data as CommitExtensionResult).usePaymentSession) {
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
    } catch (err) {
      setCommitError(err);
      // No open shift is shown inline in Step 2.
      if (counterErrorCode(err) === "SHIFT_REQUIRED") void refreshActiveShift();
      else toast.error(apiErrorMessage(err, "Failed to commit extension."), dlInUseToastOptions(err));
    } finally {
      setCommitting(false);
    }
  };

  // ── Step 3: Collect payment ───────────────────────────────────────────────

  const handleCollect = async () => {
    if (!committedExtension) return;
    if (collectAmount > 0 && collectProblem) return;
    setCollecting(true);
    setCollectError(null);
    try {
      const result = await extensionService.employeeCollect(
        committedExtension.publicId,
        extensionCollectFields(payment, collectAmount),
      );
      setCollected(true);
      if (result.data.credit) {
        toast.success(
          `Extension confirmed — ₹${result.data.credit.amount} on credit (collateral: ${result.data.credit.collateral}).`,
        );
      } else if (result.data.payment === "confirmed") {
        toast.success("Extension confirmed and booking updated.");
      } else {
        // Cash, UPI and split wait for the branch manager's confirmation (#12)
        toast.success("Payment collected — awaiting manager confirmation.");
      }
      onSuccess();
      reset();
      onClose();
    } catch (err) {
      setCollectError(err);
      // Shift, photo, split and collateral problems are shown inline in Step 3.
      const code = counterErrorCode(err);
      if (code === "SHIFT_REQUIRED") void refreshActiveShift();
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
                      disabled={(d) =>
                        d < currentEndDay ||
                        (!!maxEndDay && d > maxEndDay) ||
                        isClosedCalendarDay(officeHours, d)
                      }
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <BranchHoursBadge schedule={officeHours} date={newDate ?? null} kind="return" />
              </div>

              {/* Time pickers (only times the branch accepts returns) */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="newHour">Hour</Label>
                  <Select
                    value={newHour}
                    onValueChange={(h) => {
                      setNewHour(h);
                      // Keep the minute when it's allowed in the new hour
                      if (slotDisabled(Number(h), Number(newMinute))) {
                        const m = EXT_MINUTES.find((mm) => !slotDisabled(Number(h), Number(mm)));
                        if (m) setNewMinute(m);
                      }
                    }}
                  >
                    <SelectTrigger id="newHour" className="h-12">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map((h) => (
                        <SelectItem key={h} value={h} disabled={hourDisabled(Number(h))}>{h}:00</SelectItem>
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
                      {EXT_MINUTES.map((m) => (
                        <SelectItem key={m} value={m} disabled={slotDisabled(Number(newHour), Number(m))}>
                          :{m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Quick picks from the current end */}
              <div className="flex flex-wrap gap-2">
                {quickOptions.map((opt) => (
                  <button
                    key={opt.hours}
                    type="button"
                    disabled={opt.blocked}
                    onClick={() => {
                      setNewDate(opt.day);
                      setNewHour(opt.hour);
                      setNewMinute(opt.minute);
                    }}
                    className={cn(
                      "h-8 px-3 rounded-full border text-xs font-semibold transition-colors",
                      newEndAt && newEndAt.getTime() === opt.at.getTime()
                        ? "bg-orange-500 border-orange-500 text-white"
                        : "bg-white border-neutral-200 text-neutral-700 hover:border-neutral-400",
                      "disabled:opacity-45 disabled:cursor-not-allowed",
                    )}
                  >
                    +{opt.hours === 12 ? "12 hours" : "1 day"}
                  </button>
                ))}
              </div>

              {/* Cap / office-hours feedback (the server refuses the same cases) */}
              {capReached && eligibility?.reason ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  {eligibility.reason}
                </p>
              ) : (
                <>
                  {windowMessage && <p className="text-xs text-red-600">{windowMessage}</p>}
                  {!windowMessage && hoursMessage && <p className="text-xs text-red-600">{hoursMessage}</p>}
                  {hoursVerdict?.status === "RETURN_GRACE" && (
                    <p className="text-xs text-amber-700">
                      Branch closes at {hoursVerdict.closingTime}; returns are accepted until{" "}
                      {hoursVerdict.gracePeriodEnd}.
                    </p>
                  )}
                  {maxEndAt && !windowMessage && (
                    <p className="text-xs text-neutral-500">
                      Can be extended up to {fmt(maxEndAt.toISOString())}
                      {eligibility?.maxBookingDays ? ` (${eligibility.maxBookingDays}-day limit)` : ""}.
                    </p>
                  )}
                </>
              )}

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
                  disabled={evaluating || !newDate || capReached || !!windowMessage || !!hoursMessage}
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
                {formatExtensionHours(evaluation.pricing.extensionHours) ? (
                  <div className="flex justify-between text-neutral-600">
                    <span>Extra time</span>
                    <span>
                      {formatRentalHours(evaluation.pricing.originalHours) && (
                        <span className="text-neutral-500 mr-1">
                          {formatRentalHours(evaluation.pricing.originalHours)} →
                        </span>
                      )}
                      <span className="font-medium text-orange-600">
                        {formatExtensionHours(evaluation.pricing.extensionHours)}
                      </span>
                    </span>
                  </div>
                ) : (
                  <div className="flex justify-between text-neutral-600">
                    <span>Duration</span>
                    <span>
                      {evaluation.pricing.originalDays} day{evaluation.pricing.originalDays !== 1 ? "s" : ""}{" "}
                      → {evaluation.pricing.newDays} day{evaluation.pricing.newDays !== 1 ? "s" : ""}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-neutral-600">
                  <span>New end date</span>
                  <span className="font-medium">{fmt(evaluation.requestedEndAt)}</span>
                </div>
                <ExtensionFreeKmLine freeKm={evaluation.pricing.extensionFreeKm} />
                <ExtensionChargeBreakdown
                  split={evaluation.pricing}
                  total={evaluation.pricing.additionalAmount}
                  totalLabel="Additional due"
                  className="pt-2 border-t border-neutral-200"
                />
                {selectedResolution === "PARTIAL_EXTENSION" && (
                  <p className="text-xs text-neutral-500">
                    A partial extension is re-priced for the shorter period when you confirm.
                  </p>
                )}
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
                          setSelectedVehiclePublicId("");
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
                                </span>{" "}
                                (incl. GST)
                              </p>
                            )}
                            {opt.type === "PARTIAL_EXTENSION" && opt.partialNewEndAt && (
                              <p className="text-xs text-neutral-500 mt-0.5">
                                Until: {fmt(opt.partialNewEndAt)}
                              </p>
                            )}
                            {opt.type === "PARTIAL_EXTENSION" && opt.extensionFreeKm && (
                              <p className="text-xs text-neutral-500 mt-0.5">
                                Free km for this time:{" "}
                                {opt.extensionFreeKm.km > 0
                                  ? `+${opt.extensionFreeKm.km.toLocaleString("en-IN")} km`
                                  : "none"}
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
                          <ExtensionVehiclePicker
                            vehicles={opt.availableVehicles}
                            value={selectedVehiclePublicId}
                            onChange={setSelectedVehiclePublicId}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {commitShiftRequired && <ShiftRequiredNotice onShiftOpened={() => setCommitError(null)} />}

              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                  ← Back
                </Button>
                <Button
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                  onClick={handleProceed}
                  disabled={
                    committing ||
                    commitShiftRequired ||
                    !selectedResolution ||
                    selectedResolution === "NO_RESOLUTION"
                  }
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
                {committedExtension.taxableAmount != null && committedExtension.taxAmount != null && (
                  <p className="text-xs text-neutral-500">
                    {/* Extension rent is GST-inclusive (item 17): GST is inside the amount */}
                    Rent without GST {formatInrExact(committedExtension.taxableAmount)} + GST{" "}
                    {formatInrExact(committedExtension.taxAmount)}
                    {committedExtension.taxRate ? ` (${Number(committedExtension.taxRate)}%)` : ""} included
                    {" · "}
                    {gstSplitText(committedExtension.cgstAmount, committedExtension.sgstAmount)}
                  </p>
                )}
                <ExtensionFreeKmLine freeKm={committedExtension.extensionFreeKm} className="pt-1" />
                <p className="text-xs text-neutral-400">
                  Vehicle is on hold until payment is collected or this window is closed.
                </p>
              </div>

              {/* Cash / UPI (photo) / Split / Credit (#12) — a ₹0 extension takes no payment */}
              {collectAmount > 0 && (
                <CounterPaymentFields
                  idPrefix="ext-collect"
                  label="Collected by"
                  value={payment}
                  onChange={setPayment}
                  amount={collectAmount}
                  proofRole="staff"
                  errors={collectFieldErrors}
                  onEdit={() => {
                    if (collectError) setCollectError(null);
                  }}
                  disabled={collecting}
                  cashNote={
                    <p className="text-xs text-neutral-500">
                      Cash, UPI and split payments wait for the branch manager's confirmation; the vehicle is held until the new return time. If the payment is rejected, the booking goes back to its original return time.
                    </p>
                  }
                />
              )}

              {shiftRequired && <ShiftRequiredNotice onShiftOpened={() => setCollectError(null)} />}
              {collectGeneralError && (
                <p className="text-sm text-destructive">{apiErrorMessage(collectError, "Failed to collect payment.")}</p>
              )}

              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={handleClose} disabled={collecting}>
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                  onClick={handleCollect}
                  disabled={collecting || shiftRequired || (collectAmount > 0 && !!collectProblem)}
                >
                  {collecting
                    ? "Processing…"
                    : collectAmount <= 0
                      ? "Confirm Extension"
                      : payment.method === "CREDIT"
                        ? "Confirm on Credit"
                        : "Mark as Collected"}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

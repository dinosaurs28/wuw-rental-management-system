import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import { validateExtensionWindow } from "@repo/schemas";
import { toast } from "sonner";
import { Calendar, Clock, Loader2, ArrowRight, Check, AlertCircle, Info, CreditCard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Calendar as CalendarPicker,
} from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TimeSelect } from "@/components/ui/TimeSelect";
import { cn } from "@/lib/utils";
import {
  extensionService,
  type ExtensionEvaluation,
} from "@/services/extension.service";
import { useRazorpayCheckout } from "@/hooks/useRazorpayCheckout";
import { useAuthStore } from "@/store/auth.store";
import { apiErrorMessage } from "@/lib/counterErrors";
import { formatExtensionHours, formatInrExact } from "@/lib/gst";
import { ExtensionChargeBreakdown } from "@/components/extension/ExtensionChargeBreakdown";
import { BranchHoursBadge } from "@/components/booking/BranchHoursBadge";
import {
  buildScheduleUserMessage,
  isClosedCalendarDay,
  isReturnSlotAllowed,
  validateReturnTime,
} from "@/utils/branchScheduleValidator";

type Step ="date" | "result" | "pay" | "paying" | "failed";

interface CustomerExtensionModalProps {
  open: boolean;
  bookingPublicId: string;
  currentEndAt: string;
  onClose: () => void;
  onSuccess?: () => void;
}

// Bookings run on IST, so the picked day + time is read as IST whatever the
// browser's timezone.
const IST_OFFSET_MS = 330 * 60_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** Calendar day (local midnight, for the date picker) and "HH:mm" of an instant, in IST. */
function istParts(iso: string) {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  return {
    day: new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

/** A picked calendar day + "HH:mm" (IST) → ISO instant. */
function istToIso(day: Date, time: string) {
  const [h, m] = time.split(":").map(Number);
  return new Date(
    Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), h, m) - IST_OFFSET_MS,
  ).toISOString();
}

/** Rounds "HH:mm" up to the 15-minute steps TimeSelect offers (capped at 23:45). */
function roundUpToQuarter(time: string) {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(Math.ceil((h * 60 + m) / 15) * 15, 23 * 60 + 45);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** "5 hours", "1 day", "2 days 3 hours". */
function formatExtraTime(fromIso: string, toIso: string) {
  const hours = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 3_600_000);
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  const parts = [];
  if (days) parts.push(`${days} day${days !== 1 ? "s" : ""}`);
  if (rest || !days) parts.push(`${rest} hour${rest !== 1 ? "s" : ""}`);
  return parts.join(" ");
}

// Paise are shown when present: the charge includes GST rounded to the paisa.
function formatCurrency(amount: string | number) {
  return formatInrExact(amount);
}

export function CustomerExtensionModal({
  open,
  bookingPublicId,
  currentEndAt,
  onClose,
  onSuccess,
}: CustomerExtensionModalProps) {
  const { openCheckout } = useRazorpayCheckout();
  const user = useAuthStore((state) => state.user);
  // Set once the extension is paid for, so closing does not cancel it.
  const paidRef = useRef(false);
  const [step, setStep] = useState<Step>("date");
  const currentEnd = istParts(currentEndAt);
  // Defaults to the same time one day later; any time after the current
  // return can be picked, including later the same day.
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => addDays(currentEnd.day, 1));
  const [selectedTime, setSelectedTime] = useState(() => roundUpToQuarter(currentEnd.time));
  const [calOpen, setCalOpen] = useState(false);
  const [evaluation, setEvaluation] = useState<ExtensionEvaluation | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isInitiating, setIsInitiating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  const newEndAt = selectedDate ? istToIso(selectedDate, selectedTime) : null;
  const isAfterCurrentEnd = !!newEndAt && new Date(newEndAt) > new Date(currentEndAt);

  // 15-day cap (#15) and office hours (#2) — same query as the booking card's Extend button
  const { data: eligibility } = useQuery({
    queryKey: ["extension-eligibility", bookingPublicId],
    queryFn: () => extensionService.customerCheckEligibility(bookingPublicId),
    enabled: open,
    staleTime: 60_000,
  });
  const officeHours = eligibility?.officeHours;
  const maxEndAt = eligibility?.maxEndAt ?? null;
  const maxEndDay = maxEndAt ? istParts(maxEndAt).day : null;
  const capReached = eligibility?.eligible === false && !!eligibility.atCap;

  // Keep the default (current end + 1 day) inside the cap and off closed days
  // once the limits are known
  useEffect(() => {
    if (!selectedDate) return;
    let day = selectedDate;
    if (maxEndDay && day > maxEndDay && maxEndDay >= currentEnd.day) day = maxEndDay;
    for (let i = 0; i < 7 && isClosedCalendarDay(officeHours, day); i++) {
      const next = addDays(day, 1);
      if (maxEndDay && next > maxEndDay) break;
      day = next;
    }
    if (day.getTime() !== selectedDate.getTime()) setSelectedDate(day);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxEndAt, officeHours]);

  // Message for a new end past the cap (server wording)
  const windowMessage = (() => {
    if (!newEndAt || !maxEndAt) return null;
    if (eligibility?.bookingStartAt) {
      const res = validateExtensionWindow({
        bookingStartAt: eligibility.bookingStartAt,
        newEndAt,
        monthly: !!eligibility.isMonthly,
      });
      return res.ok ? null : res.message;
    }
    return new Date(newEndAt) > new Date(maxEndAt)
      ? `This booking can be extended up to ${format(new Date(maxEndAt), "dd MMM yyyy, h:mm a")}.`
      : null;
  })();

  // The new return must be inside office hours (grace included)
  const hoursVerdict = newEndAt && officeHours ? validateReturnTime(officeHours, new Date(newEndAt)) : null;
  const hoursMessage =
    hoursVerdict?.status === "RETURN_OUTSIDE_HOURS" ? buildScheduleUserMessage(hoursVerdict) : null;

  const isReturnSlotDisabled = selectedDate
    ? (hour: number, minute: number) => {
        if (!isReturnSlotAllowed(officeHours, selectedDate, hour * 60 + minute)) return true;
        return !!maxEndAt && istToIso(selectedDate, `${pad(hour)}:${pad(minute)}`) > maxEndAt;
      }
    : undefined;

  // "+12 hours" / "+1 day" from the current return, when allowed
  const quickOptions = [12, 24].map((hours) => {
    const iso = new Date(new Date(currentEndAt).getTime() + hours * 3_600_000).toISOString();
    const parts = istParts(iso);
    const time = roundUpToQuarter(parts.time);
    const target = istToIso(parts.day, time);
    const verdict = officeHours ? validateReturnTime(officeHours, new Date(target)) : null;
    const blocked =
      (!!maxEndAt && target > maxEndAt) || verdict?.status === "RETURN_OUTSIDE_HOURS";
    return { hours, day: parts.day, time, target, blocked };
  });

  async function cancelPendingExtension(pubId: string) {
    try {
      await extensionService.customerCancelExtension(pubId);
    } catch {
      // best-effort — ignore errors (e.g. already cancelled)
    }
  }

  async function handleClose() {
    // If we evaluated but never paid, cancel the pending extension so the
    // booking is unlocked and the customer can try again later.
    if (evaluation && !paidRef.current) {
      await cancelPendingExtension(evaluation.extensionPublicId);
    }
    setStep("date");
    setSelectedDate(addDays(currentEnd.day, 1));
    setSelectedTime(roundUpToQuarter(currentEnd.time));
    setEvaluation(null);
    setEvalError(null);
    setInitError(null);
    setPayError(null);
    paidRef.current = false;
    onClose();
  }

  async function handleEvaluate() {
    if (!newEndAt || !isAfterCurrentEnd || windowMessage || hoursMessage || capReached) return;
    setIsEvaluating(true);
    setEvalError(null);
    try {
      const res = await extensionService.customerEvaluate(bookingPublicId, newEndAt);
      setEvaluation(res.data);
      setInitError(null);
      setStep("result");
    } catch (err) {
      // Includes 409 EXTENSION_PENDING (another extension is still open).
      setEvalError(apiErrorMessage(err, "Failed to check availability. Please try again."));
    } finally {
      setIsEvaluating(false);
    }
  }

  /**
   * Fallback poll for the extension. `/payment/verify` resolves extensions by
   * order id and confirms them itself, so this only runs when the handler never
   * fired or verification failed — the webhook may still have landed.
   *
   * FAILED is terminal and comes only from a settled gateway failure; an
   * unreachable gateway reports PENDING, so an unknown result keeps polling
   * rather than telling the customer their payment failed.
   */
  async function confirmExtension(transactionId: string) {
    const res = await extensionService.verifyExtensionPayment(transactionId);
    const status =
      res.status === "CONFIRMED"
        ? ("Success" as const)
        : res.status === "FAILED"
          ? ("Failed" as const)
          : ("Pending" as const);
    return { status, message: res.message };
  }

  async function handleInitiatePayment() {
    if (!evaluation) return;
    setIsInitiating(true);
    setInitError(null);
    try {
      const res = await extensionService.customerInitiatePayment(
        evaluation.extensionPublicId,
      );
      // Nothing to pay — the backend confirmed the extension outright.
      if (res.data?.extensionStatus === "CONFIRMED") {
        paidRef.current = true;
        setIsInitiating(false);
        toast.success("Booking extended successfully!");
        onSuccess?.();
        void handleClose();
        return;
      }
      const { razorpay, transactionId } = res.data ?? {};
      if (!razorpay || !transactionId) {
        toast.error("Could not initiate payment — no payment order received");
        setIsInitiating(false);
        return;
      }

      setStep("paying");
      await openCheckout({
        razorpay,
        transactionId,
        description: "Booking extension",
        prefill: { name: user?.name, email: user?.email },
        pollStatus: () => confirmExtension(transactionId),
        onSuccess: () => {
          paidRef.current = true;
          setIsInitiating(false);
          toast.success("Booking extended successfully!");
          onSuccess?.();
          void handleClose();
        },
        onPending: (message) => {
          paidRef.current = true;
          setIsInitiating(false);
          toast.info(
            message ?? "Payment received — your extension is being confirmed.",
          );
          onSuccess?.();
          void handleClose();
        },
        onFailure: (message) => {
          setIsInitiating(false);
          // Shown as its own step rather than a toast: a refusal can carry a
          // refund notice, which the customer should be able to read and keep
          // on screen instead of watching it disappear.
          setPayError(message);
          setStep("failed");
        },
        onDismiss: () => {
          setIsInitiating(false);
          setStep("result");
          toast.info("Payment cancelled. Your extension was not confirmed.");
        },
      });
    } catch (err) {
      // e.g. 409 — the vehicle is no longer free for the new dates. Kept on screen.
      setInitError(apiErrorMessage(err, "Failed to initiate payment"));
      setIsInitiating(false);
      setStep("result");
    }
  }

  // Determine what to show the customer (hide internal conflict details)
  const resultView = (() => {
    if (!evaluation) return null;
    const opts = evaluation.resolutionOptions;
    const hasFullAvail = opts.some(
      (o) => o.type === "SAME_VEHICLE" || o.type === "SWAP_CURRENT_TO_OTHER",
    );
    const partial = opts.find((o) => o.type === "PARTIAL_EXTENSION");
    if (hasFullAvail) return { type: "available" as const };
    if (partial) return { type: "partial" as const, partialNewEndAt: partial.partialNewEndAt };
    return { type: "none" as const };
  })();

  const additionalAmount = evaluation?.pricing.additionalAmount ?? "0";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            Extend Your Booking
          </DialogTitle>
        </DialogHeader>

        {/* ── Step 1: Pick a date ── */}
        {step === "date" && (
          <div className="space-y-5 pt-2">
            <div className="flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5 text-sm text-gray-600">
              <Calendar className="h-4 w-4 text-gray-400 shrink-0" />
              <span>
                Current return:{" "}
                <span className="font-semibold text-gray-800">
                  {format(new Date(currentEndAt), "dd MMM yyyy, h:mm a")}
                </span>
              </span>
            </div>

            <div className="space-y-1.5">
              <Label>New return date &amp; time</Label>
              <div className="flex gap-2">
                <Popover open={calOpen} onOpenChange={setCalOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "flex-1 justify-start text-left font-normal",
                        !selectedDate && "text-muted-foreground",
                      )}
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      {selectedDate ? format(selectedDate, "dd MMM yyyy") : "Select a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarPicker
                      mode="single"
                      selected={selectedDate}
                      onSelect={(d) => { setSelectedDate(d); setCalOpen(false); }}
                      disabled={(d) =>
                        d < currentEnd.day ||
                        (!!maxEndDay && d > maxEndDay) ||
                        isClosedCalendarDay(officeHours, d)
                      }
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <div className="flex items-center gap-1.5 rounded-md border border-input px-3">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <TimeSelect value={selectedTime} onChange={setSelectedTime} isDisabled={isReturnSlotDisabled} />
                </div>
              </div>
              <BranchHoursBadge schedule={officeHours} date={selectedDate ?? null} kind="return" />

              {/* Quick picks from the current return */}
              <div className="flex flex-wrap gap-2 pt-1">
                {quickOptions.map((opt) => (
                  <button
                    key={opt.hours}
                    type="button"
                    disabled={opt.blocked}
                    onClick={() => {
                      setSelectedDate(opt.day);
                      setSelectedTime(opt.time);
                    }}
                    className={cn(
                      "h-8 px-3 rounded-full border text-xs font-semibold transition-colors",
                      newEndAt === opt.target
                        ? "bg-orange-500 border-orange-500 text-white"
                        : "bg-white border-gray-200 text-gray-700 hover:border-gray-400",
                      "disabled:opacity-45 disabled:cursor-not-allowed",
                    )}
                  >
                    +{opt.hours === 12 ? "12 hours" : "1 day"}
                  </button>
                ))}
              </div>

              {newEndAt && !isAfterCurrentEnd && (
                <p className="text-xs text-red-600">Pick a time after the current return time.</p>
              )}
              {isAfterCurrentEnd && windowMessage && (
                <p className="text-xs text-red-600">{windowMessage}</p>
              )}
              {isAfterCurrentEnd && !windowMessage && hoursMessage && (
                <p className="text-xs text-red-600">{hoursMessage}</p>
              )}
              {isAfterCurrentEnd && hoursVerdict?.status === "RETURN_GRACE" && (
                <p className="text-xs text-amber-700">
                  Branch closes at {hoursVerdict.closingTime}; returns are accepted until{" "}
                  {hoursVerdict.gracePeriodEnd}.
                </p>
              )}
              {maxEndAt && !windowMessage && (
                <p className="text-xs text-gray-500">
                  Can be extended up to {format(new Date(maxEndAt), "dd MMM yyyy, h:mm a")}
                  {eligibility?.maxBookingDays ? ` (${eligibility.maxBookingDays}-day limit)` : ""}.
                </p>
              )}
            </div>

            {capReached && eligibility?.reason && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm text-amber-800">
                <Info className="h-4 w-4 shrink-0" />
                {eligibility.reason}
              </div>
            )}

            {evalError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {evalError}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                onClick={handleEvaluate}
                disabled={
                  !isAfterCurrentEnd || isEvaluating || !!windowMessage || !!hoursMessage || capReached
                }
              >
                {isEvaluating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>Check <ArrowRight className="ml-2 h-4 w-4" /></>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Result ── */}
        {step === "result" && resultView && evaluation && (
          <div className="space-y-5 pt-2">
            {resultView.type === "available" && (
              <div className="rounded-lg bg-green-50 border border-green-200 p-4">
                <div className="flex items-center gap-2 text-green-800 font-semibold mb-1 text-sm">
                  <Check className="h-4 w-4" />
                  Extension available
                </div>
                <p className="text-xs text-green-700">
                  Extension available for the full duration.
                </p>
              </div>
            )}

            {resultView.type === "partial" && (
              <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4">
                <div className="flex items-center gap-2 text-yellow-800 font-semibold mb-1 text-sm">
                  <Info className="h-4 w-4" />
                  Partial extension only
                </div>
                <p className="text-xs text-yellow-700">
                  Full extension not available. We can extend until{" "}
                  <span className="font-semibold">
                    {resultView.partialNewEndAt
                      ? format(new Date(resultView.partialNewEndAt), "dd MMM yyyy, h:mm a")
                      : "a limited date"}
                  </span>
                  .
                </p>
              </div>
            )}

            {resultView.type === "none" && (
              <>
                <div className="rounded-lg bg-red-50 border border-red-200 p-4">
                  <div className="flex items-center gap-2 text-red-800 font-semibold mb-1 text-sm">
                    <AlertCircle className="h-4 w-4" />
                    No extension available
                  </div>
                  <p className="text-xs text-red-700">
                    Sorry, no extension is available for the requested dates.
                    Please contact the branch for assistance.
                  </p>
                </div>
                <Button variant="outline" className="w-full" onClick={handleClose}>
                  Close
                </Button>
              </>
            )}

            {resultView.type !== "none" && (
              <>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">New return</span>
                    <span className="font-medium">
                      {format(new Date(evaluation.requestedEndAt), "dd MMM yyyy, h:mm a")}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Extra time</span>
                    <span className="font-medium text-orange-500">
                      {formatExtensionHours(evaluation.pricing.extensionHours) ??
                        `+${formatExtraTime(currentEndAt, evaluation.requestedEndAt)}`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Original total</span>
                    <span className="font-medium">{formatCurrency(evaluation.pricing.originalTotalFinal)}</span>
                  </div>
                  <ExtensionChargeBreakdown
                    split={evaluation.pricing}
                    total={additionalAmount}
                    totalLabel="Total payable"
                    className="border-t border-gray-200 pt-2 mt-1"
                    totalClassName="font-bold text-base"
                  />
                </div>

                {initError && (
                  <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {initError}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={async () => {
                      if (evaluation) await cancelPendingExtension(evaluation.extensionPublicId);
                      setEvaluation(null);
                      setInitError(null);
                      setStep("date");
                    }}
                  >
                    ← Back
                  </Button>
                  <Button
                    className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                    onClick={handleInitiatePayment}
                    disabled={isInitiating}
                  >
                    {isInitiating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : parseFloat(additionalAmount) > 0 ? (
                      <>Pay {formatCurrency(additionalAmount)} <CreditCard className="ml-2 h-4 w-4" /></>
                    ) : (
                      <>Confirm Extension <Check className="ml-2 h-4 w-4" /></>
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Payment failed ── */}
        {step === "failed" && (
          <div className="space-y-5 py-4">
            <div className="rounded-lg bg-red-50 border border-red-200 p-4">
              <div className="flex items-center gap-2 text-red-800 font-semibold mb-1 text-sm">
                <AlertCircle className="h-4 w-4" />
                Payment not completed
              </div>
              <p className="text-xs text-red-700">
                {payError ?? "Your extension could not be confirmed."}
              </p>
            </div>
            <Button variant="outline" className="w-full" onClick={handleClose}>
              Close
            </Button>
          </div>
        )}

        {/* ── Payment in progress ── */}
        {step === "paying" && (
          <div className="py-12 text-center space-y-4">
            <Loader2 className="h-10 w-10 animate-spin text-orange-500 mx-auto" />
            <p className="font-semibold text-gray-900">Awaiting payment…</p>
            <p className="text-sm text-muted-foreground">
              Please complete your payment in the secure payment window.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

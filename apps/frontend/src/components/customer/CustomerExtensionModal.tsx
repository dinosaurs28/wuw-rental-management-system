import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { extensionPackageOptions, validateExtensionWindow } from "@repo/schemas";
import { toast } from "sonner";
import { Calendar, Loader2, ArrowRight, Check, AlertCircle, Info, CreditCard, QrCode } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  extensionService,
  type ExtensionEvaluation,
} from "@/services/extension.service";
import { useRazorpayCheckout } from "@/hooks/useRazorpayCheckout";
import { useUpiQrAvailability, useUpiQrPayment } from "@/hooks/useUpiQrPayment";
import { UpiQrPanel } from "@/components/payment/UpiQrPanel";
import { apiErrorCode, UPI_QR_ALREADY_PAID } from "@/services/upiQr.service";
import { useAuthStore } from "@/store/auth.store";
import { apiErrorMessage } from "@/lib/counterErrors";
import { formatExtensionHours, formatInrExact } from "@/lib/gst";
import { ExtensionChargeBreakdown } from "@/components/extension/ExtensionChargeBreakdown";
import { ExtensionFreeKmLine } from "@/components/extension/ExtensionFreeKmLine";
import { formatPackageReturn } from "@/components/booking/PackagePicker";
import {
  buildScheduleUserMessage,
  validateReturnTime,
} from "@/utils/branchScheduleValidator";
import { packageReturnProblem } from "@/utils/bookingPackages";

// "qr": paying by scanning a UPI QR from another phone (#2)
type Step ="date" | "result" | "pay" | "paying" | "failed" | "qr";

interface CustomerExtensionModalProps {
  open: boolean;
  bookingPublicId: string;
  currentEndAt: string;
  onClose: () => void;
  onSuccess?: () => void;
}

/** A customer extension length: +12 hours or + N days (P3), with its new return. */
interface ExtensionChoice {
  hours: number;
  label: string;
  /** ISO. */
  newEndAt: string;
  /** Outside the branch's return hours (or past the limit) — shown greyed with this. */
  disabledReason: string | null;
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
  // Customers extend by +12 hours or whole days only (P3) — the new return is
  // the current return + that length. null = the default (+1 day) once loaded.
  const [selectedHours, setSelectedHours] = useState<number | null>(null);
  const [evaluation, setEvaluation] = useState<ExtensionEvaluation | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isInitiating, setIsInitiating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  // Pay by scanning a UPI QR from another phone (#2): pays the extension's own
  // Razorpay order, so it is never a second charge
  const upiQrAvailable = useUpiQrAvailability(open);
  const upiQr = useUpiQrPayment({
    target: evaluation ? { extensionId: evaluation.extensionPublicId } : null,
    onConfirmed: () => finishPaidByQr("Booking extended successfully!"),
  });

  // Already paid (any channel) — same as a confirmed QR
  useEffect(() => {
    if (upiQr.error?.code === "EXTENSION_ALREADY_PAID") {
      finishPaidByQr("This extension is already paid — booking extended.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upiQr.error]);

  // 15-day cap (#15), office hours (#2) and the lengths a customer may add (P3) —
  // same query as the booking card's Extend button
  const queryClient = useQueryClient();
  const { data: eligibility, isLoading: eligibilityLoading } = useQuery({
    queryKey: ["extension-eligibility", bookingPublicId],
    queryFn: () => extensionService.customerCheckEligibility(bookingPublicId),
    enabled: open,
    staleTime: 60_000,
  });
  // A refetch while our own quote was open answers "A pending extension already
  // exists" (no lengths) — once that quote is released, ask again so neither
  // this picker nor the booking card's Extend button stays blocked by it.
  const refreshEligibility = () =>
    void queryClient.invalidateQueries({ queryKey: ["extension-eligibility", bookingPublicId] });
  const officeHours = eligibility?.officeHours;
  const maxEndAt = eligibility?.maxEndAt ?? null;
  // Not extendable (15-day limit reached, or less than 12 hours left before it)
  const capReached = eligibility?.eligible === false && (!!eligibility.atCap || !!eligibility.reason);

  // +12 hours, +1 day … up to the cap: the server's list, else the same rule
  // worked out here (an older server). Out-of-hours ends are shown greyed.
  const choices = useMemo<ExtensionChoice[]>(() => {
    if (eligibility?.packageOptions) {
      return eligibility.packageOptions.map((o) => ({
        hours: o.hours,
        label: o.label,
        newEndAt: o.newEndAt,
        disabledReason: o.insideHours
          ? null
          : packageReturnProblem(officeHours, new Date(o.newEndAt), null) ??
            "The branch doesn't take returns at that time",
      }));
    }
    if (!maxEndAt || eligibility?.eligible === false) return [];
    return extensionPackageOptions(currentEndAt, maxEndAt).map((o) => ({
      hours: o.hours,
      label: o.label,
      newEndAt: o.newEndAt.toISOString(),
      disabledReason: packageReturnProblem(officeHours, o.newEndAt, null),
    }));
  }, [eligibility, officeHours, maxEndAt, currentEndAt]);
  const enabledChoices = choices.filter((c) => !c.disabledReason);
  // The picked length, else +1 day, else the shortest one the branch accepts
  const selected =
    enabledChoices.find((c) => c.hours === selectedHours) ??
    enabledChoices.find((c) => c.hours === 24) ??
    enabledChoices[0] ??
    null;

  const newEndAt = selected?.newEndAt ?? null;
  const isAfterCurrentEnd = !!newEndAt && new Date(newEndAt) > new Date(currentEndAt);

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

  /**
   * Releases the unpaid extension (#2). "paid": a UPI QR had already paid it,
   * which is then kept. "open": its UPI QR couldn't be closed (502
   * GATEWAY_UNAVAILABLE), so the server kept it pending — `message` says why.
   */
  async function cancelPendingExtension(
    pubId: string,
  ): Promise<{ outcome: "released" | "paid" | "open"; message?: string }> {
    try {
      await extensionService.customerCancelExtension(pubId);
    } catch (err) {
      if (apiErrorCode(err) === UPI_QR_ALREADY_PAID) return { outcome: "paid" };
      if (apiErrorCode(err) === "GATEWAY_UNAVAILABLE") {
        return { outcome: "open", message: apiErrorMessage(err, "We couldn't close the UPI QR code. Please try again.") };
      }
      // best-effort — ignore errors (e.g. already cancelled)
    }
    return { outcome: "released" };
  }

  async function handleClose() {
    // If we evaluated but never paid, cancel the pending extension so the
    // booking is unlocked and the customer can try again later. Cancelling
    // also closes an open UPI QR — unless it was paid, which keeps the extension.
    if (evaluation && !paidRef.current) {
      const released = await cancelPendingExtension(evaluation.extensionPublicId);
      if (released.outcome === "paid") {
        paidRef.current = true;
        toast.success("Your UPI QR payment was received — booking extended.");
        onSuccess?.();
      } else if (released.outcome === "open") {
        // Still payable for a few minutes: if it is paid, the extension is confirmed
        toast.error(released.message);
      } else {
        refreshEligibility();
      }
    }
    upiQr.reset();
    setStep("date");
    setSelectedHours(null);
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

  /** The UPI QR payment confirmed the extension — same ending as Checkout's success. */
  function finishPaidByQr(message: string) {
    if (paidRef.current) return;
    paidRef.current = true;
    toast.success(message);
    onSuccess?.();
    void handleClose();
  }

  function openUpiQr() {
    setInitError(null);
    setStep("qr");
    upiQr.reset();
    void upiQr.start();
  }

  /** Back to the normal Pay button: close the QR first so it can't take money. */
  async function leaveUpiQr() {
    const result = await upiQr.close();
    if (!result.ok) {
      // Still open on the gateway: stay, so a second payment isn't started beside it
      toast.error(result.message);
      return;
    }
    // A payment had landed: stay to show it (CONFIRMED moves on by itself)
    if (result.view?.outcome === "CONFIRMED" || result.view?.outcome === "REFUND_REQUIRED") return;
    upiQr.reset();
    setStep("result");
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
    // The server snaps a partial extension to the longest +12 h / + N days that fits
    if (partial) {
      return {
        type: "partial" as const,
        partialNewEndAt: partial.partialNewEndAt,
        description: partial.description,
      };
    }
    const none = opts.find((o) => o.type === "NO_RESOLUTION");
    return { type: "none" as const, description: none?.description ?? null };
  })();

  const additionalAmount = evaluation?.pricing.additionalAmount ?? "0";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent
        className="sm:max-w-md max-h-[92vh] overflow-y-auto"
        // A stray tap outside must not cancel an extension whose QR may be being paid
        onInteractOutside={(e) => {
          if (step === "qr") e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            Extend Your Booking
          </DialogTitle>
        </DialogHeader>

        {/* ── Step 1: Pick a length (+12 hours / + N days) ── */}
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
              <Label id="extend-by-label">Extend by</Label>
              <p className="text-xs text-gray-500">
                Extensions are 12 hours or whole days (24 hours each), from your current return.
              </p>
              {eligibilityLoading ? (
                <div className="flex items-center gap-2 py-3 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking how far this booking can be extended…
                </div>
              ) : choices.length > 0 ? (
                <div
                  role="radiogroup"
                  aria-labelledby="extend-by-label"
                  className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1"
                >
                  {choices.map((opt) => {
                    const active = selected?.hours === opt.hours;
                    return (
                      <button
                        key={opt.hours}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        disabled={!!opt.disabledReason}
                        title={opt.disabledReason ?? undefined}
                        onClick={() => setSelectedHours(opt.hours)}
                        className={cn(
                          "rounded-lg border px-3 py-2 text-left transition-colors",
                          active
                            ? "bg-orange-500 border-orange-500 text-white"
                            : "bg-white border-gray-200 text-gray-800 hover:border-gray-400",
                          "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-gray-200",
                        )}
                      >
                        <span className="block text-sm font-semibold">+{opt.label}</span>
                        <span className={cn("block text-[11px] leading-tight", active ? "text-orange-50" : "text-gray-500")}>
                          {opt.disabledReason ? "Branch closed then" : formatPackageReturn(new Date(opt.newEndAt))}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {selected && (
                <p className="text-sm text-gray-700 pt-1">
                  New return:{" "}
                  <span className="font-semibold text-gray-900">
                    {formatPackageReturn(new Date(selected.newEndAt))}
                  </span>
                </p>
              )}
              {/* Why a length is greyed out (outside the branch's return hours) */}
              {choices
                .filter((c) => c.disabledReason)
                .slice(0, 3)
                .map((c) => (
                  <p key={c.hours} className="text-[11px] text-gray-500">
                    +{c.label}: {c.disabledReason}.
                  </p>
                ))}
              {!eligibilityLoading && !capReached && choices.length > 0 && enabledChoices.length === 0 && (
                <p className="text-xs text-red-600">
                  The branch doesn't take returns at any of these times. Please contact the branch.
                </p>
              )}

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
                {resultView.description && (
                  <p className="text-xs text-yellow-700 mb-1">{resultView.description}</p>
                )}
                <p className="text-xs text-yellow-700">
                  We can extend until{" "}
                  <span className="font-semibold">
                    {resultView.partialNewEndAt
                      ? formatPackageReturn(new Date(resultView.partialNewEndAt))
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
                    {resultView.description ??
                      "Sorry, no extension is available for the requested dates."}{" "}
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
                  <ExtensionFreeKmLine freeKm={evaluation.pricing.extensionFreeKm} />
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
                      const released = evaluation
                        ? await cancelPendingExtension(evaluation.extensionPublicId)
                        : null;
                      if (released?.outcome === "paid") {
                        // A UPI QR had already paid it — the extension stands
                        finishPaidByQr("Your UPI QR payment was received — booking extended.");
                        return;
                      }
                      if (released?.outcome === "open") {
                        // Its QR is still payable — stay on this quote rather than start another
                        setInitError(released.message ?? null);
                        return;
                      }
                      setEvaluation(null);
                      setInitError(null);
                      setStep("date");
                      if (released) refreshEligibility();
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

                {/* Same amount, same order — scanned from another phone (#2) */}
                {upiQrAvailable && parseFloat(additionalAmount) > 0 && (
                  <div>
                    <Button
                      variant="outline"
                      className="w-full border-orange-300 text-orange-700 hover:bg-orange-50 hover:text-orange-700"
                      onClick={openUpiQr}
                      disabled={isInitiating}
                    >
                      <QrCode className="mr-2 h-4 w-4" />
                      Pay by scanning a UPI QR
                    </Button>
                    <p className="mt-1.5 text-center text-xs text-muted-foreground">
                      No UPI app on this device? Scan the QR with any UPI app on another phone.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Paying by UPI QR (#2) ── */}
        {step === "qr" && evaluation && (
          <div className="pt-1">
            <UpiQrPanel
              qr={upiQr}
              kind="extension"
              onPayAnotherWay={() => void leaveUpiQr()}
              onDone={() => void handleClose()}
              onViewConfirmed={() => finishPaidByQr("Booking extended successfully!")}
            />
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

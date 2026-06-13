import { useState } from "react";
import { format, addDays } from "date-fns";
import { toast } from "sonner";
import { Calendar, Loader2, ArrowRight, Check, AlertCircle, Info, ExternalLink } from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  extensionService,
  type ExtensionEvaluation,
} from "@/services/extension.service";

type Step = "date" | "result" | "pay" | "redirecting";

interface CustomerExtensionModalProps {
  open: boolean;
  bookingPublicId: string;
  currentEndAt: string;
  onClose: () => void;
  onSuccess?: () => void;
}

function formatCurrency(amount: string | number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(amount));
}

export function CustomerExtensionModal({
  open,
  bookingPublicId,
  currentEndAt,
  onClose,
}: CustomerExtensionModalProps) {
  const [step, setStep] = useState<Step>("date");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [calOpen, setCalOpen] = useState(false);
  const [evaluation, setEvaluation] = useState<ExtensionEvaluation | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isInitiating, setIsInitiating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  const minDate = addDays(new Date(currentEndAt), 1);

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
    if (evaluation) {
      await cancelPendingExtension(evaluation.extensionPublicId);
    }
    setStep("date");
    setSelectedDate(undefined);
    setEvaluation(null);
    setEvalError(null);
    onClose();
  }

  async function handleEvaluate() {
    if (!selectedDate) return;
    setIsEvaluating(true);
    setEvalError(null);
    try {
      // Use noon IST for the new end time
      const newEndAt = new Date(
        Date.UTC(
          selectedDate.getFullYear(),
          selectedDate.getMonth(),
          selectedDate.getDate(),
          6, 30, 0, // 12:00 IST = 06:30 UTC
        ),
      ).toISOString();

      const res = await extensionService.customerEvaluate(bookingPublicId, newEndAt);
      setEvaluation(res.data);
      setStep("result");
    } catch (err: any) {
      setEvalError(
        err?.response?.data?.message ?? "Failed to check availability. Please try again.",
      );
    } finally {
      setIsEvaluating(false);
    }
  }

  async function handleInitiatePayment() {
    if (!evaluation) return;
    setIsInitiating(true);
    try {
      const res = await extensionService.customerInitiatePayment(
        evaluation.extensionPublicId,
        `${window.location.origin}/my-bookings`,
      );
      if (res.data?.redirectUrl) {
        setStep("redirecting");
        // Small delay so user sees the "redirecting" state
        setTimeout(() => {
          window.location.href = res.data.redirectUrl;
        }, 800);
      } else {
        toast.error("Could not initiate payment — no redirect URL received");
        setIsInitiating(false);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? "Failed to initiate payment");
      setIsInitiating(false);
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
                Current end:{" "}
                <span className="font-semibold text-gray-800">
                  {format(new Date(currentEndAt), "dd MMM yyyy")}
                </span>
              </span>
            </div>

            <div className="space-y-1.5">
              <Label>New return date</Label>
              <Popover open={calOpen} onOpenChange={setCalOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
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
                    disabled={(d) => d < minDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

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
                disabled={!selectedDate || isEvaluating}
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
                      ? format(new Date(resultView.partialNewEndAt), "dd MMM yyyy")
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
                    <span className="text-gray-500">Duration</span>
                    <span className="font-medium">
                      {evaluation.pricing.originalDays} → {evaluation.pricing.newDays} days
                      <span className="text-orange-500 ml-1">
                        (+{evaluation.pricing.newDays - evaluation.pricing.originalDays})
                      </span>
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Original total</span>
                    <span className="font-medium">{formatCurrency(evaluation.pricing.originalTotalFinal)}</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-200 pt-2 mt-1">
                    <span className="font-semibold text-gray-700">Additional charge</span>
                    <span className="font-bold text-orange-600 text-base">
                      {formatCurrency(additionalAmount)}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={async () => {
                      if (evaluation) await cancelPendingExtension(evaluation.extensionPublicId);
                      setEvaluation(null);
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
                    ) : (
                      <>Pay {formatCurrency(additionalAmount)} <ExternalLink className="ml-2 h-4 w-4" /></>
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Redirecting to PhonePe ── */}
        {step === "redirecting" && (
          <div className="py-12 text-center space-y-4">
            <Loader2 className="h-10 w-10 animate-spin text-orange-500 mx-auto" />
            <p className="font-semibold text-gray-900">Redirecting to PhonePe…</p>
            <p className="text-sm text-muted-foreground">
              Please complete your payment on the PhonePe page.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useState, useRef } from "react";
import { format, addDays } from "date-fns";
import { toast } from "sonner";
import { Calendar, Loader2, ArrowRight, Check, AlertCircle, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
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

type Step = "date" | "result" | "payment" | "done";

interface CustomerExtensionModalProps {
  open: boolean;
  bookingPublicId: string;
  currentEndAt: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const gateways = ["UPI", "Razorpay", "Other"] as const;

function formatCurrency(amount: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(parseFloat(amount));
}

export function CustomerExtensionModal({
  open,
  bookingPublicId,
  currentEndAt,
  onClose,
  onSuccess,
}: CustomerExtensionModalProps) {
  const [step, setStep] = useState<Step>("date");

  // Step 1 state
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [calOpen, setCalOpen] = useState(false);
  const [notes, setNotes] = useState("");

  // Step 2 state
  const [evaluation, setEvaluation] = useState<ExtensionEvaluation | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  // Step 3 state — online only for customers
  const [txnRef, setTxnRef] = useState("");
  const [gateway, setGateway] = useState<string>("UPI");
  const [isCommitting, setIsCommitting] = useState(false);

  const idempotencyKey = useRef(crypto.randomUUID());

  const minDate = addDays(new Date(currentEndAt), 1);

  function handleClose() {
    setStep("date");
    setSelectedDate(undefined);
    setEvaluation(null);
    setEvalError(null);
    setTxnRef("");
    setGateway("UPI");
    setNotes("");
    idempotencyKey.current = crypto.randomUUID();
    onClose();
  }

  async function handleEvaluate() {
    if (!selectedDate) return;
    setIsEvaluating(true);
    setEvalError(null);
    try {
      const newEndAt = new Date(
        Date.UTC(
          selectedDate.getFullYear(),
          selectedDate.getMonth(),
          selectedDate.getDate(),
          12,
          0,
          0
        )
      ).toISOString();

      const res = await extensionService.customerEvaluate(
        bookingPublicId,
        newEndAt,
        notes || undefined
      );
      setEvaluation(res.data);

      // Check if there's an available option
      const hasOption = res.data.resolutionOptions.some(
        (o) =>
          o.type === "SAME_VEHICLE" ||
          o.type === "SWAP_CURRENT_TO_OTHER" ||
          o.type === "PARTIAL_EXTENSION"
      );

      if (!hasOption) {
        setStep("result");
      } else {
        setStep("result");
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        "Failed to check availability. Please try again.";
      setEvalError(msg);
    } finally {
      setIsEvaluating(false);
    }
  }

  async function handleCommit() {
    if (!evaluation) return;
    if (!txnRef.trim()) {
      toast.error("Please enter your payment transaction reference.");
      return;
    }
    setIsCommitting(true);
    try {
      await extensionService.customerCommit({
        extensionPublicId: evaluation.extensionPublicId,
        paymentMethod: "ONLINE",
        onlineTransactionRef: txnRef.trim(),
        onlineGateway: gateway as any,
        idempotencyKey: idempotencyKey.current,
      });
      setStep("done");
      toast.success("Extension request submitted successfully!");
      onSuccess?.();
    } catch (err: any) {
      toast.error(
        err?.response?.data?.message || "Failed to submit extension."
      );
    } finally {
      setIsCommitting(false);
    }
  }

  // Determine customer-visible result
  const getResultView = () => {
    if (!evaluation) return null;
    const { resolutionOptions, pricing } = evaluation;
    const hasPartial = resolutionOptions.find(
      (o) => o.type === "PARTIAL_EXTENSION"
    );
    const hasAvailable = resolutionOptions.find(
      (o) =>
        o.type === "SAME_VEHICLE" || o.type === "SWAP_CURRENT_TO_OTHER"
    );

    if (hasAvailable) {
      return { type: "available" as const, option: hasAvailable, pricing };
    }
    if (hasPartial) {
      return { type: "partial" as const, option: hasPartial, pricing };
    }
    return { type: "none" as const, option: null, pricing };
  };

  const resultView = step === "result" ? getResultView() : null;
  const additionalAmount = evaluation?.resolutionOptions[0]?.additionalAmount;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            Extend Your Booking
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Date selection */}
        {step === "date" && (
          <div className="space-y-5 pt-2">
            <div className="flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5 text-sm text-gray-600">
              <Calendar className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <span>
                Current end:{" "}
                <span className="font-semibold text-gray-800">
                  {format(new Date(currentEndAt), "dd MMM yyyy")}
                </span>
              </span>
            </div>

            <div className="space-y-1.5">
              <Label>New end date</Label>
              <Popover open={calOpen} onOpenChange={setCalOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !selectedDate && "text-muted-foreground"
                    )}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {selectedDate
                      ? format(selectedDate, "dd MMM yyyy")
                      : "Select a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={selectedDate}
                    onSelect={(d) => {
                      setSelectedDate(d);
                      setCalOpen(false);
                    }}
                    disabled={(d) => d < minDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {evalError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {evalError}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleClose}
              >
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
                  <>
                    Check
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Result */}
        {step === "result" && resultView && (
          <div className="space-y-5 pt-2">
            {resultView.type === "available" && (
              <>
                <div className="rounded-lg bg-green-50 border border-green-200 p-4">
                  <div className="flex items-center gap-2 text-green-800 font-semibold mb-1">
                    <Check className="h-4 w-4" />
                    Extension available
                  </div>
                  <p className="text-sm text-green-700">
                    {resultView.option.type === "SWAP_CURRENT_TO_OTHER"
                      ? "Extension confirmed with an equivalent vehicle."
                      : "Extension available for the full duration."}
                  </p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Original duration</span>
                    <span className="font-medium">
                      {resultView.pricing.originalDays} days
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">New duration</span>
                    <span className="font-medium">
                      {resultView.pricing.newDays} days
                    </span>
                  </div>
                  <div className="flex justify-between text-sm border-t border-gray-200 pt-2 mt-2">
                    <span className="font-semibold text-gray-700">
                      Additional charge
                    </span>
                    <span className="font-bold text-orange-600 text-base">
                      {formatCurrency(resultView.option.additionalAmount)}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setStep("date")}
                  >
                    ← Back
                  </Button>
                  <Button
                    className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                    onClick={() => setStep("payment")}
                  >
                    Pay Online →
                  </Button>
                </div>
              </>
            )}

            {resultView.type === "partial" && (
              <>
                <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4">
                  <div className="flex items-center gap-2 text-yellow-800 font-semibold mb-1">
                    <Info className="h-4 w-4" />
                    Partial extension only
                  </div>
                  <p className="text-sm text-yellow-700">
                    Full extension not available. We can extend until{" "}
                    <span className="font-semibold">
                      {resultView.option.partialNewEndAt
                        ? format(
                            new Date(resultView.option.partialNewEndAt),
                            "dd MMM yyyy"
                          )
                        : "a limited date"}
                    </span>
                    .
                  </p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm flex justify-between">
                  <span className="text-gray-500">Additional charge</span>
                  <span className="font-bold text-orange-600">
                    {formatCurrency(resultView.option.additionalAmount)}
                  </span>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={handleClose}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                    onClick={() => setStep("payment")}
                  >
                    Accept Partial →
                  </Button>
                </div>
              </>
            )}

            {resultView.type === "none" && (
              <>
                <div className="rounded-lg bg-red-50 border border-red-200 p-4">
                  <div className="flex items-center gap-2 text-red-800 font-semibold mb-1">
                    <AlertCircle className="h-4 w-4" />
                    No extension available
                  </div>
                  <p className="text-sm text-red-700">
                    Sorry, no extension is available for the requested dates.
                    Please contact the branch for assistance.
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleClose}
                >
                  Close
                </Button>
              </>
            )}
          </div>
        )}

        {/* Step 3: Payment */}
        {step === "payment" && (
          <div className="space-y-5 pt-2">
            <div className="rounded-lg bg-orange-50 border border-orange-100 px-4 py-3 flex items-center justify-between text-sm">
              <span className="text-orange-700 font-medium">Amount due</span>
              <span className="text-orange-800 font-bold text-base">
                {additionalAmount ? formatCurrency(additionalAmount) : "—"}
              </span>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Payment gateway</Label>
                <Select value={gateway} onValueChange={setGateway}>
                  <SelectTrigger>
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

              <div className="space-y-1.5">
                <Label>
                  Transaction reference{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  placeholder="e.g. UPI ref / UTR number"
                  value={txnRef}
                  onChange={(e) => setTxnRef(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Enter the reference number from your payment app
                </p>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setStep("result")}
              >
                ← Back
              </Button>
              <Button
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                onClick={handleCommit}
                disabled={isCommitting || !txnRef.trim()}
              >
                {isCommitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Submit Payment"
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Done */}
        {step === "done" && (
          <div className="py-8 text-center space-y-4">
            <div className="mx-auto w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
              <Check className="h-7 w-7 text-green-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-base">
                Request submitted!
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Your extension request has been submitted. The branch team will
                confirm your extension shortly.
              </p>
            </div>
            <Button className="w-full bg-orange-500 hover:bg-orange-600 text-white" onClick={handleClose}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

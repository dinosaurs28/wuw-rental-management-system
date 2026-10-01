import { useMemo, useEffect, useRef } from "react";
import { format } from "date-fns";
import { CalendarIcon, MapPin, Check, Loader2, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TimeSelect } from "@/components/ui/TimeSelect";
import { cn } from "@/lib/utils";
import { formatInrExact, gstSplitText } from "@/lib/gst";
import { round2 } from "@repo/schemas";
import { useVehicleRentalStore } from "@/store/vehicleRental.store";
import type { VehicleDetails } from "@/services/vehicle.service";
import {
  clampPaymentFlow,
  durationDiscountTitle,
  paymentOptionsFor,
  roundMoney,
} from "@/lib/paymentPlan";
import type { BranchScheduleConfig } from "@/services/branch.service";
import { BranchHoursBadge } from "@/components/booking/BranchHoursBadge";
import { DurationPresetChips } from "@/components/booking/DurationPresetChips";
import { bookingPickerLimits } from "@/utils/bookingPickers";
import { formatRentalLength } from "@/utils/formatters";

interface VehiclePricingCardProps {
  vehicle: VehicleDetails;
  onBookVehicle: () => void;
  isRefetching?: boolean;
  /** Branch office hours — limits the pickers and shows the hours line. */
  schedule?: BranchScheduleConfig;
}

const periodTypeLabels: Record<string, string> = {
  HOURLY: "Hourly",
  HALF_DAY: "Half Day",
  FULL_DAY: "Full Day",
  MULTI_DAY: "Multi Day",
  MONTHLY: "Monthly",
};

export const VehiclePricingCard = ({
  vehicle,
  onBookVehicle,
  isRefetching = false,
  schedule,
}: VehiclePricingCardProps) => {
  const {
    getStartDate,
    getEndDate,
    startTime,
    endTime,
    setStartDate,
    setEndDate,
    setStartTime,
    setEndTime,
    paymentFlow,
    setPaymentFlow,
  } = useVehicleRentalStore();

  const pickupDate = getStartDate();
  const returnDate = getEndDate();

  // Payment plan (#6) from the server's paymentOptions (branch mode + amounts):
  // the branch's default plan on a new vehicle, then kept inside the allowed plans.
  const paymentOptions = paymentOptionsFor(vehicle);
  const optionsKey = `${paymentOptions.allowedFlows.join(",")}|${paymentOptions.defaultFlow}`;
  const planVehicleRef = useRef<string | null>(null);
  useEffect(() => {
    const isNewVehicle = planVehicleRef.current !== vehicle.publicId;
    planVehicleRef.current = vehicle.publicId;
    const current = useVehicleRentalStore.getState().paymentFlow;
    const next = isNewVehicle ? paymentOptions.defaultFlow : clampPaymentFlow(current, paymentOptions);
    if (next !== current) setPaymentFlow(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle.publicId, optionsKey]);
  const shownFlow = clampPaymentFlow(paymentFlow, paymentOptions);

  const formattedPickupDate = pickupDate
    ? format(pickupDate, "MMM dd, yyyy")
    : "Select date";
  const formattedReturnDate = returnDate
    ? format(returnDate, "MMM dd, yyyy")
    : "Select date";

  const isAvailable = vehicle.availability;
  const pd = vehicle.pricingDetails;

  // What the customer pays in full: rental + GST + refundable deposit (server's figure)
  const payableTotal =
    paymentOptions.payableTotal ?? (pd ? roundMoney(pd.finalTotal + (vehicle.deposit ?? 0)) : 0);
  const dueAtPickup =
    paymentOptions.remainingAfterAdvance ?? roundMoney(payableTotal - paymentOptions.advanceAmount);

  // Validate that return datetime is strictly after pickup datetime
  const isDateRangeValid = useMemo(() => {
    if (!pickupDate || !returnDate) return true;
    const start = new Date(pickupDate);
    const [sh, sm] = (startTime || "10:00").split(":").map(Number);
    start.setHours(sh, sm, 0, 0);
    const end = new Date(returnDate);
    const [eh, em] = (endTime || "10:00").split(":").map(Number);
    end.setHours(eh, em, 0, 0);
    return end > start;
  }, [pickupDate, returnDate, startTime, endTime]);

  // Paise are shown when present: GST is rounded to the paisa, not the rupee.
  const formatCurrency = (amount: number) => formatInrExact(amount);

  // Office hours (#2) + 15-day window (#15). Also catches stale dates from the
  // persisted store, the URL or a schedule adjustment.
  const pickupDayKey = pickupDate?.getTime();
  const returnDayKey = returnDate?.getTime();
  const limits = useMemo(
    () =>
      bookingPickerLimits({
        schedule,
        pickupDate,
        pickupTime: startTime || "10:00",
        returnDate,
        returnTime: endTime || "10:00",
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schedule, pickupDayKey, startTime, returnDayKey, endTime],
  );

  const handlePickupDateChange = (date: Date | undefined) => {
    setStartDate(date || null);
  };

  const handleReturnDateChange = (date: Date | undefined) => {
    setEndDate(date || null);
  };

  const canBook =
    isAvailable && pickupDate && returnDate && isDateRangeValid && !limits.windowError && !isRefetching;

  // What the price covers ("5 hours", "1 day + 2 hours"); the period type is the fallback
  const billedLabel =
    pd?.pricingBreakdown.billedAs ??
    periodTypeLabels[pd?.pricingBreakdown.periodType ?? ""] ??
    pd?.pricingBreakdown.periodType;

  return (
    <Card className="overflow-hidden bg-white border border-zinc-200 shadow-2xl rounded-[2rem]">
      <CardContent className="p-0">
        {/* Price Header */}
        <div className="p-5 sm:p-8 border-b border-zinc-200">
          <div className="flex items-baseline mb-4">
            <span className="text-4xl lg:text-5xl font-serif font-black text-zinc-900 tracking-tight">
              {vehicle.pricing.daily > 0 ? formatCurrency(vehicle.pricing.daily) : "—"}
            </span>
            <span className="text-sm font-bold text-zinc-500 uppercase tracking-wider ml-2">
              {/* The header is the base for the picked period, not a per-day rate */}
              {vehicle.pricing.daily > 0 ? (pd?.pricingBreakdown.billedAs ? `/ ${pd.pricingBreakdown.billedAs}` : "/day") : ""}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm font-bold tracking-wider text-zinc-400 uppercase">
            <MapPin className="size-4 text-orange-500" />
            <span>{vehicle.branch}</span>
          </div>
        </div>

        {/* Date + Time Selectors */}
        <div className="p-5 sm:p-8 space-y-4 border-b border-zinc-200">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Pickup Date */}
            <div className="space-y-3">
              <label className="text-xs font-black text-zinc-500 uppercase tracking-[0.2em]">
                Pickup Date
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal h-12 rounded-full bg-white border-zinc-200 hover:bg-zinc-100 text-zinc-900 hover:text-zinc-900 transition-colors",
                      !pickupDate && "text-zinc-500",
                    )}
                  >
                    <CalendarIcon className="mr-2 size-4 text-zinc-400" />
                    <span className="truncate text-sm">
                      {formattedPickupDate}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={pickupDate || undefined}
                    onSelect={handlePickupDateChange}
                    disabled={limits.isPickupDayDisabled}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Pickup Time */}
            <div className="space-y-3">
              <label className="text-xs font-black text-zinc-500 uppercase tracking-[0.2em]">
                Pickup Time
              </label>
              <div className="h-12 w-full bg-white border border-zinc-200 text-zinc-900 rounded-full px-4 flex items-center focus-within:border-zinc-300 transition-all">
                <TimeSelect
                  value={startTime || "10:00"}
                  onChange={setStartTime}
                  isDisabled={limits.isPickupSlotDisabled}
                  className="w-full"
                />
              </div>
              <BranchHoursBadge schedule={schedule} date={pickupDate} kind="pickup" />
            </div>

            {/* Return Date */}
            <div className="space-y-3">
              <label className="text-xs font-black text-zinc-500 uppercase tracking-[0.2em]">
                Return Date
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal h-12 rounded-full bg-white border-zinc-200 hover:bg-zinc-100 text-zinc-900 hover:text-zinc-900 transition-colors",
                      !returnDate && "text-zinc-500",
                    )}
                  >
                    <CalendarIcon className="mr-2 size-4 text-zinc-400" />
                    <span className="truncate text-sm">
                      {formattedReturnDate}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={returnDate || undefined}
                    onSelect={handleReturnDateChange}
                    disabled={limits.isReturnDayDisabled}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Return Time */}
            <div className="space-y-3">
              <label className="text-xs font-black text-zinc-500 uppercase tracking-[0.2em]">
                Return Time
              </label>
              <div className="h-12 w-full bg-white border border-zinc-200 text-zinc-900 rounded-full px-4 flex items-center focus-within:border-zinc-300 transition-all">
                <TimeSelect
                  value={endTime || "10:00"}
                  onChange={setEndTime}
                  isDisabled={limits.isReturnSlotDisabled}
                  className="w-full"
                />
              </div>
              <BranchHoursBadge schedule={schedule} date={returnDate} kind="return" />
            </div>
          </div>

          {/* Quick durations (#5) */}
          <DurationPresetChips
            pickupDate={pickupDate}
            pickupTime={startTime || "10:00"}
            returnDate={returnDate}
            returnTime={endTime || "10:00"}
            schedule={schedule}
            onApply={(date, time) => {
              setEndDate(date);
              setEndTime(time);
            }}
          />

          {limits.windowError && (
            <p className="text-sm font-semibold text-red-500">{limits.windowError}</p>
          )}
        </div>

        {/* Pricing Breakdown */}
        <div className="p-5 sm:p-8 space-y-4 border-b border-zinc-200 relative">
          {isRefetching && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center z-10">
              <Loader2 className="size-6 text-orange-500 animate-spin" />
            </div>
          )}

          {pd && isDateRangeValid && !isRefetching && (
            <>
              {/* Period type badge */}
              <div className="flex items-center gap-2 mb-2">
                <span className="px-3 py-1 text-[10px] font-black tracking-[0.15em] bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-full uppercase">
                  {pd.pricingBreakdown.billedAs ? `Billed as ${billedLabel}` : billedLabel}
                </span>
                {pickupDate && returnDate && (
                  <span className="text-xs text-zinc-500">
                    {formatRentalLength(
                      `${format(pickupDate, "yyyy-MM-dd")}T${startTime || "10:00"}`,
                      `${format(returnDate, "yyyy-MM-dd")}T${endTime || "10:00"}`,
                    )}
                  </span>
                )}
              </div>

              <div className="flex justify-between text-base">
                <span className="text-zinc-400">Base Price</span>
                <span className="text-zinc-900 font-medium">
                  {formatCurrency(pd.basePrice)}
                </span>
              </div>

              {pd.discountAmount > 0 && (
                <div className="flex justify-between text-base">
                  <span className="text-emerald-400 flex items-center gap-2">
                    <Check className="size-4" />
                    {/* Detail quotes carry only the duration slab (no coupon yet) */}
                    {durationDiscountTitle(
                      pd.durationDiscountLabel,
                      pd.durationDiscountPercent ?? roundMoney(pd.discountPercent),
                      pd.durationDiscountType,
                    )}
                  </span>
                  <span className="text-emerald-400 font-medium">
                    -{formatCurrency(pd.discountAmount)}
                  </span>
                </div>
              )}

              {pd.discountAmount > 0 && (
                <div className="flex justify-between text-base">
                  <span className="text-zinc-400">Taxable value</span>
                  <span className="text-zinc-900 font-medium">
                    {formatCurrency(round2(pd.basePrice - pd.discountAmount))}
                  </span>
                </div>
              )}

              {pd.taxAmount > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between text-base">
                    <span className="text-zinc-400">GST ({pd.taxRate}%)</span>
                    <span className="text-zinc-700 font-medium">
                      +{formatCurrency(pd.taxAmount)}
                    </span>
                  </div>
                  {(pd.cgstAmount > 0 || pd.sgstAmount > 0) && (
                    <p className="text-xs text-zinc-400 text-right">
                      {gstSplitText(pd.cgstAmount, pd.sgstAmount, pd.cgstRate, pd.sgstRate)}
                    </p>
                  )}
                </div>
              )}

              <div className="pt-4 mt-2 border-t border-zinc-200">
                <div className="flex justify-between items-end">
                  <span className="text-lg font-black text-zinc-900 uppercase tracking-wider">
                    Total
                  </span>
                  <span className="text-3xl font-bold text-zinc-900 tracking-tight">
                    {formatCurrency(pd.finalTotal)}
                  </span>
                </div>
              </div>
            </>
          )}

          {!isDateRangeValid && pickupDate && returnDate && !isRefetching && (
            <p className="text-sm text-red-500 text-center py-4 font-semibold">
              Return date/time must be after pickup date/time
            </p>
          )}

          {!pd && isDateRangeValid && !isRefetching && (
            <p className="text-base text-zinc-500 text-center py-4 font-medium">
              Select dates & times to see pricing
            </p>
          )}
        </div>

        {/* Deposit Info */}
        {!!vehicle.deposit && vehicle.deposit > 0 && (
          <div className="px-5 py-4 sm:px-8 sm:py-6 bg-zinc-50 border-b border-zinc-200 space-y-2">
            <div className="flex justify-between text-base">
              <span className="text-zinc-400">Security Deposit (refundable)</span>
              <span className="text-zinc-900 font-medium">
                {formatCurrency(vehicle.deposit)}
              </span>
            </div>
            {!!pd && isDateRangeValid && !isRefetching && (
              <div className="flex justify-between text-base">
                <span className="text-zinc-900 font-semibold">Total payable</span>
                <span className="text-zinc-900 font-bold">{formatCurrency(payableTotal)}</span>
              </div>
            )}
          </div>
        )}

        {/* Payment Plan — only the plans the branch and the amounts allow */}
        {!!pd && isDateRangeValid && (
          <div className="px-5 py-4 sm:px-8 sm:py-6 border-b border-zinc-200 space-y-3">
            <p className="text-xs font-black text-zinc-500 uppercase tracking-[0.2em]">
              Payment Plan
            </p>
            {paymentOptions.allowedFlows.length === 2 && (
              <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Payment plan">
                <button
                  type="button"
                  role="radio"
                  aria-checked={shownFlow === "FULL"}
                  onClick={() => setPaymentFlow("FULL")}
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-4 rounded-2xl border-2 transition-all",
                    shownFlow === "FULL"
                      ? "bg-white text-zinc-950 border-zinc-900 shadow-sm"
                      : "bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400 hover:text-zinc-900",
                  )}
                >
                  <Check className={cn("size-4", shownFlow === "FULL" ? "text-zinc-900" : "text-zinc-400")} />
                  <span className="text-xs font-black uppercase tracking-wider">
                    Full Pay
                  </span>
                  <span className="text-xs font-medium">
                    {formatCurrency(payableTotal)}
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={shownFlow === "ADVANCE"}
                  onClick={() => setPaymentFlow("ADVANCE")}
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-4 rounded-2xl border-2 transition-all",
                    shownFlow === "ADVANCE"
                      ? "bg-orange-500 text-white border-orange-500 shadow-sm"
                      : "bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400 hover:text-zinc-900",
                  )}
                >
                  <Wallet className="size-4" />
                  <span className="text-xs font-black uppercase tracking-wider">
                    Advance
                  </span>
                  <span className="text-xs font-medium">
                    {formatCurrency(paymentOptions.advanceAmount)} now
                  </span>
                </button>
              </div>
            )}
            {shownFlow === "ADVANCE" ? (
              <div className="text-xs text-zinc-500 space-y-1">
                <div className="flex justify-between">
                  <span>Pay now (advance)</span>
                  <span className="text-orange-500 font-bold">
                    {formatCurrency(paymentOptions.advanceAmount)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Due at pickup</span>
                  <span className="text-zinc-700">
                    {formatCurrency(dueAtPickup)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-500 text-center">
                Pay {formatCurrency(payableTotal)} upfront — no balance due at pickup.
              </p>
            )}
            {paymentOptions.reasonMessage && (
              <p className="text-xs text-zinc-400 text-center">{paymentOptions.reasonMessage}</p>
            )}
          </div>
        )}

        {/* CTA */}
        <div className="p-5 sm:p-8">
          <Button
            onClick={onBookVehicle}
            disabled={!canBook}
            className="w-full h-16 bg-zinc-900 hover:bg-black text-white font-black text-lg uppercase tracking-widest rounded-full transition-all hover:scale-105 active:scale-95 shadow-[0_4px_24px_rgba(0,0,0,0.25)] hover:shadow-[0_6px_32px_rgba(0,0,0,0.35)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none"
          >
            {isRefetching ? (
              <span className="flex items-center gap-3">
                <Loader2 className="size-5 animate-spin" />
                Updating...
              </span>
            ) : isAvailable ? (
              "Book Vehicle"
            ) : (
              "Unavailable"
            )}
          </Button>
          {(!pickupDate || !returnDate) && isAvailable && !isRefetching && (
            <p className="text-sm font-bold tracking-wider text-zinc-500 uppercase text-center mt-4">
              Please select dates & times
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

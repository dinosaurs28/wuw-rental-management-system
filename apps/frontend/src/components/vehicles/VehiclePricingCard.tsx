import { useEffect, useMemo } from "react";
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
import { formatInrExact, rentGstPartsText, rentGstSplitText, rentInclGstView } from "@/lib/gst";
import { useVehicleRentalStore } from "@/store/vehicleRental.store";
import type { VehicleDetails } from "@/services/vehicle.service";
import {
  durationDiscountTitle,
  paymentOptionsFor,
  payNowLine,
  payNowSplit,
  roundMoney,
} from "@/lib/paymentPlan";
import type { BranchScheduleConfig } from "@/services/branch.service";
import { BranchHoursBadge } from "@/components/booking/BranchHoursBadge";
import {
  PackageHints,
  PackageQuickChips,
  PackageSelect,
  formatPackageReturn,
} from "@/components/booking/PackagePicker";
import { bookingPickerLimits } from "@/utils/bookingPickers";
import { packageRangeState, returnForNewPickup, returnForPackage } from "@/utils/bookingPackages";

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
  } = useVehicleRentalStore();

  const pickupDate = getStartDate();
  const returnDate = getEndDate();

  // Advance only (item 18): the server's one plan for these amounts — shown as
  // "Pay ₹X now · ₹Y at pickup". The page stores the options (setPaymentOptions),
  // which keeps the store's paymentFlow on this plan for booking create.
  const paymentOptions = paymentOptionsFor(vehicle);
  const paySplit = payNowSplit(paymentOptions);

  const formattedPickupDate = pickupDate
    ? format(pickupDate, "MMM dd, yyyy")
    : "Select date";

  const isAvailable = vehicle.availability;
  const pd = vehicle.pricingDetails;
  // The rent incl. GST, its discounts and the GST inside it (item 17)
  const rent = rentInclGstView(pd ?? {});

  // What the customer pays in full: rental + GST + refundable deposit (server's figure)
  const payableTotal =
    paymentOptions.payableTotal ?? (pd ? roundMoney(pd.finalTotal + (vehicle.deposit ?? 0)) : 0);

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

  // Customers book packages (12 hours / 1–15 days): the return is pickup + the
  // package, computed and shown read-only
  const packageInput = {
    schedule,
    pickupDate,
    pickupTime: startTime || "10:00",
    returnDate,
    returnTime: endTime || "10:00",
  };
  const pkg = useMemo(
    () => packageRangeState(packageInput),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schedule, pickupDayKey, startTime, returnDayKey, endTime],
  );
  const applyReturn = (ret: { returnDate: Date; returnTime: string } | null) => {
    if (!ret) return;
    setEndDate(ret.returnDate);
    setEndTime(ret.returnTime);
  };
  // A range that isn't a bookable package (a link, the listing, hours that just loaded) snaps to one
  const correctionKey = pkg.correction
    ? `${pkg.correction.returnDate.getTime()}|${pkg.correction.returnTime}`
    : "";
  useEffect(() => {
    if (pkg.correction) applyReturn(pkg.correction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correctionKey]);

  // The pickup moved: the return moves with it, keeping the package
  const handlePickupDateChange = (date: Date | undefined) => {
    setStartDate(date || null);
    if (date) applyReturn(returnForNewPickup(packageInput, { pickupDate: date, pickupTime: startTime || "10:00" }));
  };

  const handlePickupTimeChange = (time: string) => {
    setStartTime(time);
    applyReturn(returnForNewPickup(packageInput, { pickupDate, pickupTime: time }));
  };

  const choosePackage = (packageHours: number) =>
    applyReturn(returnForPackage(packageInput, { packageHours, extraHours: 0 }));

  const canBook =
    isAvailable &&
    pickupDate &&
    returnDate &&
    isDateRangeValid &&
    !limits.windowError &&
    !!pkg.selected &&
    !pkg.correction &&
    !isRefetching;

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
              {vehicle.pricing.daily > 0 && " · incl. GST"}
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
                  onChange={handlePickupTimeChange}
                  isDisabled={limits.isPickupSlotDisabled}
                  className="w-full"
                />
              </div>
              <BranchHoursBadge schedule={schedule} date={pickupDate} kind="pickup" />
            </div>

            {/* Rental length — 12 hours or whole days; the return follows */}
            <div className="space-y-3 sm:col-span-2">
              <label className="text-xs font-black text-zinc-500 uppercase tracking-[0.2em]">
                Rental Length
              </label>
              <PackageSelect
                state={pkg}
                onSelect={choosePackage}
                triggerClassName="!h-12 w-full rounded-full bg-white border-zinc-200 hover:bg-zinc-100 text-zinc-900 px-4 text-sm transition-colors"
              />
            </div>

            {/* Return — computed, read-only */}
            <div className="space-y-3 sm:col-span-2">
              <label className="text-xs font-black text-zinc-500 uppercase tracking-[0.2em]">
                Return
              </label>
              <div
                aria-live="polite"
                className="h-12 w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-full px-4 flex items-center gap-2"
              >
                <CalendarIcon className="size-4 text-zinc-400 shrink-0" />
                <span className="truncate text-sm">
                  {pkg.selected ? formatPackageReturn(pkg.returnAt) : "—"}
                </span>
              </div>
              <BranchHoursBadge schedule={schedule} date={returnDate} kind="return" />
            </div>
          </div>

          {/* Quick lengths (#5) + why 12 hours is off for this pickup */}
          <div className="space-y-1.5">
            <PackageQuickChips state={pkg} onSelect={choosePackage} />
            <PackageHints state={pkg} />
          </div>

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
              </div>

              {/* Rent is GST-inclusive (item 17): GST is part of the price, not added on top */}
              <div className="flex justify-between text-base">
                <span className="text-zinc-400">Rent (incl. GST)</span>
                <span className="text-zinc-900 font-medium">
                  {formatCurrency(rent.rent)}
                </span>
              </div>

              {rent.discount > 0 && (
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
                    -{formatCurrency(rent.discount)}
                  </span>
                </div>
              )}

              {rent.gst > 0 && (
                <div className="space-y-1 text-right">
                  <p className="text-sm text-zinc-500">{rentGstSplitText(rent)}</p>
                  {(rent.cgst > 0 || rent.sgst > 0) && (
                    <p className="text-xs text-zinc-400">
                      GST: {rentGstPartsText(rent.cgst, rent.sgst, pd.cgstRate, pd.sgstRate)}
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
                    {formatCurrency(rent.rentAfterDiscount)}
                  </span>
                </div>
                <p className="mt-1 text-right text-xs text-zinc-400">Rent incl. GST</p>
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

        {/* Payment — advance only (item 18): the server's one plan, no picker */}
        {!!pd && isDateRangeValid && !isRefetching && paySplit.payNow != null && (
          <div className="px-5 py-4 sm:px-8 sm:py-6 border-b border-zinc-200 space-y-2">
            <p className="text-xs font-black text-zinc-500 uppercase tracking-[0.2em]">
              Payment
            </p>
            <p className="flex items-center gap-2 text-base font-bold text-zinc-900">
              <Wallet className="size-4 shrink-0 text-orange-500" />
              {payNowLine(paySplit, formatCurrency)}
            </p>
            <p className="text-xs text-zinc-500">
              {paySplit.flow === "ADVANCE"
                ? "The advance is paid online now; the balance is collected at pickup."
                : paySplit.fullReason}
            </p>
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

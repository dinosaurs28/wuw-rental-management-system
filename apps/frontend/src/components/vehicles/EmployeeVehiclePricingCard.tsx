import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, MapPin, Check, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { TimeSelect } from "@/components/ui/TimeSelect";
import { cn } from "@/lib/utils";
import { formatInrExact, gstSplitText } from "@/lib/gst";
import { round2 } from "@repo/schemas";
import { durationDiscountTitle } from "@/lib/paymentPlan";
import { isValidUtr } from "@/lib/counterErrors";
import {
  useEmployeeBookingStore,
  type EmployeePaymentType,
} from "@/store/employeeBooking.store";
import { ShiftRequiredNotice } from "@/components/employee/counter/ShiftRequiredNotice";
import { useActiveShift } from "@/components/employee/counter/useActiveShift";
import type { VehicleDetails } from "@/services/vehicle.service";
import type { BranchScheduleConfig } from "@/services/branch.service";
import { BranchHoursBadge } from "@/components/booking/BranchHoursBadge";
import { DurationPresetChips } from "@/components/booking/DurationPresetChips";
import { bookingPickerLimits } from "@/utils/bookingPickers";
import { formatRentalLength } from "@/utils/formatters";

interface EmployeeVehiclePricingCardProps {
  vehicle: VehicleDetails;
  onBookVehicle: () => void;
  isRefetching?: boolean;
  disabled?: boolean;
  hasCompleteKyc?: boolean;
  /** Customer QR code photo captured (#4). Omitted = not gated. */
  hasQrPhoto?: boolean;
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

export const EmployeeVehiclePricingCard = ({
  vehicle,
  onBookVehicle,
  isRefetching = false,
  disabled = false,
  hasCompleteKyc = false,
  hasQrPhoto = true,
  schedule,
}: EmployeeVehiclePricingCardProps) => {
  const {
    startDate: storeStartDate,
    endDate: storeEndDate,
    startTime,
    endTime,
    setDates,
    setStartTime,
    setEndTime,
    paymentType,
    setPaymentType,
    utr,
    setUtr,
    plan,
  } = useEmployeeBookingStore();
  const isMonthly = plan === "MONTHLY";
  const { needsShift } = useActiveShift();
  const [utrTouched, setUtrTouched] = useState(false);
  const isUpi = paymentType === "UPI";
  const utrValid = isValidUtr(utr);

  const startDate = storeStartDate ? new Date(storeStartDate) : null;
  const endDate = storeEndDate ? new Date(storeEndDate) : null;

  const formattedPickupDate = startDate
    ? format(startDate, "MMM dd, yyyy")
    : "Select date";
  const formattedReturnDate = endDate
    ? format(endDate, "MMM dd, yyyy")
    : "Select date";

  const isAvailable = vehicle.availability;
  const pd = vehicle.pricingDetails;

  // Paise are shown when present: GST is rounded to the paisa, not the rupee.
  const formatCurrency = (amount: number) => formatInrExact(amount);

  // Office hours (#2) + 15-day window (#15) / monthly plan length (30–180 days).
  // Same calendar day as pickup stays selectable for the return.
  const startDayKey = startDate?.getTime();
  const endDayKey = endDate?.getTime();
  const limits = useMemo(
    () =>
      bookingPickerLimits({
        schedule,
        pickupDate: startDate,
        pickupTime: startTime || "10:00",
        returnDate: endDate,
        returnTime: endTime || "10:00",
        monthly: isMonthly,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schedule, startDayKey, startTime, endDayKey, endTime, isMonthly],
  );

  // What the price covers ("5 hours", "1 month + 5 days"); the period type is the fallback
  const billedLabel =
    pd?.pricingBreakdown.billedAs ??
    periodTypeLabels[pd?.pricingBreakdown.periodType ?? ""] ??
    pd?.pricingBreakdown.periodType;

  const isDateRangeValid = useMemo(() => {
    if (!startDate || !endDate) return true;
    const start = new Date(startDate);
    const [sh, sm] = (startTime || "10:00").split(":").map(Number);
    start.setHours(sh, sm, 0, 0);
    const end = new Date(endDate);
    const [eh, em] = (endTime || "10:00").split(":").map(Number);
    end.setHours(eh, em, 0, 0);
    return end > start;
  }, [startDate, endDate, startTime, endTime]);

  const handleStartDateSelect = (date: Date | undefined) => {
    if (!date) return;
    // Only push end date forward if it's strictly before the new start day
    if (endDate) {
      const startDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const endDay   = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
      const newEnd = endDay < startDay ? date : endDate;
      setDates(date, newEnd);
    } else {
      setDates(date, date);
    }
  };

  const handleEndDateSelect = (date: Date | undefined) => {
    if (!date) return;
    const newStart = startDate || date;
    setDates(newStart, date);
  };

  const canBook =
    isAvailable &&
    startDate &&
    endDate &&
    isDateRangeValid &&
    !limits.windowError &&
    !isRefetching &&
    !disabled &&
    hasCompleteKyc &&
    hasQrPhoto &&
    !needsShift &&
    (!isUpi || utrValid);

  return (
    <Card className="overflow-hidden border border-zinc-200 shadow-lg">
      <CardContent className="p-0">
        {/* Price Header */}
        <div className="p-6 border-b border-zinc-100">
          <div className="flex items-baseline justify-between">
            <div>
              <span className="text-3xl font-bold text-zinc-900">
                {vehicle.pricing.daily > 0 ? formatCurrency(vehicle.pricing.daily) : "—"}
              </span>
              {/* The header is the base for the picked period (12 hours, 1 month…), not a per-day rate */}
              <span className="text-sm text-zinc-500 ml-1">
                {vehicle.pricing.daily > 0 ? (pd?.pricingBreakdown.billedAs ? `/ ${pd.pricingBreakdown.billedAs}` : "/day") : ""}
              </span>
            </div>
            <div
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-semibold",
                isAvailable
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-red-100 text-red-700",
              )}
            >
              {isAvailable ? "Available" : "Not Available"}
            </div>
          </div>
        </div>

        {/* Branch */}
        <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-100">
          <div className="flex items-center gap-2 text-sm text-zinc-600">
            <MapPin className="size-4 text-orange-500" />
            <span>{vehicle.branch}</span>
          </div>
        </div>

        {/* Date + Time Selectors */}
        <div className="p-6 space-y-4 border-b border-zinc-100">
          <div className="grid grid-cols-2 gap-3">
            {/* Pickup Date */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Pickup Date
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal h-11",
                      !startDate && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 size-4" />
                    <span className="truncate text-sm">
                      {formattedPickupDate}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate || undefined}
                    onSelect={handleStartDateSelect}
                    disabled={limits.isPickupDayDisabled}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Pickup Time */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Pickup Time
              </label>
              <div className="h-11 w-full border border-input rounded-md px-3 flex items-center bg-background focus-within:ring-1 focus-within:ring-ring">
                <TimeSelect
                  value={startTime || "10:00"}
                  onChange={setStartTime}
                  isDisabled={limits.isPickupSlotDisabled}
                  className="w-full"
                />
              </div>
              <BranchHoursBadge schedule={schedule} date={startDate} kind="pickup" className="mt-0" />
            </div>

            {/* Return Date */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Return Date
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal h-11",
                      !endDate && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 size-4" />
                    <span className="truncate text-sm">
                      {formattedReturnDate}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate || undefined}
                    onSelect={handleEndDateSelect}
                    disabled={limits.isReturnDayDisabled}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Return Time */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Return Time
              </label>
              <div className="h-11 w-full border border-input rounded-md px-3 flex items-center bg-background focus-within:ring-1 focus-within:ring-ring">
                <TimeSelect
                  value={endTime || "10:00"}
                  onChange={setEndTime}
                  isDisabled={limits.isReturnSlotDisabled}
                  className="w-full"
                />
              </div>
              <BranchHoursBadge schedule={schedule} date={endDate} kind="return" className="mt-0" />
            </div>
          </div>

          {isMonthly ? (
            <p className="text-xs font-medium text-zinc-600">
              <span className="px-2 py-0.5 mr-1.5 rounded-full bg-zinc-900 text-white text-[10px] font-bold uppercase tracking-wide">
                Monthly rental
              </span>
              30 to 180 days
            </p>
          ) : (
            /* Quick durations (#5) */
            <DurationPresetChips
              pickupDate={startDate}
              pickupTime={startTime || "10:00"}
              returnDate={endDate}
              returnTime={endTime || "10:00"}
              schedule={schedule}
              onApply={(date, time) => {
                if (startDate) setDates(startDate, date);
                setEndTime(time);
              }}
            />
          )}

          {limits.windowError && (
            <p className="text-sm font-semibold text-red-500">{limits.windowError}</p>
          )}
        </div>

        {/* Pricing Breakdown */}
        <div className="p-6 space-y-3 border-b border-zinc-100 relative">
          {isRefetching && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
              <Loader2 className="size-5 text-orange-500 animate-spin" />
            </div>
          )}

          {pd && isDateRangeValid && !isRefetching && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2.5 py-0.5 text-[10px] font-bold bg-orange-50 text-orange-600 border border-orange-200 rounded-full uppercase tracking-wide">
                  {pd.pricingBreakdown.billedAs ? `Billed as ${billedLabel}` : billedLabel}
                </span>
                {startDate && endDate && (
                  <span className="text-xs text-zinc-400">
                    {formatRentalLength(
                      `${format(startDate, "yyyy-MM-dd")}T${startTime || "10:00"}`,
                      `${format(endDate, "yyyy-MM-dd")}T${endTime || "10:00"}`,
                    )}
                  </span>
                )}
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-zinc-600">Base Price</span>
                <span className="text-zinc-900 font-medium">
                  {formatCurrency(pd.basePrice)}
                </span>
              </div>

              {pd.discountAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-600 flex items-center gap-1">
                    <Check className="size-4" />
                    {durationDiscountTitle(
                      pd.durationDiscountLabel,
                      pd.durationDiscountPercent ?? round2(pd.discountPercent),
                      pd.durationDiscountType,
                    )}
                  </span>
                  <span className="text-emerald-600 font-medium">
                    -{formatCurrency(pd.discountAmount)}
                  </span>
                </div>
              )}

              {pd.discountAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-600">Taxable value</span>
                  <span className="text-zinc-900 font-medium">
                    {formatCurrency(round2(pd.basePrice - pd.discountAmount))}
                  </span>
                </div>
              )}

              {pd.taxAmount > 0 && (
                <div className="space-y-0.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-600">GST ({pd.taxRate}%)</span>
                    <span className="text-zinc-900 font-medium">
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

              <div className="pt-3 border-t border-zinc-200">
                <div className="flex justify-between">
                  <span className="text-base font-semibold text-zinc-900">
                    Total
                  </span>
                  <span className="text-xl font-bold text-zinc-900">
                    {formatCurrency(pd.finalTotal)}
                  </span>
                </div>
              </div>
            </>
          )}

          {!isDateRangeValid && startDate && endDate && !isRefetching && (
            <p className="text-sm text-red-500 text-center py-2 font-semibold">
              Return date/time must be after pickup date/time
            </p>
          )}

          {!pd && isDateRangeValid && !isRefetching && (
            <p className="text-sm text-zinc-500 text-center py-2">
              Select dates & times to see pricing
            </p>
          )}
        </div>

        {/* Deposit */}
        {!!vehicle.deposit && vehicle.deposit > 0 && (
          <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-100">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-600">Security Deposit</span>
              <span className="text-zinc-900 font-medium">
                {formatCurrency(vehicle.deposit)}
              </span>
            </div>
          </div>
        )}

        {/* Payment Type */}
        <div className="px-6 py-4 border-b border-zinc-100">
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide block mb-3">
            Payment Method
          </label>
          <RadioGroup
            value={paymentType}
            onValueChange={(val) => setPaymentType(val as EmployeePaymentType)}
            className="grid grid-cols-3 gap-3"
          >
            <div>
              <RadioGroupItem value="CASH" id="cash" className="peer sr-only" />
              <Label
                htmlFor="cash"
                className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-transparent p-4 hover:bg-zinc-50 hover:text-accent-foreground peer-data-[state=checked]:border-orange-500 peer-data-[state=checked]:text-orange-600 cursor-pointer"
              >
                <span className="text-xl mb-1">💵</span>
                <span className="text-sm font-semibold">Cash</span>
              </Label>
            </div>
            <div>
              <RadioGroupItem
                value="ONLINE"
                id="online"
                className="peer sr-only"
              />
              <Label
                htmlFor="online"
                className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-transparent p-4 hover:bg-zinc-50 hover:text-accent-foreground peer-data-[state=checked]:border-orange-500 peer-data-[state=checked]:text-orange-600 cursor-pointer"
              >
                <span className="text-xl mb-1">💳</span>
                <span className="text-sm font-semibold">Online</span>
              </Label>
            </div>
            <div>
              <RadioGroupItem value="UPI" id="upi" className="peer sr-only" />
              <Label
                htmlFor="upi"
                className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-transparent p-4 hover:bg-zinc-50 hover:text-accent-foreground peer-data-[state=checked]:border-orange-500 peer-data-[state=checked]:text-orange-600 cursor-pointer"
              >
                <span className="text-xl mb-1">📱</span>
                <span className="text-sm font-semibold whitespace-nowrap">UPI (UTR)</span>
              </Label>
            </div>
          </RadioGroup>

          {isUpi && (
            <div className="mt-4 space-y-1.5">
              <Label htmlFor="walkin-utr" className="text-sm">
                UTR number <span className="text-red-500">*</span>
              </Label>
              <Input
                id="walkin-utr"
                inputMode="numeric"
                autoComplete="off"
                maxLength={20}
                placeholder="12-digit UTR"
                value={utr}
                onChange={(e) => setUtr(e.target.value)}
                onBlur={() => setUtrTouched(true)}
                aria-invalid={utrTouched && !utrValid}
                className="h-11 font-mono tracking-wide"
              />
              {utrTouched && !utrValid ? (
                <p className="text-xs text-red-600">Enter the 12-digit UTR number.</p>
              ) : (
                <p className="text-xs text-zinc-500">
                  Customer pays the shop's UPI QR — enter the UTR from their UPI app.
                </p>
              )}
            </div>
          )}
        </div>

        {/* CTA */}
        <div className="p-6 space-y-3">
          {needsShift && <ShiftRequiredNotice />}
          <Button
            onClick={onBookVehicle}
            disabled={!canBook}
            className="w-full h-12 bg-orange-500 hover:bg-orange-600 text-white font-semibold text-base rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRefetching ? (
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                Updating...
              </span>
            ) : !isAvailable ? (
              "Currently Unavailable"
            ) : !hasCompleteKyc ? (
              "Select KYC Document"
            ) : !hasQrPhoto ? (
              "Capture QR Code Photo"
            ) : needsShift ? (
              "Open Cash Shift to Book"
            ) : isUpi && !utrValid ? (
              "Enter UTR Number"
            ) : (
              "Proceed to Booking"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

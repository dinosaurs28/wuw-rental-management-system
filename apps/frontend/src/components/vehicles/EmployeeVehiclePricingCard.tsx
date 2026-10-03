import { useEffect, useMemo } from "react";
import { format } from "date-fns";
import { CalendarIcon, MapPin, Check, Loader2, CreditCard } from "lucide-react";
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
import { round2 } from "@repo/schemas";
import { durationDiscountTitle } from "@/lib/paymentPlan";
import {
  PAYMENT_PROOF_REQUIRED_MESSAGE,
  counterPaymentProblem,
  type CounterPaymentValue,
} from "@/lib/counterPayment";
import { CounterPaymentFields } from "@/components/payment/counter/CounterPaymentFields";
import { useEmployeeBookingStore } from "@/store/employeeBooking.store";
import { ShiftRequiredNotice } from "@/components/employee/counter/ShiftRequiredNotice";
import { useActiveShift } from "@/components/employee/counter/useActiveShift";
import type { VehicleDetails } from "@/services/vehicle.service";
import type { BranchScheduleConfig } from "@/services/branch.service";
import { BranchHoursBadge } from "@/components/booking/BranchHoursBadge";
import {
  ExtraHoursSelect,
  PackageHints,
  PackageQuickChips,
  PackageSelect,
  formatPackageReturn,
} from "@/components/booking/PackagePicker";
import { bookingPickerLimits } from "@/utils/bookingPickers";
import { packageRangeState, returnForNewPickup, returnForPackage } from "@/utils/bookingPackages";

interface EmployeeVehiclePricingCardProps {
  vehicle: VehicleDetails;
  onBookVehicle: () => void;
  isRefetching?: boolean;
  disabled?: boolean;
  /** Customer QR code photo captured (#4). Omitted = not gated. The KYC document is optional (X2). */
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
    upiProof,
    setUpiProof,
    splitCash,
    setSplitCash,
    collateral,
    setCollateral,
    plan,
  } = useEmployeeBookingStore();
  const isMonthly = plan === "MONTHLY";
  const { needsShift } = useActiveShift();
  // Counter methods (#3 / #11): Cash / UPI (photo) / Split / Credit; "Online" = Razorpay
  const isOnline = paymentType === "ONLINE";
  const counterValue: CounterPaymentValue = {
    method: isOnline ? "CASH" : paymentType,
    proof: upiProof,
    splitCash,
    collateral,
  };

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
  // The rent incl. GST, its discounts and the GST inside it (item 17)
  const rent = rentInclGstView(pd ?? {});

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

  // Standard plan: a package (12 hours / 1–15 days) + 0–11 extra hours, the
  // return computed (P4a). The monthly plan keeps its own return picker.
  const usePackages = !isMonthly;
  const packageInput = {
    schedule,
    pickupDate: startDate,
    pickupTime: startTime || "10:00",
    returnDate: endDate,
    returnTime: endTime || "10:00",
    allowExtraHours: true,
  };
  const pkg = useMemo(
    () => packageRangeState(packageInput),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schedule, startDayKey, startTime, endDayKey, endTime],
  );
  const applyReturn = (ret: { returnDate: Date; returnTime: string } | null) => {
    if (!ret || !startDate) return;
    setDates(startDate, ret.returnDate);
    setEndTime(ret.returnTime);
  };
  // A range that isn't a package (+ extra hours) that can be booked snaps to one
  const correctionKey =
    usePackages && pkg.correction
      ? `${pkg.correction.returnDate.getTime()}|${pkg.correction.returnTime}`
      : "";
  useEffect(() => {
    if (usePackages && pkg.correction) applyReturn(pkg.correction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correctionKey]);

  const handlePickupTimeChange = (time: string) => {
    setStartTime(time);
    if (usePackages) applyReturn(returnForNewPickup(packageInput, { pickupDate: startDate, pickupTime: time }));
  };
  const choosePackage = (packageHours: number) =>
    applyReturn(returnForPackage(packageInput, { packageHours, extraHours: pkg.extraHours }));
  const chooseExtraHours = (extraHours: number) => {
    if (!pkg.selected) return;
    applyReturn(returnForPackage(packageInput, { packageHours: pkg.selected.hours, extraHours }));
  };

  const handleStartDateSelect = (date: Date | undefined) => {
    if (!date) return;
    // Packages: the return moves with the pickup, keeping the length
    if (usePackages) {
      const ret = returnForNewPickup(packageInput, { pickupDate: date, pickupTime: startTime || "10:00" });
      setDates(date, ret?.returnDate ?? date);
      if (ret) setEndTime(ret.returnTime);
      return;
    }
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

  // What the customer pays at the counter (rent incl. GST after discounts + deposit) —
  // shown as the split's total; the server works out the exact UPI part.
  const walkInTotal = pd ? round2(rent.rentAfterDiscount + (vehicle.deposit ?? 0)) : null;
  const paymentProblem = isOnline ? null : counterPaymentProblem(counterValue, walkInTotal);

  const canBook =
    isAvailable &&
    startDate &&
    endDate &&
    isDateRangeValid &&
    !limits.windowError &&
    (!usePackages || (!!pkg.selected && !pkg.correction)) &&
    !isRefetching &&
    !disabled &&
    hasQrPhoto &&
    !needsShift &&
    !paymentProblem;

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
                {vehicle.pricing.daily > 0 && " · incl. GST"}
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
                  onChange={handlePickupTimeChange}
                  isDisabled={limits.isPickupSlotDisabled}
                  className="w-full"
                />
              </div>
              <BranchHoursBadge schedule={schedule} date={startDate} kind="pickup" className="mt-0" />
            </div>

            {usePackages ? (
              <>
                {/* Rental length + extra hours (Fleet) — the return follows */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Rental Length
                  </label>
                  <PackageSelect
                    state={pkg}
                    onSelect={choosePackage}
                    triggerClassName="!h-11 w-full text-sm font-normal"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Extra Hours
                  </label>
                  <ExtraHoursSelect
                    state={pkg}
                    onSelect={chooseExtraHours}
                    triggerClassName="!h-11 w-full text-sm font-normal"
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Return
                  </label>
                  <div
                    aria-live="polite"
                    className="h-11 w-full border border-input rounded-md px-3 flex items-center gap-2 bg-zinc-50 text-sm"
                  >
                    <CalendarIcon className="size-4 text-zinc-400 shrink-0" />
                    <span className="truncate">
                      {pkg.selected ? formatPackageReturn(pkg.returnAt) : "—"}
                    </span>
                  </div>
                  <BranchHoursBadge schedule={schedule} date={endDate} kind="return" className="mt-0" />
                </div>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>

          {isMonthly ? (
            <p className="text-xs font-medium text-zinc-600">
              <span className="px-2 py-0.5 mr-1.5 rounded-full bg-zinc-900 text-white text-[10px] font-bold uppercase tracking-wide">
                Monthly rental
              </span>
              30 to 180 days
            </p>
          ) : (
            /* Quick lengths (#5) + why 12 hours is off / what the extra hours cost */
            <div className="space-y-1.5">
              <PackageQuickChips state={pkg} onSelect={choosePackage} />
              <PackageHints state={pkg} showExtraHoursNote />
            </div>
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
              </div>

              {/* Rent is GST-inclusive (item 17): GST is inside the price */}
              <div className="flex justify-between text-sm">
                <span className="text-zinc-600">Rent (incl. GST)</span>
                <span className="text-zinc-900 font-medium">
                  {formatCurrency(rent.rent)}
                </span>
              </div>

              {rent.discount > 0 && (
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
                    -{formatCurrency(rent.discount)}
                  </span>
                </div>
              )}

              {rent.gst > 0 && (
                <div className="space-y-0.5 text-right">
                  <p className="text-xs text-zinc-500">{rentGstSplitText(rent)}</p>
                  {(rent.cgst > 0 || rent.sgst > 0) && (
                    <p className="text-xs text-zinc-400">
                      GST: {rentGstPartsText(rent.cgst, rent.sgst, pd.cgstRate, pd.sgstRate)}
                    </p>
                  )}
                </div>
              )}

              <div className="pt-3 border-t border-zinc-200">
                <div className="flex justify-between">
                  <span className="text-base font-semibold text-zinc-900">
                    Total <span className="text-xs font-normal text-zinc-500">(rent incl. GST)</span>
                  </span>
                  <span className="text-xl font-bold text-zinc-900">
                    {formatCurrency(rent.rentAfterDiscount)}
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

        {/* Payment — Cash / UPI (photo of the customer's payment screen) / Split / Credit (#3, #11), or Online (Razorpay) */}
        <div className="px-6 py-4 border-b border-zinc-100">
          <CounterPaymentFields
            idPrefix="walkin-pay"
            label="Payment method"
            value={counterValue}
            onChange={(next) => {
              setPaymentType(next.method);
              setUpiProof(next.proof);
              setSplitCash(next.splitCash);
              setCollateral(next.collateral);
            }}
            amount={walkInTotal}
            proofRole="staff"
            extraChip={{
              label: "Online",
              icon: <CreditCard className="h-4 w-4" />,
              selected: isOnline,
              onSelect: () => setPaymentType("ONLINE"),
            }}
            cashNote={
              <p className="text-xs text-zinc-500">
                The branch manager confirms the cash from your shift.
              </p>
            }
          />
          {isOnline && (
            <p className="mt-3 text-xs text-zinc-500">
              The customer pays by card / UPI in the secure checkout on the next screen.
            </p>
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
            ) : !hasQrPhoto ? (
              "Capture QR Code Photo"
            ) : needsShift ? (
              "Open Cash Shift to Book"
            ) : paymentProblem ? (
              paymentType === "CREDIT"
                ? "Note the Collateral Held"
                : paymentProblem === PAYMENT_PROOF_REQUIRED_MESSAGE
                  ? "Add the Payment Photo"
                  : "Check the Split Amounts"
            ) : (
              "Proceed to Booking"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

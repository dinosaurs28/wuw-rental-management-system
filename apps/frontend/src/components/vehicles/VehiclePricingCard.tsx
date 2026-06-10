import { useMemo } from "react";
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
import { useVehicleRentalStore } from "@/store/vehicleRental.store";
import type { VehicleDetails } from "@/services/vehicle.service";

interface VehiclePricingCardProps {
  vehicle: VehicleDetails;
  onBookVehicle: () => void;
  isRefetching?: boolean;
}

const periodTypeLabels: Record<string, string> = {
  HOURLY: "Hourly",
  HALF_DAY: "Half Day",
  FULL_DAY: "Full Day",
  MULTI_DAY: "Multi Day",
};

export const VehiclePricingCard = ({
  vehicle,
  onBookVehicle,
  isRefetching = false,
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

  const formattedPickupDate = pickupDate
    ? format(pickupDate, "MMM dd, yyyy")
    : "Select date";
  const formattedReturnDate = returnDate
    ? format(returnDate, "MMM dd, yyyy")
    : "Select date";

  const isAvailable = vehicle.availability;
  const pd = vehicle.pricingDetails;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const disabledDays = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return { before: today };
  }, []);

  const returnDisabledDays = useMemo(() => {
    if (pickupDate) return { before: pickupDate };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return { before: today };
  }, [pickupDate]);

  const handlePickupDateChange = (date: Date | undefined) => {
    setStartDate(date || null);
  };

  const handleReturnDateChange = (date: Date | undefined) => {
    setEndDate(date || null);
  };

  const canBook = isAvailable && pickupDate && returnDate && !isRefetching;

  return (
    <Card className="overflow-hidden bg-white border border-zinc-200 shadow-2xl rounded-[2rem]">
      <CardContent className="p-0">
        {/* Price Header */}
        <div className="p-5 sm:p-8 border-b border-zinc-200">
          <div className="flex items-baseline mb-4">
            <span className="text-4xl lg:text-5xl font-serif font-black text-zinc-900 tracking-tight">
              {formatCurrency(vehicle.pricing.daily)}
            </span>
            <span className="text-sm font-bold text-zinc-500 uppercase tracking-wider ml-2">
              /day
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
                    disabled={disabledDays}
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
                <TimeSelect value={startTime || "10:00"} onChange={setStartTime} className="w-full" />
              </div>
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
                    disabled={returnDisabledDays}
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
                <TimeSelect value={endTime || "10:00"} onChange={setEndTime} className="w-full" />
              </div>
            </div>
          </div>
        </div>

        {/* Pricing Breakdown */}
        <div className="p-5 sm:p-8 space-y-4 border-b border-zinc-200 relative">
          {isRefetching && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center z-10">
              <Loader2 className="size-6 text-orange-500 animate-spin" />
            </div>
          )}

          {pd && !isRefetching && (
            <>
              {/* Period type badge */}
              <div className="flex items-center gap-2 mb-2">
                <span className="px-3 py-1 text-[10px] font-black tracking-[0.15em] bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-full uppercase">
                  {periodTypeLabels[pd.pricingBreakdown.periodType] ||
                    pd.pricingBreakdown.periodType}
                </span>
                <span className="text-xs text-zinc-500">
                  {pd.pricingBreakdown.duration.days > 0 &&
                    `${pd.pricingBreakdown.duration.days}d `}
                  {pd.pricingBreakdown.duration.hours > 0 &&
                    `${pd.pricingBreakdown.duration.hours}h `}
                  {pd.pricingBreakdown.duration.minutes > 0 &&
                    `${pd.pricingBreakdown.duration.minutes}m`}
                </span>
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
                    Discount ({pd.discountPercent}%)
                  </span>
                  <span className="text-emerald-400 font-medium">
                    -{formatCurrency(pd.discountAmount)}
                  </span>
                </div>
              )}

              {pd.taxAmount > 0 && (
                <div className="flex justify-between text-base">
                  <span className="text-zinc-400">GST ({pd.taxRate}%)</span>
                  <span className="text-zinc-700 font-medium">
                    +{formatCurrency(pd.taxAmount)}
                  </span>
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

          {!pd && !isRefetching && (
            <p className="text-base text-zinc-500 text-center py-4 font-medium">
              Select dates & times to see pricing
            </p>
          )}
        </div>

        {/* Deposit Info */}
        <div className="px-5 py-4 sm:px-8 sm:py-6 bg-zinc-50 border-b border-zinc-200">
          <div className="flex justify-between text-base">
            <span className="text-zinc-400">Security Deposit</span>
            <span className="text-zinc-900 font-medium">
              {formatCurrency(vehicle.deposit)}
            </span>
          </div>
        </div>

        {/* Advance Payment Option */}
        {!!vehicle.advancePayAmount && vehicle.advancePayAmount > 0 && !!pd && (
          <div className="px-5 py-4 sm:px-8 sm:py-6 border-b border-zinc-200 space-y-3">
            <p className="text-xs font-black text-zinc-500 uppercase tracking-[0.2em]">
              Payment Plan
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPaymentFlow("FULL")}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-4 rounded-2xl border-2 transition-all",
                  paymentFlow === "FULL"
                    ? "bg-white text-zinc-950 border-zinc-900 shadow-sm"
                    : "bg-white/10 text-zinc-300 border-zinc-600 hover:border-zinc-400 hover:text-zinc-100",
                )}
              >
                <Check className={cn("size-4", paymentFlow === "FULL" ? "text-zinc-900" : "text-zinc-400")} />
                <span className="text-xs font-black uppercase tracking-wider">
                  Full Pay
                </span>
                <span className="text-xs font-medium">
                  {formatCurrency(pd.finalTotal)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setPaymentFlow("ADVANCE")}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-4 rounded-2xl border-2 transition-all",
                  paymentFlow === "ADVANCE"
                    ? "bg-orange-500 text-white border-orange-500 shadow-sm"
                    : "bg-white/10 text-zinc-300 border-zinc-600 hover:border-zinc-400 hover:text-zinc-100",
                )}
              >
                <Wallet className="size-4" />
                <span className="text-xs font-black uppercase tracking-wider">
                  Advance
                </span>
                <span className="text-xs font-medium">
                  {formatCurrency(vehicle.advancePayAmount)} now
                </span>
              </button>
            </div>
            {paymentFlow === "ADVANCE" ? (
              <div className="text-xs text-zinc-400 space-y-1">
                <div className="flex justify-between">
                  <span>Pay now (advance)</span>
                  <span className="text-orange-400 font-bold">
                    {formatCurrency(vehicle.advancePayAmount)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Remaining (at pickup)</span>
                  <span className="text-zinc-300">
                    {formatCurrency(pd.finalTotal - vehicle.advancePayAmount)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-400 text-center">
                Pay the full amount upfront — no balance due at pickup.
              </p>
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

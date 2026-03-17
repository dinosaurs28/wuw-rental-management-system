import { useMemo } from "react";
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
import { cn } from "@/lib/utils";
import { useEmployeeBookingStore } from "@/store/employeeBooking.store";
import type { VehicleDetails } from "@/services/vehicle.service";

interface EmployeeVehiclePricingCardProps {
  vehicle: VehicleDetails;
  onBookVehicle: () => void;
  isRefetching?: boolean;
  disabled?: boolean;
}

const periodTypeLabels: Record<string, string> = {
  HOURLY: "Hourly",
  HALF_DAY: "Half Day",
  FULL_DAY: "Full Day",
  MULTI_DAY: "Multi Day",
};

export const EmployeeVehiclePricingCard = ({
  vehicle,
  onBookVehicle,
  isRefetching = false,
  disabled = false,
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
  } = useEmployeeBookingStore();

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
    if (startDate) return { before: startDate };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return { before: today };
  }, [startDate]);

  const handleStartDateSelect = (date: Date | undefined) => {
    if (!date) return;
    const newEnd = endDate && date > endDate ? date : endDate || date;
    setDates(date, newEnd);
  };

  const handleEndDateSelect = (date: Date | undefined) => {
    if (!date) return;
    const newStart = startDate || date;
    setDates(newStart, date);
  };

  const canBook =
    isAvailable && startDate && endDate && !isRefetching && !disabled;

  return (
    <Card className="overflow-hidden border border-zinc-200 shadow-lg">
      <CardContent className="p-0">
        {/* Price Header */}
        <div className="p-6 border-b border-zinc-100">
          <div className="flex items-baseline justify-between">
            <div>
              <span className="text-3xl font-bold text-zinc-900">
                {formatCurrency(vehicle.pricing.daily)}
              </span>
              <span className="text-sm text-zinc-500 ml-1">/day</span>
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
                    disabled={disabledDays}
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
              <input
                type="time"
                value={startTime || "10:00"}
                onChange={(e) => setStartTime(e.target.value)}
                className="h-11 w-full border border-input rounded-md px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring bg-background"
              />
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
                    disabled={returnDisabledDays}
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
              <input
                type="time"
                value={endTime || "10:00"}
                onChange={(e) => setEndTime(e.target.value)}
                className="h-11 w-full border border-input rounded-md px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring bg-background"
              />
            </div>
          </div>
        </div>

        {/* Pricing Breakdown */}
        <div className="p-6 space-y-3 border-b border-zinc-100 relative">
          {isRefetching && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
              <Loader2 className="size-5 text-orange-500 animate-spin" />
            </div>
          )}

          {pd && !isRefetching && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2.5 py-0.5 text-[10px] font-bold bg-orange-50 text-orange-600 border border-orange-200 rounded-full uppercase tracking-wide">
                  {periodTypeLabels[pd.pricingBreakdown.periodType] ||
                    pd.pricingBreakdown.periodType}
                </span>
                <span className="text-xs text-zinc-400">
                  {pd.pricingBreakdown.duration.days > 0 &&
                    `${pd.pricingBreakdown.duration.days}d `}
                  {pd.pricingBreakdown.duration.hours > 0 &&
                    `${pd.pricingBreakdown.duration.hours}h `}
                  {pd.pricingBreakdown.duration.minutes > 0 &&
                    `${pd.pricingBreakdown.duration.minutes}m`}
                </span>
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
                    Discount ({pd.discountPercent}%)
                  </span>
                  <span className="text-emerald-600 font-medium">
                    -{formatCurrency(pd.discountAmount)}
                  </span>
                </div>
              )}

              {pd.taxAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-600">GST ({pd.taxRate}%)</span>
                  <span className="text-zinc-900 font-medium">
                    +{formatCurrency(pd.taxAmount)}
                  </span>
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

          {!pd && !isRefetching && (
            <p className="text-sm text-zinc-500 text-center py-2">
              Select dates & times to see pricing
            </p>
          )}
        </div>

        {/* Deposit */}
        <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-100">
          <div className="flex justify-between text-sm">
            <span className="text-zinc-600">Security Deposit</span>
            <span className="text-zinc-900 font-medium">
              {formatCurrency(vehicle.deposit)}
            </span>
          </div>
        </div>

        {/* Payment Type */}
        <div className="px-6 py-4 border-b border-zinc-100">
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide block mb-3">
            Payment Method
          </label>
          <RadioGroup
            value={paymentType}
            onValueChange={(val) => setPaymentType(val as "CASH" | "ONLINE")}
            className="grid grid-cols-2 gap-4"
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
          </RadioGroup>
        </div>

        {/* CTA */}
        <div className="p-6">
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
            ) : isAvailable ? (
              "Proceed to Booking"
            ) : (
              "Currently Unavailable"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  CalendarIcon,
  Check,
  Loader2,
  Wallet,
  Gauge,
  ChevronDown,
} from "lucide-react";
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
import type { VehicleGroupDetails } from "@/services/vehicle.service";

interface VehicleBookingPanelProps {
  group: VehicleGroupDetails;
  onBookVehicle: () => void;
  isRefetching?: boolean;
}

const periodTypeLabels: Record<string, string> = {
  HOURLY: "Hourly",
  HALF_DAY: "Half Day",
  FULL_DAY: "Full Day",
  MULTI_DAY: "Multi Day",
};

export const VehicleBookingPanel = ({
  group,
  onBookVehicle,
  isRefetching = false,
}: VehicleBookingPanelProps) => {
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

  const [showBreakdown, setShowBreakdown] = useState(false);

  const pickupDate = getStartDate();
  const returnDate = getEndDate();
  const pd = group.pricingDetails;
  const isAvailable = group.availability;

  const fmt = (amount: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);

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

  const hasAdvance = !!group.advancePayAmount && group.advancePayAmount > 0 && !!pd;
  const canBook = isAvailable && pickupDate && returnDate && !isRefetching;

  const sectionTitle =
    "text-base font-black text-zinc-900 tracking-tight mb-4";

  const dateTrigger = (label: string, value: Date | null) => (
    <Button
      variant="outline"
      className={cn(
        "w-full justify-start text-left font-medium h-11 rounded-xl bg-white border-zinc-200 hover:bg-zinc-50 text-zinc-900 hover:text-zinc-900",
        !value && "text-zinc-400",
      )}
    >
      <CalendarIcon className="mr-2 size-4 text-zinc-400" />
      <span className="truncate text-sm">
        {value ? format(value, "MMM dd, yyyy") : `${label}`}
      </span>
    </Button>
  );

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Scrollable booking content */}
      <div className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-8">
        {/* Rental period */}
        <section>
          <h3 className={sectionTitle}>Rental period</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">
                Pickup
              </label>
              <Popover>
                <PopoverTrigger asChild>{dateTrigger("Select", pickupDate)}</PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={pickupDate || undefined}
                    onSelect={(d) => setStartDate(d || null)}
                    disabled={disabledDays}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <div className="h-11 w-full bg-white border border-zinc-200 text-zinc-900 rounded-xl px-3 flex items-center focus-within:border-zinc-400 transition-colors">
                <TimeSelect value={startTime || "10:00"} onChange={setStartTime} className="w-full" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">
                Return
              </label>
              <Popover>
                <PopoverTrigger asChild>{dateTrigger("Select", returnDate)}</PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={returnDate || undefined}
                    onSelect={(d) => setEndDate(d || null)}
                    disabled={returnDisabledDays}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <div className="h-11 w-full bg-white border border-zinc-200 text-zinc-900 rounded-xl px-3 flex items-center focus-within:border-zinc-400 transition-colors">
                <TimeSelect value={endTime || "10:00"} onChange={setEndTime} className="w-full" />
              </div>
            </div>
          </div>
        </section>

        {/* Mileage — real freeKmLimit / extraKmRate */}
        {pd && (
          <section>
            <h3 className={sectionTitle}>Mileage</h3>
            <div className="rounded-2xl border-2 border-zinc-900 p-4 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-5 items-center justify-center rounded-full bg-zinc-900">
                  <span className="size-2 rounded-full bg-white" />
                </span>
                <div>
                  <p className="flex items-center gap-2 font-bold text-zinc-900">
                    <Gauge className="size-4 text-zinc-500" />
                    {pd.freeKmLimit > 0
                      ? `${pd.freeKmLimit.toLocaleString("en-IN")} km included`
                      : "Per-km pricing"}
                  </p>
                  {pd.extraKmRate > 0 && (
                    <p className="text-sm text-zinc-500 mt-1">
                      +{fmt(pd.extraKmRate)} for every additional km
                    </p>
                  )}
                </div>
              </div>
              <span className="shrink-0 text-xs font-bold text-zinc-900">
                Included
              </span>
            </div>
          </section>
        )}

        {/* Payment plan — fills the "Booking option" slot with real data */}
        {pd && (
          <section>
            <h3 className={sectionTitle}>Payment plan</h3>
            {hasAdvance ? (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setPaymentFlow("FULL")}
                  className={cn(
                    "w-full flex items-center justify-between gap-4 rounded-2xl border-2 p-4 text-left transition-all",
                    paymentFlow === "FULL"
                      ? "border-zinc-900"
                      : "border-zinc-200 hover:border-zinc-300",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 flex size-5 items-center justify-center rounded-full border-2",
                        paymentFlow === "FULL"
                          ? "border-zinc-900 bg-zinc-900"
                          : "border-zinc-300",
                      )}
                    >
                      {paymentFlow === "FULL" && (
                        <span className="size-2 rounded-full bg-white" />
                      )}
                    </span>
                    <div>
                      <p className="font-bold text-zinc-900">Pay in full</p>
                      <p className="text-sm text-zinc-500 mt-0.5">
                        No balance due at pickup.
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 font-bold text-zinc-900">
                    {fmt(pd.finalTotal)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentFlow("ADVANCE")}
                  className={cn(
                    "w-full flex items-center justify-between gap-4 rounded-2xl border-2 p-4 text-left transition-all",
                    paymentFlow === "ADVANCE"
                      ? "border-zinc-900"
                      : "border-zinc-200 hover:border-zinc-300",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 flex size-5 items-center justify-center rounded-full border-2",
                        paymentFlow === "ADVANCE"
                          ? "border-zinc-900 bg-zinc-900"
                          : "border-zinc-300",
                      )}
                    >
                      {paymentFlow === "ADVANCE" && (
                        <span className="size-2 rounded-full bg-white" />
                      )}
                    </span>
                    <div>
                      <p className="flex items-center gap-2 font-bold text-zinc-900">
                        <Wallet className="size-4 text-zinc-500" /> Pay advance
                      </p>
                      <p className="text-sm text-zinc-500 mt-0.5">
                        {fmt(group.advancePayAmount)} now,{" "}
                        {fmt(pd.finalTotal - group.advancePayAmount)} at pickup.
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#FF5F00] px-3 py-1 text-xs font-bold text-white">
                    {fmt(group.advancePayAmount)}
                  </span>
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border-2 border-zinc-900 p-4 flex items-center gap-3">
                <Check className="size-5 text-zinc-900" />
                <p className="font-bold text-zinc-900">
                  Pay in full —{" "}
                  <span className="font-medium text-zinc-500">
                    no balance due at pickup.
                  </span>
                </p>
              </div>
            )}
          </section>
        )}

        {/* Price details (collapsible breakdown) */}
        {pd && (
          <section>
            <button
              type="button"
              onClick={() => setShowBreakdown((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-bold text-zinc-900 underline decoration-[#FF5F00] decoration-2 underline-offset-4 hover:text-[#FF5F00] transition-colors"
            >
              Price details
              <ChevronDown
                className={cn(
                  "size-4 transition-transform",
                  showBreakdown && "rotate-180",
                )}
              />
            </button>
            {showBreakdown && (
              <div className="mt-4 space-y-3 rounded-2xl bg-zinc-50 p-4 text-sm">
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded-full bg-[#FF5F00]/10 px-2.5 py-1 font-bold uppercase tracking-wider text-[#FF5F00]">
                    {periodTypeLabels[pd.pricingBreakdown.periodType] ||
                      pd.pricingBreakdown.periodType}
                  </span>
                  <span className="text-zinc-400">
                    {pd.pricingBreakdown.duration.days > 0 &&
                      `${pd.pricingBreakdown.duration.days}d `}
                    {pd.pricingBreakdown.duration.hours > 0 &&
                      `${pd.pricingBreakdown.duration.hours}h `}
                    {pd.pricingBreakdown.duration.minutes > 0 &&
                      `${pd.pricingBreakdown.duration.minutes}m`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Base price</span>
                  <span className="font-medium text-zinc-900">
                    {fmt(pd.basePrice)}
                  </span>
                </div>
                {pd.discountAmount > 0 && (
                  <div className="flex justify-between">
                    <span className="flex items-center gap-1.5 text-emerald-600">
                      <Check className="size-4" />
                      Discount ({pd.discountPercent}%)
                    </span>
                    <span className="font-medium text-emerald-600">
                      -{fmt(pd.discountAmount)}
                    </span>
                  </div>
                )}
                {pd.cgstAmount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">
                      CGST ({(pd.taxRate / 2).toFixed(1)}%)
                    </span>
                    <span className="font-medium text-zinc-700">
                      +{fmt(pd.cgstAmount)}
                    </span>
                  </div>
                )}
                {pd.sgstAmount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">
                      SGST ({(pd.taxRate / 2).toFixed(1)}%)
                    </span>
                    <span className="font-medium text-zinc-700">
                      +{fmt(pd.sgstAmount)}
                    </span>
                  </div>
                )}
                {pd.cgstAmount === 0 && pd.sgstAmount === 0 && pd.taxAmount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">GST ({pd.taxRate}%)</span>
                    <span className="font-medium text-zinc-700">
                      +{fmt(pd.taxAmount)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t border-zinc-200 pt-3">
                  <span className="text-zinc-500">Security deposit</span>
                  <span className="font-medium text-zinc-900">
                    {fmt(group.deposit)}
                  </span>
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Sticky price + CTA footer */}
      <div className="border-t border-zinc-200 p-6 lg:p-8 bg-white">
        {pd ? (
          <div className="mb-4 flex items-baseline gap-3">
            <span className="text-3xl font-serif font-black tracking-tight text-zinc-900">
              {fmt(group.pricing.daily ?? 0)}
            </span>
            <span className="text-sm font-bold uppercase tracking-wider text-zinc-400">
              /day
            </span>
            <span className="ml-auto text-sm text-zinc-500">
              <span className="font-bold text-zinc-900">{fmt(pd.finalTotal)}</span>{" "}
              total
            </span>
          </div>
        ) : (
          <p className="mb-4 text-center text-sm font-medium text-zinc-500">
            Select dates &amp; times to see pricing
          </p>
        )}

        <Button
          onClick={onBookVehicle}
          disabled={!canBook}
          className="h-14 w-full rounded-2xl bg-[#FF5F00] text-base font-black uppercase tracking-widest text-white transition-all hover:bg-[#E55500] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
        >
          {isRefetching ? (
            <span className="flex items-center gap-2">
              <Loader2 className="size-5 animate-spin" /> Updating…
            </span>
          ) : isAvailable ? (
            "Next"
          ) : (
            "Unavailable"
          )}
        </Button>
        {(!pickupDate || !returnDate) && isAvailable && !isRefetching && (
          <p className="mt-3 text-center text-xs font-bold uppercase tracking-wider text-zinc-500">
            Please select dates &amp; times
          </p>
        )}
      </div>
    </div>
  );
};

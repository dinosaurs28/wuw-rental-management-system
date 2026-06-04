import { useNavigate } from "react-router-dom";
import { Car, ChevronRight, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { PublicVehicle, ManagerVehicle } from "@/services/vehicle.service";

interface VehicleCardProps {
  vehicle: PublicVehicle | ManagerVehicle;
  basePath?: string;
  startDateTime?: string;
  endDateTime?: string;
  /** "light" keeps the original card (internal/employee pages); "dark" is the public Sixt-style card. */
  variant?: "light" | "dark";
}

export const VehicleCard = ({
  vehicle,
  basePath = "/vehicle",
  startDateTime,
  endDateTime,
  variant = "light",
}: VehicleCardProps) => {
  const navigate = useNavigate();

  const imageUrl =
    "images" in vehicle
      ? vehicle.images?.[0]?.file?.url
      : vehicle.imageUrl?.[0]?.file?.url;

  // Helper to get category name from either type
  const getCategoryName = () => {
    return typeof vehicle.category === "string"
      ? vehicle.category
      : vehicle.category.name;
  };

  // Helper to get display price - use pricingDetails.finalPrice if available
  const getDisplayPrice = () => {
    if ("pricingDetails" in vehicle && vehicle.pricingDetails) {
      return vehicle.pricingDetails.finalPrice;
    }
    return "pricing" in vehicle
      ? vehicle.pricing.daily
      : vehicle.customPricing;
  };

  // Helper to get price label based on pricing type
  const getPriceLabel = () => {
    if ("pricingDetails" in vehicle && vehicle.pricingDetails) {
      const typeMap: Record<string, string> = {
        HOURLY: "/ hour",
        HALF_DAY: "/ half day",
        FULL_DAY: "/ day",
        MULTI_DAY: "total",
      };
      return typeMap[vehicle.pricingDetails.type] || "/ day";
    }
    return "/ day";
  };

  const handleViewVehicle = () => {
    const params = new URLSearchParams();
    if (startDateTime) params.set("start", startDateTime);
    if (endDateTime) params.set("end", endDateTime);
    const query = params.toString();

    // Grouped public vehicles use groupKey; manager/employee vehicles use publicId
    if ("groupKey" in vehicle) {
      navigate(`${basePath}/group/${encodeURIComponent(vehicle.groupKey)}${query ? `?${query}` : ""}`);
    } else {
      navigate(`${basePath}/${(vehicle as any).publicId}${query ? `?${query}` : ""}`);
    }
  };

  const hasPricingDetails =
    "pricingDetails" in vehicle && vehicle.pricingDetails;

  // Period-type label as a short, real chip (e.g. "Full day")
  const getPeriodChip = () => {
    if (!hasPricingDetails) return null;
    const map: Record<string, string> = {
      HOURLY: "Hourly",
      HALF_DAY: "Half day",
      FULL_DAY: "Full day",
      MULTI_DAY: "Multi-day",
    };
    return map[(vehicle as PublicVehicle).pricingDetails!.type] || null;
  };

  const availableCount =
    "availableCount" in vehicle ? vehicle.availableCount : undefined;

  const availabilityTone =
    availableCount === undefined
      ? ""
      : availableCount >= 3
      ? "bg-green-500"
      : availableCount >= 1
      ? "bg-yellow-500"
      : "bg-red-500";

  // Secondary per-day rate, only when the headline is a multi-day total (both real fields)
  const dailyRate =
    "pricing" in vehicle ? vehicle.pricing?.daily : undefined;
  const showSecondaryDaily =
    hasPricingDetails &&
    (vehicle as PublicVehicle).pricingDetails!.type === "MULTI_DAY" &&
    !!dailyRate;

  // ---------------------------------------------------------------------------
  // Dark Sixt-style card (public pages) — real data only
  // ---------------------------------------------------------------------------
  if (variant === "dark") {
    const periodChip = getPeriodChip();
    return (
      <div className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#23272c] via-[#1a1d21] to-[#101214] shadow-lg transition-all duration-300 hover:border-white/25 hover:shadow-2xl">
        {/* Header: title + category */}
        <div className="px-5 pt-5">
          <h3 className="text-xl font-black uppercase leading-tight tracking-tight text-white">
            {vehicle.make} {vehicle.model}
          </h3>
          <p className="mt-1 text-sm font-medium text-zinc-400">
            {getCategoryName()}
          </p>

          {/* Real-data chips: branch, period type, availability */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {"branch" in vehicle && vehicle.branch && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-zinc-200">
                <MapPin className="size-3" />
                {vehicle.branch}
              </span>
            )}
            {periodChip && (
              <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-zinc-200">
                {periodChip}
              </span>
            )}
            {availableCount !== undefined && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-zinc-200">
                <span className={`size-1.5 rounded-full ${availabilityTone}`} />
                {availableCount} available
              </span>
            )}
          </div>
        </div>

        {/* Vehicle image with spotlight backdrop */}
        <div className="relative mt-2 h-44 px-6">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_60%_55%,rgba(255,255,255,0.16),transparent_65%)]" />
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={`${vehicle.make} ${vehicle.model}`}
              className="relative h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="relative flex h-full w-full items-center justify-center">
              <Car className="size-16 text-white/20" />
            </div>
          )}
        </div>

        {/* Price block */}
        <div className="mt-auto px-5 pb-4 pt-2">
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-black tracking-tight text-white">
              ₹{getDisplayPrice() as number}
            </span>
            <span className="text-xs font-bold text-zinc-400">
              {getPriceLabel()}
            </span>
          </div>
          {showSecondaryDaily && (
            <div className="mt-0.5 text-xs font-medium text-zinc-500">
              ₹{dailyRate} / day
            </div>
          )}
        </div>

        {/* Full-width CTA footer */}
        <button
          onClick={handleViewVehicle}
          className="flex w-full items-center justify-center gap-1 bg-[#FF5F00] py-3.5 text-sm font-bold uppercase tracking-wider text-white transition-colors hover:bg-[#E55500]"
        >
          Select
          <ChevronRight className="size-4" />
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Original light card (internal / employee pages)
  // ---------------------------------------------------------------------------
  return (
    <Card className="group overflow-hidden bg-white border-2 border-gray-100 rounded-none hover:border-gray-300 transition-all duration-300 relative flex flex-col h-full shadow-sm hover:shadow-xl">
      {/* Vehicle Image Container */}
      <div className="relative aspect-[4/3] bg-white overflow-hidden p-6">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`${vehicle.make} ${vehicle.model}`}
            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-50">
            <Car className="size-16 text-gray-300" />
          </div>
        )}

        {/* Category Label (Top Left) */}
        <div className="absolute top-4 left-4 z-10">
          <span className="px-3 py-1 bg-black text-white text-[10px] font-black tracking-[0.2em] uppercase rounded-sm">
            {getCategoryName()}
          </span>
        </div>

        {/* Period Type Label */}
        {hasPricingDetails && (
          <div className="absolute top-4 right-4 z-10">
            <span className="px-3 py-1 bg-[#FF5F00] text-white text-[10px] font-black tracking-[0.15em] uppercase rounded-sm">
              {vehicle.pricingDetails!.type.replace("_", " ")}
            </span>
          </div>
        )}
      </div>

      <CardContent className="p-6 pt-0 flex-1 flex flex-col justify-between space-y-6">
        {/* Vehicle Details */}
        <div className="space-y-2 text-center md:text-left">
          <h3 className="text-2xl font-black text-black leading-tight uppercase">
            {vehicle.make} {vehicle.model}
          </h3>

          {/* Branch / Availability */}
          <div className="flex items-center justify-center md:justify-start gap-4 mt-2">
            {"branch" in vehicle && vehicle.branch && (
              <p className="text-[11px] font-bold tracking-wider text-gray-400 uppercase">
                {vehicle.branch}
              </p>
            )}
            {"availableCount" in vehicle && (
              <span
                className={`text-[11px] font-bold tracking-wider uppercase ${
                  vehicle.availableCount >= 3
                    ? "text-green-600"
                    : vehicle.availableCount >= 1
                    ? "text-yellow-600"
                    : "text-red-600"
                }`}
              >
                {vehicle.availableCount} available
              </span>
            )}
          </div>
        </div>

        {/* Price and CTA Area */}
        <div className="pt-6 border-t-2 border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-center sm:text-left">
             <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Total from</div>
            <div className="flex items-baseline justify-center sm:justify-start gap-1">
               <span className="text-3xl font-black text-black tracking-tighter">
                  ₹{getDisplayPrice() as number}
               </span>
               <span className="text-sm font-bold text-gray-500">
                  {getPriceLabel()}
               </span>
            </div>
          </div>
          <Button
            onClick={handleViewVehicle}
            className="w-full sm:w-auto h-12 px-6 bg-[#FF5F00] hover:bg-[#E55500] text-white font-bold uppercase tracking-wider rounded-none transition-all group-hover:scale-105"
          >
            Select
            <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

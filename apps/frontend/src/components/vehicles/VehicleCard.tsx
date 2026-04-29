import { useNavigate } from "react-router-dom";
import { Car } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { PublicVehicle, ManagerVehicle } from "@/services/vehicle.service";

interface VehicleCardProps {
  vehicle: PublicVehicle | ManagerVehicle;
  basePath?: string;
  startDateTime?: string;
  endDateTime?: string;
}

export const VehicleCard = ({
  vehicle,
  basePath = "/vehicle",
  startDateTime,
  endDateTime,
}: VehicleCardProps) => {
  const navigate = useNavigate();

  const imageUrl = vehicle.imageUrl?.[0]?.file?.url;

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
        HOURLY: "/hr",
        HALF_DAY: "/half day",
        FULL_DAY: "/day",
        MULTI_DAY: "/total",
      };
      return typeMap[vehicle.pricingDetails.type] || "/day";
    }
    return "/day";
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

  return (
    <Card className="group overflow-hidden bg-white border border-zinc-200 shadow-2xl rounded-[2rem] hover:-translate-y-2 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.15)] transition-all duration-500 relative">
      {/* Subtle glow effect */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

      {/* Vehicle Image */}
      <div className="relative aspect-[4/3] bg-zinc-100 overflow-hidden rounded-t-[2rem]">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`${vehicle.make} ${vehicle.model}`}
            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-zinc-100">
            <Car className="size-16 text-zinc-400" />
          </div>
        )}
        {/* Category Badge */}
        <div className="absolute top-4 left-4 z-10">
          <span className="px-4 py-1.5 text-[10px] font-black tracking-[0.2em] bg-white/90 backdrop-blur-md border border-zinc-200 text-zinc-900 rounded-full uppercase">
            {getCategoryName()}
          </span>
        </div>
        {/* Period Type Badge */}
        {hasPricingDetails && (
          <div className="absolute top-4 right-4 z-10">
            <span className="px-3 py-1.5 text-[10px] font-black tracking-[0.15em] bg-orange-500/80 backdrop-blur-md text-white rounded-full uppercase">
              {vehicle.pricingDetails!.type.replace("_", " ")}
            </span>
          </div>
        )}
        {/* Available Count Badge (public grouped vehicles only) */}
        {"availableCount" in vehicle && (
          <div className="absolute bottom-4 right-4 z-10">
            <span
              className={`px-3 py-1.5 text-[10px] font-black tracking-[0.15em] backdrop-blur-md text-white rounded-full uppercase ${
                vehicle.availableCount >= 3
                  ? "bg-emerald-500/80"
                  : vehicle.availableCount >= 1
                  ? "bg-yellow-500/80"
                  : "bg-red-500/80"
              }`}
            >
              {vehicle.availableCount} available
            </span>
          </div>
        )}
      </div>

      <CardContent className="p-6 space-y-4 relative z-10">
        {/* Make + Model */}
        <div className="space-y-1">
          <h3 className="text-xl md:text-2xl font-serif font-black text-zinc-900 leading-tight group-hover:text-orange-600 transition-colors">
            {vehicle.make} {vehicle.model}
          </h3>
          {/* Branch */}
          <p className="text-xs font-bold tracking-wider text-zinc-500 uppercase flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-orange-500 shrink-0" />
            {vehicle.branch}
          </p>
        </div>

        {/* Price and CTA */}
        <div className="flex items-center justify-between pt-4 border-t border-zinc-200">
          <div>
            <span className="text-3xl font-bold text-zinc-900 tracking-tight">
              ₹{getDisplayPrice() as number}
            </span>
            <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-2">
              {getPriceLabel()}
            </span>
          </div>
          <Button
            onClick={handleViewVehicle}
            className="h-12 px-6 bg-zinc-900 hover:bg-zinc-700 text-white font-bold rounded-full transition-all hover:scale-105 active:scale-95 shadow-sm"
          >
            View
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

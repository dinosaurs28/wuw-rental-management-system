import { useNavigate } from "react-router-dom";
import { Car, MapPin, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { PublicVehicle, ManagerVehicle } from "@/services/vehicle.service";

interface VehicleCardProps {
  vehicle: PublicVehicle | ManagerVehicle;
  basePath?: string;
  startDateTime?: string;
  endDateTime?: string;
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

  const getCategoryName = () => {
    return typeof vehicle.category === "string"
      ? vehicle.category
      : vehicle.category.name;
  };

  const getDisplayPrice = () => {
    if ("pricingDetails" in vehicle && vehicle.pricingDetails) {
      return vehicle.pricingDetails.finalPrice;
    }
    return "pricing" in vehicle
      ? vehicle.pricing.daily
      : vehicle.customPricing;
  };

  const getPriceLabel = () => {
    if ("pricingDetails" in vehicle && vehicle.pricingDetails) {
      const typeMap: Record<string, string> = {
        HOURLY: variant === "dark" ? "/ hr" : "/ hour",
        HALF_DAY: variant === "dark" ? "/ half day" : "/ half day",
        FULL_DAY: variant === "dark" ? "/ day" : "/ day",
        MULTI_DAY: variant === "dark" ? "/ total" : "total",
      };
      return typeMap[vehicle.pricingDetails.type] || "/ day";
    }
    return "/ day";
  };

  const getDurationLabel = () => {
    if ("pricingDetails" in vehicle && vehicle.pricingDetails) {
      const typeMap: Record<string, string> = {
        HOURLY: "Hourly",
        HALF_DAY: "Half day",
        FULL_DAY: "Full day",
        MULTI_DAY: "Multi day",
      };
      return typeMap[vehicle.pricingDetails.type] || "Full day";
    }
    return null;
  };

  const handleViewVehicle = () => {
    const params = new URLSearchParams();
    if (startDateTime) params.set("start", startDateTime);
    if (endDateTime) params.set("end", endDateTime);
    const query = params.toString();

    if ("groupKey" in vehicle) {
      navigate(`${basePath}/group/${encodeURIComponent(vehicle.groupKey)}${query ? `?${query}` : ""}`);
    } else {
      navigate(`${basePath}/${(vehicle as ManagerVehicle).publicId}${query ? `?${query}` : ""}`);
    }
  };

  const hasBranch = "branch" in vehicle && vehicle.branch;
  const durationLabel = getDurationLabel();
  const hasAvailability = "availableCount" in vehicle;
  const hasPricingDetails = "pricingDetails" in vehicle && vehicle.pricingDetails;

  const availabilityDotClass = (() => {
    if (!hasAvailability) return "bg-amber-400";
    const count = (vehicle as PublicVehicle).availableCount;
    if (count >= 3) return "bg-emerald-400";
    if (count >= 1) return "bg-amber-400";
    return "bg-red-400";
  })();

  if (variant === "dark") {
    return (
      <article className="flex flex-col rounded-[22px] overflow-hidden bg-[#101217] shadow-[0_22px_50px_-26px_rgba(0,0,0,0.55)] isolate transition-transform duration-300 hover:-translate-y-1">
        {/* Stage */}
        <div className="relative h-[440px] overflow-hidden">
          {/* Studio gradient backdrop */}
          <div
            className="absolute inset-0"
            style={{
              background: [
                "radial-gradient(120% 50% at 50% 74%, rgba(232,235,237,.92) 0%, rgba(150,156,160,.34) 42%, rgba(11,12,15,0) 72%)",
                "radial-gradient(112% 78% at 56% 47%, #c6cbce 0%, #8b9095 28%, #44484d 53%, rgba(11,12,15,0) 80%)",
                "radial-gradient(145% 125% at 50% 38%, rgba(0,0,0,0) 52%, rgba(7,8,10,.9) 100%)",
                "linear-gradient(180deg, #0b0c0f 0%, #101217 52%, #090a0d 100%)",
              ].join(", "),
            }}
          />

          {/* Vehicle image */}
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={`${vehicle.make} ${vehicle.model}`}
              className="absolute pointer-events-none"
              style={{
                left: "50%",
                top: "57%",
                transform: "translate(-50%, -50%)",
                width: "84%",
                filter: "drop-shadow(0 26px 22px rgba(0,0,0,.5))",
              }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <Car className="size-20 text-zinc-600" />
            </div>
          )}

          {/* Top scrim */}
          <div
            className="absolute inset-x-0 top-0 h-[200px] pointer-events-none"
            style={{ background: "linear-gradient(180deg, rgba(8,9,12,.82) 0%, rgba(8,9,12,.32) 52%, rgba(8,9,12,0) 100%)" }}
          />
          {/* Bottom scrim */}
          <div
            className="absolute inset-x-0 bottom-0 h-[175px] pointer-events-none"
            style={{ background: "linear-gradient(0deg, rgba(8,9,12,.9) 0%, rgba(8,9,12,.42) 52%, rgba(8,9,12,0) 100%)" }}
          />

          {/* Overlaid content */}
          <div className="relative h-full flex flex-col justify-between p-6 text-white">
            {/* Name + type + chips */}
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-[25px] font-extrabold tracking-[-0.01em] uppercase leading-[1.12] m-0">
                  {vehicle.make} {vehicle.model}
                </h2>
                <p className="text-[16px] font-semibold text-[#c5c7cb] mt-2 mb-0">
                  {getCategoryName()}
                </p>
              </div>

              {/* Chips */}
              <div className="flex flex-wrap gap-[9px]">
                {hasBranch && (
                  <span className="inline-flex items-center gap-2 h-9 px-[15px] rounded-full text-[14.5px] font-semibold text-white bg-white/[0.12] border border-white/20 backdrop-blur-[5px]">
                    <MapPin className="size-[15px] shrink-0" strokeWidth={2} />
                    {(vehicle as PublicVehicle).branch}
                  </span>
                )}
                {durationLabel && (
                  <span className="inline-flex items-center h-9 px-[15px] rounded-full text-[14.5px] font-semibold text-white bg-white/[0.12] border border-white/20 backdrop-blur-[5px]">
                    {durationLabel}
                  </span>
                )}
                {hasAvailability && (
                  <span className="inline-flex items-center gap-2 h-9 px-[15px] rounded-full text-[14.5px] font-semibold text-white bg-white/[0.12] border border-white/20 backdrop-blur-[5px]">
                    <span
                      className={`size-[9px] rounded-full shrink-0 ${availabilityDotClass}`}
                      style={{ boxShadow: "0 0 0 3px rgba(245,166,35,.2)" }}
                    />
                    {(vehicle as PublicVehicle).availableCount} available
                  </span>
                )}
              </div>
            </div>

            {/* Price */}
            <div className="flex items-baseline gap-[9px]">
              <span className="text-[34px] font-extrabold tracking-[-0.02em] leading-none">
                ₹{getDisplayPrice() as number}
              </span>
              <span className="text-[17px] font-semibold text-[#c5c7cb]">
                {getPriceLabel()}
              </span>
            </div>
          </div>
        </div>

        {/* SELECT CTA */}
        <button
          onClick={handleViewVehicle}
          className="w-full h-[60px] flex items-center justify-center gap-3 bg-[#f0500a] hover:bg-[#d9470a] text-white font-extrabold text-[17px] tracking-[0.06em] uppercase transition-colors duration-150 border-0 cursor-pointer"
        >
          Select
          <ChevronRight className="size-[18px]" strokeWidth={2.4} />
        </button>
      </article>
    );
  }

  // Light Card for Employee Listing
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
            {hasAvailability && (
              <span
                className={`text-[11px] font-bold tracking-wider uppercase ${
                  (vehicle as PublicVehicle).availableCount >= 3
                    ? "text-green-600"
                    : (vehicle as PublicVehicle).availableCount >= 1
                    ? "text-yellow-600"
                    : "text-red-600"
                }`}
              >
                {(vehicle as PublicVehicle).availableCount} available
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

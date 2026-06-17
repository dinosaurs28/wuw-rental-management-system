import { useNavigate } from "react-router-dom";
import { Car, MapPin, ChevronRight } from "lucide-react";
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

  const imageUrl =
    "images" in vehicle
      ? vehicle.images?.[0]?.file?.url
      : vehicle.imageUrl?.[0]?.file?.url;

  const getCategoryName = () => {
    return typeof vehicle.category === "string"
      ? vehicle.category
      : vehicle.category.name;
  };

  // Daily rate is always available; total is computed only once a rental period is chosen
  const dailyPrice =
    "pricing" in vehicle ? vehicle.pricing.daily : vehicle.customPricing;
  const totalPrice =
    "pricingDetails" in vehicle && vehicle.pricingDetails
      ? vehicle.pricingDetails.finalPrice
      : null;

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

  const availabilityDotClass = (() => {
    if (!hasAvailability) return "bg-amber-400";
    const count = (vehicle as PublicVehicle).availableCount;
    if (count >= 3) return "bg-emerald-400";
    if (count >= 1) return "bg-amber-400";
    return "bg-red-400";
  })();

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
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-[9px]">
              <span className="text-[34px] font-extrabold tracking-[-0.02em] leading-none text-[#f0500a]">
                ₹{dailyPrice as number}
              </span>
              <span className="text-[17px] font-semibold text-[#c5c7cb]">
                / day
              </span>
            </div>
            {totalPrice != null && (
              <span className="text-[15px] font-semibold text-[#c5c7cb]">
                ₹{totalPrice} total
              </span>
            )}
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
};

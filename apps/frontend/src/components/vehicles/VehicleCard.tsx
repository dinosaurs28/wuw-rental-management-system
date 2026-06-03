import { useNavigate } from "react-router-dom";
import { Car, ChevronRight } from "lucide-react";
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
          <p className="text-sm font-medium text-gray-500">
            Or similar
          </p>
          
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


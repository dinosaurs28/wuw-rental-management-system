import React from "react";
import type { AvailableVehicle } from "@/types/vehicleSwap";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatSwapRupees, swapAmount } from "./swapFormat";

/**
 * Per-candidate price difference preview (pro-rated): the difference of the
 * GST-inclusive rents (item 17), charged as is — no GST is added (item 8).
 */
export const SwapPriceLine: React.FC<{
  priceDifference: string | null | undefined;
  /** Amount on its own line (right-aligned list column) */
  stacked?: boolean;
  className?: string;
}> = ({ priceDifference, stacked = false, className = "" }) => {
  // Older server: no prices in the list
  if (priceDifference === undefined) return null;
  const amount = swapAmount(priceDifference);
  if (amount === null) {
    return <p className={`text-xs text-amber-700 ${className}`}>Price difference unavailable</p>;
  }
  if (amount <= 0) {
    return <p className={`text-xs text-gray-500 ${className}`}>No extra cost</p>;
  }
  if (stacked) {
    return (
      <div className={className}>
        <p className="text-sm font-semibold text-orange-700">+{formatSwapRupees(amount)}</p>
        <p className="text-[11px] text-gray-500">rest of rental, no GST added</p>
      </div>
    );
  }
  return (
    <p className={`text-xs text-gray-700 ${className}`}>
      <span className="font-semibold text-orange-700">+{formatSwapRupees(amount)}</span>{" "}
      rest of rental, no GST added
    </p>
  );
};

interface AvailableVehiclesListProps {
  vehicles: AvailableVehicle[];
  onSelectVehicle: (vehicle: AvailableVehicle) => void;
  selectedVehicleId?: number;
}

export const AvailableVehiclesList: React.FC<AvailableVehiclesListProps> = ({
  vehicles,
  onSelectVehicle,
  selectedVehicleId,
}) => {
  // Group vehicles by category
  const groupedVehicles = vehicles.reduce(
    (acc, vehicle) => {
      const category = vehicle.categoryName;
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(vehicle);
      return acc;
    },
    {} as Record<string, AvailableVehicle[]>,
  );

  return (
    <div className="space-y-6">
      {Object.entries(groupedVehicles).map(([category, categoryVehicles]) => (
        <div key={category}>
          <h3 className="text-lg font-semibold mb-3">{category}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {categoryVehicles.map((vehicle) => (
              <Card
                key={vehicle.id}
                className={`cursor-pointer transition-all hover:shadow-md ${
                  selectedVehicleId === vehicle.id
                    ? "border-blue-500 ring-2 ring-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-blue-300"
                }`}
                onClick={() => onSelectVehicle(vehicle)}
              >
                <CardContent className="p-4">
                  {vehicle.images[0]?.url && (
                    <img
                      src={vehicle.images[0].url}
                      alt={`${vehicle.make} ${vehicle.model}`}
                      className="w-full h-32 object-cover rounded mb-3"
                    />
                  )}
                  <div className="space-y-1">
                    <h4 className="font-semibold">
                      {vehicle.make} {vehicle.model}
                    </h4>
                    <p className="text-sm text-gray-600">{vehicle.regNo}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className="bg-green-50 text-green-700 border-green-200"
                      >
                        {vehicle.status}
                      </Badge>
                      {vehicle.isUpgrade && (
                        <Badge
                          variant="outline"
                          className="bg-blue-50 text-blue-700 border-blue-200"
                        >
                          Upgrade
                        </Badge>
                      )}
                    </div>
                    <SwapPriceLine priceDifference={vehicle.priceDifference} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

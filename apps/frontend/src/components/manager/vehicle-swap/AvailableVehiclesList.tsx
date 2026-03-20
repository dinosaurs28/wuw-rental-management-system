import React from "react";
import type { AvailableVehicle } from "@/types/vehicleSwap";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
                    <Badge
                      variant="outline"
                      className="bg-green-50 text-green-700 border-green-200"
                    >
                      {vehicle.status}
                    </Badge>
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

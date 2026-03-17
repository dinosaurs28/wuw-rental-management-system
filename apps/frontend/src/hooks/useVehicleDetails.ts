import { useQuery } from "@tanstack/react-query";
import {
  fetchVehicleDetails,
  type VehicleDetailsParams,
} from "@/services/vehicle.service";

export const useVehicleDetails = (
  vehicleId: string,
  startDateTime: string | null,
  endDateTime: string | null,
) => {
  const params: VehicleDetailsParams = {
    vehicleId,
    startDate: startDateTime || undefined,
    endDate: endDateTime || undefined,
  };

  return useQuery({
    queryKey: ["vehicle-details", vehicleId, startDateTime, endDateTime],
    queryFn: () => fetchVehicleDetails(params),
    enabled: !!vehicleId,
    staleTime: 60 * 1000,
  });
};

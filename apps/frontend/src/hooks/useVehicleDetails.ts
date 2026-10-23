import { useQuery } from "@tanstack/react-query";
import {
  fetchVehicleDetails,
  type VehicleDetailsParams,
} from "@/services/vehicle.service";

export const useVehicleDetails = (
  vehicleId: string,
  startDateTime: string | null,
  endDateTime: string | null,
  /** Customer Monthly: the car's own monthly price for 30 days (Daily omits it) */
  plan?: "STANDARD" | "MONTHLY",
) => {
  const params: VehicleDetailsParams = {
    vehicleId,
    startDate: startDateTime || undefined,
    endDate: endDateTime || undefined,
    ...(plan === "MONTHLY" ? { plan } : {}),
  };

  return useQuery({
    queryKey: ["vehicle-details", vehicleId, startDateTime, endDateTime, plan === "MONTHLY" ? "MONTHLY" : null],
    queryFn: () => fetchVehicleDetails(params),
    enabled: !!vehicleId,
    staleTime: 60 * 1000,
  });
};

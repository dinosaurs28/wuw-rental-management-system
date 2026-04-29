import { useQuery } from "@tanstack/react-query";
import { fetchVehicleGroupDetails } from "@/services/vehicle.service";

export const useVehicleGroupDetails = (
  groupKey: string,
  startDateTime: string | null,
  endDateTime: string | null,
) => {
  return useQuery({
    queryKey: ["vehicle-group-details", groupKey, startDateTime, endDateTime],
    queryFn: () =>
      fetchVehicleGroupDetails(
        groupKey,
        startDateTime || undefined,
        endDateTime || undefined,
      ),
    enabled: !!groupKey,
    staleTime: 30 * 1000,
  });
};

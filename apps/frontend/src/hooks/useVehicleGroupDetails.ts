import { useQuery } from "@tanstack/react-query";
import { fetchVehicleGroupDetails } from "@/services/vehicle.service";

export const useVehicleGroupDetails = (
  groupKey: string,
  startDateTime: string | null,
  endDateTime: string | null,
  options?: { enabled?: boolean; plan?: "STANDARD" | "MONTHLY" },
) => {
  const monthly = options?.plan === "MONTHLY";
  return useQuery({
    queryKey: ["vehicle-group-details", groupKey, startDateTime, endDateTime, monthly ? "MONTHLY" : null],
    queryFn: () =>
      fetchVehicleGroupDetails(
        groupKey,
        startDateTime || undefined,
        endDateTime || undefined,
        monthly ? "MONTHLY" : undefined,
      ),
    enabled: !!groupKey && (options?.enabled ?? true),
    staleTime: 30 * 1000,
  });
};

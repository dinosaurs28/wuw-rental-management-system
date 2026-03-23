import { useQuery } from "@tanstack/react-query";
import { fetchPublicVehicleCategories } from "@/services/vehicle.service";

export const usePublicVehicleCategories = () => {
  return useQuery({
    queryKey: ["public-vehicle-categories"],
    queryFn: fetchPublicVehicleCategories,
    staleTime: 5 * 60 * 1000,
  });
};

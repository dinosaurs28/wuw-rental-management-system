import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { employeeService } from "../services/employee.service";
import type { PublicVehicle } from "@/services/vehicle.service";

interface EmployeeVehiclesResponse {
  data: PublicVehicle[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

export const useEmployeeVehicles = (filters: any, options?: { enabled?: boolean }) => {
  return useQuery<EmployeeVehiclesResponse>({
    queryKey: ["employee-vehicles", filters],
    queryFn: () => employeeService.searchVehicles(filters),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  });
};

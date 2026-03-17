import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { employeeService } from "../services/employee.service";

interface EmployeeVehiclesResponse {
  data: any[]; // defining loosely or import Vehicle type if available, strict typing is better but 'any[]' solves the immediate error
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

export const useEmployeeVehicles = (filters: any) => {
  return useQuery<EmployeeVehiclesResponse>({
    queryKey: ["employee-vehicles", filters],
    queryFn: () => employeeService.searchVehicles(filters),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
};

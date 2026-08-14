import { useQuery } from "@tanstack/react-query";
import { employeeService } from "@/services/employee.service";
import { useEmployeeAuthStore } from "@/store/employeeAuth.store";

export type VehicleTypeClass = "TWO_WHEELER" | "FOUR_WHEELER";

/**
 * Returns which vehicle type classes the given customer has already booked
 * for the specified date range, so the employee listing page can show
 * restrictions before attempting a booking.
 *
 * Mirrors useCustomerBookingLimits but calls the employee-auth endpoint,
 * allowing staff to check any customer by publicId.
 */
export function useEmployeeCustomerBookingLimits(
  customerPublicId: string | undefined,
  start: string | undefined,
  end: string | undefined,
) {
  const isAuthenticated = useEmployeeAuthStore((s) => s.isAuthenticated);

  const query = useQuery({
    queryKey: ["employee-customer-booking-limits", customerPublicId, start, end],
    queryFn: () =>
      employeeService.getCustomerBookingLimits(customerPublicId!, start!, end!),
    enabled: isAuthenticated && !!customerPublicId && !!start && !!end,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
    throwOnError: false,
  });

  const usedTypeClasses = query.data?.usedTypeClasses ?? {};
  const restrictedTypeClasses = new Set<VehicleTypeClass>(
    Object.keys(usedTypeClasses) as VehicleTypeClass[],
  );

  return {
    restrictedTypeClasses,
    conflictDetails: usedTypeClasses,
    isLoading: query.isLoading,
  };
}

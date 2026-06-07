import { useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/axios";
import { useAuthStore } from "@/store/auth.store";

export type VehicleTypeClass = "TWO_WHEELER" | "FOUR_WHEELER";

export interface BookingLimitSlot {
  bookingPublicId: string;
  vehicleMake: string;
  vehicleModel: string;
  startAt: string;
  endAt: string;
  status: "HOLD" | "CONFIRMED" | "PICKED_UP";
  holdExpiresAt: string | null;
}

interface BookingLimitsResponse {
  usedTypeClasses: Partial<Record<VehicleTypeClass, BookingLimitSlot>>;
}

async function fetchBookingLimits(start: string, end: string): Promise<BookingLimitsResponse> {
  const { data } = await apiClient.get<BookingLimitsResponse>(
    `/public/customer/booking-limits`,
    { params: { start, end } },
  );
  return data;
}

/**
 * Returns which vehicle type classes the logged-in customer has already
 * booked for the given date range, so the listing page can show restrictions
 * before the customer enters the booking flow.
 *
 * Gracefully returns empty restrictions on any error — the backend remains
 * the authoritative gate.
 */
export function useCustomerBookingLimits(
  start: string | undefined,
  end: string | undefined,
) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const query = useQuery({
    queryKey: ["customer-booking-limits", start, end],
    queryFn: () => fetchBookingLimits(start!, end!),
    enabled: isAuthenticated && !!start && !!end,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    // Never block the user on a monitoring failure; backend is the authoritative gate
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

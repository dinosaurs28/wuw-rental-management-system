import { useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/axios";
import { useAuthStore } from "@/store/auth.store";

export type VehicleTypeClass = "TWO_WHEELER" | "FOUR_WHEELER";
export type BookingRestrictionMode = "NONE" | "SAME_CATEGORY" | "ANY_VEHICLE";

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
  restrictionMode: BookingRestrictionMode;
  usedTypeClasses: Partial<Record<VehicleTypeClass, BookingLimitSlot>>;
  blockedAll: boolean;
  anyVehicleConflict?: BookingLimitSlot | null;
}

async function fetchBookingLimits(
  start: string,
  end: string,
  branchPublicId?: string,
): Promise<BookingLimitsResponse> {
  const { data } = await apiClient.get<BookingLimitsResponse>(
    `/public/customer/booking-limits`,
    { params: { start, end, ...(branchPublicId ? { branchPublicId } : {}) } },
  );
  return data;
}

/**
 * Returns which vehicle type classes the logged-in customer has already
 * booked for the given date range, so the listing page can show restrictions.
 *
 * When the branch's restriction mode is ANY_VEHICLE, `blockedAll` is true if
 * the customer has any active booking at that branch in the date range —
 * all vehicles should be shown as unavailable in that case.
 */
export function useCustomerBookingLimits(
  start: string | undefined,
  end: string | undefined,
  branchPublicId?: string,
) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const query = useQuery({
    queryKey: ["customer-booking-limits", start, end, branchPublicId],
    queryFn: () => fetchBookingLimits(start!, end!, branchPublicId),
    enabled: isAuthenticated && !!start && !!end,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
    throwOnError: false,
  });

  const data = query.data;
  const usedTypeClasses = data?.usedTypeClasses ?? {};
  const restrictedTypeClasses = new Set<VehicleTypeClass>(
    Object.keys(usedTypeClasses) as VehicleTypeClass[],
  );

  return {
    restrictedTypeClasses,
    conflictDetails: usedTypeClasses,
    blockedAll: data?.blockedAll ?? false,
    restrictionMode: data?.restrictionMode ?? "SAME_CATEGORY",
    anyVehicleConflict: data?.anyVehicleConflict ?? null,
    isLoading: query.isLoading,
  };
}

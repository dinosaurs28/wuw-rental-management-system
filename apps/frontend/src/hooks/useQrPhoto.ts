import { useQuery } from "@tanstack/react-query";
import { kycService } from "@/services/kyc.service";
import { managerDashboardService } from "@/services/managerDashboard.service";

export type QrPhotoRole = "staff" | "manager";

export const qrPhotoKeys = {
  customer: (customerPublicId: string) => ["customer-qr-photo", customerPublicId] as const,
  booking: (role: QrPhotoRole, bookingId: string) =>
    ["booking-qr-photo", role, bookingId] as const,
  /** Prefix that matches every booking-level QR query. */
  allBookings: ["booking-qr-photo"] as const,
};

// Presigned URLs live 15 minutes: refetch well before they expire so a
// thumbnail left open on the counter still enlarges.
const QR_STALE_MS = 5 * 60 * 1000;
const QR_REFRESH_MS = 12 * 60 * 1000;

/** Customer's current QR code photo (Fleet only). */
export function useCustomerQrPhoto(customerPublicId: string | null | undefined) {
  return useQuery({
    queryKey: qrPhotoKeys.customer(customerPublicId ?? ""),
    queryFn: () => kycService.getCustomerQrPhoto(customerPublicId!),
    enabled: !!customerPublicId,
    staleTime: QR_STALE_MS,
    refetchInterval: QR_REFRESH_MS,
    retry: 1,
  });
}

/** QR code photo for a booking of the signed-in user's branch (Fleet or BM). */
export function useBookingQrPhoto(role: QrPhotoRole, bookingId: string | null | undefined) {
  return useQuery({
    queryKey: qrPhotoKeys.booking(role, bookingId ?? ""),
    queryFn: () =>
      role === "manager"
        ? managerDashboardService.getBookingQrPhoto(bookingId!)
        : kycService.getBookingQrPhoto(bookingId!),
    enabled: !!bookingId,
    staleTime: QR_STALE_MS,
    refetchInterval: QR_REFRESH_MS,
    retry: 1,
  });
}

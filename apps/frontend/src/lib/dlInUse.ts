/**
 * 409 DL_IN_USE — one vehicle per driving licence (X3). The server refuses a
 * booking, pickup or extension while the same DL number has a vehicle out, or
 * a HOLD / CONFIRMED booking overlapping the dates. Customer responses carry a
 * message only; staff and branch-manager responses add `conflictingBooking`.
 * See apps/backend/src/services/booking/dl-in-use.service.ts.
 */
export const DL_IN_USE = "DL_IN_USE";

export interface DlConflictingBooking {
  publicId: string;
  status: string;
  vehicle: { make: string; model: string; regNo: string } | null;
  startAt: string;
  endAt: string;
  customerName: string;
}

type ApiErrorLike = {
  response?: { data?: { code?: unknown; conflictingBooking?: unknown } };
};

export function isDlInUse(err: unknown): boolean {
  return (err as ApiErrorLike | undefined)?.response?.data?.code === DL_IN_USE;
}

/** The booking holding the licence (staff/BM responses only), or null. */
export function dlConflictingBooking(err: unknown): DlConflictingBooking | null {
  if (!isDlInUse(err)) return null;
  const booking = (err as ApiErrorLike).response?.data?.conflictingBooking as
    | DlConflictingBooking
    | undefined;
  return booking && typeof booking.publicId === "string" ? booking : null;
}

const STATUS_LABELS: Record<string, string> = {
  PICKED_UP: "Vehicle out",
  CONFIRMED: "Confirmed",
  HOLD: "On hold",
};

/** "Conflicting booking ABC123 · Vehicle out · Honda Activa (KA01AB1234)", or null. */
export function dlConflictLabel(err: unknown): string | null {
  const booking = dlConflictingBooking(err);
  if (!booking) return null;
  const parts = [`Conflicting booking ${booking.publicId}`];
  parts.push(STATUS_LABELS[booking.status] ?? booking.status);
  if (booking.vehicle) {
    parts.push(`${booking.vehicle.make} ${booking.vehicle.model} (${booking.vehicle.regNo})`);
  }
  return parts.join(" · ");
}

/** Sonner options for a DL_IN_USE toast on staff screens (booking ID as the description). */
export function dlInUseToastOptions(err: unknown): { description: string; duration: number } | undefined {
  const label = dlConflictLabel(err);
  return label ? { description: label, duration: 12000 } : undefined;
}

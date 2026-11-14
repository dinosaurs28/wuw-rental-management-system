/**
 * Late Razorpay capture on a lapsed hold (Nov 2026). An online booking whose
 * hold expired (or was released) can still be paid afterwards — by then its
 * car may have been booked by someone else, or the customer may have booked
 * again. Confirming would double-book, so such a payment goes to the refund
 * path instead. Pure rules; the confirm service does the locked lookups.
 */

export type LateCaptureRefusalReason = "VEHICLE_TAKEN" | "CUSTOMER_REBOOKED";

export interface LateCaptureRefusal {
  reason: LateCaptureRefusalReason;
  /** Vehicles no longer free for the window (VEHICLE_TAKEN). */
  vehicleIds: number[];
  /** The customer's other overlapping bookings (CUSTOMER_REBOOKED). */
  bookingPublicIds: string[];
}

/** Only a gateway payment landing on a HOLD_EXPIRED booking is re-checked; a live HOLD is unchanged. */
export function needsLateCaptureCheck(b: { status: string }, isGatewayPayment: boolean): boolean {
  return isGatewayPayment && b.status === "HOLD_EXPIRED";
}

/** Statuses of the customer's own other bookings that mean "they already re-booked". */
export const REBOOKED_STATUSES = ["CONFIRMED", "PICKED_UP"] as const;

export interface VehicleKind {
  categoryId: number;
  /** VehicleTypeClass: TWO_WHEELER | FOUR_WHEELER | OTHER. */
  typeClass: string;
}

export interface OtherCustomerBooking {
  publicId: string;
  createdAt: Date;
  vehicles: VehicleKind[];
}

/** Same kind of vehicle: same category, or the same (known) type class. */
function sameKind(a: VehicleKind, b: VehicleKind): boolean {
  return a.categoryId === b.categoryId || (a.typeClass !== "OTHER" && a.typeClass === b.typeClass);
}

/**
 * The customer's overlapping bookings that are a re-book of this one: made
 * AFTER it (a second car booked alongside is not a re-book) and for the same
 * kind of vehicle.
 */
export function rebookingsOf(
  thisBooking: { createdAt: Date; vehicles: VehicleKind[] },
  others: OtherCustomerBooking[],
): string[] {
  return others
    .filter(
      (o) =>
        o.createdAt.getTime() > thisBooking.createdAt.getTime() &&
        o.vehicles.some((v) => thisBooking.vehicles.some((t) => sameKind(t, v))),
    )
    .map((o) => o.publicId);
}

/**
 * Decides whether a late capture may confirm. The customer having re-booked
 * wins (the refund then goes to a duplicate, not a lost car), then any of the
 * booking's vehicles being blocked for its window.
 */
export function lateCaptureRefusal(input: {
  vehicleIds: number[];
  blockedVehicleIds: Set<number>;
  /** Already narrowed by rebookingsOf. */
  overlappingCustomerBookings: string[];
}): LateCaptureRefusal | null {
  if (input.overlappingCustomerBookings.length > 0) {
    return { reason: "CUSTOMER_REBOOKED", vehicleIds: [], bookingPublicIds: [...input.overlappingCustomerBookings] };
  }
  const taken = input.vehicleIds.filter((id) => input.blockedVehicleIds.has(id));
  if (taken.length > 0) return { reason: "VEHICLE_TAKEN", vehicleIds: taken, bookingPublicIds: [] };
  return null;
}

/** The distinct REFUND REQUIRED log reason. */
export function lateCaptureLogReason(r: LateCaptureRefusal): string {
  return r.reason === "CUSTOMER_REBOOKED"
    ? `late capture on HOLD_EXPIRED booking — customer already re-booked (${r.bookingPublicIds.join(", ")})`
    : `late capture on HOLD_EXPIRED booking — vehicle(s) ${r.vehicleIds.join(", ")} no longer free for the window`;
}

/**
 * OUT_FOR_RENTAL with and without a rental behind it.
 *
 * The system sets a vehicle OUT_FOR_RENTAL at pickup and back at the drop; the
 * PICKED_UP booking blocks the dates it is out for. A branch manager can also
 * set OUT_FOR_RENTAL by hand from the vehicle form. No booking backs that, so
 * there is no return time either: such a vehicle is unavailable for every date
 * until the manager sets it back.
 */

import { prisma, BookingStatus, VehicleStatus, Prisma } from "@repo/database/client";

/** A booking item whose booking is out on the road (picked up, not yet dropped). */
export const ACTIVE_RENTAL_ITEM_WHERE: Prisma.BookingItemWhereInput = {
  booking: { status: BookingStatus.PICKED_UP },
};

/**
 * The active rental holding the vehicle (a PICKED_UP booking), or null.
 * `awaitingReturnConfirmation`: the drop is done and waits for a manager.
 */
export async function findActiveRental(
  vehicleId: number,
): Promise<{ awaitingReturnConfirmation: boolean } | null> {
  const item = await prisma.bookingItem.findFirst({
    where: { vehicleId, ...ACTIVE_RENTAL_ITEM_WHERE },
    select: { booking: { select: { requiresManagerConfirmation: true } } },
  });
  return item ? { awaitingReturnConfirmation: item.booking.requiresManagerConfirmation } : null;
}

/**
 * Of `vehicleIds`, the ones set OUT_FOR_RENTAL by hand: the status is on but no
 * PICKED_UP booking holds the vehicle. These are unavailable for any window.
 */
export async function getManualOutForRentalIds(vehicleIds: number[]): Promise<Set<number>> {
  if (vehicleIds.length === 0) return new Set();
  const rows = await prisma.vehicle.findMany({
    where: {
      id: { in: vehicleIds },
      status: VehicleStatus.OUT_FOR_RENTAL,
      bookingItems: { none: ACTIVE_RENTAL_ITEM_WHERE },
    },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

// ── Handing a car over (pickup) ──────────────────────────────────────────────

/** 409: the car is still out on another rental (or its return awaits the manager). */
export const VEHICLE_STILL_OUT = "VEHICLE_STILL_OUT";
/** 409: the car's status keeps it from being handed over (damage review, maintenance …). */
export const VEHICLE_NOT_READY = "VEHICLE_NOT_READY";

export interface PickupRefusal {
  success: false;
  code: typeof VEHICLE_STILL_OUT | typeof VEHICLE_NOT_READY;
  message: string;
}

const NOT_READY_LABEL: Partial<Record<string, string>> = {
  [VehicleStatus.MANAGER_REPORTED]: "in damage review",
  [VehicleStatus.MAINTENANCE]: "in maintenance",
  [VehicleStatus.INACTIVE]: "inactive",
  [VehicleStatus.OUT_FOR_RENTAL]: "marked Out For Rental by the manager",
};

/**
 * Whether one car can be handed over for a booking, or why not. A car is
 * listed for dates after its current rental, so at pickup it may not be back
 * yet (otherRental: a PICKED_UP booking other than this one holds it); and
 * only an AVAILABLE car is handed over — damage review, maintenance, inactive
 * or a hand-set Out for Rental are refused. heldByThisBooking: this booking is
 * already PICKED_UP with the car (a retried completion), which is fine.
 */
export function pickupRefusalFor(v: {
  regNo: string;
  status: string;
  otherRental: { awaitingReturnConfirmation: boolean } | null;
  heldByThisBooking: boolean;
}): PickupRefusal | null {
  if (v.otherRental) {
    return {
      success: false,
      code: VEHICLE_STILL_OUT,
      message: v.otherRental.awaitingReturnConfirmation
        ? `${v.regNo}'s previous return is waiting for the branch manager's confirmation. Ask the manager to confirm it, or swap the vehicle.`
        : `${v.regNo} is still out on another rental. Swap the vehicle or wait for its return.`,
    };
  }
  if (v.status === VehicleStatus.AVAILABLE) return null;
  if (v.status === VehicleStatus.OUT_FOR_RENTAL && v.heldByThisBooking) return null;
  return {
    success: false,
    code: VEHICLE_NOT_READY,
    message: `${v.regNo} is ${NOT_READY_LABEL[v.status] ?? `not available (${v.status})`}. Swap the vehicle, or ask the branch manager to make it available.`,
  };
}

type PickupDb = Pick<Prisma.TransactionClient, "bookingItem" | "vehicle">;

/**
 * The first refusal (pickupRefusalFor) among `vehicleIds` for handing them over
 * on booking `bookingId`, or null when all can go. Checked up front by every
 * pickup path and again where the status flips (inside its transaction).
 */
export async function checkVehiclesReadyForPickup(
  vehicleIds: number[],
  bookingId: number,
  db: PickupDb = prisma,
): Promise<PickupRefusal | null> {
  if (vehicleIds.length === 0) return null;
  const vehicles = await db.vehicle.findMany({
    where: { id: { in: vehicleIds } },
    select: { id: true, regNo: true, status: true },
    orderBy: { id: "asc" },
  });
  const rentals = await db.bookingItem.findMany({
    where: { vehicleId: { in: vehicleIds }, ...ACTIVE_RENTAL_ITEM_WHERE },
    select: { vehicleId: true, bookingId: true, booking: { select: { requiresManagerConfirmation: true } } },
  });
  for (const v of vehicles) {
    const other = rentals.find((r) => r.vehicleId === v.id && r.bookingId !== bookingId);
    const refusal = pickupRefusalFor({
      regNo: v.regNo,
      status: v.status,
      otherRental: other ? { awaitingReturnConfirmation: other.booking.requiresManagerConfirmation } : null,
      heldByThisBooking: rentals.some((r) => r.vehicleId === v.id && r.bookingId === bookingId),
    });
    if (refusal) return refusal;
  }
  return null;
}

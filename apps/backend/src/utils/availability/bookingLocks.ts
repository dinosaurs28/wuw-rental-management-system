/**
 * Booking locks as an availability blocker (client, Oct 2026: "create a
 * booking lock for a Window"). A BookingLock keeps the cars it names — the
 * whole branch, some vehicles or some vehicle groups — from any NEW booking or
 * change whose window overlaps [startAt, endAt): a plain overlap, no turnaround
 * (lockBlocksVehicle in @repo/schemas). A customers-only lock doesn't block
 * staff actions (walk-ins, reschedules, swaps): pass `forStaff`.
 *
 * The listing (getUnavailableVehicleIds), its explanation
 * (explainUnavailableVehicles), booking creation's locked re-check
 * (lockAndFindBlockedVehicleIds), reschedule and the extension availability
 * all read locks through here, so what is listed is what can be booked.
 */
import { prisma, type Prisma } from "@repo/database/client";
import { lockBlocksVehicle } from "@repo/schemas";

export type LockDb = Pick<Prisma.TransactionClient, "bookingLock" | "vehicle">;

export const BOOKING_LOCK_SELECT = {
  id: true,
  publicId: true,
  branchId: true,
  startAt: true,
  endAt: true,
  reason: true,
  scope: true,
  vehicleIds: true,
  groupKeys: true,
  customersOnly: true,
} satisfies Prisma.BookingLockSelect;

export type BlockingLock = Prisma.BookingLockGetPayload<{ select: typeof BOOKING_LOCK_SELECT }>;

export interface LockCheckOptions {
  /** A staff action (walk-in, reschedule, swap): customers-only locks don't block it. */
  forStaff?: boolean;
  /** Read through this client (a transaction). */
  db?: LockDb;
}

/**
 * Every lock keeping each of `vehicleIds` from [start, end), earliest start
 * first. Vehicles no lock covers are absent. One query when no lock overlaps
 * the window (the usual case); vehicles are read only when one does.
 */
export async function findLocksCovering(
  vehicleIds: number[],
  start: Date,
  end: Date,
  options: LockCheckOptions = {},
): Promise<Map<number, BlockingLock[]>> {
  const result = new Map<number, BlockingLock[]>();
  if (vehicleIds.length === 0 || end.getTime() <= start.getTime()) return result;
  const db = options.db ?? prisma;
  const forStaff = options.forStaff ?? false;
  const locks = await db.bookingLock.findMany({
    where: {
      cancelledAt: null,
      startAt: { lt: end },
      endAt: { gt: start },
      ...(forStaff && { customersOnly: false }),
    },
    select: BOOKING_LOCK_SELECT,
    orderBy: [{ startAt: "asc" }, { id: "asc" }],
  });
  if (locks.length === 0) return result;
  const branchIds = new Set(locks.map((l) => l.branchId));
  const vehicles = await db.vehicle.findMany({
    where: { id: { in: [...new Set(vehicleIds)] }, branchId: { in: [...branchIds] } },
    select: { id: true, branchId: true, make: true, model: true, categoryId: true },
  });
  for (const v of vehicles) {
    const covering = locks.filter((l) => lockBlocksVehicle(l, v, start, end, forStaff));
    if (covering.length > 0) result.set(v.id, covering);
  }
  return result;
}

/** For each locked vehicle, the first lock (earliest start) keeping it from [start, end). */
export async function findBlockingLocks(
  vehicleIds: number[],
  start: Date,
  end: Date,
  options: LockCheckOptions = {},
): Promise<Map<number, BlockingLock>> {
  const covering = await findLocksCovering(vehicleIds, start, end, options);
  return new Map([...covering].map(([id, locks]) => [id, locks[0]!]));
}

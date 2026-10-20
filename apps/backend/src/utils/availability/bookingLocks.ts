/**
 * Booking locks as an availability blocker (client, Oct 2026: "create a
 * booking lock for a Window"). A BookingLock keeps the cars it names — the
 * whole branch, some vehicles or some vehicle groups — from any NEW booking or
 * change whose window overlaps its effective window [effectiveLockStart(startAt),
 * endAt) — from 00:00 IST the day before the lock starts (LOCK_LEAD_DAYS) — a
 * plain overlap, no turnaround (lockBlocksVehicle in @repo/schemas). While the
 * lead or the lock runs (lockActsAt) the car is hidden from listings without
 * dates too (findActingLocks). A customers-only lock doesn't block
 * staff actions (walk-ins, reschedules, swaps): pass `forStaff`.
 *
 * The listing (getUnavailableVehicleIds), its explanation
 * (explainUnavailableVehicles), booking creation's locked re-check
 * (lockAndFindBlockedVehicleIds), reschedule and the extension availability
 * all read locks through here, so what is listed is what can be booked.
 */
import { prisma, type Prisma } from "@repo/database/client";
import { LOCK_LEAD_DAYS, effectiveLockStart, lockActsAt, lockBlocksVehicle } from "@repo/schemas";

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

export type BlockingLock = Prisma.BookingLockGetPayload<{ select: typeof BOOKING_LOCK_SELECT }> & {
  /** When the lock starts to act: 00:00 IST the day before startAt (effectiveLockStart). */
  effectiveStartAt: Date;
};

/** effectiveLockStart is at most this long before startAt — the database pre-filter's reach. */
const LEAD_REACH_MS = (LOCK_LEAD_DAYS + 1) * 24 * 60 * 60_000;

const withEffectiveStart = <T extends { startAt: Date }>(l: T): T & { effectiveStartAt: Date } => ({
  ...l,
  effectiveStartAt: effectiveLockStart(l.startAt),
});

export interface LockCheckOptions {
  /** A staff action (walk-in, reschedule, swap): customers-only locks don't block it. */
  forStaff?: boolean;
  /** Read through this client (a transaction). */
  db?: LockDb;
}

/**
 * Every lock keeping each of `vehicleIds` from [start, end) (its effective
 * window, the lead day included), earliest start first. Vehicles no lock covers are absent. One query when no lock overlaps
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
      // A superset (the lead reaches back at most LEAD_REACH_MS); lockBlocksVehicle decides
      startAt: { lt: new Date(end.getTime() + LEAD_REACH_MS) },
      endAt: { gt: start },
      ...(forStaff && { customersOnly: false }),
    },
    select: BOOKING_LOCK_SELECT,
    orderBy: [{ startAt: "asc" }, { id: "asc" }],
  });
  return coverVehicles(db, vehicleIds, locks.map(withEffectiveStart), (l, v) => lockBlocksVehicle(l, v, start, end, forStaff));
}

/** For each of `vehicleIds`, the locks of `locks` that `blocks` it (vehicles read only when there are locks). */
async function coverVehicles(
  db: LockDb,
  vehicleIds: number[],
  locks: BlockingLock[],
  blocks: (lock: BlockingLock, vehicle: { id: number; branchId: number; make: string; model: string; categoryId: number }) => boolean,
): Promise<Map<number, BlockingLock[]>> {
  const result = new Map<number, BlockingLock[]>();
  if (locks.length === 0) return result;
  const branchIds = new Set(locks.map((l) => l.branchId));
  const vehicles = await db.vehicle.findMany({
    where: { id: { in: [...new Set(vehicleIds)] }, branchId: { in: [...branchIds] } },
    select: { id: true, branchId: true, make: true, model: true, categoryId: true },
  });
  for (const v of vehicles) {
    const covering = locks.filter((l) => blocks(l, v));
    if (covering.length > 0) result.set(v.id, covering);
  }
  return result;
}

/**
 * For each of `vehicleIds`, the first lock (earliest start) acting at `now` —
 * now ∈ [effectiveLockStart, endAt): the lead day or the lock itself. Listings
 * without dates leave these cars out (customers-only locks don't count with
 * `forStaff`).
 */
export async function findActingLocks(
  vehicleIds: number[],
  now: Date = new Date(),
  options: LockCheckOptions = {},
): Promise<Map<number, BlockingLock>> {
  if (vehicleIds.length === 0) return new Map();
  const db = options.db ?? prisma;
  const forStaff = options.forStaff ?? false;
  const locks = await db.bookingLock.findMany({
    where: {
      cancelledAt: null,
      startAt: { lt: new Date(now.getTime() + LEAD_REACH_MS) },
      endAt: { gt: now },
      ...(forStaff && { customersOnly: false }),
    },
    select: BOOKING_LOCK_SELECT,
    orderBy: [{ startAt: "asc" }, { id: "asc" }],
  });
  const acting = locks.map(withEffectiveStart).filter((l) => lockActsAt(l, now));
  const covering = await coverVehicles(db, vehicleIds, acting, (l, v) => lockBlocksVehicle(l, v, l.effectiveStartAt, l.endAt, forStaff));
  return new Map([...covering].map(([id, ls]) => [id, ls[0]!]));
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

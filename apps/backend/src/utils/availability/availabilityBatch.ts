/**
 * Batch availability utilities — eliminates N+1 query patterns.
 *
 * Hold key schema (existing, set by getBookInfo.controller.ts):
 *   Redis key: `{booking.publicId}`  (no prefix)
 *   Value: JSON { startDate: ISO, endDate: ISO, vehicles: [...] }
 *
 *   Redis set: `vehicle_holds:{vehicle.publicId}`
 *   Members: holdIds (= booking publicIds) active for that vehicle
 */

import { prisma, BookingStatus, Prisma } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { getManualOutForRentalIds } from "./outForRental.js";
import { findBlockingLocks } from "./bookingLocks.js";
import { BOOKING_TURNAROUND_MS, windowsConflictWithTurnaround } from "@repo/schemas";
import {
  DROP_NOT_RECORDED_WHERE,
  automaticGraceMinutes,
  bookingBlocksWindow,
  isListableStatus,
  turnaroundMsFor,
} from "./vehicleEligibility.js";

/*
 * Bookings that block a vehicle: CONFIRMED and PICKED_UP (bookingBlocksWindow),
 * each with the 3 h turnaround (BOOKING_TURNAROUND_HOURS) either side; a
 * PICKED_UP one stops blocking once fleet records the drop (isDropRecorded).
 * HOLD rows are left out of the listing checks intentionally — HOLD bookings
 * may expire and should not stop listings from showing the vehicle (checkouts
 * in progress show as Redis holds, with the same turnaround); booking creation
 * re-checks live HOLD rows under a lock (lockAndFindBlockedVehicleIds).
 */

/**
 * How far around [start, end) to look for bookings whose turnaround may reach
 * it — the turnaround or the longest automatic grace, whichever is larger. A
 * superset only: bookingBlocksWindow decides.
 */
const CANDIDATE_REACH_MS = 24 * 60 * 60 * 1000;

/** What bookingBlocksWindow reads off a booking (the grace keys included). */
const BLOCKING_BOOKING_SELECT = {
  status: true,
  startAt: true,
  endAt: true,
  holdExpiresAt: true,
  requiresManagerConfirmation: true,
  returnedAt: true,
  frozenChargeConfig: true,
  branch: {
    select: { chargeConfig: { select: { gracePolicyEnabled: true, graceType: true, graceMinutes: true } } },
  },
} satisfies Prisma.BookingSelect;

/**
 * Booking items that MAY keep a vehicle from [start, end): CONFIRMED bookings
 * (and with `includeHoldRows` unexpired HOLDs) within reach of it once the
 * turnaround is counted, and every PICKED_UP one whose drop isn't recorded
 * (the car is out now — until its return plus the turnaround, or for good once
 * overdue). A superset only: the rows are decided by bookingBlocksWindow
 * (findBlockingItems).
 */
function blockingCandidateItemWhere(
  start: Date,
  end: Date,
  now: Date,
  reachMs: number,
  includeHoldRows: boolean,
): Prisma.BookingItemWhereInput {
  const near = {
    startAt: { lt: new Date(end.getTime() + reachMs) }, // starts before the requested end plus turnaround
    endAt: { gt: new Date(start.getTime() - reachMs) }, // ends after the requested start less turnaround
  };
  return {
    booking: {
      OR: [
        { status: BookingStatus.CONFIRMED, ...near },
        // Out on the road: the drop isn't recorded yet (isDropRecorded)
        { status: BookingStatus.PICKED_UP, ...DROP_NOT_RECORDED_WHERE },
        ...(includeHoldRows ? [{ status: BookingStatus.HOLD, holdExpiresAt: { gt: now }, ...near }] : []),
      ],
    },
  };
}

interface FindBlockingOptions {
  excludeBookingId?: number;
  /** Also count unexpired HOLD bookings (booking creation's locked re-check). */
  includeHoldRows?: boolean;
  /** Turnaround either side (default BOOKING_TURNAROUND_MS; grace may lengthen it). */
  turnaroundMs?: number;
}

type BookingItemDb = Pick<Prisma.TransactionClient, "bookingItem">;

/**
 * The booking items that keep each of `vehicleIds` from [start, end), earliest
 * booking first — the one rule shared by the listing check, its explanation
 * and the in-transaction re-check at booking create.
 */
async function findBlockingItems(
  db: BookingItemDb,
  vehicleIds: number[],
  start: Date,
  end: Date,
  now: Date,
  options: FindBlockingOptions = {},
) {
  if (vehicleIds.length === 0) return [];
  const { excludeBookingId, includeHoldRows = false } = options;
  const turnaroundMs = options.turnaroundMs ?? BOOKING_TURNAROUND_MS;
  const rows = await db.bookingItem.findMany({
    where: {
      vehicleId: { in: vehicleIds },
      ...blockingCandidateItemWhere(start, end, now, Math.max(CANDIDATE_REACH_MS, turnaroundMs), includeHoldRows),
      ...(excludeBookingId != null && { NOT: { bookingId: excludeBookingId } }),
    },
    select: { vehicleId: true, booking: { select: { publicId: true, ...BLOCKING_BOOKING_SELECT } } },
    orderBy: { booking: { startAt: "asc" } },
  });
  return rows.filter(({ booking }) =>
    bookingBlocksWindow(
      booking,
      start,
      end,
      now,
      automaticGraceMinutes(booking.frozenChargeConfig, booking.branch.chargeConfig),
      turnaroundMs,
    ),
  );
}

/**
 * When the car is free again after a blocking booking: its return plus the
 * turnaround (grace counted). Not used for an overdue rental — that car is
 * free only once the drop is recorded.
 */
function availableFromOf(
  booking: { endAt: Date; frozenChargeConfig: Prisma.JsonValue | null; branch: { chargeConfig: Parameters<typeof automaticGraceMinutes>[1] } },
  turnaroundMs: number,
): Date {
  const grace = automaticGraceMinutes(booking.frozenChargeConfig, booking.branch.chargeConfig);
  return new Date(booking.endAt.getTime() + turnaroundMsFor(grace, turnaroundMs));
}

/**
 * TASK-001: Batch fetch of conflicting vehicle IDs — the vehicles with at least
 * one blocking booking for the requested [start, end) window (findBlockingItems).
 */
async function fetchConflictingVehicleIds(
  vehicleIds: number[],
  start: Date,
  end: Date,
): Promise<Set<number>> {
  if (vehicleIds.length === 0) return new Set();

  const conflictingItems = await findBlockingItems(prisma, vehicleIds, start, end, new Date());

  const conflicting = new Set<number>();
  for (const item of conflictingItems) {
    conflicting.add(item.vehicleId);
  }

  return conflicting;
}

/**
 * TASK-002: Check Redis holds for a set of vehicles.
 * Returns Set of vehicleIds that have an active hold overlapping [start, end).
 *
 * Reads vehicle_holds:{vehicle.publicId} sets then fetches hold data in one mget.
 * Failures are caught and logged — availability falls back to DB-only result.
 */
async function checkHoldsForVehicles(
  vehicleIdToPublicId: Map<number, string>,
  start: Date,
  end: Date,
  excludeHoldIds: ReadonlySet<string> = new Set(),
  bufferMs: number = BOOKING_TURNAROUND_MS,
): Promise<Set<number>> {
  const unavailable = new Set<number>();
  if (vehicleIdToPublicId.size === 0) return unavailable;

  try {
    const entries = Array.from(vehicleIdToPublicId.entries());

    // Fetch all vehicle hold sets in a single pipeline round-trip
    const pipeline = redis.pipeline();
    for (const [, publicId] of entries) {
      pipeline.smembers(`vehicle_holds:${publicId}`);
    }
    const results = await pipeline.exec();
    if (!results) return unavailable;

    // Collect all unique holdIds per vehicle
    const vehicleHoldIds: Array<{ vehicleId: number; holdIds: string[] }> = [];
    for (let i = 0; i < entries.length; i++) {
      const [vehicleId] = entries[i]!;
      const result = results[i];
      const holdIds = ((result && !result[0] ? (result[1] as string[]) : null) ?? []).filter(
        (id) => !excludeHoldIds.has(id),
      );
      if (holdIds.length > 0) {
        vehicleHoldIds.push({ vehicleId, holdIds });
      }
    }

    if (vehicleHoldIds.length === 0) return unavailable;

    // Fetch all hold data in one mget call
    const uniqueHoldIds = [
      ...new Set(vehicleHoldIds.flatMap((v) => v.holdIds)),
    ];
    const holdDataList = await redis.mget(...uniqueHoldIds);

    const holdDataMap = new Map<string, { startDate: string; endDate: string }>();
    for (let i = 0; i < uniqueHoldIds.length; i++) {
      const raw = holdDataList[i];
      if (raw) {
        try {
          holdDataMap.set(uniqueHoldIds[i]!, JSON.parse(raw));
        } catch {
          // malformed hold — skip
        }
      }
    }

    // Check overlap for each vehicle's holds
    for (const { vehicleId, holdIds } of vehicleHoldIds) {
      for (const holdId of holdIds) {
        const hold = holdDataMap.get(holdId);
        if (!hold) continue;
        const holdStart = new Date(hold.startDate);
        const holdEnd = new Date(hold.endDate);
        // Overlap with the turnaround either side: holdStart < end + buffer AND holdEnd + buffer > start
        if (windowsConflictWithTurnaround(holdStart.getTime(), holdEnd.getTime(), start.getTime(), end.getTime(), bufferMs)) {
          unavailable.add(vehicleId);
          break;
        }
      }
    }
  } catch (err) {
    console.warn("[availability] Redis hold check failed, falling back to DB-only:", err);
  }

  return unavailable;
}

/**
 * Active Redis holds (customer checkouts) on these vehicles that overlap
 * [start, end), with their windows — skipping `excludeHoldIds` (a booking's own
 * hold id is its publicId). Used where a booking is moved (reschedule) and the
 * caller needs to say what is in the way. Redis failures are logged and read
 * as "no holds", like checkHoldsForVehicles. `opts.bufferMs` widens the overlap
 * by a turnaround either side (default 0: a plain overlap; reschedule passes
 * BOOKING_TURNAROUND_MS).
 */
export async function listOverlappingHolds(
  vehicleIdToPublicId: Map<number, string>,
  start: Date,
  end: Date,
  excludeHoldIds: ReadonlySet<string> = new Set(),
  opts: { bufferMs?: number } = {},
): Promise<Array<{ vehicleId: number; holdId: string; startAt: Date; endAt: Date }>> {
  const bufferMs = Math.max(0, opts.bufferMs ?? 0);
  const found: Array<{ vehicleId: number; holdId: string; startAt: Date; endAt: Date }> = [];
  if (vehicleIdToPublicId.size === 0) return found;
  try {
    const entries = Array.from(vehicleIdToPublicId.entries());
    const pipeline = redis.pipeline();
    for (const [, publicId] of entries) pipeline.smembers(`vehicle_holds:${publicId}`);
    const results = (await pipeline.exec()) ?? [];

    const perVehicle: Array<{ vehicleId: number; holdIds: string[] }> = [];
    entries.forEach(([vehicleId], i) => {
      const result = results[i];
      const holdIds = ((result && !result[0] ? (result[1] as string[]) : null) ?? []).filter(
        (id) => !excludeHoldIds.has(id),
      );
      if (holdIds.length > 0) perVehicle.push({ vehicleId, holdIds });
    });
    if (perVehicle.length === 0) return found;

    const uniqueHoldIds = [...new Set(perVehicle.flatMap((v) => v.holdIds))];
    const raw = await redis.mget(...uniqueHoldIds);
    const holds = new Map<string, { startDate: string; endDate: string }>();
    uniqueHoldIds.forEach((id, i) => {
      const value = raw[i];
      if (!value) return;
      try {
        holds.set(id, JSON.parse(value));
      } catch {
        // malformed hold — skip
      }
    });

    for (const { vehicleId, holdIds } of perVehicle) {
      for (const holdId of holdIds) {
        const hold = holds.get(holdId);
        if (!hold) continue;
        const holdStart = new Date(hold.startDate);
        const holdEnd = new Date(hold.endDate);
        if (windowsConflictWithTurnaround(holdStart.getTime(), holdEnd.getTime(), start.getTime(), end.getTime(), bufferMs)) {
          found.push({ vehicleId, holdId, startAt: holdStart, endAt: holdEnd });
        }
      }
    }
  } catch (err) {
    console.warn("[availability] Redis hold listing failed, ignoring holds:", err);
  }
  return found;
}

/**
 * TASK-003: Get all vehicleIds unavailable for [start, end).
 * Checks CONFIRMED/PICKED_UP bookings (DB) and active holds (Redis), each with
 * the 3 h turnaround either side (bookingBlocksWindow), and vehicles
 * set OUT_FOR_RENTAL by hand (no booking behind it, so no window is free),
 * and booking locks overlapping the window (bookingLocks.ts — a plain overlap).
 *
 * @param vehicleIds          Internal vehicle IDs to check
 * @param start               Booking start time (output of TimezoneService.toPrisma)
 * @param end                 Booking end time (output of TimezoneService.toPrisma)
 * @param vehicleIdToPublicId Optional pre-built map to avoid an extra DB lookup.
 *                            Pass this from controllers that already have vehicle objects.
 * @param options.forStaff    A staff action (walk-in): customers-only booking locks don't count.
 */
export async function getUnavailableVehicleIds(
  vehicleIds: number[],
  start: Date,
  end: Date,
  vehicleIdToPublicId?: Map<number, string>,
  options: { forStaff?: boolean } = {},
): Promise<Set<number>> {
  if (vehicleIds.length === 0) return new Set();

  // Build public ID map only when not provided by the caller
  let idMap = vehicleIdToPublicId;
  if (!idMap) {
    const vehicles = await prisma.vehicle.findMany({
      where: { id: { in: vehicleIds } },
      select: { id: true, publicId: true },
    });
    idMap = new Map(vehicles.map((v) => [v.id, v.publicId]));
  }

  // Run DB and Redis checks in parallel
  const [dbConflicts, holdConflicts, manualOutForRental, locked] = await Promise.all([
    fetchConflictingVehicleIds(vehicleIds, start, end),
    checkHoldsForVehicles(idMap, start, end),
    getManualOutForRentalIds(vehicleIds),
    findBlockingLocks(vehicleIds, start, end, { forStaff: options.forStaff }),
  ]);

  const unavailable = new Set<number>(dbConflicts);
  for (const id of holdConflicts) {
    unavailable.add(id);
  }
  for (const id of manualOutForRental) {
    unavailable.add(id);
  }
  for (const id of locked.keys()) {
    unavailable.add(id);
  }

  console.log(
    `[availability] checked ${vehicleIds.length} vehicles: ${unavailable.size} unavailable` +
    ` (${dbConflicts.size} DB conflicts, ${holdConflicts.size} hold conflicts,` +
    ` ${manualOutForRental.size} manually out for rental, ${locked.size} booking-locked)`,
  );

  return unavailable;
}

/**
 * Of `vehicleIds`, the ones no window is free for: set OUT_FOR_RENTAL by hand,
 * or out on an overdue rental. A listing without dates leaves these out (the
 * dated check above blocks them too).
 */
export async function getBlockedForAnyWindowIds(vehicleIds: number[], now: Date = new Date()): Promise<Set<number>> {
  if (vehicleIds.length === 0) return new Set();
  const [manual, overdue] = await Promise.all([
    getManualOutForRentalIds(vehicleIds),
    prisma.bookingItem.findMany({
      where: {
        vehicleId: { in: vehicleIds },
        // Overdue and the drop not recorded yet (isDropRecorded)
        booking: { status: BookingStatus.PICKED_UP, endAt: { lte: now }, ...DROP_NOT_RECORDED_WHERE },
      },
      select: { vehicleId: true },
    }),
  ]);
  const blocked = new Set<number>(manual);
  for (const item of overdue) blocked.add(item.vehicleId);
  return blocked;
}

/** Why getUnavailableVehicleIds refuses a vehicle for a window. */
export type UnavailableReason =
  | { code: "MANUAL_OUT_FOR_RENTAL" }
  /** Picked up and past its return time (blocks every window). */
  | { code: "OVERDUE_RENTAL"; endAt: Date }
  /** Out on a rental that, with the turnaround, overlaps the window. */
  | { code: "ON_RENT"; endAt: Date; availableFrom: Date }
  /** A confirmed booking, with the turnaround, overlaps the window. */
  | { code: "BOOKED"; startAt: Date; endAt: Date; availableFrom: Date }
  /**
   * A branch manager's booking lock overlaps the window (plain overlap): staff
   * see the reason and when it ends; customers never do.
   */
  | { code: "BOOKING_LOCKED"; lockPublicId: string; reason: string; startAt: Date; endAt: Date }
  /**
   * A customer checkout is holding it for part of the window (a Redis hold, or
   * with includeHoldRows an unexpired HOLD booking).
   */
  | { code: "ON_HOLD" };

export interface ExplainUnavailableOptions {
  /** Read through this client (a transaction that holds the vehicle row locks). */
  db?: Prisma.TransactionClient;
  /**
   * Also count unexpired HOLD bookings overlapping the window — the extra check
   * booking creation makes under its lock (lockAndFindBlockedVehicleIds).
   */
  includeHoldRows?: boolean;
  /** Ignore this booking's own rows (a booking moved onto another car). */
  excludeBookingId?: number;
  /** Ignore these Redis holds (a booking's own hold id is its publicId). */
  excludeHoldIds?: ReadonlySet<string>;
  /** A staff action (walk-in, swap): customers-only booking locks don't count. */
  forStaff?: boolean;
  /**
   * Turnaround either side of every booking and hold (default
   * BOOKING_TURNAROUND_MS; a booking's longer automatic grace still counts).
   * An extension swap passes its own buffer.
   */
  turnaroundMs?: number;
  now?: Date;
}

/**
 * getUnavailableVehicleIds with the reason per vehicle — the same four checks
 * (blocking bookings, Redis holds, hand-set OUT_FOR_RENTAL, booking locks), so
 * a vehicle is in this map exactly when it is in that set. One reason per
 * vehicle, most lasting first: hand-set OUT_FOR_RENTAL, overdue, booking lock,
 * on rent, booked, hold.
 * `options` adds booking creation's live-HOLD-row check, a transaction client
 * and the moved booking's own rows to ignore (vehicle swaps).
 */
export async function explainUnavailableVehicles(
  vehicleIds: number[],
  start: Date,
  end: Date,
  vehicleIdToPublicId: Map<number, string>,
  options: ExplainUnavailableOptions = {},
): Promise<Map<number, UnavailableReason>> {
  const reasons = new Map<number, UnavailableReason>();
  if (vehicleIds.length === 0) return reasons;

  const db = options.db ?? prisma;
  const now = options.now ?? new Date();
  const turnaroundMs = options.turnaroundMs ?? BOOKING_TURNAROUND_MS;
  const [items, holdConflicts, manualOutForRental, locked] = await Promise.all([
    findBlockingItems(db, vehicleIds, start, end, now, {
      excludeBookingId: options.excludeBookingId,
      includeHoldRows: options.includeHoldRows,
      turnaroundMs,
    }),
    checkHoldsForVehicles(vehicleIdToPublicId, start, end, options.excludeHoldIds, turnaroundMs),
    getManualOutForRentalIds(vehicleIds, db),
    findBlockingLocks(vehicleIds, start, end, { forStaff: options.forStaff, db }),
  ]);

  const rank = (r: UnavailableReason): number =>
    ({ MANUAL_OUT_FOR_RENTAL: 0, OVERDUE_RENTAL: 1, BOOKING_LOCKED: 2, ON_RENT: 3, BOOKED: 4, ON_HOLD: 5 })[r.code];
  const offer = (vehicleId: number, reason: UnavailableReason) => {
    const current = reasons.get(vehicleId);
    if (!current || rank(reason) < rank(current)) reasons.set(vehicleId, reason);
  };

  for (const id of manualOutForRental) offer(id, { code: "MANUAL_OUT_FOR_RENTAL" });
  for (const [id, lock] of locked) {
    offer(id, { code: "BOOKING_LOCKED", lockPublicId: lock.publicId, reason: lock.reason, startAt: lock.startAt, endAt: lock.endAt });
  }
  for (const { vehicleId, booking } of items) {
    if (booking.status === BookingStatus.PICKED_UP) {
      offer(
        vehicleId,
        booking.endAt <= now
          ? { code: "OVERDUE_RENTAL", endAt: booking.endAt }
          : { code: "ON_RENT", endAt: booking.endAt, availableFrom: availableFromOf(booking, turnaroundMs) },
      );
    } else if (booking.status === BookingStatus.HOLD) {
      offer(vehicleId, { code: "ON_HOLD" });
    } else {
      offer(vehicleId, {
        code: "BOOKED",
        startAt: booking.startAt,
        endAt: booking.endAt,
        availableFrom: availableFromOf(booking, turnaroundMs),
      });
    }
  }
  for (const id of holdConflicts) offer(id, { code: "ON_HOLD" });

  return reasons;
}

/**
 * Inside a booking-create transaction: locks the vehicle rows (FOR UPDATE, in
 * id order) and returns the ones that can't take [start, end) — removed or no
 * longer listable, set Out for Rental by hand, a blocking booking or an
 * unexpired HOLD of another checkout (findBlockingItems, the 3 h turnaround
 * either side, a drop already recorded not counting) or a booking lock overlapping the window
 * (customers-only locks not counting with `options.forStaff`). Two creates for the same car serialise on
 * the lock, so the later one sees the earlier one's HOLD row and is refused; a booking lock
 * being created takes the same row locks (booking-lock.service), so it is seen too.
 * Redis holds are checked before the transaction (getUnavailableVehicleIds).
 */
export async function lockAndFindBlockedVehicleIds(
  tx: Prisma.TransactionClient,
  vehicleIds: number[],
  start: Date,
  end: Date,
  options: { forStaff?: boolean } = {},
): Promise<Set<number>> {
  const blocked = new Set<number>();
  if (vehicleIds.length === 0) return blocked;
  const ids = [...new Set(vehicleIds)].sort((a, b) => a - b);

  const locked = await tx.$queryRaw<Array<{ id: number; status: string; deletedAt: Date | null }>>`
    SELECT "id", "status"::text AS "status", "deletedAt" FROM "Vehicle"
    WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;

  const now = new Date();
  const items = await findBlockingItems(tx, ids, start, end, now, { includeHoldRows: true });
  const onRental = new Set(
    (
      await tx.bookingItem.findMany({
        where: { vehicleId: { in: ids }, booking: { status: BookingStatus.PICKED_UP } },
        select: { vehicleId: true },
      })
    ).map((i) => i.vehicleId),
  );

  for (const v of locked) {
    const manualOutForRental = v.status === "OUT_FOR_RENTAL" && !onRental.has(v.id);
    if (v.deletedAt || !isListableStatus(v.status) || manualOutForRental) blocked.add(v.id);
  }
  for (const i of items) blocked.add(i.vehicleId);
  const lockBlocked = await findBlockingLocks(ids, start, end, { forStaff: options.forStaff, db: tx });
  for (const id of lockBlocked.keys()) blocked.add(id);
  return blocked;
}

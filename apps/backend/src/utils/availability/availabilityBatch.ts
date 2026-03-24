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

import { prisma, BookingStatus } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";

/** Booking statuses that block a vehicle from being rented. HOLD is excluded intentionally
 *  — HOLD bookings may expire and should not prevent new listings from showing the vehicle. */
const BLOCKING_STATUSES: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.PICKED_UP,
];

/**
 * TASK-001: Single-query batch fetch of conflicting vehicle IDs.
 * Returns a Set of vehicleIds that have at least one CONFIRMED/PICKED_UP booking
 * overlapping the requested [start, end) window.
 *
 * Overlap condition: booking.startAt < end AND booking.endAt > start
 */
async function fetchConflictingVehicleIds(
  vehicleIds: number[],
  start: Date,
  end: Date,
): Promise<Set<number>> {
  if (vehicleIds.length === 0) return new Set();

  const conflictingItems = await prisma.bookingItem.findMany({
    where: {
      vehicleId: { in: vehicleIds },
      booking: {
        status: { in: BLOCKING_STATUSES },
        startAt: { lt: end },   // booking starts before requested end
        endAt:   { gt: start }, // booking ends after requested start
      },
    },
    select: { vehicleId: true },
  });

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
      const holdIds = (result && !result[0] ? (result[1] as string[]) : null) ?? [];
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
        // Overlap: holdStart < end AND holdEnd > start
        if (holdStart < end && holdEnd > start) {
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
 * TASK-003: Get all vehicleIds unavailable for [start, end).
 * Checks both CONFIRMED/PICKED_UP bookings (DB) and active holds (Redis).
 *
 * @param vehicleIds          Internal vehicle IDs to check
 * @param start               Booking start time (output of TimezoneService.toPrisma)
 * @param end                 Booking end time (output of TimezoneService.toPrisma)
 * @param vehicleIdToPublicId Optional pre-built map to avoid an extra DB lookup.
 *                            Pass this from controllers that already have vehicle objects.
 */
export async function getUnavailableVehicleIds(
  vehicleIds: number[],
  start: Date,
  end: Date,
  vehicleIdToPublicId?: Map<number, string>,
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
  const [dbConflicts, holdConflicts] = await Promise.all([
    fetchConflictingVehicleIds(vehicleIds, start, end),
    checkHoldsForVehicles(idMap, start, end),
  ]);

  const unavailable = new Set<number>(dbConflicts);
  for (const id of holdConflicts) {
    unavailable.add(id);
  }

  console.log(
    `[availability] checked ${vehicleIds.length} vehicles: ${unavailable.size} unavailable` +
    ` (${dbConflicts.size} DB conflicts, ${holdConflicts.size} hold conflicts)`,
  );

  return unavailable;
}

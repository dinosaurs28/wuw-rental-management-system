/**
 * The extension availability rule (pure: no database). An extension from the
 * current return to a new return is blocked by any booking, rental or
 * checkout on the same car that overlaps [current return, new return +
 * EXTENSION_BUFFER_HOURS): the new return must be at least 2 hours before the
 * next pickup. Evaluate (the conflict resolver), the partial extension, the
 * eligibility "available until" and the commit's re-checks (before and under
 * the vehicle row lock, through extensionAvailabilityService.checkVehicleAvailability)
 * all use these helpers, so an option that is offered also commits.
 *
 * A booking lock (kind "LOCK") is an exact window: the return must be at or
 * before the lock's start — no buffer (bufferBefore).
 */
import { EXTENSION_BUFFER_MS, EXTENSION_SLOT_MINUTES, type ExtensionLimitReason } from "@repo/schemas";

const SLOT_MS = EXTENSION_SLOT_MINUTES * 60 * 1000;

/** What a conflict may say about itself: LOCK = a booking lock. */
type ConflictKind = { kind?: string | null };

/** The gap a return must leave before this conflict starts: none for a booking lock, else the buffer. */
export function bufferBefore(conflict: ConflictKind): number {
  return conflict.kind === "LOCK" ? 0 : EXTENSION_BUFFER_MS;
}

/** End of the window an extension to `newEndAt` is checked over: newEndAt + the buffer. */
export function extensionCheckEnd(newEndAt: Date): Date {
  return new Date(newEndAt.getTime() + EXTENSION_BUFFER_MS);
}

/** Does `conflict` keep the car from being extended from currentEndAt to newEndAt? */
export function blocksExtension(
  conflict: { startAt: Date; endAt: Date } & ConflictKind,
  currentEndAt: Date,
  newEndAt: Date,
): boolean {
  return (
    conflict.startAt.getTime() < newEndAt.getTime() + bufferBefore(conflict) &&
    conflict.endAt.getTime() > currentEndAt.getTime()
  );
}

/**
 * Latest return before a pickup at `pickupAt`: the buffer earlier (`bufferMs`,
 * 0 for a booking lock), rounded down to the EXTENSION_SLOT_MINUTES grid the
 * pickers offer.
 */
export function latestReturnBefore(pickupAt: Date, bufferMs: number = EXTENSION_BUFFER_MS): Date {
  const t = pickupAt.getTime() - bufferMs;
  return new Date(Math.floor(t / SLOT_MS) * SLOT_MS);
}

/** Latest return this conflict allows (latestReturnBefore its start, with its own buffer). */
export function latestReturnFor(conflict: { startAt: Date } & ConflictKind): Date {
  return latestReturnBefore(conflict.startAt, bufferBefore(conflict));
}

/**
 * The end a partial extension can hold: the latest return before the first
 * booking, rental or checkout in the way (latestReturnBefore its start). The
 * conflicts are the ones the commit re-checks, so a partial that is offered
 * also commits. Returns null when that end is not after the current return
 * (the car is needed within 2 hours of it, e.g. a booking right at the return),
 * or when nothing is in the way (the full extension is available).
 */
export function partialExtensionEnd(
  currentEndAt: Date,
  requestedEndAt: Date,
  conflicts: ReadonlyArray<{ startAt: Date } & ConflictKind>,
): Date | null {
  // Only conflicts that reach the requested return (start < requested + their buffer)
  const inWay = conflicts.filter((c) => c.startAt.getTime() < requestedEndAt.getTime() + bufferBefore(c));
  if (inWay.length === 0) return null;
  const end = new Date(Math.min(...inWay.map((c) => latestReturnFor(c).getTime())));
  if (end.getTime() <= currentEndAt.getTime()) return null;
  // each start < requested + its buffer, so end < requested: always a shorter extension
  return end.getTime() < requestedEndAt.getTime() ? end : null;
}

export interface ExtensionAvailableUntil {
  /** Latest return the current car can be extended to (never before currentEndAt). */
  availableUntil: Date;
  limitReason: ExtensionLimitReason;
  /** False when there is no time left on this car (availableUntil == currentEndAt). */
  canExtend: boolean;
}

/**
 * How far the booking's current car can be extended: the latest return before
 * the next pickup (nextPickupAt − buffer, rounded down), or the rental-length
 * cap when that comes first.
 */
export function extensionAvailableUntil(input: {
  currentEndAt: Date;
  maxEndAt: Date;
  nextPickupAt: Date | null;
  /** The next conflict's kind: "LOCK" (a booking lock) needs no buffer before it. */
  nextKind?: string | null;
}): ExtensionAvailableUntil {
  const { currentEndAt, maxEndAt, nextPickupAt } = input;
  const beforeNext = nextPickupAt ? latestReturnBefore(nextPickupAt, bufferBefore({ kind: input.nextKind })) : null;
  const byNext = !!beforeNext && beforeNext.getTime() < maxEndAt.getTime();
  const limit = byNext ? beforeNext! : maxEndAt;
  const canExtend = limit.getTime() > currentEndAt.getTime();
  return {
    availableUntil: canExtend ? limit : currentEndAt,
    limitReason: byNext ? "NEXT_BOOKING" : "MAX_RENTAL_PERIOD",
    canExtend,
  };
}

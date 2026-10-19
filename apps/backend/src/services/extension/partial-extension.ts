/**
 * The extension availability rule (pure: no database). An extension from the
 * current return to a new return is blocked by any booking, rental or
 * checkout on the same car that overlaps [current return, new return +
 * EXTENSION_BUFFER_HOURS): the new return must be at least 2 hours before the
 * next pickup. Evaluate (the conflict resolver), the partial extension, the
 * eligibility "available until" and the commit's re-checks (before and under
 * the vehicle row lock, through extensionAvailabilityService.checkVehicleAvailability)
 * all use these helpers, so an option that is offered also commits.
 */
import { EXTENSION_BUFFER_MS, EXTENSION_SLOT_MINUTES, type ExtensionLimitReason } from "@repo/schemas";

const SLOT_MS = EXTENSION_SLOT_MINUTES * 60 * 1000;

/** End of the window an extension to `newEndAt` is checked over: newEndAt + the buffer. */
export function extensionCheckEnd(newEndAt: Date): Date {
  return new Date(newEndAt.getTime() + EXTENSION_BUFFER_MS);
}

/** Does `conflict` keep the car from being extended from currentEndAt to newEndAt? */
export function blocksExtension(
  conflict: { startAt: Date; endAt: Date },
  currentEndAt: Date,
  newEndAt: Date,
): boolean {
  return (
    conflict.startAt.getTime() < extensionCheckEnd(newEndAt).getTime() &&
    conflict.endAt.getTime() > currentEndAt.getTime()
  );
}

/**
 * Latest return before a pickup at `pickupAt`: the buffer earlier, rounded
 * down to the EXTENSION_SLOT_MINUTES grid the pickers offer.
 */
export function latestReturnBefore(pickupAt: Date): Date {
  const t = pickupAt.getTime() - EXTENSION_BUFFER_MS;
  return new Date(Math.floor(t / SLOT_MS) * SLOT_MS);
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
  conflicts: ReadonlyArray<{ startAt: Date }>,
): Date | null {
  if (conflicts.length === 0) return null;
  const first = Math.min(...conflicts.map((c) => c.startAt.getTime()));
  if (first >= extensionCheckEnd(requestedEndAt).getTime()) return null;
  const end = latestReturnBefore(new Date(first));
  if (end.getTime() <= currentEndAt.getTime()) return null;
  // first < requested + buffer, so end < requested: always a shorter extension
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
}): ExtensionAvailableUntil {
  const { currentEndAt, maxEndAt, nextPickupAt } = input;
  const beforeNext = nextPickupAt ? latestReturnBefore(nextPickupAt) : null;
  const byNext = !!beforeNext && beforeNext.getTime() < maxEndAt.getTime();
  const limit = byNext ? beforeNext! : maxEndAt;
  const canExtend = limit.getTime() > currentEndAt.getTime();
  return {
    availableUntil: canExtend ? limit : currentEndAt,
    limitReason: byNext ? "NEXT_BOOKING" : "MAX_RENTAL_PERIOD",
    canExtend,
  };
}

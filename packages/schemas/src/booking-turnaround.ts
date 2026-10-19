/**
 * Turnaround between two bookings of the same car (client request, Oct 2026):
 * a car is free for a new booking only from BOOKING_TURNAROUND_HOURS after an
 * existing booking's scheduled return, and a new booking must end at least
 * that long before an existing booking's pickup. Once fleet records the drop,
 * the returned booking stops blocking (the car is free at once).
 */

/** Hours a car is kept between one booking's return and the next pickup. */
export const BOOKING_TURNAROUND_HOURS = 3;
export const BOOKING_TURNAROUND_MS = BOOKING_TURNAROUND_HOURS * 60 * 60 * 1000;

/**
 * Whether an existing booking [existingStart, existingEnd) keeps the car from
 * a new window [start, end) with `turnaroundMs` either side: the new pickup
 * must be at least turnaroundMs after the existing return, or the new return
 * at least turnaroundMs before the existing pickup.
 */
export function windowsConflictWithTurnaround(
  existingStartMs: number,
  existingEndMs: number,
  startMs: number,
  endMs: number,
  turnaroundMs: number = BOOKING_TURNAROUND_MS,
): boolean {
  const t = Math.max(0, turnaroundMs);
  return existingStartMs < endMs + t && startMs < existingEndMs + t;
}

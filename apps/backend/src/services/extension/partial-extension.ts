/**
 * The end a partial extension can hold: up to the first booking, rental or
 * checkout in the way — the same conflicts the commit re-checks
 * (extensionAvailabilityService.checkVehicleAvailability over
 * [current end, requested end)), so a partial that is offered also commits.
 * None when the first conflict starts at or before the current end (the car is
 * already taken from the return time — e.g. a booking right at the return) or
 * when nothing is in the way (the full extension is available).
 *
 * Pure: no database.
 */
export function partialExtensionEnd(
  currentEndAt: Date,
  requestedEndAt: Date,
  conflicts: ReadonlyArray<{ startAt: Date }>,
): Date | null {
  if (conflicts.length === 0) return null;
  const first = Math.min(...conflicts.map((c) => c.startAt.getTime()));
  if (first <= currentEndAt.getTime() || first >= requestedEndAt.getTime()) return null;
  return new Date(first);
}

/**
 * TASK-004: Single-vehicle availability check — delegates to the batch utility.
 *
 * Fixed: removed HOLD from blocking statuses (HOLD bookings may expire and should
 * not prevent other bookings from being created).
 * Correct blocking statuses: CONFIRMED, PICKED_UP (see availabilityBatch.ts).
 */

import { getUnavailableVehicleIds } from "./availabilityBatch.js";

export async function checkVehicleAvailability(
  vehicleId: number,
  start: Date,
  end: Date,
  // A staff action (walk-in): customers-only booking locks don't count
  options: { forStaff?: boolean } = {},
): Promise<boolean> {
  const unavailable = await getUnavailableVehicleIds([vehicleId], start, end, undefined, options);
  return !unavailable.has(vehicleId);
}

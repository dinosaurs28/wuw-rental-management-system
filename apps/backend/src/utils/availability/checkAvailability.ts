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
): Promise<boolean> {
  const unavailable = await getUnavailableVehicleIds([vehicleId], start, end);
  return !unavailable.has(vehicleId);
}

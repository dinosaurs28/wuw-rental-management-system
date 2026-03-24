/**
 * TASK-018: Structured cache key helpers for vehicle-scoped Redis keys.
 *
 * Use these helpers for all vehicle availability and pricing cache operations
 * to ensure consistent key patterns and enable targeted invalidation.
 */

/** Short-TTL availability cache (30 seconds). Invalidate on any booking state change. */
export const vehicleAvailabilityKey = (vehicleId: number): string =>
  `vehicle:${vehicleId}:availability`;

/** Medium-TTL pricing cache (300 seconds). Invalidate on pricing config updates. */
export const vehiclePricingKey = (vehicleId: number): string =>
  `vehicle:${vehicleId}:pricing`;

/**
 * TASK-019: Delete availability cache for a set of vehicles.
 * Call after booking create/update/cancel/state-change for the affected vehicles.
 */
export async function invalidateVehicleAvailability(
  redis: { del: (...keys: string[]) => Promise<any> },
  vehicleIds: number[],
): Promise<void> {
  if (vehicleIds.length === 0) return;
  const keys = vehicleIds.map(vehicleAvailabilityKey);
  await redis.del(...keys);
}

/**
 * Delete pricing cache for a set of vehicles.
 * Call after pricing config updates (branchPricingDefaults or vehicleCustomPricing changes).
 */
export async function invalidateVehiclePricing(
  redis: { del: (...keys: string[]) => Promise<any> },
  vehicleIds: number[],
): Promise<void> {
  if (vehicleIds.length === 0) return;
  const keys = vehicleIds.map(vehiclePricingKey);
  await redis.del(...keys);
}

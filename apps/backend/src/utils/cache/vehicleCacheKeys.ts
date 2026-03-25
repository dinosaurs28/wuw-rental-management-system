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

// ── Pricing config cache keys (TASK-006) ──────────────────────────────────────

/** VehicleCustomPricing record for a vehicle. TTL 300s. Invalidate on vehicleCustomPricing update. */
export const vehiclePricingConfigKey = (vehicleId: number): string =>
  `pricing-config:vehicle:${vehicleId}`;

/** BranchPricingDefaults for a branch+category combination. TTL 300s. */
export const branchPricingDefaultsKey = (branchId: number, categoryId: number): string =>
  `pricing-defaults:branch:${branchId}:cat:${categoryId}`;

/** GSTRule for a branch. TTL 600s. Invalidate on GST rule update. */
export const gstRuleKey = (branchId: number): string =>
  `gst:branch:${branchId}`;

/** CategoryDepositSetting amount for a branch+category. TTL 300s. */
export const depositSettingKey = (branchId: number, categoryId: number): string =>
  `deposit:branch:${branchId}:cat:${categoryId}`;

/** BranchDiscountConfig for a branch. TTL 300s. Shared by duration and coupon discount services. */
export const branchDiscountConfigKey = (branchId: number): string =>
  `discount-config:branch:${branchId}`;

/** Best-matching DurationDiscountSlab for a branch+days. TTL 300s. */
export const durationDiscountSlabKey = (branchId: number, days: number): string =>
  `discount-slab:branch:${branchId}:days:${days}`;

/** Full PricingResult for a vehicle+time window. TTL 60s. Invalidate on booking change. (TASK-017) */
export const vehicleDetailsPricingKey = (vehicleId: number, startIso: string, endIso: string): string =>
  `pricing-result:vehicle:${vehicleId}:${startIso}:${endIso}`;

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

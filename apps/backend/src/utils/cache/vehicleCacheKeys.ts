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

/**
 * Full PricingResult for a vehicle+time window. TTL 60s. Invalidate on booking change. (TASK-017)
 * "v2": results priced on the GST-inclusive rent (item 17); "v3": the Extra Hour
 * Rate became the one hourly rate — a result cached by an older release is never
 * read back.
 */
export const vehicleDetailsPricingKey = (vehicleId: number, startIso: string, endIso: string): string =>
  `pricing-result:vehicle:${vehicleId}:v3:${startIso}:${endIso}`;

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
 * Clears every vehicle-scoped pricing key — including the VehicleCustomPricing record the
 * pricing engine caches (pricing-config:vehicle:{id}) and, when the client can SCAN, the
 * cached PricingResults (pricing-result:vehicle:{id}:*) — so an edited rate (e.g. extra km)
 * applies to the very next price or drop bill instead of after the cache TTL.
 */
export async function invalidateVehiclePricing(
  redis: {
    del: (...keys: string[]) => Promise<any>;
    scan?: (...args: any[]) => Promise<any>;
  },
  vehicleIds: number[],
): Promise<void> {
  if (vehicleIds.length === 0) return;
  const keys = vehicleIds.flatMap((id) => [vehiclePricingKey(id), vehiclePricingConfigKey(id)]);
  await redis.del(...keys);

  if (!redis.scan) return;
  for (const id of vehicleIds) {
    let cursor = "0";
    do {
      const [nextCursor, found] = await redis.scan(cursor, "MATCH", `pricing-result:vehicle:${id}:*`, "COUNT", 100);
      cursor = nextCursor;
      if (found.length > 0) await redis.del(...found);
    } while (cursor !== "0");
  }
}

/**
 * Invalidate all grouped listing caches — customer and walk-in listings, and
 * the walk-in category lists (a category shows while it has a listable car).
 * Call after any vehicle status/availability change so listing availableCount stays accurate.
 * Uses SCAN to avoid KEYS issues on Redis Cluster.
 */
export async function invalidateGroupListingCache(
  redis: { scan: (...args: any[]) => Promise<any>; del: (...keys: string[]) => Promise<any> },
  groupKey?: string,
): Promise<void> {
  try {
    const patterns = [
      "public:vehicles:grouped:*",
      "employee:vehicles:grouped:*",
      "employee:branch:*:categories",
      ...(groupKey
        ? [`public:vehicles:group:${groupKey}:*`, `employee:vehicles:group:${groupKey}:*`]
        : ["public:vehicles:group:*", "employee:vehicles:group:*"]),
    ];

    for (const pattern of patterns) {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = nextCursor;
        if (keys.length > 0) await redis.del(...keys);
      } while (cursor !== "0");
    }
  } catch (err) {
    console.warn("[cache] invalidateGroupListingCache failed (non-fatal):", err);
  }
}

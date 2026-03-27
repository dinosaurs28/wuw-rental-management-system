import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { redis } from "../../lib/redisconfig.js";
import { branchDiscountConfigKey, durationDiscountSlabKey } from "../../utils/cache/vehicleCacheKeys.js";

const SLAB_TTL = 300;

export interface DurationDiscountResult {
  applied: boolean;
  slabId: number | null;
  discountType: "PERCENTAGE" | "FLAT" | null;
  value: Decimal;
  discountAmount: Decimal;
  discountPercent: Decimal;
  postDiscountAmount: Decimal;
  label: string | null;
}

const ZERO = new Decimal(0);

class DurationDiscountService {
  /**
   * Evaluate the best-matching duration slab for a branch + actual hours.
   * Uses actual hours (not ceiling days) so that e.g. 6d22h (166hr) does NOT
   * qualify for a 7-day (168hr) slab — preventing over-qualification.
   *
   * Slab comparison: slab.minDays * 24 ≤ actualHours ≤ (slab.maxDays ?? ∞) * 24
   *
   * Returns zero-discount result when:
   *   - branch has durationDiscountEnabled = false
   *   - no slab matches the booking duration
   */
  async evaluate(
    branchId: number,
    actualHours: number,
    baseAmount: Decimal,
  ): Promise<DurationDiscountResult> {
    const noDiscount: DurationDiscountResult = {
      applied: false,
      slabId: null,
      discountType: null,
      value: ZERO,
      discountAmount: ZERO,
      discountPercent: ZERO,
      postDiscountAmount: baseAmount,
      label: null,
    };

    // Check branch config — feature must be enabled (TASK-011: Redis cached, shared key with discount-evaluation-engine)
    const configCacheKey = branchDiscountConfigKey(branchId);
    let config: { durationDiscountEnabled: boolean } | null = null;
    try {
      const cached = await redis.get(configCacheKey);
      if (cached !== null) {
        config = JSON.parse(cached);
      } else {
        config = await prisma.branchDiscountConfig.findUnique({
          where: { branchId },
          select: { stackWithCoupon: true, maxCombinedDiscountPercent: true, durationDiscountEnabled: true },
        });
        await redis.set(configCacheKey, JSON.stringify(config), "EX", SLAB_TTL);
      }
    } catch (err) {
      console.warn("[pricing-cache] Redis error, falling back to DB:", err);
      config = await prisma.branchDiscountConfig.findUnique({
        where: { branchId },
        select: { durationDiscountEnabled: true },
      });
    }

    if (!config || !config.durationDiscountEnabled) return noDiscount;

    // Convert actualHours to a float day value for slab comparison.
    // e.g. 168hr → 7.0, 166hr → 6.917, 52hr → 2.167
    // Prisma compares int column (minDays) against the float — safe for lte/gte.
    const effectiveDays = actualHours / 24;

    // Cache key bucketed by floored hours so adjacent durations share the cache slot
    const slabCacheKey = durationDiscountSlabKey(branchId, Math.floor(actualHours));
    let slab: any;
    try {
      const cached = await redis.get(slabCacheKey);
      if (cached !== null) {
        slab = JSON.parse(cached); // null or slab object
      } else {
        slab = await prisma.durationDiscountSlab.findFirst({
          where: {
            branchId,
            minDays: { lte: effectiveDays },
            OR: [{ maxDays: null }, { maxDays: { gte: effectiveDays } }],
          },
          orderBy: { minDays: "desc" },
        });
        await redis.set(slabCacheKey, JSON.stringify(slab), "EX", SLAB_TTL);
      }
    } catch (err) {
      console.warn("[pricing-cache] Redis error, falling back to DB:", err);
      slab = await prisma.durationDiscountSlab.findFirst({
        where: {
          branchId,
          minDays: { lte: effectiveDays },
          OR: [{ maxDays: null }, { maxDays: { gte: effectiveDays } }],
        },
        orderBy: { minDays: "desc" },
      });
    }

    if (!slab) return noDiscount;

    const value = new Decimal(slab.value.toString());
    let discountAmount: Decimal;
    let discountPercent: Decimal;
    let postDiscountAmount: Decimal;

    if (slab.discountType === "PERCENTAGE") {
      discountAmount = baseAmount.mul(value).div(100).toDecimalPlaces(2);
      discountPercent = value;
      postDiscountAmount = baseAmount.sub(discountAmount);
    } else {
      // FLAT
      discountAmount = Decimal.min(value, baseAmount).toDecimalPlaces(2);
      discountPercent = discountAmount.div(baseAmount).mul(100).toDecimalPlaces(4);
      postDiscountAmount = baseAmount.sub(discountAmount);
    }

    return {
      applied: true,
      slabId: slab.id,
      discountType: slab.discountType,
      value,
      discountAmount,
      discountPercent,
      postDiscountAmount,
      label: slab.label,
    };
  }
}

export const durationDiscountService = new DurationDiscountService();

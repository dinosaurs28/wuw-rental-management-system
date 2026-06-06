/**
 * TASK-007 / TASK-008: Batch listing price fetch — 2 DB queries for all vehicles.
 *
 * Returns the applicable base price per vehicle for the given duration, matching
 * the same slab selection logic as PricingEngineService.determineBasePrice.
 * Used exclusively by the listing API to avoid per-vehicle pricing engine calls.
 */

import { prisma } from "@repo/database/client";
import {
  RentalPeriodType,
  type RentalDuration,
} from "../../services/pricing/duration-calculator.service.js";

interface VehicleRef {
  id: number;
  branchId: number;
  categoryId: number;
}

interface PricingRow {
  hourlyRate: number | null;
  price12Hour: number | null;
  price24Hour: number;
  priceMonthly: number | null;
}

/** Converts a Prisma Decimal to a number, returning null if the value is 0 or unset.
 *  Prisma Decimal(0) is an object (truthy), so a plain `? Number(x) : null` check
 *  would store 0 instead of null, breaking the `?? fallback` logic downstream. */
function toPositiveOrNull(val: { toNumber?: () => number } | null | undefined): number | null {
  if (val == null) return null;
  const n = Number(val);
  return n > 0 ? n : null;
}

/**
 * Mirrors PricingEngineService.determineBasePrice hourly-first rule:
 * if hourlyRate > 0 → hourlyRate × ceil(actualDuration) for ALL slab types.
 * Otherwise fall through to slab-based pricing.
 */
function selectPrice(pricing: PricingRow, duration: RentalDuration): number {
  if (pricing.hourlyRate && pricing.hourlyRate > 0) {
    const billableHours = Math.max(1, Math.ceil(duration.actualDuration));
    return pricing.hourlyRate * billableHours;
  }

  switch (duration.periodType) {
    case RentalPeriodType.HALF_DAY:
      return pricing.price12Hour ?? pricing.price24Hour;
    case RentalPeriodType.FULL_DAY:
      return pricing.price24Hour;
    case RentalPeriodType.MULTI_DAY: {
      // Split complete 24hr periods from partial last day and apply slab rounding,
      // matching PricingEngineService.determineBasePrice behaviour.
      const fullDays = Math.floor(duration.actualDuration / 24);
      const remainingHours = duration.actualDuration % 24;

      if (remainingHours <= 0) {
        return pricing.price24Hour * fullDays;
      } else if (remainingHours <= 12 && pricing.price12Hour) {
        // Partial day ≤ 12hrs → half-day rate for remainder
        return pricing.price24Hour * fullDays + pricing.price12Hour;
      } else {
        // Partial day > 12hrs or no half-day pricing → round up to full day
        return pricing.price24Hour * (fullDays + 1);
      }
    }
    case RentalPeriodType.MONTHLY: {
      if (pricing.priceMonthly) {
        // Full months + overflow days + leftover hours
        const fullMonths     = Math.floor(duration.actualDuration / (30 * 24));
        const afterMonths    = duration.actualDuration % (30 * 24);
        const overflowDays   = Math.floor(afterMonths / 24);
        const leftoverHours  = afterMonths % 24;

        let price = pricing.priceMonthly * fullMonths;
        price += pricing.price24Hour * overflowDays;
        if (leftoverHours > 0) {
          if (pricing.hourlyRate && pricing.hourlyRate > 0) {
            price += pricing.hourlyRate * Math.ceil(leftoverHours);
          } else if (leftoverHours <= 12 && pricing.price12Hour) {
            price += pricing.price12Hour;
          } else {
            price += pricing.price24Hour;
          }
        }
        return price;
      }
      // No monthly rate — bill per actual day
      const actualDays = Math.ceil(duration.actualDuration / 24);
      return pricing.price24Hour * actualDays;
    }
    default:
      return pricing.price24Hour;
  }
}

export interface ListingPrice {
  price: number;      // base price before discount
  finalPrice: number; // price after duration discount
}

/**
 * Fetch listing prices for multiple vehicles with duration discounts applied.
 * Uses at most 4 DB queries total (2 for pricing, 2 for discount config/slabs).
 *
 * @param vehicles  Minimal vehicle objects (id, branchId, categoryId already in memory)
 * @param duration  Pre-computed RentalDuration — same for all vehicles in a single search
 * @returns Map<vehicleId, ListingPrice>
 */
export async function getBatchListingPrices(
  vehicles: VehicleRef[],
  duration: RentalDuration,
): Promise<Map<number, ListingPrice>> {
  if (vehicles.length === 0) return new Map();

  const vehicleIds = vehicles.map((v) => v.id);

  // Query 1: custom pricing (enabled vehicles override branch defaults)
  const customPricings = await prisma.vehicleCustomPricing.findMany({
    where: { vehicleId: { in: vehicleIds }, enabled: true },
    select: {
      vehicleId: true,
      hourlyRate: true,
      price12Hour: true,
      price24Hour: true,
      priceMonthly: true,
    },
  });

  const customMap = new Map<number, PricingRow>();
  for (const cp of customPricings) {
    customMap.set(cp.vehicleId, {
      hourlyRate:   toPositiveOrNull(cp.hourlyRate),
      price12Hour:  toPositiveOrNull(cp.price12Hour),
      price24Hour:  Number(cp.price24Hour),
      priceMonthly: toPositiveOrNull(cp.priceMonthly),
    });
  }

  // Query 2: branch defaults for vehicles without custom pricing
  const needsDefault = vehicles.filter((v) => !customMap.has(v.id));
  const defaultMap = new Map<string, PricingRow>();

  if (needsDefault.length > 0) {
    const uniquePairs = [
      ...new Map(
        needsDefault.map((v) => [`${v.branchId}:${v.categoryId}`, v]),
      ).values(),
    ];

    const branchDefaults = await prisma.branchPricingDefaults.findMany({
      where: {
        OR: uniquePairs.map((v) => ({
          branchId: v.branchId,
          categoryId: v.categoryId,
        })),
      },
      select: {
        branchId: true,
        categoryId: true,
        hourlyRate: true,
        price12Hour: true,
        price24Hour: true,
        priceMonthly: true,
      },
    });

    for (const bd of branchDefaults) {
      defaultMap.set(`${bd.branchId}:${bd.categoryId}`, {
        hourlyRate:   toPositiveOrNull(bd.hourlyRate),
        price12Hour:  toPositiveOrNull(bd.price12Hour),
        price24Hour:  Number(bd.price24Hour),
        priceMonthly: toPositiveOrNull(bd.priceMonthly),
      });
    }
  }

  // Build base price map
  const basePriceMap = new Map<number, number>();
  for (const v of vehicles) {
    const pricing = customMap.get(v.id) ?? defaultMap.get(`${v.branchId}:${v.categoryId}`);
    basePriceMap.set(v.id, pricing ? selectPrice(pricing, duration) : 0);
  }

  // ── Apply duration discounts (2 extra queries for all branches) ────────────
  const uniqueBranchIds = [...new Set(vehicles.map((v) => v.branchId))];
  const effectiveDays = duration.actualDuration / 24;

  // Query 3: which branches have duration discounts enabled
  const discountConfigs = await prisma.branchDiscountConfig.findMany({
    where: { branchId: { in: uniqueBranchIds }, durationDiscountEnabled: true },
    select: { branchId: true, maxCombinedDiscountPercent: true },
  });

  const enabledBranchIds = new Set(discountConfigs.map((c) => c.branchId));
  const configByBranch = new Map(discountConfigs.map((c) => [c.branchId, c]));

  // Query 4: best-matching slab per enabled branch for this duration
  const branchSlabMap = new Map<number, { discountType: string; value: number }>();

  if (enabledBranchIds.size > 0) {
    const slabs = await prisma.durationDiscountSlab.findMany({
      where: {
        branchId: { in: [...enabledBranchIds] },
        minDays: { lte: effectiveDays },
        OR: [{ maxDays: null }, { maxDays: { gte: effectiveDays } }],
      },
      orderBy: [{ branchId: "asc" }, { minDays: "desc" }],
      select: { branchId: true, discountType: true, value: true },
    });

    // First result per branch = highest matching minDays slab
    for (const s of slabs) {
      if (!branchSlabMap.has(s.branchId)) {
        branchSlabMap.set(s.branchId, { discountType: s.discountType, value: Number(s.value) });
      }
    }
  }

  // Build final result with discounts applied
  const result = new Map<number, ListingPrice>();
  for (const v of vehicles) {
    const basePrice = basePriceMap.get(v.id) ?? 0;
    const slab = branchSlabMap.get(v.branchId);

    if (!slab || basePrice === 0) {
      result.set(v.id, { price: basePrice, finalPrice: basePrice });
      continue;
    }

    let discount = slab.discountType === "PERCENTAGE"
      ? basePrice * slab.value / 100
      : Math.min(slab.value, basePrice);

    // Respect combined discount cap if set
    const cfg = configByBranch.get(v.branchId);
    if (cfg?.maxCombinedDiscountPercent != null) {
      const maxDiscount = basePrice * Number(cfg.maxCombinedDiscountPercent) / 100;
      discount = Math.min(discount, maxDiscount);
    }

    result.set(v.id, {
      price: basePrice,
      finalPrice: Math.max(0, Math.round(basePrice - discount)),
    });
  }

  return result;
}

/**
 * Fallback: fetch base 24-hour prices for vehicles when no date range is selected.
 * Used for the listing page "browse without dates" mode.
 */
export async function getBatchFallbackPrices(
  vehicles: VehicleRef[],
): Promise<Map<number, { daily: number; hourly: number; halfDay: number }>> {
  if (vehicles.length === 0) return new Map();

  const vehicleIds = vehicles.map((v) => v.id);

  const customPricings = await prisma.vehicleCustomPricing.findMany({
    where: { vehicleId: { in: vehicleIds }, enabled: true },
    select: { vehicleId: true, hourlyRate: true, price12Hour: true, price24Hour: true },
  });
  const customMap = new Map<number, PricingRow>();
  for (const cp of customPricings) {
    customMap.set(cp.vehicleId, {
      hourlyRate:   toPositiveOrNull(cp.hourlyRate),
      price12Hour:  toPositiveOrNull(cp.price12Hour),
      price24Hour:  Number(cp.price24Hour),
      priceMonthly: null,
    });
  }

  const needsDefault = vehicles.filter((v) => !customMap.has(v.id));
  const defaultMap = new Map<string, PricingRow>();

  if (needsDefault.length > 0) {
    const uniquePairs = [
      ...new Map(
        needsDefault.map((v) => [`${v.branchId}:${v.categoryId}`, v]),
      ).values(),
    ];
    const branchDefaults = await prisma.branchPricingDefaults.findMany({
      where: {
        OR: uniquePairs.map((v) => ({
          branchId: v.branchId,
          categoryId: v.categoryId,
        })),
      },
      select: { branchId: true, categoryId: true, hourlyRate: true, price12Hour: true, price24Hour: true },
    });
    for (const bd of branchDefaults) {
      defaultMap.set(`${bd.branchId}:${bd.categoryId}`, {
        hourlyRate:   toPositiveOrNull(bd.hourlyRate),
        price12Hour:  toPositiveOrNull(bd.price12Hour),
        price24Hour:  Number(bd.price24Hour),
        priceMonthly: null,
      });
    }
  }

  const result = new Map<number, { daily: number; hourly: number; halfDay: number }>();
  for (const v of vehicles) {
    const p = customMap.get(v.id) ?? defaultMap.get(`${v.branchId}:${v.categoryId}`);
    const daily = p?.price24Hour ?? 0;
    result.set(v.id, {
      daily,
      hourly:  p?.hourlyRate  ?? daily / 24,
      halfDay: p?.price12Hour ?? daily / 2,
    });
  }

  return result;
}

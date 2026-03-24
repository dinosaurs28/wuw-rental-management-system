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
    case RentalPeriodType.MULTI_DAY:
      return pricing.price24Hour * duration.days;
    case RentalPeriodType.MONTHLY:
      return pricing.priceMonthly ?? pricing.price24Hour * 30;
    default:
      return pricing.price24Hour;
  }
}

/**
 * Fetch listing prices for multiple vehicles in at most 2 DB queries.
 *
 * @param vehicles  Minimal vehicle objects (id, branchId, categoryId already in memory)
 * @param duration  Pre-computed RentalDuration — same for all vehicles in a single search
 * @returns Map<vehicleId, applicablePrice>
 */
export async function getBatchListingPrices(
  vehicles: VehicleRef[],
  duration: RentalDuration,
): Promise<Map<number, number>> {
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
      hourlyRate:   cp.hourlyRate   ? Number(cp.hourlyRate)   : null,
      price12Hour:  cp.price12Hour  ? Number(cp.price12Hour)  : null,
      price24Hour:  Number(cp.price24Hour),
      priceMonthly: cp.priceMonthly ? Number(cp.priceMonthly) : null,
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
        hourlyRate:   bd.hourlyRate   ? Number(bd.hourlyRate)   : null,
        price12Hour:  bd.price12Hour  ? Number(bd.price12Hour)  : null,
        price24Hour:  Number(bd.price24Hour),
        priceMonthly: bd.priceMonthly ? Number(bd.priceMonthly) : null,
      });
    }
  }

  // Build final price map — select slab based on duration period type
  const result = new Map<number, number>();
  for (const v of vehicles) {
    const pricing = customMap.get(v.id) ?? defaultMap.get(`${v.branchId}:${v.categoryId}`);
    if (pricing) {
      result.set(v.id, selectPrice(pricing, duration));
    } else {
      // No pricing configured — return 0; UI should treat as "price unavailable"
      result.set(v.id, 0);
    }
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
      hourlyRate:   cp.hourlyRate   ? Number(cp.hourlyRate)   : null,
      price12Hour:  cp.price12Hour  ? Number(cp.price12Hour)  : null,
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
        hourlyRate:   bd.hourlyRate   ? Number(bd.hourlyRate)   : null,
        price12Hour:  bd.price12Hour  ? Number(bd.price12Hour)  : null,
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

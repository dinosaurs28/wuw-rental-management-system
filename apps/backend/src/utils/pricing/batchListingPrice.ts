/**
 * TASK-007 / TASK-008: Batch listing price fetch — 2 DB queries for all vehicles.
 *
 * Returns the applicable base price per vehicle for the given duration, matching
 * the same slab selection logic as PricingEngineService.determineBasePrice.
 * Used exclusively by the listing API to avoid per-vehicle pricing engine calls.
 */

import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { splitRentTotal } from "@repo/schemas";
import type { DateTime } from "luxon";
import { HALF_DAY_PACKAGE_HOURS } from "@repo/schemas";
import {
  DurationCalculatorService,
  type RentalDuration,
} from "../../services/pricing/duration-calculator.service.js";
import { clampedHalfDayBranchIds } from "../booking/branchScheduleValidator.js";
import { slabDaysFor } from "../../services/discount/duration-discount.service.js";
import {
  selectBasePrice,
  type BasePriceSelection,
  type BilledAsType,
} from "../../services/pricing/base-price-rule.js";

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
 * Configured rents are GST-inclusive totals (item 17): the 12 h / 24 h rent is
 * totalRent* (what the BM form edits), else price* (the same total).
 */
type RentRow = {
  totalRent12Hour?: { toNumber?: () => number } | null;
  totalRent24Hour?: { toNumber?: () => number } | null;
  price12Hour: { toNumber?: () => number } | null;
  price24Hour: { toNumber?: () => number } | number;
};
const rent12Hour = (row: RentRow): number | null =>
  toPositiveOrNull(row.totalRent12Hour) ?? toPositiveOrNull(row.price12Hour);
const rent24Hour = (row: RentRow): number =>
  toPositiveOrNull(row.totalRent24Hour) ?? Number(row.price24Hour);

/** The GST inside a GST-inclusive listing price, by the branch rule (absent without one). */
async function branchRentSplitter(
  branchIds: number[],
): Promise<(branchId: number, price: number) => { rentWithoutGst: number; gst: number; cgst: number; sgst: number } | null> {
  const rules = branchIds.length
    ? await prisma.gSTRule.findMany({
        where: { branchId: { in: branchIds } },
        select: { branchId: true, cgstRate: true, sgstRate: true },
      })
    : [];
  const byBranch = new Map(
    rules.map((r) => [r.branchId, { cgstRate: Number(r.cgstRate), sgstRate: Number(r.sgstRate) }]),
  );
  return (branchId, price) => {
    const rates = byBranch.get(branchId);
    if (!rates || price <= 0) return null;
    const s = splitRentTotal(price, rates);
    return { rentWithoutGst: s.taxable, gst: s.gst, cgst: s.cgst, sgst: s.sgst };
  };
}

/**
 * Same slab rule as PricingEngineService.determineBasePrice (shared
 * base-price-rule.ts): an hourly rate is capped at the 12 h / 24 h slab price,
 * so listing and booking prices always agree. Free km are not needed here.
 */
function selectPrice(pricing: PricingRow, duration: RentalDuration): BasePriceSelection {
  const toDecimal = (n: number | null) => (n != null && n > 0 ? new Decimal(n) : null);
  return selectBasePrice(
    {
      hourlyRate: toDecimal(pricing.hourlyRate),
      price12Hour: toDecimal(pricing.price12Hour),
      price24Hour: new Decimal(pricing.price24Hour),
      priceMonthly: toDecimal(pricing.priceMonthly),
      freeKm12Hour: 0,
      freeKm24Hour: 0,
      freeKmMonthly: 0,
    },
    duration,
  );
}

export interface ListingPrice {
  price: number;      // GST-inclusive rent before discount (the price, e.g. 1300)
  finalPrice: number; // GST-inclusive rent after the duration discount
  /**
   * The GST inside finalPrice by the branch rule (item 17): rentWithoutGst + gst
   * = finalPrice, gst = cgst + sgst. Absent when the branch has no GST rule.
   */
  rentWithoutGst?: number;
  gst?: number;
  cgst?: number;
  sgst?: number;
  /** What the price covers, e.g. "5 hours", "12 hours", "1 day" (absent when unpriced). */
  billedAs?: string;
  billedAsType?: BilledAsType;
  /** Duration-slab discount included in finalPrice (absent when none applies). */
  discountAmount?: number;
  discountPercent?: number;
  /** The slab's manager-set label, e.g. "Weekly" (null when the slab has none). */
  discountLabel?: string | null;
}

/**
 * Fetch listing prices for multiple vehicles with duration discounts applied.
 * Uses at most 4 DB queries total (2 for pricing, 2 for discount config/slabs).
 *
 * @param vehicles  Minimal vehicle objects (id, branchId, categoryId already in memory)
 * @param duration  Pre-computed RentalDuration — same for all vehicles in a single search
 * @param window    The searched pickup → return: at a branch where it is the 12-hour
 *                  package held to closing (client item 6) the price is the full 12 hours,
 *                  as the booking engine bills it
 * @returns Map<vehicleId, ListingPrice>
 */
export async function getBatchListingPrices(
  vehicles: VehicleRef[],
  duration: RentalDuration,
  window?: { startAt: DateTime; endAt: DateTime },
): Promise<Map<number, ListingPrice>> {
  if (vehicles.length === 0) return new Map();

  const clampedBranches = window
    ? await clampedHalfDayBranchIds(
        vehicles.map((v) => v.branchId),
        window.startAt.toJSDate(),
        window.endAt.toJSDate(),
      )
    : new Set<number>();
  const halfDayDuration =
    window && clampedBranches.size > 0
      ? DurationCalculatorService.calculate(window.startAt, window.startAt.plus({ hours: HALF_DAY_PACKAGE_HOURS }))
      : null;

  const vehicleIds = vehicles.map((v) => v.id);

  // Query 1: custom pricing (enabled vehicles override branch defaults)
  const customPricings = await prisma.vehicleCustomPricing.findMany({
    where: { vehicleId: { in: vehicleIds }, enabled: true },
    select: {
      vehicleId: true,
      extraHourRate: true,
      price12Hour: true,
      price24Hour: true,
      totalRent12Hour: true,
      totalRent24Hour: true,
      priceMonthly: true,
    },
  });

  const customMap = new Map<number, PricingRow>();
  for (const cp of customPricings) {
    customMap.set(cp.vehicleId, {
      hourlyRate:   toPositiveOrNull(cp.extraHourRate),
      price12Hour:  rent12Hour(cp),
      price24Hour:  rent24Hour(cp),
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
        extraHourRate: true,
        price12Hour: true,
        price24Hour: true,
        totalRent12Hour: true,
        totalRent24Hour: true,
        priceMonthly: true,
      },
    });

    for (const bd of branchDefaults) {
      defaultMap.set(`${bd.branchId}:${bd.categoryId}`, {
        hourlyRate:   toPositiveOrNull(bd.extraHourRate),
        price12Hour:  rent12Hour(bd),
        price24Hour:  rent24Hour(bd),
        priceMonthly: toPositiveOrNull(bd.priceMonthly),
      });
    }
  }

  // Build base price map
  const basePriceMap = new Map<number, number>();
  const billedAsMap = new Map<number, { billedAs: string; billedAsType: BilledAsType }>();
  for (const v of vehicles) {
    const pricing = customMap.get(v.id) ?? defaultMap.get(`${v.branchId}:${v.categoryId}`);
    if (!pricing) {
      basePriceMap.set(v.id, 0);
      continue;
    }
    const selection = selectPrice(
      pricing,
      halfDayDuration && clampedBranches.has(v.branchId) ? halfDayDuration : duration,
    );
    basePriceMap.set(v.id, Number(selection.basePrice.toFixed(2)));
    billedAsMap.set(v.id, { billedAs: selection.billedAs, billedAsType: selection.billedAsType });
  }

  // ── Apply duration discounts (2 extra queries for all branches) ────────────
  const uniqueBranchIds = [...new Set(vehicles.map((v) => v.branchId))];
  // Full 24-hour periods — the same day count the booking engine matches slabs on
  const slabDays = slabDaysFor(duration.actualDuration);

  // Query 3: which branches have duration discounts enabled
  const discountConfigs = await prisma.branchDiscountConfig.findMany({
    where: { branchId: { in: uniqueBranchIds }, durationDiscountEnabled: true },
    select: { branchId: true, maxCombinedDiscountPercent: true },
  });

  const enabledBranchIds = new Set(discountConfigs.map((c) => c.branchId));
  const configByBranch = new Map(discountConfigs.map((c) => [c.branchId, c]));

  // Query 4: best-matching slab per enabled branch for this duration
  const branchSlabMap = new Map<number, { discountType: string; value: number; label: string | null }>();

  if (enabledBranchIds.size > 0 && slabDays >= 1) {
    const slabs = await prisma.durationDiscountSlab.findMany({
      where: {
        branchId: { in: [...enabledBranchIds] },
        minDays: { lte: slabDays },
        OR: [{ maxDays: null }, { maxDays: { gte: slabDays } }],
      },
      orderBy: [{ branchId: "asc" }, { minDays: "desc" }],
      select: { branchId: true, discountType: true, value: true, label: true },
    });

    // First result per branch = highest matching minDays slab
    for (const s of slabs) {
      if (!branchSlabMap.has(s.branchId)) {
        branchSlabMap.set(s.branchId, { discountType: s.discountType, value: Number(s.value), label: s.label });
      }
    }
  }

  // Query 5: branch GST rules — the GST inside each inclusive price
  const gstSplit = await branchRentSplitter(uniqueBranchIds);

  // Build final result with discounts applied
  const result = new Map<number, ListingPrice>();
  for (const v of vehicles) {
    const basePrice = basePriceMap.get(v.id) ?? 0;
    const slab = branchSlabMap.get(v.branchId);

    const billed = billedAsMap.get(v.id);

    if (!slab || basePrice === 0) {
      result.set(v.id, { price: basePrice, finalPrice: basePrice, ...billed, ...gstSplit(v.branchId, basePrice) });
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

    const finalPrice = Math.max(0, Math.round(basePrice - discount));
    result.set(v.id, {
      price: basePrice,
      finalPrice,
      ...billed,
      ...gstSplit(v.branchId, finalPrice),
      ...(discount > 0 && {
        discountAmount: Math.round((basePrice - finalPrice) * 100) / 100,
        discountPercent: Math.round(((basePrice - finalPrice) / basePrice) * 10000) / 100,
        discountLabel: slab.label,
      }),
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
    select: {
      vehicleId: true, extraHourRate: true, price12Hour: true, price24Hour: true,
      totalRent12Hour: true, totalRent24Hour: true,
    },
  });
  const customMap = new Map<number, PricingRow>();
  for (const cp of customPricings) {
    customMap.set(cp.vehicleId, {
      hourlyRate:   toPositiveOrNull(cp.extraHourRate),
      price12Hour:  rent12Hour(cp),
      price24Hour:  rent24Hour(cp),
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
      select: {
        branchId: true, categoryId: true, extraHourRate: true, price12Hour: true, price24Hour: true,
        totalRent12Hour: true, totalRent24Hour: true,
      },
    });
    for (const bd of branchDefaults) {
      defaultMap.set(`${bd.branchId}:${bd.categoryId}`, {
        hourlyRate:   toPositiveOrNull(bd.extraHourRate),
        price12Hour:  rent12Hour(bd),
        price24Hour:  rent24Hour(bd),
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

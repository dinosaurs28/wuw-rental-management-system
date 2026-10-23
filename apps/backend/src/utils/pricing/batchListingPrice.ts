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
import { DateTime } from "luxon";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
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
  type FestivalBreakdown,
  type WeekendBreakdown,
  type WeekendContext,
} from "../../services/pricing/base-price-rule.js";
import { getBranchesWeekendDays } from "../../services/pricing/branch-weekend-days.service.js";
import { getBranchesSpecialRules } from "../../services/pricing/branch-special-rules.service.js";
import { needsVehicleGroup, rulesForVehicle, type SpecialRule } from "./specialDateRule.js";
import { monthlyPortion } from "./monthlyPlan.js";

interface VehicleRef {
  id: number;
  branchId: number;
  categoryId: number;
  /** For per-group festival rules (looked up when a caller doesn't pass them) */
  make?: string;
  model?: string;
}

interface PricingRow {
  hourlyRate: number | null;
  price12Hour: number | null;
  price24Hour: number;
  priceMonthly: number | null;
  /** Weekend rents (GST-inclusive); null = the weekday rent */
  weekendPrice12Hour: number | null;
  weekendPrice24Hour: number | null;
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

/** The optional weekend rents (weekend-wise pricing; null / 0 = the weekday rent). */
type WeekendRentRow = {
  weekendTotalRent12Hour?: { toNumber?: () => number } | null;
  weekendTotalRent24Hour?: { toNumber?: () => number } | null;
};
const weekendRents = (row: WeekendRentRow) => ({
  weekendPrice12Hour: toPositiveOrNull(row.weekendTotalRent12Hour),
  weekendPrice24Hour: toPositiveOrNull(row.weekendTotalRent24Hour),
});

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
 * weekend blocks take the weekend rents and festival blocks (those starting on
 * a rule's dates) their rule's change, so listing and booking prices — and
 * walk-in group resolution's price keys — always agree. Free km are not
 * needed here.
 */
function selectPrice(pricing: PricingRow, duration: RentalDuration, weekend?: WeekendContext): BasePriceSelection {
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
      weekendPrice12Hour: toDecimal(pricing.weekendPrice12Hour),
      weekendPrice24Hour: toDecimal(pricing.weekendPrice24Hour),
    },
    duration,
    weekend,
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
  /** Weekend rates inside price (absent when none applies). */
  weekend?: WeekendBreakdown;
  /** Festival rules inside price (absent when none applies). */
  festival?: FestivalBreakdown;
}

/**
 * Fetch listing prices for multiple vehicles with duration discounts applied.
 * Uses at most 4 DB queries total (2 for pricing, 2 for discount config/slabs).
 *
 * @param vehicles  Minimal vehicle objects (id, branchId, categoryId already in memory)
 * @param duration  Pre-computed RentalDuration — same for all vehicles in a single search
 * @param window    The searched pickup → return: at a branch where it is the 12-hour
 *                  package held to closing (client item 6) the price is the full 12 hours,
 *                  as the booking engine bills it; it also places the blocks on the
 *                  calendar for the branch's weekend rents and festival rules
 * @param options   specialRules: price with these festival rules instead of each
 *                  branch's live ones (the festival-rule preview; [] = none);
 *                  monthlyPlan: a monthly booking (customer Monthly / counter monthly
 *                  plan) — the full months at the monthly price take no duration slab,
 *                  the slab for the remainder's length applies to the remainder only
 *                  (as PricingEngineService with monthlyPlan)
 * @returns Map<vehicleId, ListingPrice>
 */
export async function getBatchListingPrices(
  vehicles: VehicleRef[],
  duration: RentalDuration,
  window?: { startAt: Date; endAt: Date },
  options: { specialRules?: SpecialRule[]; monthlyPlan?: boolean } = {},
): Promise<Map<number, ListingPrice>> {
  if (vehicles.length === 0) return new Map();

  const windowStartRaw = window?.startAt;
  const windowEndRaw = window?.endAt;
  const windowStart = windowStartRaw ? TimezoneService.fromPrisma(windowStartRaw) : null;
  const windowEnd = windowEndRaw ? TimezoneService.fromPrisma(windowEndRaw) : null;

  const clampedBranches = windowStart && windowEnd && windowStartRaw && windowEndRaw
    ? await clampedHalfDayBranchIds(
        vehicles.map((v) => v.branchId),
        windowStartRaw,
        windowEndRaw,
      )
    : new Set<number>();
  const halfDayDuration =
    windowStart && clampedBranches.size > 0
      ? DurationCalculatorService.calculate(windowStart, windowStart.plus({ hours: HALF_DAY_PACKAGE_HOURS }))
      : null;

  const vehicleIds = vehicles.map((v) => v.id);
  const weekendDaysByBranch = window
    ? await getBranchesWeekendDays(vehicles.map((v) => v.branchId))
    : new Map<number, number[]>();
  // Festival rules touching the window, per branch (filtered by each vehicle below)
  const specialRulesByBranch = !window
    ? new Map<number, SpecialRule[]>()
    : options.specialRules
      ? new Map(vehicles.map((v) => [v.branchId, options.specialRules!]))
      : await getBranchesSpecialRules(vehicles.map((v) => v.branchId), window.startAt, window.endAt);
  // Per-group rules match on make / model: one query for the vehicles passed without them
  const missingGroup = needsVehicleGroup([...specialRulesByBranch.values()].flat())
    ? vehicles.filter((v) => v.make == null || v.model == null).map((v) => v.id)
    : [];
  const groupOf = new Map(
    (missingGroup.length
      ? await prisma.vehicle.findMany({ where: { id: { in: missingGroup } }, select: { id: true, make: true, model: true } })
      : []
    ).map((v) => [v.id, v]),
  );

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
      weekendTotalRent12Hour: true,
      weekendTotalRent24Hour: true,
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
      ...weekendRents(cp),
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
        weekendTotalRent12Hour: true,
        weekendTotalRent24Hour: true,
        priceMonthly: true,
      },
    });

    for (const bd of branchDefaults) {
      defaultMap.set(`${bd.branchId}:${bd.categoryId}`, {
        hourlyRate:   toPositiveOrNull(bd.extraHourRate),
        price12Hour:  rent12Hour(bd),
        price24Hour:  rent24Hour(bd),
        priceMonthly: toPositiveOrNull(bd.priceMonthly),
        ...weekendRents(bd),
      });
    }
  }

  // Build base price map
  const basePriceMap = new Map<number, number>();
  // Monthly plan: the undiscounted months part per vehicle (absent = slab on the whole rent)
  const monthPartMap = new Map<number, ReturnType<typeof monthlyPortion>>();
  const billedAsMap = new Map<
    number,
    { billedAs: string; billedAsType: BilledAsType; weekend?: WeekendBreakdown; festival?: FestivalBreakdown }
  >();
  for (const v of vehicles) {
    const pricing = customMap.get(v.id) ?? defaultMap.get(`${v.branchId}:${v.categoryId}`);
    if (!pricing) {
      basePriceMap.set(v.id, 0);
      continue;
    }
    const selection = selectPrice(
      pricing,
      halfDayDuration && clampedBranches.has(v.branchId) ? halfDayDuration : duration,
      window && {
        startAt: window.startAt,
        endAt: window.endAt,
        weekendDays: weekendDaysByBranch.get(v.branchId) ?? [],
        specialRules: rulesForVehicle(specialRulesByBranch.get(v.branchId) ?? [], {
          id: v.id,
          categoryId: v.categoryId,
          make: v.make ?? groupOf.get(v.id)?.make,
          model: v.model ?? groupOf.get(v.id)?.model,
        }),
      },
    );
    basePriceMap.set(v.id, Number(selection.basePrice.toFixed(2)));
    if (options.monthlyPlan) {
      const part = monthlyPortion(pricing.priceMonthly, duration);
      if (part) monthPartMap.set(v.id, part);
    }
    billedAsMap.set(v.id, {
      billedAs: selection.billedAs,
      billedAsType: selection.billedAsType,
      ...(selection.weekend && { weekend: selection.weekend }),
      ...(selection.festival && { festival: selection.festival }),
    });
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
  type Slab = { discountType: string; value: number; label: string | null };
  const slabsFor = async (days: number): Promise<Map<number, Slab>> => {
    const map = new Map<number, Slab>();
    if (enabledBranchIds.size === 0 || days < 1) return map;
    const slabs = await prisma.durationDiscountSlab.findMany({
      where: {
        branchId: { in: [...enabledBranchIds] },
        minDays: { lte: days },
        OR: [{ maxDays: null }, { maxDays: { gte: days } }],
      },
      orderBy: [{ branchId: "asc" }, { minDays: "desc" }],
      select: { branchId: true, discountType: true, value: true, label: true },
    });
    // First result per branch = highest matching minDays slab
    for (const s of slabs) {
      if (!map.has(s.branchId)) {
        map.set(s.branchId, { discountType: s.discountType, value: Number(s.value), label: s.label });
      }
    }
    return map;
  };
  const branchSlabMap = await slabsFor(slabDays);
  // Monthly plan: the remainder after the full months is matched on its own length
  // (every vehicle billed by the month has the same remainder — same window)
  const anyMonthPart = [...monthPartMap.values()][0];
  const remainderSlabMap = anyMonthPart ? await slabsFor(slabDaysFor(anyMonthPart.remainderHours)) : new Map<number, Slab>();

  // Query 5: branch GST rules — the GST inside each inclusive price
  const gstSplit = await branchRentSplitter(uniqueBranchIds);

  // Build final result with discounts applied
  const result = new Map<number, ListingPrice>();
  for (const v of vehicles) {
    const basePrice = basePriceMap.get(v.id) ?? 0;
    const monthPart = monthPartMap.get(v.id);
    const slab = monthPart ? remainderSlabMap.get(v.branchId) : branchSlabMap.get(v.branchId);
    // Monthly plan: the slab only sees the rent after the full months
    const monthAmount = monthPart ? monthPart.amount.toNumber() : 0;
    const discountable = Math.round((basePrice - monthAmount) * 100) / 100;

    const billed = billedAsMap.get(v.id);

    if (!slab || basePrice === 0 || discountable <= 0) {
      result.set(v.id, { price: basePrice, finalPrice: basePrice, ...billed, ...gstSplit(v.branchId, basePrice) });
      continue;
    }

    // Rounded exactly as the booking engine rounds the slab (duration-discount
    // service + combined cap): to the paisa, half-up — so the listed price is
    // the booked price, paise included
    const base = new Decimal(discountable);
    let discount = slab.discountType === "PERCENTAGE"
      ? base.mul(slab.value).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      : Decimal.min(slab.value, base).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    // Respect combined discount cap if set
    const cfg = configByBranch.get(v.branchId);
    if (cfg?.maxCombinedDiscountPercent != null) {
      const maxDiscount = base
        .mul(Number(cfg.maxCombinedDiscountPercent))
        .div(100)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      discount = Decimal.min(discount, maxDiscount);
    }

    const finalPrice = Decimal.max(0, base.sub(discount)).add(monthAmount).toNumber();
    result.set(v.id, {
      price: basePrice,
      finalPrice,
      ...billed,
      ...gstSplit(v.branchId, finalPrice),
      ...(discount.gt(0) && {
        discountAmount: Math.round((basePrice - finalPrice) * 100) / 100,
        discountPercent: Math.round(((basePrice - finalPrice) / basePrice) * 10000) / 100,
        discountLabel: slab.label,
      }),
    });
  }

  return result;
}

/** Listing prices without dates: the weekday rates (+ the weekend 24-hour rent when it differs). */
export interface FallbackPrice {
  daily: number;
  hourly: number;
  halfDay: number;
  /** Weekend 24-hour rent — only when set and different from `daily` */
  weekendDaily?: number;
}

/**
 * Fallback: fetch base 24-hour prices for vehicles when no date range is selected.
 * Used for the listing page "browse without dates" mode.
 */
export async function getBatchFallbackPrices(
  vehicles: VehicleRef[],
): Promise<Map<number, FallbackPrice>> {
  if (vehicles.length === 0) return new Map();

  const vehicleIds = vehicles.map((v) => v.id);

  const customPricings = await prisma.vehicleCustomPricing.findMany({
    where: { vehicleId: { in: vehicleIds }, enabled: true },
    select: {
      vehicleId: true, extraHourRate: true, price12Hour: true, price24Hour: true,
      totalRent12Hour: true, totalRent24Hour: true, weekendTotalRent12Hour: true, weekendTotalRent24Hour: true,
    },
  });
  const customMap = new Map<number, PricingRow>();
  for (const cp of customPricings) {
    customMap.set(cp.vehicleId, {
      hourlyRate:   toPositiveOrNull(cp.extraHourRate),
      price12Hour:  rent12Hour(cp),
      price24Hour:  rent24Hour(cp),
      priceMonthly: null,
      ...weekendRents(cp),
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
        totalRent12Hour: true, totalRent24Hour: true, weekendTotalRent12Hour: true, weekendTotalRent24Hour: true,
      },
    });
    for (const bd of branchDefaults) {
      defaultMap.set(`${bd.branchId}:${bd.categoryId}`, {
        hourlyRate:   toPositiveOrNull(bd.extraHourRate),
        price12Hour:  rent12Hour(bd),
        price24Hour:  rent24Hour(bd),
        priceMonthly: null,
        ...weekendRents(bd),
      });
    }
  }

  // A weekend rent is only shown where the branch has weekend days to charge it on
  const anyWeekendRent = [...customMap.values(), ...defaultMap.values()].some((p) => p.weekendPrice24Hour != null);
  const weekendDaysByBranch = anyWeekendRent
    ? await getBranchesWeekendDays(vehicles.map((v) => v.branchId))
    : new Map<number, number[]>();

  const result = new Map<number, FallbackPrice>();
  for (const v of vehicles) {
    const p = customMap.get(v.id) ?? defaultMap.get(`${v.branchId}:${v.categoryId}`);
    const daily = p?.price24Hour ?? 0;
    const weekendDaily = (weekendDaysByBranch.get(v.branchId)?.length ?? 0) > 0 ? p?.weekendPrice24Hour : null;
    result.set(v.id, {
      daily,
      hourly:  p?.hourlyRate  ?? daily / 24,
      halfDay: p?.price12Hour ?? daily / 2,
      ...(weekendDaily != null && weekendDaily !== daily && { weekendDaily }),
    });
  }

  return result;
}

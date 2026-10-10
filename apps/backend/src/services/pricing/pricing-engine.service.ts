import { prisma } from "@repo/database/client";
import type { VehicleCustomPricing } from "@repo/database/client";
import { DateTime } from "luxon";
import Decimal from "decimal.js";
import {
  DurationCalculatorService,
  RentalPeriodType,
  RentalDuration,
} from "./duration-calculator.service.js";
import {
  discountEvaluationEngine,
  type DiscountEvaluationInput,
  type DiscountEvaluationResult,
} from "../discount/discount-evaluation-engine.service.js";
import { redis } from "../../lib/redisconfig.js";
import { selectBasePrice, type BilledAsType } from "./base-price-rule.js";
import {
  vehiclePricingConfigKey,
  branchPricingDefaultsKey,
  depositSettingKey,
} from "../../utils/cache/vehicleCacheKeys.js";
import { getBranchGstRatesCached, splitRentGross } from "../tax/gst.service.js";
import { isClampedHalfDayWindow } from "../../utils/booking/branchScheduleValidator.js";
import { heldBillingEnd } from "../../utils/booking/halfDayPackage.js";
import { HALF_DAY_PACKAGE_HOURS } from "@repo/schemas";

const PRICING_TTL = 300; // 5 minutes

/**
 * Vehicle pricing configuration. Every rent here (hourly, 12 h, 24 h, monthly)
 * is a GST-INCLUSIVE total — what the customer pays (item 17).
 */
export interface VehiclePricing {
  hourlyRate: Decimal | null;
  price12Hour: Decimal | null;
  price24Hour: Decimal;
  priceMonthly: Decimal | null;
  freeKm12Hour: number;
  freeKm24Hour: number;
  freeKmMonthly: number;
  extraKmRate: Decimal;
  extraHourRate: Decimal;
}

/**
 * Optional rates (hourly / 12-hour / monthly): unset and 0 both mean "not
 * offered". A Prisma Decimal(0) — or its "0" string from the Redis cache — is
 * truthy, so without this a ₹0 slab would be billed. Mirrors
 * batchListingPrice's toPositiveOrNull so listing and booking prices agree.
 */
function optionalRate(val: { toString(): string } | null | undefined): Decimal | null {
  if (val == null) return null;
  const rate = new Decimal(val.toString());
  return rate.gt(0) ? rate : null;
}

/**
 * The GST-inclusive 12 h / 24 h rent of a pricing row: totalRent* (the column
 * the BM form edits), else price* (same total; rows priced before totalRent*
 * existed, or a cached row without it).
 */
function inclusiveRent(
  row: { totalRent12Hour?: unknown; totalRent24Hour?: unknown; price12Hour?: unknown; price24Hour?: unknown },
  slab: "12" | "24",
): Decimal | null {
  const total = optionalRate((slab === "12" ? row.totalRent12Hour : row.totalRent24Hour) as any);
  return total ?? optionalRate((slab === "12" ? row.price12Hour : row.price24Hour) as any);
}

const ZERO_DEC = new Decimal(0);

/**
 * Split `total` across `weights` (rounded to paise, half-up) so the parts add up
 * to `total` exactly: the last non-zero weight takes the rounding remainder.
 */
export function allocateByWeights(total: Decimal, weights: Decimal[]): Decimal[] {
  const sum = weights.reduce((s, w) => s.add(w), ZERO_DEC);
  if (sum.lte(0)) return weights.map(() => ZERO_DEC);
  let lastIndex = -1;
  weights.forEach((w, i) => { if (w.gt(0)) lastIndex = i; });
  let remaining = total;
  return weights.map((w, i) => {
    if (!w.gt(0)) return ZERO_DEC;
    if (i === lastIndex) return remaining;
    const part = total.mul(w).div(sum).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    remaining = remaining.sub(part);
    return part;
  });
}

/**
 * Pricing calculation result — expanded with discount breakdown layers.
 *
 * Rents are GST-inclusive (item 17). The engine takes every discount off the
 * inclusive rent (`gross`), splits GST out of the rent after discounts, and
 * reports the booking in TAXABLE terms in the classic fields, so the stored
 * invariants hold: basePrice − discountAmount + taxAmount = finalTotal.
 *   basePrice      = rent without GST of the rent before discounts
 *   discountAmount = basePrice − rent without GST after discounts
 *                    (the duration / coupon / manual layers are its shares)
 *   taxAmount      = GST of the rent after discounts (CGST + SGST)
 *   finalTotal     = rent incl. GST after discounts (= gross.total)
 */
export interface PricingResult {
  // Base pricing (before any discount) — rent without GST
  basePrice: Decimal;

  // Layer 1 — duration discount
  durationDiscountAmount: Decimal;
  durationDiscountPercent: Decimal;
  durationSlabId: number | null;
  durationDiscountLabel: string | null;
  durationDiscountType: "PERCENTAGE" | "FLAT" | null;
  durationDiscountValue: Decimal;
  /** A duration slab matched but the coupon gave the bigger saving (no stacking). */
  durationSuppressed: boolean;

  // Layer 2 — coupon discount
  couponDiscountAmount: Decimal;
  couponDiscountPercent: Decimal;
  appliedCouponCode?: string;
  couponRuleId?: number;

  // Layer 3 — manual discount
  manualDiscountAmount: Decimal;

  // Combined discount totals (kept for backward compat with booking fields)
  discountAmount: Decimal;
  discountPercent: Decimal;

  // Deposits & fees
  deposit: Decimal;

  // Tax breakdown (always on post-discount base)
  taxAmount: Decimal;
  cgstAmount: Decimal;
  sgstAmount: Decimal;
  taxRate: Decimal;
  cgstRate: Decimal;
  sgstRate: Decimal;

  // Final amounts
  finalTotal: Decimal;

  /**
   * The same price GST-inclusive — what the customer sees. Discounts are taken
   * off these amounts (a flat ₹100 coupon is grossCouponDiscount ₹100).
   */
  gross: {
    /** Rent incl. GST before discounts — the configured price (e.g. ₹1,300) */
    price: Decimal;
    durationDiscount: Decimal;
    couponDiscount: Decimal;
    manualDiscount: Decimal;
    /** durationDiscount + couponDiscount + manualDiscount */
    discount: Decimal;
    /** Rent incl. GST after discounts (= finalTotal) */
    total: Decimal;
  };
  /** Rent without GST after discounts (= basePrice − discountAmount); + taxAmount = gross.total */
  rentWithoutGst: Decimal;

  // Distance limits
  freeKmLimit: number;
  extraKmRate: Decimal;

  // Full evaluation result (for DiscountApplication recording) — on the
  // GST-inclusive rent: originalAmount = gross.price, finalAmount = gross.total
  discountEvaluation: DiscountEvaluationResult;

  // Breakdown details
  pricingBreakdown: {
    periodType: RentalPeriodType;
    duration: RentalDuration;
    applicablePrice: Decimal;
    priceSource: "vehicle_custom" | "branch_default" | "fallback";
    /** What the price actually covers, e.g. "5 hours", "12 hours", "1 day", "2 days + 12 hours". */
    billedAs: string;
    billedAsType: BilledAsType;
  };
}

/** Coupon-evaluation context for calculateBookingPrice (all optional). */
export interface PricingDiscountOptions {
  /** Plan the coupon's applicablePaymentPlans / allowPartialPayment are checked against. */
  paymentPlan?: "FULL" | "ADVANCE";
  /** Booking being re-priced — its own CouponUsageLog row isn't counted against it. */
  excludeBookingId?: number;
  /** couponCode is the booking's own applied coupon: skip validity-window and usage-limit checks. */
  couponLockedIn?: boolean;
  /**
   * Don't check the coupon's payment-plan rules here (paymentPlan is ignored for
   * them): the plan charged depends on the post-coupon total, so the caller runs
   * couponValidationService.checkPaymentPlan against it afterwards.
   */
  deferPaymentPlanCheck?: boolean;
  /**
   * The 12-hour package held to closing (client item 6). true = an EXISTING
   * booking created as one (heldToClosingOf(pricingSnapshot)): billed as at
   * least pickup + 12 h, whatever its window is now (rescheduled, branch hours
   * changed, a short staff extension). false = an existing booking created as
   * anything else: billed by its clock length, never re-detected. Omitted = a
   * NEW quote / booking: recognised from the window and the branch's hours.
   */
  heldToClosing?: boolean;
}

/**
 * Whether a booking was created as the 12-hour package held to closing — the
 * flag booking create / walk-in create store in pricingSnapshot. Every path
 * that re-prices an existing booking passes this as `heldToClosing`.
 */
export { heldToClosingOf } from "../../utils/booking/halfDayPackage.js";

/**
 * Rent GST result: the GST-inclusive rent before / after discounts split into
 * rent without GST + CGST + SGST (splitRentGross, the client's method).
 */
interface RentTaxResult {
  /** Rent without GST of the rent before discounts */
  taxableBefore: Decimal;
  /** Rent without GST of the rent after discounts */
  taxableAfter: Decimal;
  totalTax: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  rate: Decimal;
  cgstRate: Decimal;
  sgstRate: Decimal;
}

/**
 * Service for calculating booking prices.
 * Calculation order: GST-inclusive rent → Duration Discount → Coupon/Manual
 * Discount (all on the inclusive rent) → split GST out of the rent after discounts
 */
export class PricingEngineService {
  /**
   * Calculate complete booking price with optional coupon discount.
   *
   * @param vehicleId            - ID of the vehicle
   * @param startAt              - Rental start datetime (IST)
   * @param endAt                - Rental end datetime (IST)
   * @param branchId             - Branch ID
   * @param customerId           - Customer ID (required for coupon eligibility checks)
   * @param couponCode           - Optional coupon code to evaluate
   * @param manualDiscountAmount - Optional manager override amount
   * @param manualDiscountId     - FK to ManualDiscount record
   * @param categoryId           - Optional: vehicle categoryId already in memory (skips DB lookup)
   * @param vehicleCustomPricing - Optional: already-fetched VehicleCustomPricing (skips DB/cache)
   * @param discountOptions      - Optional: payment plan the coupon is checked against
   *                               (default FULL), the booking being re-priced (its own
   *                               coupon use is not counted) and coupon lock-in
   */
  async calculateBookingPrice(
    vehicleId: number,
    startAt: DateTime,
    endAt: DateTime,
    branchId: number,
    customerId?: number,
    couponCode?: string,
    manualDiscountAmount?: Decimal,
    manualDiscountId?: number,
    categoryId?: number,
    vehicleCustomPricing?: VehicleCustomPricing | null,
    discountOptions?: PricingDiscountOptions,
  ): Promise<PricingResult> {
    console.time(`[perf] details:pricing:${vehicleId}`);
    try {
      // 1. Calculate rental duration (a 12-hour package held to closing is billed as 12 hours)
      const duration = DurationCalculatorService.calculate(
        startAt,
        await this.billingEndAt(startAt, endAt, branchId, discountOptions?.heldToClosing),
      );

      // 2. Resolve categoryId once — either from caller or a single DB lookup
      const resolvedCategoryId = categoryId ?? await this.getVehicleCategoryId(vehicleId);

      // 3. Parallelize independent fetches: pricing config + deposit (TASK-004)
      const [pricing, deposit] = await Promise.all([
        this.getVehiclePricing(vehicleId, branchId, resolvedCategoryId, vehicleCustomPricing),
        this.getDepositAmount(vehicleId, branchId, resolvedCategoryId),
      ]);

      // 4. Determine base price based on duration
      const { basePrice, freeKmLimit, priceSource, billedAs, billedAsType } =
        await this.determineBasePrice(pricing, duration, vehicleId, branchId);

      // 5. Evaluate all discounts (duration + coupon + manual) in strict order.
      //    Duration discount runs for ALL requests (no customer context needed).
      //    Coupon and manual discounts only run when a real customerId is supplied.
      const ZERO = new Decimal(0);
      const evalInput: DiscountEvaluationInput = {
        branchId,
        customerId: customerId ?? 0, // 0 = anonymous; coupon/manual layers skipped below
        vehicleId,
        baseAmount: basePrice,
        rentalDays: duration.days,
        rentalHours: duration.actualDuration,
        vehicleCategoryId: resolvedCategoryId,
        paymentPlan: discountOptions?.paymentPlan ?? "FULL",
        excludeBookingId: discountOptions?.excludeBookingId,
        couponLockedIn: discountOptions?.couponLockedIn,
        skipPaymentPlanCheck: discountOptions?.deferPaymentPlanCheck,
        // Only pass coupon/manual context when a real customer is known
        couponCode:           customerId != null ? couponCode           : undefined,
        manualDiscountAmount: customerId != null ? manualDiscountAmount : undefined,
        manualDiscountId:     customerId != null ? manualDiscountId     : undefined,
      };
      const discountEvaluation = await discountEvaluationEngine.evaluate(evalInput);

      // basePrice here is the GST-inclusive rent (item 17); every discount layer
      // above was taken off it
      const grossPrice = basePrice;
      const grossAfterDiscount = discountEvaluation.finalAmount;
      const durationDiscountPercent = discountEvaluation.durationDiscount.discountPercent;
      const couponDiscountPercent = discountEvaluation.couponDiscountPercent;
      const [grossDuration, grossCoupon, grossManual] = allocateByWeights(
        grossPrice.sub(grossAfterDiscount),
        [
          discountEvaluation.durationDiscount.discountAmount,
          discountEvaluation.couponDiscountAmount,
          discountEvaluation.manualDiscountAmount,
        ],
      ) as [Decimal, Decimal, Decimal];

      // 6. Split GST out of the rent after discounts (never added on top)
      const taxResult = await this.calculateRentTax(grossPrice, grossAfterDiscount, branchId);

      // 7. Taxable terms: the discount is what it took off the rent without GST,
      //    shared across the layers in proportion to their inclusive amounts
      const taxableBase = taxResult.taxableBefore;
      const totalDiscountAmount = taxableBase.sub(taxResult.taxableAfter);
      const [durationDiscountAmount, couponDiscountAmount, actualManualDiscount] = allocateByWeights(
        totalDiscountAmount,
        [grossDuration, grossCoupon, grossManual],
      ) as [Decimal, Decimal, Decimal];
      const totalDiscountPercent = taxableBase.gt(0)
        ? totalDiscountAmount.div(taxableBase).mul(100).toDecimalPlaces(4)
        : ZERO;

      // 8. Final total — the rent incl. GST after discounts
      const finalTotal = taxResult.taxableAfter.add(taxResult.totalTax);

      return {
        basePrice: taxableBase,
        durationDiscountAmount,
        durationDiscountPercent,
        durationSlabId: discountEvaluation.durationDiscount.slabId,
        durationDiscountLabel: discountEvaluation.durationDiscount.label,
        durationDiscountType: discountEvaluation.durationDiscount.discountType,
        durationDiscountValue: discountEvaluation.durationDiscount.value,
        durationSuppressed: discountEvaluation.durationSuppressed,
        couponDiscountAmount,
        couponDiscountPercent,
        appliedCouponCode: discountEvaluation.appliedCouponCode,
        couponRuleId: discountEvaluation.couponRule?.id,
        manualDiscountAmount: actualManualDiscount,
        discountAmount: totalDiscountAmount,
        discountPercent: totalDiscountPercent,
        deposit,
        taxAmount: taxResult.totalTax,
        cgstAmount: taxResult.cgst,
        sgstAmount: taxResult.sgst,
        taxRate: taxResult.rate,
        cgstRate: taxResult.cgstRate,
        sgstRate: taxResult.sgstRate,
        finalTotal,
        gross: {
          price: grossPrice,
          durationDiscount: grossDuration,
          couponDiscount: grossCoupon,
          manualDiscount: grossManual,
          discount: grossDuration.add(grossCoupon).add(grossManual),
          total: finalTotal,
        },
        rentWithoutGst: taxResult.taxableAfter,
        freeKmLimit,
        extraKmRate: pricing.extraKmRate,
        discountEvaluation,
        pricingBreakdown: {
          periodType: duration.periodType,
          duration,
          // The GST-inclusive slab price (what a listing shows)
          applicablePrice: grossPrice,
          priceSource: pricing.source as any,
          billedAs,
          billedAsType,
        },
      };
    } finally {
      console.timeEnd(`[perf] details:pricing:${vehicleId}`);
    }
  }

  /**
   * Calculate limited pricing for listing pages.
   * Skips taxes, deposits, and coupon evaluation overhead.
   */
  async calculateListingPrice(
    vehicleId: number,
    startAt: DateTime,
    endAt: DateTime,
    branchId: number,
    categoryId?: number,
  ): Promise<{
    price: Decimal;
    finalPrice: Decimal;
    type: RentalPeriodType;
    billedAs: string;
    billedAsType: BilledAsType;
  }> {
    const duration = DurationCalculatorService.calculate(startAt, await this.billingEndAt(startAt, endAt, branchId));
    const resolvedCategoryId = categoryId ?? await this.getVehicleCategoryId(vehicleId);
    const pricing = await this.getVehiclePricing(vehicleId, branchId, resolvedCategoryId);
    const { basePrice, billedAs, billedAsType } =
      await this.determineBasePrice(pricing, duration, vehicleId, branchId);

    // Apply duration discount only (no coupon on listing)
    const evalInput: DiscountEvaluationInput = {
      branchId,
      customerId: 0, // listing does not have customer context
      vehicleId,
      baseAmount: basePrice,
      rentalDays: duration.days,
      rentalHours: duration.actualDuration,
      vehicleCategoryId: resolvedCategoryId,
      paymentPlan: "FULL",
    };
    const evaluation = await discountEvaluationEngine.evaluate(evalInput);

    return {
      price: basePrice,
      finalPrice: evaluation.finalAmount,
      type: duration.periodType,
      billedAs,
      billedAsType,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * The end the price is worked out to. A 12-hour package held to the branch's
   * closing on the pickup day (client item 6 — e.g. 2 PM → 10:30 PM) is still
   * the 12-hour package: billed as pickup + 12 h (12-hour price and free km),
   * never as the shorter clock time by the hour. `held` (see
   * PricingDiscountOptions.heldToClosing): true → at least pickup + 12 h;
   * false → the window's end; omitted → recognised from the window (new quotes).
   */
  private async billingEndAt(startAt: DateTime, endAt: DateTime, branchId: number, held?: boolean): Promise<DateTime> {
    if (held === true) {
      return DateTime.fromJSDate(heldBillingEnd(startAt.toJSDate(), endAt.toJSDate()), { zone: startAt.zone });
    }
    if (held === false) return endAt;
    const clamped = await isClampedHalfDayWindow(branchId, startAt.toJSDate(), endAt.toJSDate());
    return clamped ? startAt.plus({ hours: HALF_DAY_PACKAGE_HOURS }) : endAt;
  }

  private async getVehicleCategoryId(vehicleId: number): Promise<number> {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { categoryId: true },
    });
    if (!vehicle) throw new Error("Vehicle not found");
    return vehicle.categoryId;
  }

  /**
   * TASK-007: Fetch vehicle pricing with Redis caching.
   * Cache order: provided value → Redis (vehiclePricingConfigKey) → DB
   */
  private async getVehiclePricing(
    vehicleId: number,
    branchId: number,
    categoryId?: number,
    providedCustomPricing?: VehicleCustomPricing | null,
  ): Promise<VehiclePricing & { source: "vehicle_custom" | "branch_default" }> {
    let customPricing: any;

    if (providedCustomPricing !== undefined) {
      // TASK-016: caller already fetched this — skip cache + DB entirely
      customPricing = providedCustomPricing;
    } else {
      const configCacheKey = vehiclePricingConfigKey(vehicleId);
      try {
        const cached = await redis.get(configCacheKey);
        if (cached !== null) {
          console.log(`[pricing-cache] hit: ${configCacheKey}`);
          customPricing = JSON.parse(cached); // null or object
        } else {
          console.warn(`[pricing-cache] miss: ${configCacheKey}`);
          customPricing = await prisma.vehicleCustomPricing.findUnique({ where: { vehicleId } });
          await redis.set(configCacheKey, JSON.stringify(customPricing), "EX", PRICING_TTL);
        }
      } catch (err) {
        console.warn("[pricing-cache] Redis error, falling back to DB:", err);
        customPricing = await prisma.vehicleCustomPricing.findUnique({ where: { vehicleId } });
      }
    }

    if (customPricing && customPricing.enabled) {
      return {
        // One hourly rate per vehicle: the Extra Hour Rate prices the hours
        // beyond full days / the 12 h slab (bookings + extensions) and late returns.
        hourlyRate: optionalRate(customPricing.extraHourRate),
        price12Hour: inclusiveRent(customPricing, "12"),
        price24Hour: inclusiveRent(customPricing, "24") ?? new Decimal(customPricing.price24Hour.toString()),
        priceMonthly: optionalRate(customPricing.priceMonthly),
        freeKm12Hour: customPricing.freeKm12Hour,
        freeKm24Hour: customPricing.freeKm24Hour,
        freeKmMonthly: customPricing.freeKmMonthly,
        extraKmRate: new Decimal(customPricing.extraKmRate.toString()),
        extraHourRate: new Decimal(customPricing.extraHourRate.toString()),
        source: "vehicle_custom",
      };
    }

    // Resolve categoryId for branch-defaults path (TASK-002)
    const resolvedCategoryId = categoryId ?? await this.getVehicleCategoryId(vehicleId);

    // TASK-007: Cache branch pricing defaults
    const defaultsCacheKey = branchPricingDefaultsKey(branchId, resolvedCategoryId);
    let branchDefaults: any;
    try {
      const cached = await redis.get(defaultsCacheKey);
      if (cached !== null) {
        console.log(`[pricing-cache] hit: ${defaultsCacheKey}`);
        branchDefaults = JSON.parse(cached);
      } else {
        console.warn(`[pricing-cache] miss: ${defaultsCacheKey}`);
        branchDefaults = await prisma.branchPricingDefaults.findUnique({
          where: { branchId_categoryId: { branchId, categoryId: resolvedCategoryId } },
        });
        await redis.set(defaultsCacheKey, JSON.stringify(branchDefaults), "EX", PRICING_TTL);
      }
    } catch (err) {
      console.warn("[pricing-cache] Redis error, falling back to DB:", err);
      branchDefaults = await prisma.branchPricingDefaults.findUnique({
        where: { branchId_categoryId: { branchId, categoryId: resolvedCategoryId } },
      });
    }

    if (!branchDefaults) {
      throw new Error(`No pricing configured for this vehicle category at branch ${branchId}`);
    }

    return {
      hourlyRate: optionalRate(branchDefaults.extraHourRate),
      price12Hour: inclusiveRent(branchDefaults, "12"),
      price24Hour: inclusiveRent(branchDefaults, "24") ?? new Decimal(branchDefaults.price24Hour.toString()),
      priceMonthly: optionalRate(branchDefaults.priceMonthly),
      freeKm12Hour: branchDefaults.freeKm12Hour,
      freeKm24Hour: branchDefaults.freeKm24Hour,
      freeKmMonthly: branchDefaults.freeKmMonthly,
      extraKmRate: new Decimal(branchDefaults.extraKmRate.toString()),
      extraHourRate: new Decimal(branchDefaults.extraHourRate.toString()),
      source: "branch_default",
    };
  }

  private async determineBasePrice(
    pricing: VehiclePricing & { source: string },
    duration: RentalDuration,
    vehicleId: number,
    branchId: number,
  ): Promise<{
    basePrice: Decimal;
    freeKmLimit: number;
    priceSource: string;
    billedAs: string;
    billedAsType: BilledAsType;
  }> {
    /**
     * Slab billing, with an hourly rate (when configured) capped at the slab
     * price per block of up to 24 h — see base-price-rule.ts. The listing batch
     * pricer runs the same rule, so listed and booked prices always agree.
     *
     * Example: 5 hours, hourly ₹150, 12-hour ₹900 → 5 × 150 = ₹750 ("5 hours")
     * Example: 8 hours, hourly ₹150, 12-hour ₹900 → ₹900 ("12 hours")
     * Example: 29 hours, no hourly rate → 1 day + 12-hour slab ("1 day + 12 hours")
     */
    const selection = selectBasePrice(pricing, duration);
    return {
      basePrice: selection.basePrice,
      freeKmLimit: selection.freeKmLimit,
      priceSource: pricing.source,
      billedAs: selection.billedAs,
      billedAsType: selection.billedAsType,
    };
  }

  /**
   * TASK-003 + TASK-009: Get deposit amount with Redis caching.
   * categoryId threaded through to skip redundant vehicle.findUnique calls.
   */
  private async getDepositAmount(vehicleId: number, branchId: number, categoryId?: number): Promise<Decimal> {
    const resolvedCategoryId = categoryId ?? await this.getVehicleCategoryId(vehicleId);

    const cacheKey = depositSettingKey(branchId, resolvedCategoryId);
    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) {
        console.log(`[pricing-cache] hit: ${cacheKey}`);
        return new Decimal(cached);
      }
      console.warn(`[pricing-cache] miss: ${cacheKey}`);
    } catch (err) {
      console.warn("[pricing-cache] Redis error, falling back to DB:", err);
    }

    const depositSetting = await prisma.categoryDepositSetting.findUnique({
      where: { branchId_categoryId: { branchId, categoryId: resolvedCategoryId } },
    });
    const amount = depositSetting ? new Decimal(depositSetting.amount.toString()) : new Decimal(0);

    try {
      await redis.set(cacheKey, amount.toString(), "EX", PRICING_TTL);
    } catch (err) {
      console.warn("[pricing-cache] Redis set error (non-fatal):", err);
    }

    return amount;
  }

  /**
   * GST of the GST-inclusive rent (item 17) through the canonical gst.service
   * rule (splitRentGross: CGST and SGST each rounded half-up to 2 dp, GST =
   * CGST + SGST, never IGST): the rent after discounts is split into rent
   * without GST + GST, and the rent before discounts gives the taxable base.
   * The branch rule is read through the shared Redis cache; a branch without a
   * GSTRule fails with GST_RULE_MISSING (no silent fallback rate).
   */
  private async calculateRentTax(
    grossPrice: Decimal,
    grossAfterDiscount: Decimal,
    branchId: number,
  ): Promise<RentTaxResult> {
    const rates = await getBranchGstRatesCached(branchId);
    const before = splitRentGross(grossPrice, rates);
    const after = splitRentGross(grossAfterDiscount, rates);
    return {
      taxableBefore: before.taxable,
      taxableAfter: after.taxable,
      totalTax: after.gst,
      cgst: after.cgst,
      sgst: after.sgst,
      rate: new Decimal(rates.rate),
      cgstRate: new Decimal(rates.cgstRate),
      sgstRate: new Decimal(rates.sgstRate),
    };
  }

  calculateExtraKmCharges(kmDriven: number, freeKmLimit: number, extraKmRate: Decimal): Decimal {
    return extraKmRate.mul(Math.max(0, kmDriven - freeKmLimit));
  }

  calculateExtraHourCharges(extraHours: number, hourlyRate: Decimal): Decimal {
    return hourlyRate.mul(extraHours);
  }
}

type DecLike = { toString(): string };

/**
 * The GST-inclusive rent fields every pricing response carries (numbers, 2 dp),
 * next to the classic taxable-terms fields (basePrice / discountAmount /
 * taxAmount / finalTotal):
 *   rentInclGst              rent incl. GST before discounts — the price (₹1,300)
 *   durationDiscountInclGst, couponDiscountInclGst, manualDiscountInclGst
 *   discountInclGst          all discounts, off the inclusive rent
 *   rentAfterDiscountInclGst rent incl. GST after discounts (= finalTotal)
 *   rentWithoutGst           rent without GST after discounts
 *   gst / cgst / sgst        the GST inside rentAfterDiscountInclGst
 * rentWithoutGst + gst = rentAfterDiscountInclGst = rentInclGst − discountInclGst.
 * Accepts a PricingResult or its JSON (Redis-cached details pricing); a cached
 * result from before these fields existed yields {} (absent for ≤ 60 s).
 */
export function rentInclGstFields(pr: {
  gross?: {
    price: DecLike;
    durationDiscount: DecLike;
    couponDiscount: DecLike;
    manualDiscount: DecLike;
    discount: DecLike;
    total: DecLike;
  } | null;
  rentWithoutGst?: DecLike | null;
  taxAmount: DecLike;
  cgstAmount: DecLike;
  sgstAmount: DecLike;
}) {
  if (!pr.gross || pr.rentWithoutGst == null) return {};
  const n = (d: DecLike) => Number(new Decimal(d.toString()).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
  return {
    rentInclGst: n(pr.gross.price),
    durationDiscountInclGst: n(pr.gross.durationDiscount),
    couponDiscountInclGst: n(pr.gross.couponDiscount),
    manualDiscountInclGst: n(pr.gross.manualDiscount),
    discountInclGst: n(pr.gross.discount),
    rentAfterDiscountInclGst: n(pr.gross.total),
    rentWithoutGst: n(pr.rentWithoutGst),
    gst: n(pr.taxAmount),
    cgst: n(pr.cgstAmount),
    sgst: n(pr.sgstAmount),
  };
}

/**
 * Running GST-inclusive totals over the vehicles of one booking (booking
 * summary, walk-in create, BM reprice). view() gives the pricingSnapshot.totals
 * / response fields (numbers, 2 dp):
 *   grandRentInclGst                 Σ rent incl. GST before discounts
 *   grandDurationDiscountInclGst, grandCouponDiscountInclGst, grandManualDiscountInclGst
 *   grandDiscountInclGst             Σ discounts off the inclusive rent
 *   grandRentAfterDiscountInclGst    Σ rent incl. GST after discounts
 *   grandRentWithoutGst              Σ rent without GST after discounts
 * grandRentAfterDiscountInclGst = grandRentInclGst − grandDiscountInclGst
 *                               = grandRentWithoutGst + grandTaxTotal.
 */
export class InclGstTotals {
  private rent = ZERO_DEC;
  private duration = ZERO_DEC;
  private coupon = ZERO_DEC;
  private manual = ZERO_DEC;
  private total = ZERO_DEC;
  private withoutGst = ZERO_DEC;

  add(pr: Pick<PricingResult, "gross" | "rentWithoutGst">): void {
    this.rent = this.rent.add(pr.gross.price);
    this.duration = this.duration.add(pr.gross.durationDiscount);
    this.coupon = this.coupon.add(pr.gross.couponDiscount);
    this.manual = this.manual.add(pr.gross.manualDiscount);
    this.total = this.total.add(pr.gross.total);
    this.withoutGst = this.withoutGst.add(pr.rentWithoutGst);
  }

  view() {
    const n = (d: Decimal) => Number(d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
    return {
      grandRentInclGst: n(this.rent),
      grandDurationDiscountInclGst: n(this.duration),
      grandCouponDiscountInclGst: n(this.coupon),
      grandManualDiscountInclGst: n(this.manual),
      grandDiscountInclGst: n(this.duration.add(this.coupon).add(this.manual)),
      grandRentAfterDiscountInclGst: n(this.total),
      grandRentWithoutGst: n(this.withoutGst),
    };
  }
}

export default PricingEngineService;

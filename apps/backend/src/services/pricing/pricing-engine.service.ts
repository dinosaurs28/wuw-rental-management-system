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
import {
  vehiclePricingConfigKey,
  branchPricingDefaultsKey,
  gstRuleKey,
  depositSettingKey,
} from "../../utils/cache/vehicleCacheKeys.js";

const PRICING_TTL = 300; // 5 minutes
const GST_TTL = 600;     // 10 minutes

/**
 * Vehicle pricing configuration
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
 * Pricing calculation result — expanded with discount breakdown layers.
 */
export interface PricingResult {
  // Base pricing (before any discount)
  basePrice: Decimal;

  // Layer 1 — duration discount
  durationDiscountAmount: Decimal;
  durationDiscountPercent: Decimal;

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

  // Final amounts
  finalTotal: Decimal;

  // Distance limits
  freeKmLimit: number;
  extraKmRate: Decimal;

  // Full evaluation result (for DiscountApplication recording)
  discountEvaluation: DiscountEvaluationResult;

  // Breakdown details
  pricingBreakdown: {
    periodType: RentalPeriodType;
    duration: RentalDuration;
    applicablePrice: Decimal;
    priceSource: "vehicle_custom" | "branch_default" | "fallback";
  };
}

/**
 * Tax calculation result
 */
interface TaxResult {
  totalTax: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  rate: Decimal;
}

/**
 * Service for calculating booking prices.
 * Calculation order: Base Amount → Duration Discount → Coupon/Manual Discount → GST
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
  ): Promise<PricingResult> {
    console.time(`[perf] details:pricing:${vehicleId}`);
    try {
      // 1. Calculate rental duration
      const duration = DurationCalculatorService.calculate(startAt, endAt);

      // 2. Resolve categoryId once — either from caller or a single DB lookup
      const resolvedCategoryId = categoryId ?? await this.getVehicleCategoryId(vehicleId);

      // 3. Parallelize independent fetches: pricing config + deposit (TASK-004)
      const [pricing, deposit] = await Promise.all([
        this.getVehiclePricing(vehicleId, branchId, resolvedCategoryId, vehicleCustomPricing),
        this.getDepositAmount(vehicleId, branchId, resolvedCategoryId),
      ]);

      // 4. Determine base price based on duration
      const { basePrice, freeKmLimit, priceSource } =
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
        paymentPlan: "FULL",
        // Only pass coupon/manual context when a real customer is known
        couponCode:           customerId != null ? couponCode           : undefined,
        manualDiscountAmount: customerId != null ? manualDiscountAmount : undefined,
        manualDiscountId:     customerId != null ? manualDiscountId     : undefined,
      };
      const discountEvaluation = await discountEvaluationEngine.evaluate(evalInput);

      const postDiscountBase = discountEvaluation.finalAmount;
      const durationDiscountAmount = discountEvaluation.durationDiscount.discountAmount;
      const durationDiscountPercent = discountEvaluation.durationDiscount.discountPercent;
      const couponDiscountAmount = discountEvaluation.couponDiscountAmount;
      const couponDiscountPercent = discountEvaluation.couponDiscountPercent;
      const actualManualDiscount = discountEvaluation.manualDiscountAmount;
      const totalDiscountAmount = discountEvaluation.totalDiscountAmount;
      const totalDiscountPercent = basePrice.gt(0)
        ? totalDiscountAmount.div(basePrice).mul(100).toDecimalPlaces(4)
        : ZERO;

      // 6. Calculate GST on post-discount amount (never on original base)
      const taxResult = await this.calculateTax(postDiscountBase, branchId);

      // 7. Final total
      const finalTotal = postDiscountBase.add(taxResult.totalTax);

      return {
        basePrice,
        durationDiscountAmount,
        durationDiscountPercent,
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
        finalTotal,
        freeKmLimit,
        extraKmRate: pricing.extraKmRate,
        discountEvaluation,
        pricingBreakdown: {
          periodType: duration.periodType,
          duration,
          applicablePrice: basePrice,
          priceSource: pricing.source as any,
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
  ): Promise<{ price: Decimal; finalPrice: Decimal; type: RentalPeriodType }> {
    const duration = DurationCalculatorService.calculate(startAt, endAt);
    const resolvedCategoryId = categoryId ?? await this.getVehicleCategoryId(vehicleId);
    const pricing = await this.getVehiclePricing(vehicleId, branchId, resolvedCategoryId);
    const { basePrice } = await this.determineBasePrice(pricing, duration, vehicleId, branchId);

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
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

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
        hourlyRate: customPricing.hourlyRate ? new Decimal(customPricing.hourlyRate.toString()) : null,
        price12Hour: customPricing.price12Hour ? new Decimal(customPricing.price12Hour.toString()) : null,
        price24Hour: new Decimal(customPricing.price24Hour.toString()),
        priceMonthly: customPricing.priceMonthly ? new Decimal(customPricing.priceMonthly.toString()) : null,
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
      hourlyRate: branchDefaults.hourlyRate ? new Decimal(branchDefaults.hourlyRate.toString()) : null,
      price12Hour: branchDefaults.price12Hour ? new Decimal(branchDefaults.price12Hour.toString()) : null,
      price24Hour: new Decimal(branchDefaults.price24Hour.toString()),
      priceMonthly: branchDefaults.priceMonthly ? new Decimal(branchDefaults.priceMonthly.toString()) : null,
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
  ): Promise<{ basePrice: Decimal; freeKmLimit: number; priceSource: string }> {
    let basePrice: Decimal;
    let freeKmLimit: number;

    /**
     * Hourly-first rule:
     * If an hourlyRate is configured and > 0, use granular per-hour billing for
     * ALL durations (including HALF_DAY, FULL_DAY, MULTI_DAY, MONTHLY).
     * This is the intended behaviour when a business wants pure hourly billing.
     *
     * When hourlyRate is 0 or null, fall through to slab-based billing
     * (HALF_DAY / FULL_DAY / MULTI_DAY / MONTHLY), rounding up to the
     * nearest configured slab.
     *
     * Example: 29 hours, hourlyRate = ₹100 → 29 × 100 = ₹2900
     * Example: 29 hours, hourlyRate = null → MULTI_DAY, 2 days × daily = ₹X
     */
    if (pricing.hourlyRate && pricing.hourlyRate.gt(0)) {
      const billableHours = Math.max(1, Math.ceil(duration.actualDuration));
      return {
        basePrice:   pricing.hourlyRate.mul(billableHours),
        freeKmLimit: Math.floor(billableHours * 8),
        priceSource: pricing.source,
      };
    }

    // Hourly not configured — use slab-based billing
    switch (duration.periodType) {
      case RentalPeriodType.HOURLY:
        // No hourlyRate configured — fall back to the 12-hour slab (cheapest available unit).
        // Per business rule: any rental < 12 hr without a per-hour rate is billed as a half day.
        if (pricing.price12Hour) {
          basePrice = pricing.price12Hour;
          freeKmLimit = pricing.freeKm12Hour;
        } else {
          basePrice = pricing.price24Hour;
          freeKmLimit = pricing.freeKm24Hour;
        }
        break;

      case RentalPeriodType.HALF_DAY:
        if (!pricing.price12Hour) throw new Error("12-hour rental not available for this vehicle");
        basePrice = pricing.price12Hour;
        freeKmLimit = pricing.freeKm12Hour;
        break;

      case RentalPeriodType.FULL_DAY:
        basePrice = pricing.price24Hour;
        freeKmLimit = pricing.freeKm24Hour;
        break;

      case RentalPeriodType.MULTI_DAY: {
        // Split into complete 24hr periods + partial last day.
        // Partial day slab logic (mirrors HALF_DAY / FULL_DAY behaviour):
        //   remaining ≤ 12hrs AND price12Hour configured → half-day rate
        //   remaining > 12hrs OR no price12Hour              → full-day rate
        const fullDays = Math.floor(duration.actualDuration / 24);
        const remainingHours = duration.actualDuration % 24;

        if (remainingHours <= 0) {
          // Exactly N complete days
          basePrice = pricing.price24Hour.mul(fullDays);
          freeKmLimit = pricing.freeKm24Hour * fullDays;
        } else if (remainingHours <= 12 && pricing.price12Hour) {
          // Partial day ≤ 12hrs + 12hr pricing exists → half-day rate for remainder
          basePrice = pricing.price24Hour.mul(fullDays).add(pricing.price12Hour);
          freeKmLimit = pricing.freeKm24Hour * fullDays + pricing.freeKm12Hour;
        } else {
          // Partial day > 12hrs, or no half-day pricing → round up to full day
          basePrice = pricing.price24Hour.mul(fullDays + 1);
          freeKmLimit = pricing.freeKm24Hour * (fullDays + 1);
        }
        break;
      }

      case RentalPeriodType.MONTHLY:
        if (pricing.priceMonthly) {
          const fullMonths    = Math.floor(duration.actualDuration / (30 * 24));
          const afterMonths   = duration.actualDuration % (30 * 24);
          const overflowDays  = Math.floor(afterMonths / 24);
          const leftoverHours = afterMonths % 24;

          basePrice   = pricing.priceMonthly.mul(fullMonths)
                          .add(pricing.price24Hour.mul(overflowDays));
          freeKmLimit = pricing.freeKmMonthly * fullMonths
                          + pricing.freeKm24Hour * overflowDays;

          if (leftoverHours > 0) {
            if (pricing.hourlyRate && pricing.hourlyRate.gt(0)) {
              basePrice   = basePrice.add(pricing.hourlyRate.mul(Math.ceil(leftoverHours)));
              freeKmLimit += pricing.freeKm24Hour;
            } else if (leftoverHours <= 12 && pricing.price12Hour) {
              basePrice   = basePrice.add(pricing.price12Hour);
              freeKmLimit += pricing.freeKm12Hour;
            } else {
              basePrice   = basePrice.add(pricing.price24Hour);
              freeKmLimit += pricing.freeKm24Hour;
            }
          }
        } else {
          const actualDays = Math.ceil(duration.actualDuration / 24);
          basePrice   = pricing.price24Hour.mul(actualDays);
          freeKmLimit = pricing.freeKm24Hour * actualDays;
        }
        break;

      default:
        throw new Error("Invalid rental period type");
    }

    return { basePrice, freeKmLimit, priceSource: pricing.source };
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
   * TASK-008: Calculate GST with Redis caching for the GST rule.
   */
  private async calculateTax(amount: Decimal, branchId: number): Promise<TaxResult> {
    const cacheKey = gstRuleKey(branchId);
    let gstRule: any;

    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) {
        console.log(`[pricing-cache] hit: ${cacheKey}`);
        gstRule = JSON.parse(cached);
      } else {
        console.warn(`[pricing-cache] miss: ${cacheKey}`);
        gstRule = await prisma.gSTRule.findUnique({ where: { branchId } });
        await redis.set(cacheKey, JSON.stringify(gstRule), "EX", GST_TTL);
      }
    } catch (err) {
      console.warn("[pricing-cache] Redis error, falling back to DB:", err);
      gstRule = await prisma.gSTRule.findUnique({ where: { branchId } });
    }

    if (!gstRule) throw new Error("GST rules not configured for this branch");

    const cgstRate = new Decimal(gstRule.cgstRate.toString());
    const sgstRate = new Decimal(gstRule.sgstRate.toString());
    const cgst = amount.mul(cgstRate).div(100);
    const sgst = amount.mul(sgstRate).div(100);

    return { totalTax: cgst.add(sgst), cgst, sgst, rate: cgstRate.add(sgstRate) };
  }

  calculateExtraKmCharges(kmDriven: number, freeKmLimit: number, extraKmRate: Decimal): Decimal {
    return extraKmRate.mul(Math.max(0, kmDriven - freeKmLimit));
  }

  calculateExtraHourCharges(extraHours: number, hourlyRate: Decimal): Decimal {
    return hourlyRate.mul(extraHours);
  }
}

export default PricingEngineService;

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
import { getBranchGstRatesCached, computeLineGst } from "../tax/gst.service.js";

const PRICING_TTL = 300; // 5 minutes

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
 * Pricing calculation result — expanded with discount breakdown layers.
 */
export interface PricingResult {
  // Base pricing (before any discount)
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
}

/**
 * Tax calculation result
 */
interface TaxResult {
  totalTax: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  rate: Decimal;
  cgstRate: Decimal;
  sgstRate: Decimal;
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
        freeKmLimit,
        extraKmRate: pricing.extraKmRate,
        discountEvaluation,
        pricingBreakdown: {
          periodType: duration.periodType,
          duration,
          applicablePrice: basePrice,
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
    const duration = DurationCalculatorService.calculate(startAt, endAt);
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
        hourlyRate: optionalRate(customPricing.hourlyRate),
        price12Hour: optionalRate(customPricing.price12Hour),
        price24Hour: new Decimal(customPricing.price24Hour.toString()),
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
      hourlyRate: optionalRate(branchDefaults.hourlyRate),
      price12Hour: optionalRate(branchDefaults.price12Hour),
      price24Hour: new Decimal(branchDefaults.price24Hour.toString()),
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
   * GST on the post-discount base through the canonical gst.service rule:
   * CGST and SGST each rounded half-up to 2 dp, GST = CGST + SGST, never IGST.
   * The branch rule is read through the shared Redis cache; a branch without a
   * GSTRule fails with GST_RULE_MISSING (no silent fallback rate).
   */
  private async calculateTax(amount: Decimal, branchId: number): Promise<TaxResult> {
    const rates = await getBranchGstRatesCached(branchId);
    const line = computeLineGst(amount, rates);
    return {
      totalTax: line.gst,
      cgst: line.cgst,
      sgst: line.sgst,
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

export default PricingEngineService;

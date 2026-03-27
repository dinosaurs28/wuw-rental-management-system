import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { durationDiscountService, type DurationDiscountResult } from "./duration-discount.service.js";
import { couponValidationService, type CouponValidationContext } from "./coupon-validation.service.js";
import { discountCalculationService } from "./discount-calculation.service.js";
import type { DiscountRule } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { branchDiscountConfigKey } from "../../utils/cache/vehicleCacheKeys.js";

const DISCOUNT_CONFIG_TTL = 300;

export interface DiscountEvaluationInput {
  branchId: number;
  customerId: number;  // 0 = anonymous (skips coupon/manual layers)
  vehicleId: number;
  baseAmount: Decimal;       // total base before any discount
  rentalDays: number;        // Math.ceil(actualHours/24) — used for coupon day constraints
  rentalHours: number;       // actual duration in hours — used for duration slab matching
  vehicleCategoryId: number;
  paymentPlan: string;       // "FULL" | "ADVANCE"
  couponCode?: string;
  manualDiscountAmount?: Decimal;  // manager override (already issued ManualDiscount)
  manualDiscountId?: number;
}

export interface DiscountEvaluationResult {
  // Layer 1 — duration
  durationDiscount: DurationDiscountResult;

  // Layer 2 — coupon
  couponValid: boolean;
  couponFailureCode?: string;
  couponFailureReason?: string;
  couponRule?: DiscountRule;
  couponDiscountAmount: Decimal;
  couponDiscountPercent: Decimal;

  // Layer 3 — manual
  manualDiscountAmount: Decimal;
  manualDiscountId?: number;

  // Totals
  originalAmount: Decimal;
  totalDiscountAmount: Decimal;
  finalAmount: Decimal;         // after all discounts, before GST
  appliedCouponCode?: string;
  stackingEnforced: boolean;    // true = duration+coupon stacking was allowed
}

const ZERO = new Decimal(0);

class DiscountEvaluationEngine {
  async evaluate(input: DiscountEvaluationInput): Promise<DiscountEvaluationResult> {
    const {
      branchId, customerId, vehicleId, baseAmount,
      rentalDays, rentalHours, vehicleCategoryId, paymentPlan,
      couponCode, manualDiscountAmount, manualDiscountId,
    } = input;

    // Load branch config for stacking rules (TASK-010: Redis cached)
    const cacheKey = branchDiscountConfigKey(branchId);
    let config: { stackWithCoupon: boolean; maxCombinedDiscountPercent: any; durationDiscountEnabled: boolean } | null = null;
    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) {
        console.log(`[pricing-cache] hit: ${cacheKey}`);
        config = JSON.parse(cached);
      } else {
        console.warn(`[pricing-cache] miss: ${cacheKey}`);
        config = await prisma.branchDiscountConfig.findUnique({
          where: { branchId },
          select: { stackWithCoupon: true, maxCombinedDiscountPercent: true, durationDiscountEnabled: true },
        });
        await redis.set(cacheKey, JSON.stringify(config), "EX", DISCOUNT_CONFIG_TTL);
      }
    } catch (err) {
      console.warn("[pricing-cache] Redis error, falling back to DB:", err);
      config = await prisma.branchDiscountConfig.findUnique({
        where: { branchId },
        select: { stackWithCoupon: true, maxCombinedDiscountPercent: true, durationDiscountEnabled: true },
      });
    }

    // ── Step 1: Duration discount ────────────────────────────────────────────
    const durationDiscount = await durationDiscountService.evaluate(branchId, rentalHours, baseAmount);

    // After duration discount, this is the base for the coupon layer
    let postDurationAmount = durationDiscount.postDiscountAmount;

    // ── Step 2: Coupon discount ──────────────────────────────────────────────
    let couponValid = false;
    let couponFailureCode: string | undefined;
    let couponFailureReason: string | undefined;
    let couponRule: DiscountRule | undefined;
    let couponDiscountAmount = ZERO;
    let couponDiscountPercent = ZERO;
    let appliedCouponCode: string | undefined;
    let stackingEnforced = false;

    if (couponCode) {
      // If duration discount was applied but stacking is not allowed, the coupon
      // is evaluated on the ORIGINAL base (not reduced) — but then we must pick
      // whichever gives the larger saving and block the other.
      const amountForCouponValidation = durationDiscount.applied && config && !config.stackWithCoupon
        ? baseAmount   // evaluate on original base for comparisons
        : postDurationAmount;

      const ctx: CouponValidationContext = {
        branchId, customerId,
        bookingAmount: amountForCouponValidation,
        rentalDays, vehicleCategoryId, paymentPlan,
      };
      const validation = await couponValidationService.validate(couponCode, ctx);

      if (validation.valid && validation.rule) {
        couponRule = validation.rule;
        couponValid = true;
        appliedCouponCode = couponCode.toUpperCase().trim();

        if (durationDiscount.applied && config && !config.stackWithCoupon) {
          // Cannot stack — pick best saving
          const couponCalc = discountCalculationService.calculateCouponDiscount(
            couponRule,
            baseAmount, // against original
          );

          if (couponCalc.discountAmount.gt(durationDiscount.discountAmount)) {
            // Coupon wins — suppress duration discount
            durationDiscount.applied = false;
            durationDiscount.discountAmount = ZERO;
            durationDiscount.discountPercent = ZERO;
            durationDiscount.postDiscountAmount = baseAmount;
            postDurationAmount = baseAmount;
            const recalc = discountCalculationService.calculateCouponDiscount(couponRule, postDurationAmount);
            couponDiscountAmount = recalc.discountAmount;
            couponDiscountPercent = recalc.discountPercent;
            postDurationAmount = recalc.postDiscountAmount;
          } else {
            // Duration discount wins — suppress coupon
            couponValid = false;
            couponRule = undefined;
            appliedCouponCode = undefined;
            couponFailureCode = "COUPON_STACKING_NOT_ALLOWED";
            couponFailureReason = "Duration discount already applies. Stacking is not enabled for this branch.";
          }
          stackingEnforced = true;
        } else {
          // Stacking allowed or no duration discount — apply coupon on postDurationAmount
          const calc = discountCalculationService.calculateCouponDiscount(couponRule, postDurationAmount);
          couponDiscountAmount = calc.discountAmount;
          couponDiscountPercent = calc.discountPercent;
          postDurationAmount = calc.postDiscountAmount;
        }
      } else {
        couponValid = false;
        couponFailureCode = validation.failureCode;
        couponFailureReason = validation.failureReason;
      }
    }

    // ── Step 3: Manual discount ──────────────────────────────────────────────
    let actualManualDiscount = ZERO;
    if (manualDiscountAmount && manualDiscountAmount.gt(0)) {
      actualManualDiscount = discountCalculationService.calculateManualDiscount(
        manualDiscountAmount,
        postDurationAmount,
      );
      postDurationAmount = postDurationAmount.sub(actualManualDiscount);
    }

    // ── Enforce combined discount cap ────────────────────────────────────────
    const totalDiscountAmount = durationDiscount.discountAmount
      .add(couponDiscountAmount)
      .add(actualManualDiscount)
      .toDecimalPlaces(2);

    let finalAmount = baseAmount.sub(totalDiscountAmount);
    if (finalAmount.lt(0)) finalAmount = ZERO;

    // Check combined cap
    if (config?.maxCombinedDiscountPercent != null) {
      const cap = new Decimal(config.maxCombinedDiscountPercent.toString());
      const actualPercent = totalDiscountAmount.div(baseAmount).mul(100);
      if (actualPercent.gt(cap)) {
        // Re-cap the total discount
        const maxDiscount = baseAmount.mul(cap).div(100).toDecimalPlaces(2);
        finalAmount = baseAmount.sub(maxDiscount);
      }
    }

    return {
      durationDiscount,
      couponValid,
      couponFailureCode,
      couponFailureReason,
      couponRule,
      couponDiscountAmount,
      couponDiscountPercent,
      manualDiscountAmount: actualManualDiscount,
      manualDiscountId,
      originalAmount: baseAmount,
      totalDiscountAmount,
      finalAmount,
      appliedCouponCode,
      stackingEnforced,
    };
  }
}

export const discountEvaluationEngine = new DiscountEvaluationEngine();

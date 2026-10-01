import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { durationDiscountService, type DurationDiscountResult } from "./duration-discount.service.js";
import { couponValidationService, normalizeCouponCode, type CouponValidationContext } from "./coupon-validation.service.js";
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
  /** Booking being re-priced — its own coupon use isn't counted against it. */
  excludeBookingId?: number;
  /** The coupon is the booking's own, already-applied coupon (extension re-pricing). */
  couponLockedIn?: boolean;
  /** Skip the coupon's payment-plan rules; the caller checks them against the plan charged. */
  skipPaymentPlanCheck?: boolean;
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
  stackingEnforced: boolean;    // true = stacking was NOT allowed, so only the better of duration/coupon applied
  durationSuppressed: boolean;  // a duration slab matched but lost to the coupon (no stacking)
  combinedCapApplied: boolean;  // maxCombinedDiscountPercent trimmed the layers
}

const ZERO = new Decimal(0);

class DiscountEvaluationEngine {
  async evaluate(input: DiscountEvaluationInput): Promise<DiscountEvaluationResult> {
    const {
      branchId, customerId, vehicleId, baseAmount,
      rentalDays, rentalHours, vehicleCategoryId, paymentPlan,
      couponCode, manualDiscountAmount, manualDiscountId,
      excludeBookingId, couponLockedIn, skipPaymentPlanCheck,
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
    let couponBaseAmount = ZERO;   // the amount the coupon was calculated on
    let appliedCouponCode: string | undefined;
    let stackingEnforced = false;
    let durationSuppressed = false;

    if (couponCode) {
      // Stacking is allowed when the branch allows it OR the coupon itself is
      // marked stackable. Without stacking, the coupon is evaluated on the
      // ORIGINAL base and whichever gives the larger saving wins.
      let allowStack = !config || config.stackWithCoupon;
      if (durationDiscount.applied && !allowStack) {
        const ruleFlags = await prisma.discountRule.findUnique({
          where: { code: normalizeCouponCode(couponCode) },
          select: { stackable: true },
        });
        allowStack = ruleFlags?.stackable === true;
      }
      const mustPickBest = durationDiscount.applied && !allowStack;
      const amountForCouponValidation = mustPickBest
        ? baseAmount   // evaluate on original base for comparisons
        : postDurationAmount;

      const ctx: CouponValidationContext = {
        branchId, customerId,
        bookingAmount: amountForCouponValidation,
        rentalDays, vehicleCategoryId, paymentPlan,
        bookingId: excludeBookingId,
        lockedIn: couponLockedIn,
        skipPaymentPlan: skipPaymentPlanCheck,
      };
      const validation = await couponValidationService.validate(couponCode, ctx);

      if (validation.valid && validation.rule) {
        couponRule = validation.rule;
        couponValid = true;
        appliedCouponCode = normalizeCouponCode(couponCode);

        if (mustPickBest) {
          // Cannot stack — pick best saving
          const couponCalc = discountCalculationService.calculateCouponDiscount(
            couponRule,
            baseAmount, // against original
          );

          if (couponCalc.discountAmount.gt(durationDiscount.discountAmount)) {
            // Coupon wins — suppress duration discount (and forget the slab, so
            // DiscountApplication never points at a slab that wasn't applied)
            durationDiscount.applied = false;
            durationDiscount.slabId = null;
            durationDiscount.discountType = null;
            durationDiscount.value = ZERO;
            durationDiscount.label = null;
            durationDiscount.discountAmount = ZERO;
            durationDiscount.discountPercent = ZERO;
            durationDiscount.postDiscountAmount = baseAmount;
            durationSuppressed = true;
            postDurationAmount = baseAmount;
            couponBaseAmount = postDurationAmount;
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
          couponBaseAmount = postDurationAmount;
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
    // When the layers exceed maxCombinedDiscountPercent of the base, trim them
    // in reverse order — manual first, then coupon, then the duration slab — so
    // the stored layer amounts always add up to exactly (base − final).
    let combinedCapApplied = false;
    if (config?.maxCombinedDiscountPercent != null && baseAmount.gt(0)) {
      const cap = new Decimal(config.maxCombinedDiscountPercent.toString());
      const maxDiscount = baseAmount.mul(cap).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const layersTotal = durationDiscount.discountAmount.add(couponDiscountAmount).add(actualManualDiscount);
      let excess = layersTotal.sub(maxDiscount);
      if (excess.gt(0)) {
        combinedCapApplied = true;
        const trim = (amount: Decimal): Decimal => {
          const cut = Decimal.min(amount, excess);
          excess = excess.sub(cut);
          return amount.sub(cut);
        };
        actualManualDiscount = trim(actualManualDiscount);
        if (couponDiscountAmount.gt(0)) {
          couponDiscountAmount = trim(couponDiscountAmount);
          couponDiscountPercent = couponBaseAmount.gt(0)
            ? couponDiscountAmount.div(couponBaseAmount).mul(100).toDecimalPlaces(4)
            : ZERO;
        }
        if (durationDiscount.discountAmount.gt(0)) {
          durationDiscount.discountAmount = trim(durationDiscount.discountAmount);
          durationDiscount.discountPercent = durationDiscount.discountAmount.div(baseAmount).mul(100).toDecimalPlaces(4);
          durationDiscount.postDiscountAmount = baseAmount.sub(durationDiscount.discountAmount);
        }
      }
    }

    const totalDiscountAmount = durationDiscount.discountAmount
      .add(couponDiscountAmount)
      .add(actualManualDiscount)
      .toDecimalPlaces(2);

    let finalAmount = baseAmount.sub(totalDiscountAmount);
    if (finalAmount.lt(0)) finalAmount = ZERO;

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
      durationSuppressed,
      combinedCapApplied,
    };
  }
}

export const discountEvaluationEngine = new DiscountEvaluationEngine();

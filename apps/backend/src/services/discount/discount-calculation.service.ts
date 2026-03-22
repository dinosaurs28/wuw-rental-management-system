import Decimal from "decimal.js";
import type { DiscountRule } from "@repo/database/client";

export interface CouponDiscountResult {
  discountAmount: Decimal;
  discountPercent: Decimal;
  postDiscountAmount: Decimal;
}

class DiscountCalculationService {
  /**
   * Calculate the coupon discount amount against the post-duration-discount base.
   * Enforces maxDiscountCap when set.
   */
  calculateCouponDiscount(rule: DiscountRule, postDurationAmount: Decimal): CouponDiscountResult {
    const value = new Decimal(rule.value.toString());
    const cap = rule.maxDiscountCap != null ? new Decimal(rule.maxDiscountCap.toString()) : null;

    let rawDiscount: Decimal;

    if (rule.discountType === "PERCENTAGE") {
      rawDiscount = postDurationAmount.mul(value).div(100);
    } else {
      // FLAT
      rawDiscount = value;
    }

    // Apply cap
    let discountAmount = cap ? Decimal.min(rawDiscount, cap) : rawDiscount;
    // Never exceed the full amount
    discountAmount = Decimal.min(discountAmount, postDurationAmount).toDecimalPlaces(2);

    const postDiscountAmount = postDurationAmount.sub(discountAmount);
    const discountPercent =
      postDurationAmount.gt(0)
        ? discountAmount.div(postDurationAmount).mul(100).toDecimalPlaces(4)
        : new Decimal(0);

    return { discountAmount, discountPercent, postDiscountAmount };
  }

  /**
   * Apply a flat manual discount amount, capped at the remaining amount.
   */
  calculateManualDiscount(amount: Decimal, postCouponAmount: Decimal): Decimal {
    return Decimal.min(amount, postCouponAmount).toDecimalPlaces(2);
  }
}

export const discountCalculationService = new DiscountCalculationService();

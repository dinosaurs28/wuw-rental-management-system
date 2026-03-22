import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import type { DiscountRule } from "@repo/database/client";

export interface CouponValidationContext {
  branchId: number;
  customerId: number;
  bookingAmount: Decimal;      // base amount before any discount
  rentalDays: number;
  vehicleCategoryId: number;
  paymentPlan: string;         // "FULL" | "ADVANCE"
  bookingId?: number;          // present when re-validating post-creation
}

export interface ValidationResult {
  valid: boolean;
  rule?: DiscountRule;
  failureCode?: string;
  failureReason?: string;
}

class CouponValidationService {
  async validate(
    code: string,
    ctx: CouponValidationContext,
  ): Promise<ValidationResult> {
    const fail = (failureCode: string, failureReason: string): ValidationResult => ({
      valid: false,
      failureCode,
      failureReason,
    });

    // Layer 1 — rule exists and is active
    const rule = await prisma.discountRule.findUnique({
      where: { code: code.toUpperCase().trim() },
    });
    if (!rule) return fail("COUPON_NOT_FOUND", "Coupon code does not exist.");
    if (!rule.isActive) return fail("COUPON_INACTIVE", "This coupon is no longer active.");

    // Layer 2 — validity period
    const now = DateTime.utc();
    const start = DateTime.fromJSDate(rule.startDate, { zone: "utc" });
    const end = DateTime.fromJSDate(rule.endDate, { zone: "utc" });
    if (now < start) return fail("COUPON_NOT_YET_VALID", "This coupon is not valid yet.");
    if (now > end) return fail("COUPON_EXPIRED", "This coupon has expired.");

    // Layer 3 — branch scope
    if (rule.scope === "BRANCH" && rule.applicableBranchIds.length > 0) {
      if (!rule.applicableBranchIds.includes(ctx.branchId)) {
        return fail("COUPON_BRANCH_SCOPE_MISMATCH", "This coupon is not valid at this branch.");
      }
    }
    if (rule.scope === "USER" && rule.targetCustomerIds.length > 0) {
      if (!rule.targetCustomerIds.includes(ctx.customerId)) {
        return fail("COUPON_USER_SCOPE_MISMATCH", "This coupon is not available for your account.");
      }
    }

    // Layer 4 — customer eligibility
    const bookingCount = await prisma.booking.count({
      where: {
        customerId: ctx.customerId,
        status: { in: ["CONFIRMED", "PICKED_UP", "RETURNED"] },
      },
    });

    if (rule.newCustomersOnly && bookingCount > 0) {
      return fail("COUPON_NEW_CUSTOMERS_ONLY", "This coupon is only available for first-time customers.");
    }
    if (rule.minBookingCount != null && bookingCount < rule.minBookingCount) {
      return fail("COUPON_MIN_BOOKING_COUNT", `You need at least ${rule.minBookingCount} completed bookings to use this coupon.`);
    }
    if (rule.maxBookingCount != null && bookingCount > rule.maxBookingCount) {
      return fail("COUPON_MAX_BOOKING_COUNT", "You are not eligible for this coupon based on your booking history.");
    }

    // Layer 5 — booking constraints
    if (rule.minBookingAmount != null) {
      const min = new Decimal(rule.minBookingAmount.toString());
      if (ctx.bookingAmount.lt(min)) {
        return fail("COUPON_MIN_AMOUNT", `Minimum booking amount of ₹${min.toFixed(2)} required.`);
      }
    }
    if (rule.maxBookingAmount != null) {
      const max = new Decimal(rule.maxBookingAmount.toString());
      if (ctx.bookingAmount.gt(max)) {
        return fail("COUPON_MAX_AMOUNT", `This coupon is only valid for bookings up to ₹${max.toFixed(2)}.`);
      }
    }
    if (rule.applicableVehicleCategoryIds.length > 0) {
      if (!rule.applicableVehicleCategoryIds.includes(ctx.vehicleCategoryId)) {
        return fail("COUPON_VEHICLE_CATEGORY_MISMATCH", "This coupon is not valid for the selected vehicle category.");
      }
    }
    if (rule.minRentalDays != null && ctx.rentalDays < rule.minRentalDays) {
      return fail("COUPON_MIN_DAYS", `Minimum rental of ${rule.minRentalDays} days required.`);
    }
    if (rule.maxRentalDays != null && ctx.rentalDays > rule.maxRentalDays) {
      return fail("COUPON_MAX_DAYS", `This coupon is only valid for rentals up to ${rule.maxRentalDays} days.`);
    }

    // Layer 6 — payment plan compatibility
    if (rule.applicablePaymentPlans.length > 0) {
      const plansUpper = rule.applicablePaymentPlans.map((p) => p.toUpperCase());
      if (!plansUpper.includes(ctx.paymentPlan.toUpperCase()) && !plansUpper.includes("BOTH")) {
        return fail("COUPON_PAYMENT_PLAN_MISMATCH", "This coupon is not valid for the selected payment plan.");
      }
    }

    // Layer 7 — total usage limit
    if (rule.totalUsageLimit != null) {
      const totalUsed = await prisma.couponUsageLog.count({
        where: { discountRuleId: rule.id },
      });
      if (totalUsed >= rule.totalUsageLimit) {
        return fail("COUPON_USAGE_LIMIT_EXCEEDED", "This coupon has reached its usage limit.");
      }
    }

    // Layer 8 — per-user usage limit
    if (rule.perUserLimit != null) {
      const userUsed = await prisma.couponUsageLog.count({
        where: { discountRuleId: rule.id, customerId: ctx.customerId },
      });
      if (userUsed >= rule.perUserLimit) {
        return fail("COUPON_PER_USER_LIMIT_EXCEEDED", "You have already used this coupon the maximum number of times.");
      }
    }

    // Layer 9 — per-branch usage limit
    if (rule.perBranchLimit != null) {
      const branchUsed = await prisma.couponUsageLog.count({
        where: { discountRuleId: rule.id, branchId: ctx.branchId },
      });
      if (branchUsed >= rule.perBranchLimit) {
        return fail("COUPON_BRANCH_LIMIT_EXCEEDED", "This coupon has reached its limit at this branch.");
      }
    }

    // Layer 10 — per-day usage limit
    if (rule.perDayLimit != null) {
      const todayStart = DateTime.utc().startOf("day").toJSDate();
      const todayEnd = DateTime.utc().endOf("day").toJSDate();
      const todayUsed = await prisma.couponUsageLog.count({
        where: {
          discountRuleId: rule.id,
          appliedAt: { gte: todayStart, lte: todayEnd },
        },
      });
      if (todayUsed >= rule.perDayLimit) {
        return fail("COUPON_DAILY_LIMIT_EXCEEDED", "This coupon has reached its daily usage limit.");
      }
    }

    return { valid: true, rule };
  }
}

export const couponValidationService = new CouponValidationService();

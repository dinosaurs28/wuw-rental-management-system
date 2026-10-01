import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import type { DiscountRule } from "@repo/database/client";

const IST = "Asia/Kolkata";

/** Prisma client or interactive-transaction client — both expose the models used here. */
type Db = Pick<typeof prisma, "discountRule" | "booking" | "couponUsageLog" | "$queryRaw">;

/** Canonical form of a coupon code as stored on DiscountRule.code. */
export const normalizeCouponCode = (code: string): string => code.trim().toUpperCase();

export interface CouponValidationContext {
  branchId: number;
  customerId: number;
  bookingAmount: Decimal;      // base amount before any discount
  rentalDays: number;
  vehicleCategoryId: number;
  paymentPlan: string;         // "FULL" | "ADVANCE"
  /**
   * The booking being (re-)priced. Its own CouponUsageLog rows and the booking
   * itself are excluded from every usage/eligibility count, so re-checking a
   * booking that already holds the coupon doesn't count its own use against it.
   */
  bookingId?: number;
  /**
   * The coupon is already locked in on `bookingId` (extension re-pricing). The
   * validity window, active flag and usage limits were satisfied when it was
   * applied and are not re-checked; scope and booking constraints still are.
   */
  lockedIn?: boolean;
  /**
   * Skip Layer 6 (payment-plan rules). Customer booking create and the coupon
   * preview only know the plan that will be charged once the post-coupon total
   * is known (0 < advance < payable), so they run checkPaymentPlan themselves
   * against that plan instead of guessing it from the branch mode.
   */
  skipPaymentPlan?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  rule?: DiscountRule;
  failureCode?: string;
  failureReason?: string;
}

class CouponValidationService {
  /**
   * Row-lock the DiscountRule for the rest of the transaction, so concurrent
   * bookings using the same coupon re-check and record usage one after another
   * (otherwise two HOLDs on a totalUsageLimit=1 coupon could both pass).
   */
  async lockRule(tx: Pick<typeof prisma, "$queryRaw">, ruleId: number): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "DiscountRule" WHERE id = ${ruleId} FOR UPDATE`;
  }

  async validate(
    code: string,
    ctx: CouponValidationContext,
    db: Db = prisma,
  ): Promise<ValidationResult> {
    const fail = (failureCode: string, failureReason: string): ValidationResult => ({
      valid: false,
      failureCode,
      failureReason,
    });

    // The booking being re-checked never counts against itself
    const excludeBookingId = ctx.bookingId;

    // Layer 1 — rule exists and is active
    const rule = await db.discountRule.findUnique({
      where: { code: normalizeCouponCode(code) },
    });
    if (!rule) return fail("COUPON_NOT_FOUND", "Coupon code does not exist.");
    if (!rule.isActive && !ctx.lockedIn) return fail("COUPON_INACTIVE", "This coupon is no longer active.");

    // Layer 2 — validity period (stored as IST calendar-day bounds)
    if (!ctx.lockedIn) {
      const now = DateTime.utc();
      const start = DateTime.fromJSDate(rule.startDate, { zone: "utc" });
      const end = DateTime.fromJSDate(rule.endDate, { zone: "utc" });
      if (now < start) return fail("COUPON_NOT_YET_VALID", "This coupon is not valid yet.");
      if (now > end) return fail("COUPON_EXPIRED", "This coupon has expired.");
    }

    // Layer 3 — branch scope (create/update now require a branch for BRANCH and a
    // customer for USER; legacy rows with an empty list keep applying everywhere)
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

    // Layer 3.5 — per-customer restriction (BRANCH coupons restricted to specific customers)
    if (rule.scope === "BRANCH" && rule.targetCustomerIds.length > 0) {
      if (!rule.targetCustomerIds.includes(ctx.customerId)) {
        return fail("COUPON_USER_RESTRICTED", "This coupon is not available for your account.");
      }
    }

    // Layer 4 — customer eligibility
    const bookingCount = await db.booking.count({
      where: {
        customerId: ctx.customerId,
        status: { in: ["CONFIRMED", "PICKED_UP", "RETURNED"] },
        ...(excludeBookingId != null ? { id: { not: excludeBookingId } } : {}),
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

    // Layer 6 — payment plan compatibility (left to the caller when deferred)
    if (!ctx.skipPaymentPlan) {
      const planCheck = this.checkPaymentPlan(rule, ctx.paymentPlan);
      if (!planCheck.valid) return planCheck;
    }

    // A locked-in coupon already consumed its use when it was applied
    if (ctx.lockedIn) return { valid: true, rule };

    // Layers 7–10 — usage limits
    const usage = await this.checkUsageLimits(rule, ctx, db);
    if (!usage.valid) return usage;

    return { valid: true, rule };
  }

  /** Layer 6 on its own — the only check that depends on the payment plan. */
  checkPaymentPlan(rule: DiscountRule, paymentPlan: string): ValidationResult {
    const plan = paymentPlan.toUpperCase();
    if (rule.applicablePaymentPlans.length > 0) {
      const plansUpper = rule.applicablePaymentPlans.map((p) => p.toUpperCase());
      if (!plansUpper.includes(plan) && !plansUpper.includes("BOTH")) {
        return {
          valid: false,
          failureCode: "COUPON_PAYMENT_PLAN_MISMATCH",
          failureReason: plan === "ADVANCE"
            ? "This coupon can't be used when paying an advance."
            : "This coupon is only valid when paying an advance.",
        };
      }
    }
    if (plan === "ADVANCE" && rule.allowPartialPayment === false) {
      return {
        valid: false,
        failureCode: "COUPON_PAYMENT_PLAN_MISMATCH",
        failureReason: "This coupon needs the booking to be paid in full.",
      };
    }
    return { valid: true, rule };
  }

  /**
   * Layers 7–10 on their own. Booking creation calls this again inside its
   * transaction after lockRule, so two concurrent holds can't both take the
   * last use of a limited coupon.
   */
  async checkUsageLimits(
    rule: DiscountRule,
    ctx: Pick<CouponValidationContext, "customerId" | "branchId" | "bookingId">,
    db: Db = prisma,
  ): Promise<ValidationResult> {
    const fail = (failureCode: string, failureReason: string): ValidationResult => ({
      valid: false,
      failureCode,
      failureReason,
    });
    const notThisBooking = ctx.bookingId != null ? { bookingId: { not: ctx.bookingId } } : {};

    // Layer 7 — total usage limit
    if (rule.totalUsageLimit != null) {
      const totalUsed = await db.couponUsageLog.count({
        where: { discountRuleId: rule.id, ...notThisBooking },
      });
      if (totalUsed >= rule.totalUsageLimit) {
        return fail("COUPON_USAGE_LIMIT_EXCEEDED", "This coupon has reached its usage limit.");
      }
    }

    // Layer 8 — per-user usage limit
    if (rule.perUserLimit != null) {
      const userUsed = await db.couponUsageLog.count({
        where: { discountRuleId: rule.id, customerId: ctx.customerId, ...notThisBooking },
      });
      if (userUsed >= rule.perUserLimit) {
        return fail("COUPON_PER_USER_LIMIT_EXCEEDED", "You have already used this coupon the maximum number of times.");
      }
    }

    // Layer 9 — per-branch usage limit
    if (rule.perBranchLimit != null) {
      const branchUsed = await db.couponUsageLog.count({
        where: { discountRuleId: rule.id, branchId: ctx.branchId, ...notThisBooking },
      });
      if (branchUsed >= rule.perBranchLimit) {
        return fail("COUPON_BRANCH_LIMIT_EXCEEDED", "This coupon has reached its limit at this branch.");
      }
    }

    // Layer 10 — per-day usage limit (IST business day)
    if (rule.perDayLimit != null) {
      const nowIst = DateTime.now().setZone(IST);
      const todayStart = nowIst.startOf("day").toJSDate();
      const todayEnd = nowIst.endOf("day").toJSDate();
      const todayUsed = await db.couponUsageLog.count({
        where: {
          discountRuleId: rule.id,
          appliedAt: { gte: todayStart, lte: todayEnd },
          ...notThisBooking,
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

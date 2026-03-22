import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { applyCouponSchema } from "@repo/schemas";
import { DateTime } from "luxon";
import PricingEngineService from "../../services/pricing/pricing-engine.service.js";
import { discountApplicationService } from "../../services/discount/index.js";
import { couponValidationService } from "../../services/discount/index.js";
import Decimal from "decimal.js";

const pricingEngine = new PricingEngineService();

const buildActorContext = async (req: Request) => {
  const user = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true, branchId: true, branch: { select: { name: true } } },
  });
  if (!user || !user.branchId) throw new Error("Actor not found");
  return {
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    actorBranchId: user.branchId,
    actorPublicId: req.public_Id,
    branchName: user.branch?.name ?? "Unknown",
  };
};

/**
 * POST /api/branchManager/bookings/:bookingId/apply-coupon
 *
 * Validates and applies a coupon to an existing HOLD booking.
 * Recalculates pricing and records a DiscountApplication.
 * Uses publicId from URL param (frontend-facing).
 */
export const ApplyCoupon = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params; // publicId from frontend

    const validation = applyCouponSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
    }

    const booking = await prisma.booking.findUnique({
      where: { publicId: bookingId },
      include: {
        items: { include: { vehicle: { select: { id: true, categoryId: true } } } },
        customer: { select: { id: true } },
        branch: { select: { id: true } },
      },
    });

    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    if (booking.status !== "HOLD" && booking.status !== "CONFIRMED") {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Coupon can only be applied to active bookings" });
    }
    if (booking.invoice) {
      // Check if post-invoice application is allowed
      const rule = await couponValidationService.validate(validation.data.couponCode, {
        branchId: booking.branchId,
        customerId: booking.customerId,
        bookingAmount: new Decimal(booking.totalBase.toString()),
        rentalDays: booking.days,
        vehicleCategoryId: booking.items[0]?.vehicle.categoryId ?? 0,
        paymentPlan: validation.data.paymentPlan,
      });
      if (!rule.valid || !rule.rule?.allowPostInvoice) {
        return res.status(StatusCode.BAD_REQUEST).json({
          code: "DISCOUNT_POST_INVOICE_BLOCKED",
          message: "Discount cannot be applied after invoice has been generated.",
        });
      }
    }

    const actor = await buildActorContext(req);

    // Re-calculate pricing with coupon
    const firstItem = booking.items[0];
    if (!firstItem) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Booking has no vehicle items" });
    }

    const startAt = DateTime.fromJSDate(booking.startAt, { zone: "Asia/Kolkata" });
    const endAt = DateTime.fromJSDate(booking.endAt, { zone: "Asia/Kolkata" });

    const pricing = await pricingEngine.calculateBookingPrice(
      firstItem.vehicleId,
      startAt,
      endAt,
      booking.branchId,
      booking.customerId,
      validation.data.couponCode,
      undefined,
      undefined,
    );

    if (!pricing.discountEvaluation?.couponValid) {
      return res.status(StatusCode.UNPROCESSABLE_ENTITY).json({
        code: pricing.discountEvaluation?.couponFailureCode ?? "COUPON_INVALID",
        message: pricing.discountEvaluation?.couponFailureReason ?? "Coupon is not valid for this booking.",
      });
    }

    // Record the discount application (upsert — safe for HOLD bookings)
    await discountApplicationService.record(
      booking.id,
      booking.publicId,
      pricing.discountEvaluation,
      validation.data.paymentPlan,
      actor,
    );

    // Update booking totals to reflect new discount
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        totalDiscount: pricing.discountAmount,
        totalTax: pricing.taxAmount,
        totalFinal: pricing.finalTotal,
        couponCode: pricing.appliedCouponCode,
        discountRuleId: pricing.couponRuleId,
        pricingSnapshot: {
          ...(booking.pricingSnapshot as object),
          durationDiscountAmount: pricing.durationDiscountAmount.toFixed(2),
          couponCode: pricing.appliedCouponCode,
          couponDiscountAmount: pricing.couponDiscountAmount.toFixed(2),
          totalDiscountAmount: pricing.discountAmount.toFixed(2),
          finalTotal: pricing.finalTotal.toFixed(2),
        },
      },
    });

    return res.status(StatusCode.OK).json({
      message: "Coupon applied successfully",
      data: {
        couponCode: pricing.appliedCouponCode,
        durationDiscountAmount: pricing.durationDiscountAmount.toFixed(2),
        couponDiscountAmount: pricing.couponDiscountAmount.toFixed(2),
        totalDiscountAmount: pricing.discountAmount.toFixed(2),
        totalTax: pricing.taxAmount.toFixed(2),
        finalTotal: pricing.finalTotal.toFixed(2),
      },
    });
  } catch (error) {
    console.error("ApplyCoupon Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * DELETE /api/branchManager/bookings/:bookingId/apply-coupon
 *
 * Removes applied coupon from a HOLD booking and recalculates pricing without it.
 */
export const RemoveCoupon = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params; // publicId

    const booking = await prisma.booking.findUnique({
      where: { publicId: bookingId },
      include: {
        items: { include: { vehicle: { select: { id: true } } } },
      },
    });
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    if (booking.status !== "HOLD") {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Coupon can only be removed from HOLD bookings" });
    }
    if (!booking.couponCode) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "No coupon is currently applied to this booking" });
    }

    const actor = await buildActorContext(req);
    const firstItem = booking.items[0];
    if (!firstItem) return res.status(StatusCode.BAD_REQUEST).json({ message: "Booking has no items" });

    const startAt = DateTime.fromJSDate(booking.startAt, { zone: "Asia/Kolkata" });
    const endAt = DateTime.fromJSDate(booking.endAt, { zone: "Asia/Kolkata" });

    // Recalculate without coupon — duration discount still applies
    const pricing = await pricingEngine.calculateBookingPrice(
      firstItem.vehicleId,
      startAt,
      endAt,
      booking.branchId,
      booking.customerId,
      undefined, // no coupon
    );

    // Update discount application record (without coupon)
    if (pricing.discountEvaluation) {
      await discountApplicationService.record(
        booking.id,
        booking.publicId,
        pricing.discountEvaluation,
        "FULL",
        actor,
      );
    }

    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        couponCode: null,
        discountRuleId: null,
        totalDiscount: pricing.discountAmount,
        totalTax: pricing.taxAmount,
        totalFinal: pricing.finalTotal,
        pricingSnapshot: {
          ...(booking.pricingSnapshot as object),
          couponCode: null,
          couponDiscountAmount: "0.00",
          totalDiscountAmount: pricing.discountAmount.toFixed(2),
          finalTotal: pricing.finalTotal.toFixed(2),
        },
      },
    });

    return res.status(StatusCode.OK).json({
      message: "Coupon removed",
      data: {
        totalDiscountAmount: pricing.discountAmount.toFixed(2),
        totalTax: pricing.taxAmount.toFixed(2),
        finalTotal: pricing.finalTotal.toFixed(2),
      },
    });
  } catch (error) {
    console.error("RemoveCoupon Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/branchManager/bookings/:bookingId/discount-summary
 *
 * Returns the discount application summary for a booking.
 */
export const GetBookingDiscountSummary = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params; // publicId

    const booking = await prisma.booking.findUnique({
      where: { publicId: bookingId },
      select: { id: true, branchId: true },
    });
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });

    if (booking.branchId !== req.branch_Id) {
      return res.status(StatusCode.FORBIDDEN).json({ message: "Access denied" });
    }

    const application = await discountApplicationService.getByBookingId(booking.id);
    return res.status(StatusCode.OK).json({ data: application });
  } catch (error) {
    console.error("GetBookingDiscountSummary Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

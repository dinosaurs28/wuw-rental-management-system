import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { PricingEngineService } from "../../services/pricing/pricing-engine.service.js";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import { z } from "zod";

const pricingEngine = new PricingEngineService();

const validateSchema = z.object({
  couponCode: z.string().min(1).max(50),
  vehiclePublicId: z.string().min(1),
  startAt: z.string().min(1),
  endAt: z.string().min(1),
});

/**
 * POST /api/public/discount/validate
 *
 * Validates a coupon code and returns a pricing preview.
 * No authentication required. No usage is recorded.
 */
export const ValidateCoupon = async (req: Request, res: Response) => {
  try {
    const parsed = validateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: parsed.error.format() });
    }

    const { couponCode, vehiclePublicId, startAt, endAt } = parsed.data;

    const vehicle = await prisma.vehicle.findUnique({
      where: { publicId: vehiclePublicId },
      select: { id: true, branchId: true, categoryId: true },
    });
    if (!vehicle) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Vehicle not found" });
    }

    const startDt = TimezoneService.parseISO(startAt);
    const endDt = TimezoneService.parseISO(endAt);
    if (!startDt.isValid || !endDt.isValid) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid date format" });
    }

    const pricing = await pricingEngine.calculateBookingPrice(
      vehicle.id,
      startDt,
      endDt,
      vehicle.branchId,
      0, // no customer context for public preview — customer-specific checks use 0 as sentinel
      couponCode.toUpperCase(),
    );

    const valid = pricing.discountEvaluation?.couponValid === true;

    if (!valid) {
      return res.status(StatusCode.OK).json({
        data: {
          valid: false,
          code: pricing.discountEvaluation?.couponFailureCode ?? "COUPON_INVALID",
          reason: pricing.discountEvaluation?.couponFailureReason ?? "Invalid coupon code.",
        },
      });
    }

    return res.status(StatusCode.OK).json({
      data: {
        valid: true,
        couponCode: pricing.appliedCouponCode ?? couponCode.toUpperCase(),
        discountAmount: pricing.couponDiscountAmount.toFixed(2),
        discountType: pricing.discountEvaluation?.couponRule?.discountType,
        discountValue: pricing.discountEvaluation?.couponRule?.value?.toString(),
      },
    });
  } catch (error) {
    console.error("ValidateCoupon Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

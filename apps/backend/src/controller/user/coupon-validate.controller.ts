import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { PricingEngineService } from "../../services/pricing/pricing-engine.service.js";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import { z } from "zod";

const pricingEngine = new PricingEngineService();

const validateSchema = z
  .object({
    couponCode: z.string().min(1).max(50),
    vehiclePublicId: z.string().min(1).optional(),
    groupKey: z.string().min(1).optional(),
    startAt: z.string().min(1),
    endAt: z.string().min(1),
  })
  .refine((d) => d.vehiclePublicId || d.groupKey, {
    message: "Either vehiclePublicId or groupKey is required",
    path: ["vehiclePublicId"],
  });

/**
 * POST /api/user/discount/validate
 *
 * Customer-authenticated coupon validation. Resolves the real customerId so
 * perUserLimit and targetCustomerIds checks are enforced correctly.
 * No usage is recorded — this is a preview only.
 */
export const ValidateCustomerCoupon = async (req: Request, res: Response) => {
  try {
    const parsed = validateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: parsed.error.format() });
    }

    const { couponCode, vehiclePublicId, groupKey, startAt, endAt } = parsed.data;

    // Resolve real customerId from the authenticated user
    const customer = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { customerProfile: { select: { id: true } } },
    });
    const customerId = customer?.customerProfile?.id ?? 0;

    let vehicle: { id: number; branchId: number; categoryId: number } | null = null;

    if (vehiclePublicId) {
      vehicle = await prisma.vehicle.findUnique({
        where: { publicId: vehiclePublicId },
        select: { id: true, branchId: true, categoryId: true },
      });
    } else if (groupKey) {
      const parts = groupKey.split("__");
      const categoryId = parseInt(parts[2] ?? "", 10);
      const branchId = parseInt(parts[3] ?? "", 10);
      if (isNaN(categoryId) || isNaN(branchId)) {
        return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid group key" });
      }
      vehicle = await prisma.vehicle.findFirst({
        where: { branchId, categoryId, status: "AVAILABLE" },
        select: { id: true, branchId: true, categoryId: true },
        orderBy: { odo: "asc" },
      });
    }

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
      customerId,
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
    console.error("ValidateCustomerCoupon Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

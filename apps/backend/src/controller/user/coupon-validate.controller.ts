import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { previewCoupon } from "../../services/discount/coupon-preview.service.js";
import { isGstRuleMissing, GST_RULE_MISSING, GST_RULE_MISSING_MESSAGE } from "../../services/tax/gst.service.js";
import { z } from "zod";

const validateSchema = z
  .object({
    couponCode: z.string().min(1).max(50),
    vehiclePublicId: z.string().min(1).optional(),
    groupKey: z.string().min(1).optional(),
    startAt: z.string().min(1),
    endAt: z.string().min(1),
    // Plan the customer picked (optional — older clients omit it)
    paymentFlow: z.enum(["FULL", "ADVANCE"]).optional(),
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
 * No usage is recorded — this is a preview only. A valid response carries the
 * server-priced breakdown (pricing), payableTotal and paymentOptions.
 */
export const ValidateCustomerCoupon = async (req: Request, res: Response) => {
  try {
    const parsed = validateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: parsed.error.format() });
    }

    const { couponCode, vehiclePublicId, groupKey, startAt, endAt, paymentFlow } = parsed.data;

    // Resolve real customerId from the authenticated user
    const customer = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { customerProfile: { select: { id: true } } },
    });
    const customerId = customer?.customerProfile?.id ?? 0;

    const result = await previewCoupon({
      couponCode,
      vehiclePublicId,
      groupKey,
      startAt,
      endAt,
      customerId,
      paymentFlow,
    });
    if (result.status !== 200) {
      return res.status(result.status).json({ message: result.message });
    }
    return res.status(StatusCode.OK).json({ data: result.data });
  } catch (error) {
    if (isGstRuleMissing(error)) {
      return res.status(StatusCode.CONFLICT).json({ success: false, code: GST_RULE_MISSING, message: GST_RULE_MISSING_MESSAGE });
    }
    console.error("ValidateCustomerCoupon Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

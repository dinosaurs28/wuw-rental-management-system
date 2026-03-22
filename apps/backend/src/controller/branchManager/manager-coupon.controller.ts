import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { createManagerCouponSchema } from "@repo/schemas";
import { discountRuleService } from "../../services/discount/index.js";

const buildActorContext = async (req: Request) => {
  const user = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true, branchId: true, branch: { select: { name: true } } },
  });
  if (!user || !user.branchId) throw new Error("Actor not found or has no branch");
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
 * POST /api/branchManager/discount/coupons
 *
 * Branch manager creates a coupon (e.g. for a known customer, friend, or
 * relative). All guardrails (value cap, validity, usage limit, daily quota)
 * are enforced server-side from BranchDiscountConfig — manager cannot bypass
 * them regardless of what they send in the request body.
 */
export const CreateManagerCoupon = async (req: Request, res: Response) => {
  try {
    const validation = createManagerCouponSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid input",
        errors: validation.error.format(),
      });
    }

    const actor = await buildActorContext(req);
    const rule = await discountRuleService.createManagerCoupon(validation.data, actor);

    return res.status(StatusCode.CREATED).json({
      message: "Coupon created successfully",
      data: {
        publicId: rule.publicId,
        code: rule.code,
        name: rule.name,
        discountType: rule.discountType,
        value: rule.value,
        totalUsageLimit: rule.totalUsageLimit,
        endDate: rule.endDate,
        isActive: rule.isActive,
      },
    });
  } catch (error: any) {
    console.error("CreateManagerCoupon Error:", error);

    if (error.message?.includes("not enabled")) {
      return res.status(StatusCode.FORBIDDEN).json({ message: error.message });
    }
    if (error.message?.includes("cannot exceed") || error.message?.includes("Daily coupon")) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
    }
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/branchManager/discount/coupons
 *
 * Lists all coupons ever created by managers of this branch.
 * Branch managers can only see their own branch's manager-created coupons.
 */
export const ListManagerCoupons = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;

    const coupons = await prisma.discountRule.findMany({
      where: {
        scope: "BRANCH",
        applicableBranchIds: { has: branchId },
        createdBy: { role: { in: ["MANAGER", "STAFF"] } },
      },
      orderBy: { createdAt: "desc" },
      select: {
        publicId: true,
        code: true,
        name: true,
        description: true,
        discountType: true,
        value: true,
        totalUsageLimit: true,
        startDate: true,
        endDate: true,
        isActive: true,
        targetCustomerIds: true,
        createdAt: true,
        createdBy: { select: { publicId: true, name: true, role: true } },
        _count: { select: { usageLogs: true } },
      },
    });

    return res.status(StatusCode.OK).json({ data: coupons });
  } catch (error) {
    console.error("ListManagerCoupons Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/branchManager/discount/coupons/limits
 *
 * Returns today's coupon creation count vs limit for the current manager.
 * Useful for showing "You have created 2 of 3 coupons today" in the UI.
 */
export const GetManagerCouponLimits = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;

    const actor = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true },
    });
    if (!actor) return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });

    const config = await prisma.branchDiscountConfig.findUnique({
      where: { branchId },
      select: {
        managerCouponCreationEnabled: true,
        maxManagerCouponsPerDay: true,
        maxManagerCouponDiscountPercent: true,
        maxManagerCouponFlatAmount: true,
        maxManagerCouponValidityDays: true,
        maxManagerCouponUsageLimit: true,
      },
    });

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);

    const createdToday = await prisma.discountRule.count({
      where: {
        createdById: actor.id,
        createdAt: { gte: todayStart, lte: todayEnd },
      },
    });

    return res.status(StatusCode.OK).json({
      data: {
        enabled: config?.managerCouponCreationEnabled ?? false,
        createdToday,
        dailyLimit: config?.maxManagerCouponsPerDay ?? 3,
        remainingToday: Math.max(0, (config?.maxManagerCouponsPerDay ?? 3) - createdToday),
        limits: {
          maxDiscountPercent: config?.maxManagerCouponDiscountPercent ?? 15,
          maxFlatAmount: config?.maxManagerCouponFlatAmount ?? 500,
          maxValidityDays: config?.maxManagerCouponValidityDays ?? 7,
          maxUsageLimit: config?.maxManagerCouponUsageLimit ?? 5,
        },
      },
    });
  } catch (error) {
    console.error("GetManagerCouponLimits Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

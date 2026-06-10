import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { createManagerCouponSchema, updateManagerCouponSchema } from "@repo/schemas";
import { discountRuleService } from "../../services/discount/index.js";
import Decimal from "decimal.js";

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
 * PATCH /api/branchManager/discount/coupons/:publicId
 *
 * Branch manager edits an existing coupon. Usage logs are never touched —
 * only the rule definition is updated. Guardrails from BranchDiscountConfig
 * are re-enforced on every edit.
 */
export const UpdateManagerCoupon = async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;
    const branchId = req.branch_Id;

    const validation = updateManagerCouponSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
    }
    const input = validation.data;

    const rule = await prisma.discountRule.findUnique({
      where: { publicId },
      select: { id: true, applicableBranchIds: true, isActive: true, discountType: true, endDate: true, totalUsageLimit: true },
    });

    if (!rule) return res.status(StatusCode.NOT_FOUND).json({ message: "Coupon not found" });
    if (!rule.applicableBranchIds.includes(branchId)) {
      return res.status(StatusCode.FORBIDDEN).json({ message: "You can only edit coupons for your own branch" });
    }

    const config = await prisma.branchDiscountConfig.findUnique({ where: { branchId } });

    // Re-enforce guardrails on value change
    if (input.value !== undefined) {
      if (rule.discountType === "PERCENTAGE") {
        const maxPct = Number(config?.maxManagerCouponDiscountPercent ?? 15);
        if (input.value > maxPct) {
          return res.status(StatusCode.BAD_REQUEST).json({ message: `Discount percentage cannot exceed ${maxPct}%` });
        }
      } else {
        const maxFlat = Number(config?.maxManagerCouponFlatAmount ?? 500);
        if (input.value > maxFlat) {
          return res.status(StatusCode.BAD_REQUEST).json({ message: `Flat discount cannot exceed ₹${maxFlat}` });
        }
      }
    }

    // Re-enforce usage limit cap
    if (input.usageLimit !== undefined) {
      const cap = config?.maxManagerCouponUsageLimit ?? 5;
      input.usageLimit = Math.min(input.usageLimit, cap);

      // Ensure new limit is not below current usage count (preserve existing logs)
      const currentUsage = await prisma.couponUsageLog.count({ where: { discountRuleId: rule.id } });
      if (input.usageLimit < currentUsage) {
        return res.status(StatusCode.BAD_REQUEST).json({
          message: `Cannot set limit to ${input.usageLimit} — coupon has already been used ${currentUsage} time(s)`,
        });
      }
    }

    // Compute new endDate if extendDays provided
    let newEndDate: Date | undefined;
    if (input.extendDays !== undefined) {
      const base = new Date(rule.endDate) > new Date() ? new Date(rule.endDate) : new Date();
      newEndDate = new Date(base);
      newEndDate.setDate(newEndDate.getDate() + input.extendDays);
    }

    const updateData: any = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.value !== undefined && { value: new Decimal(input.value) }),
      ...(input.usageLimit !== undefined && { totalUsageLimit: input.usageLimit }),
      ...(input.perUserLimit !== undefined && { perUserLimit: input.perUserLimit }),
      ...(input.targetCustomerIds !== undefined && { targetCustomerIds: input.targetCustomerIds }),
      ...(newEndDate && { endDate: newEndDate }),
      ...(input.reason !== undefined && {
        description: `[Manager Coupon] Reason: ${input.reason}`,
      }),
    };

    const updated = await prisma.discountRule.update({ where: { publicId }, data: updateData });

    return res.status(StatusCode.OK).json({ message: "Coupon updated successfully", data: { publicId: updated.publicId } });
  } catch (error: any) {
    console.error("UpdateManagerCoupon Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * PATCH /api/branchManager/discount/coupons/:publicId/deactivate
 *
 * Branch manager deactivates one of their own branch's coupons.
 */
export const DeactivateManagerCoupon = async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;
    const branchId = req.branch_Id;

    const rule = await prisma.discountRule.findUnique({
      where: { publicId },
      select: { id: true, isActive: true, applicableBranchIds: true },
    });

    if (!rule) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Coupon not found" });
    }
    if (!rule.applicableBranchIds.includes(branchId)) {
      return res.status(StatusCode.FORBIDDEN).json({ message: "You can only deactivate coupons for your own branch" });
    }
    if (!rule.isActive) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Coupon is already inactive" });
    }

    const actor = await buildActorContext(req);
    await discountRuleService.deactivateRule(publicId as string, actor);

    return res.status(StatusCode.OK).json({ message: "Coupon deactivated successfully" });
  } catch (error: any) {
    console.error("DeactivateManagerCoupon Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/branchManager/discount/coupons/customer-search?q=phone_or_name
 *
 * Search customers by phone number or name so the manager can pick a
 * specific customer to restrict a coupon to.
 */
export const SearchCustomerForCoupon = async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string | undefined)?.trim();
    if (!q || q.length < 3) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Query must be at least 3 characters" });
    }

    const users = await prisma.user.findMany({
      where: {
        role: "CUSTOMER",
        OR: [
          { phone: { contains: q } },
          { name: { contains: q, mode: "insensitive" } },
        ],
        customerProfile: { isNot: null },
      },
      select: {
        name: true,
        phone: true,
        publicId: true,
        customerProfile: { select: { id: true } },
      },
      take: 10,
    });

    return res.status(StatusCode.OK).json({
      data: users.map((u) => ({
        customerProfileId: u.customerProfile!.id,
        name: u.name,
        phone: u.phone,
        publicId: u.publicId,
      })),
    });
  } catch (error) {
    console.error("SearchCustomerForCoupon Error:", error);
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

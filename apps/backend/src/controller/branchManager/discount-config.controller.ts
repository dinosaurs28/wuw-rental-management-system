import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { updateBranchDiscountConfigSchema } from "@repo/schemas";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
import Decimal from "decimal.js";
import { redis } from "../../lib/redisconfig.js";
import { branchDiscountConfigKey } from "../../utils/cache/vehicleCacheKeys.js";

export const GetBranchDiscountConfig = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const config = await prisma.branchDiscountConfig.findUnique({ where: { branchId } });

    // Return defaults if not yet configured
    if (!config) {
      return res.status(StatusCode.OK).json({
        data: {
          branchId,
          durationDiscountEnabled: false,
          stackWithCoupon: false,
          maxCombinedDiscountPercent: null,
          managerApprovalThreshold: 500,
          maxManualDiscountsPerEmployeePerDay: 5,
          managerCouponCreationEnabled: false,
          maxManagerCouponDiscountPercent: 15,
          maxManagerCouponFlatAmount: 500,
          maxManagerCouponValidityDays: 7,
          maxManagerCouponUsageLimit: 5,
          maxManagerCouponsPerDay: 3,
        },
      });
    }

    return res.status(StatusCode.OK).json({ data: config });
  } catch (error) {
    console.error("GetBranchDiscountConfig Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const UpdateBranchDiscountConfig = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const validation = updateBranchDiscountConfigSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
    }

    const data: any = {};
    const v = validation.data;
    if (v.durationDiscountEnabled !== undefined) data.durationDiscountEnabled = v.durationDiscountEnabled;
    if (v.stackWithCoupon !== undefined) data.stackWithCoupon = v.stackWithCoupon;
    if (v.maxCombinedDiscountPercent !== undefined) {
      data.maxCombinedDiscountPercent = v.maxCombinedDiscountPercent != null ? new Decimal(v.maxCombinedDiscountPercent) : null;
    }
    if (v.managerApprovalThreshold !== undefined) data.managerApprovalThreshold = new Decimal(v.managerApprovalThreshold);
    if (v.maxManualDiscountsPerEmployeePerDay !== undefined) data.maxManualDiscountsPerEmployeePerDay = v.maxManualDiscountsPerEmployeePerDay;

    const config = await prisma.branchDiscountConfig.upsert({
      where: { branchId },
      create: { branchId, ...data },
      update: data,
    });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.UPDATED,
      entityType: StaffEntityType.PRICING,
      entityRef: String(branchId),
      description: `Branch discount config updated`,
      metadata: data,
    });

    // TASK-012e: Invalidate discount config cache so next pricing call gets updated rules
    try {
      await redis.del(branchDiscountConfigKey(branchId));
    } catch (err) {
      console.warn("[pricing-cache] Failed to invalidate discount config cache (non-fatal):", err);
    }

    return res.status(StatusCode.OK).json({ message: "Branch discount config updated", data: config });
  } catch (error) {
    console.error("UpdateBranchDiscountConfig Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

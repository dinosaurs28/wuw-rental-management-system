import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import {
  createDiscountRuleSchema,
  updateDiscountRuleSchema,
  generateCouponCodeSchema,
  listDiscountRulesQuerySchema,
  updateBranchDiscountConfigAdminSchema,
} from "@repo/schemas";
import { discountRuleService, couponCodeGeneratorService } from "../../services/discount/index.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
import Decimal from "decimal.js";

const buildActorContext = async (req: Request) => {
  const user = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true, branchId: true, branch: { select: { name: true } } },
  });
  if (!user) throw new Error("Actor not found");
  return {
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    actorBranchId: user.branchId ?? undefined,
    actorPublicId: req.public_Id,
    branchName: user.branch?.name ?? "HQ",
  };
};

export const ListDiscountRules = async (req: Request, res: Response) => {
  try {
    const query = listDiscountRulesQuerySchema.safeParse(req.query);
    if (!query.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid query", errors: query.error.format() });
    }
    const result = await discountRuleService.listRules(query.data);
    return res.status(StatusCode.OK).json({ data: result });
  } catch (error) {
    console.error("ListDiscountRules Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const GetDiscountRule = async (req: Request, res: Response) => {
  try {
    const rule = await discountRuleService.getRuleByPublicId(req.params.publicId!);
    if (!rule) return res.status(StatusCode.NOT_FOUND).json({ message: "Discount rule not found" });
    return res.status(StatusCode.OK).json({ data: rule });
  } catch (error) {
    console.error("GetDiscountRule Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const CreateDiscountRule = async (req: Request, res: Response) => {
  try {
    const validation = createDiscountRuleSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
    }
    const actor = await buildActorContext(req);
    const rule = await discountRuleService.createRule(
      {
        ...validation.data,
        startDate: new Date(validation.data.startDate),
        endDate: new Date(validation.data.endDate),
      },
      actor,
    );
    return res.status(StatusCode.CREATED).json({ message: "Discount rule created", data: { publicId: rule.publicId, code: rule.code } });
  } catch (error: any) {
    console.error("CreateDiscountRule Error:", error);
    if (error.message?.includes("already exists")) {
      return res.status(StatusCode.CONFLICT).json({ message: error.message });
    }
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const UpdateDiscountRule = async (req: Request, res: Response) => {
  try {
    const validation = updateDiscountRuleSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
    }
    const actor = await buildActorContext(req);
    const data: any = { ...validation.data };
    if (data.startDate) data.startDate = new Date(data.startDate);
    if (data.endDate) data.endDate = new Date(data.endDate);
    const rule = await discountRuleService.updateRule(req.params.publicId!, data, actor);
    return res.status(StatusCode.OK).json({ message: "Discount rule updated", data: rule });
  } catch (error: any) {
    console.error("UpdateDiscountRule Error:", error);
    if (error.message?.includes("not found")) return res.status(StatusCode.NOT_FOUND).json({ message: error.message });
    if (error.message?.includes("already exists")) return res.status(StatusCode.CONFLICT).json({ message: error.message });
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const DeactivateDiscountRule = async (req: Request, res: Response) => {
  try {
    const actor = await buildActorContext(req);
    const rule = await discountRuleService.deactivateRule(req.params.publicId!, actor);
    return res.status(StatusCode.OK).json({ message: "Discount rule deactivated", data: { publicId: rule.publicId, isActive: false } });
  } catch (error: any) {
    console.error("DeactivateDiscountRule Error:", error);
    if (error.message?.includes("not found")) return res.status(StatusCode.NOT_FOUND).json({ message: error.message });
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const GenerateCouponCode = async (req: Request, res: Response) => {
  try {
    const validation = generateCouponCodeSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
    }
    const code = await couponCodeGeneratorService.generateCode(validation.data);
    return res.status(StatusCode.OK).json({ data: { code } });
  } catch (error) {
    console.error("GenerateCouponCode Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/admin/discount-rules/manager-coupons
 *
 * Admin view of all manager-created coupons across all branches.
 * Useful for monitoring for abuse or unusual patterns.
 */
export const ListManagerCreatedCoupons = async (req: Request, res: Response) => {
  try {
    const { branchId, isActive, page = "1", pageSize = "20" } = req.query as Record<string, string>;

    const where: any = {
      scope: "BRANCH",
      createdBy: { role: { in: ["MANAGER", "STAFF"] } },
    };
    if (branchId) where.applicableBranchIds = { has: parseInt(branchId) };
    if (isActive !== undefined) where.isActive = isActive === "true";

    const skip = (parseInt(page) - 1) * parseInt(pageSize);
    const take = parseInt(pageSize);

    const [coupons, total] = await Promise.all([
      prisma.discountRule.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
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
          applicableBranchIds: true,
          targetCustomerIds: true,
          createdAt: true,
          createdBy: { select: { publicId: true, name: true, role: true } },
          _count: { select: { usageLogs: true } },
        },
      }),
      prisma.discountRule.count({ where }),
    ]);

    return res.status(StatusCode.OK).json({ data: coupons, total, page: parseInt(page), pageSize: parseInt(pageSize) });
  } catch (error) {
    console.error("ListManagerCreatedCoupons Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * PATCH /api/admin/discount-rules/branch-config/:branchId
 *
 * Admin updates a branch's discount config including manager coupon guardrails.
 * This is the only way to enable managerCouponCreationEnabled.
 */
export const AdminUpdateBranchDiscountConfig = async (req: Request, res: Response) => {
  try {
    const targetBranchId = parseInt(req.params.branchId!);
    if (isNaN(targetBranchId)) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid branch ID" });
    }

    const branch = await prisma.branch.findUnique({ where: { id: targetBranchId }, select: { id: true, name: true } });
    if (!branch) return res.status(StatusCode.NOT_FOUND).json({ message: "Branch not found" });

    const validation = updateBranchDiscountConfigAdminSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
    }

    const v = validation.data;
    const data: any = {};

    // Standard config fields
    if (v.durationDiscountEnabled !== undefined) data.durationDiscountEnabled = v.durationDiscountEnabled;
    if (v.stackWithCoupon !== undefined) data.stackWithCoupon = v.stackWithCoupon;
    if (v.maxCombinedDiscountPercent !== undefined) {
      data.maxCombinedDiscountPercent = v.maxCombinedDiscountPercent != null ? new Decimal(v.maxCombinedDiscountPercent) : null;
    }
    if (v.managerApprovalThreshold !== undefined) data.managerApprovalThreshold = new Decimal(v.managerApprovalThreshold);
    if (v.maxManualDiscountsPerEmployeePerDay !== undefined) data.maxManualDiscountsPerEmployeePerDay = v.maxManualDiscountsPerEmployeePerDay;

    // Admin-only manager coupon guardrail fields
    if (v.managerCouponCreationEnabled !== undefined) data.managerCouponCreationEnabled = v.managerCouponCreationEnabled;
    if (v.maxManagerCouponDiscountPercent !== undefined) data.maxManagerCouponDiscountPercent = new Decimal(v.maxManagerCouponDiscountPercent);
    if (v.maxManagerCouponFlatAmount !== undefined) data.maxManagerCouponFlatAmount = new Decimal(v.maxManagerCouponFlatAmount);
    if (v.maxManagerCouponValidityDays !== undefined) data.maxManagerCouponValidityDays = v.maxManagerCouponValidityDays;
    if (v.maxManagerCouponUsageLimit !== undefined) data.maxManagerCouponUsageLimit = v.maxManagerCouponUsageLimit;
    if (v.maxManagerCouponsPerDay !== undefined) data.maxManagerCouponsPerDay = v.maxManagerCouponsPerDay;

    const config = await prisma.branchDiscountConfig.upsert({
      where: { branchId: targetBranchId },
      create: { branchId: targetBranchId, ...data },
      update: data,
    });

    const actor = await buildActorContext(req);
    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId: targetBranchId,
      branchName: branch.name,
      actionType: StaffActionType.UPDATED,
      entityType: StaffEntityType.PRICING,
      entityRef: String(targetBranchId),
      description: `Admin updated discount config for branch "${branch.name}"`,
      metadata: data,
    });

    return res.status(StatusCode.OK).json({ message: "Branch discount config updated", data: config });
  } catch (error) {
    console.error("AdminUpdateBranchDiscountConfig Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

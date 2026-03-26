import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { createID } from "../../utils/nanoID.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../staffActivity/staffActivity.service.js";
import type { DiscountRule, DiscountScope, DiscountType, Role } from "@repo/database/client";

type DiscountRuleWithMeta = DiscountRule & {
  createdBy: { name: string; publicId: string };
  _count: { usageLogs: number };
};

export interface CreateDiscountRuleInput {
  code: string;
  name: string;
  description?: string;
  discountType: DiscountType;
  value: number;
  maxDiscountCap?: number;
  scope: DiscountScope;
  applicableBranchIds?: number[];
  targetCustomerIds?: number[];
  newCustomersOnly?: boolean;
  minBookingCount?: number;
  maxBookingCount?: number;
  minBookingAmount?: number;
  maxBookingAmount?: number;
  applicableVehicleCategoryIds?: number[];
  minRentalDays?: number;
  maxRentalDays?: number;
  applicablePaymentPlans?: string[];
  allowPartialPayment?: boolean;
  minAdvanceAfterDiscount?: number;
  allowPostBooking?: boolean;
  allowPostInvoice?: boolean;
  totalUsageLimit?: number;
  perUserLimit?: number;
  perBranchLimit?: number;
  perDayLimit?: number;
  stackable?: boolean;
  priority?: number;
  startDate: Date;
  endDate: Date;
}

export interface UpdateDiscountRuleInput extends Partial<CreateDiscountRuleInput> {}

interface ActorContext {
  actorId: number;
  actorName: string;
  actorRole: Role;
  actorBranchId?: number;
  actorPublicId: string;
  branchName: string;
}

class DiscountRuleService {
  async createRule(input: CreateDiscountRuleInput, actor: ActorContext): Promise<DiscountRule> {
    const existing = await prisma.discountRule.findUnique({
      where: { code: input.code },
    });
    if (existing) {
      throw new Error(`Coupon code "${input.code}" already exists.`);
    }

    const rule = await prisma.discountRule.create({
      data: {
        publicId: createID(),
        code: input.code.toUpperCase().trim(),
        name: input.name,
        description: input.description ?? null,
        discountType: input.discountType,
        value: new Decimal(input.value),
        maxDiscountCap: input.maxDiscountCap != null ? new Decimal(input.maxDiscountCap) : null,
        scope: input.scope,
        applicableBranchIds: input.applicableBranchIds ?? [],
        targetCustomerIds: input.targetCustomerIds ?? [],
        newCustomersOnly: input.newCustomersOnly ?? false,
        minBookingCount: input.minBookingCount ?? null,
        maxBookingCount: input.maxBookingCount ?? null,
        minBookingAmount: input.minBookingAmount != null ? new Decimal(input.minBookingAmount) : null,
        maxBookingAmount: input.maxBookingAmount != null ? new Decimal(input.maxBookingAmount) : null,
        applicableVehicleCategoryIds: input.applicableVehicleCategoryIds ?? [],
        minRentalDays: input.minRentalDays ?? null,
        maxRentalDays: input.maxRentalDays ?? null,
        applicablePaymentPlans: input.applicablePaymentPlans ?? [],
        allowPartialPayment: input.allowPartialPayment ?? true,
        minAdvanceAfterDiscount: input.minAdvanceAfterDiscount != null ? new Decimal(input.minAdvanceAfterDiscount) : null,
        allowPostBooking: input.allowPostBooking ?? false,
        allowPostInvoice: input.allowPostInvoice ?? false,
        totalUsageLimit: input.totalUsageLimit ?? null,
        perUserLimit: input.perUserLimit ?? null,
        perBranchLimit: input.perBranchLimit ?? null,
        perDayLimit: input.perDayLimit ?? null,
        stackable: input.stackable ?? false,
        priority: input.priority ?? 0,
        startDate: input.startDate,
        endDate: input.endDate,
        isActive: true,
        createdById: actor.actorId,
      },
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: actor.actorBranchId,
      action: "CREATE_DISCOUNT_RULE",
      category: AuditCategory.DISCOUNT,
      description: `Discount rule "${rule.code}" created`,
      entity: "DiscountRule",
      entityId: rule.publicId,
      entityLabel: rule.name,
      after: { code: rule.code, discountType: rule.discountType, value: rule.value, scope: rule.scope },
    });

    if (actor.actorBranchId) {
      await staffActivityService.log({
        actorPublicId: actor.actorPublicId,
        actorName: actor.actorName,
        actorRole: actor.actorRole,
        branchId: actor.actorBranchId,
        branchName: actor.branchName,
        actionType: StaffActionType.CREATED,
        entityType: StaffEntityType.DISCOUNT_RULE,
        entityRef: rule.publicId,
        description: `Discount rule "${rule.code}" created`,
        metadata: { code: rule.code, discountType: rule.discountType, scope: rule.scope },
      });
    }

    return rule;
  }

  async updateRule(publicId: string, input: UpdateDiscountRuleInput, actor: ActorContext): Promise<DiscountRule> {
    const existing = await prisma.discountRule.findUnique({ where: { publicId } });
    if (!existing) throw new Error("Discount rule not found.");

    // If updating the code, ensure uniqueness
    if (input.code && input.code.toUpperCase() !== existing.code) {
      const codeConflict = await prisma.discountRule.findUnique({
        where: { code: input.code.toUpperCase().trim() },
      });
      if (codeConflict) throw new Error(`Coupon code "${input.code}" already exists.`);
    }

    const updated = await prisma.discountRule.update({
      where: { publicId },
      data: {
        ...(input.code && { code: input.code.toUpperCase().trim() }),
        ...(input.name && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.discountType && { discountType: input.discountType }),
        ...(input.value != null && { value: new Decimal(input.value) }),
        ...(input.maxDiscountCap !== undefined && {
          maxDiscountCap: input.maxDiscountCap != null ? new Decimal(input.maxDiscountCap) : null,
        }),
        ...(input.scope && { scope: input.scope }),
        ...(input.applicableBranchIds && { applicableBranchIds: input.applicableBranchIds }),
        ...(input.targetCustomerIds && { targetCustomerIds: input.targetCustomerIds }),
        ...(input.newCustomersOnly !== undefined && { newCustomersOnly: input.newCustomersOnly }),
        ...(input.minBookingCount !== undefined && { minBookingCount: input.minBookingCount }),
        ...(input.maxBookingCount !== undefined && { maxBookingCount: input.maxBookingCount }),
        ...(input.minBookingAmount !== undefined && {
          minBookingAmount: input.minBookingAmount != null ? new Decimal(input.minBookingAmount) : null,
        }),
        ...(input.maxBookingAmount !== undefined && {
          maxBookingAmount: input.maxBookingAmount != null ? new Decimal(input.maxBookingAmount) : null,
        }),
        ...(input.applicableVehicleCategoryIds && { applicableVehicleCategoryIds: input.applicableVehicleCategoryIds }),
        ...(input.minRentalDays !== undefined && { minRentalDays: input.minRentalDays }),
        ...(input.maxRentalDays !== undefined && { maxRentalDays: input.maxRentalDays }),
        ...(input.applicablePaymentPlans && { applicablePaymentPlans: input.applicablePaymentPlans }),
        ...(input.allowPartialPayment !== undefined && { allowPartialPayment: input.allowPartialPayment }),
        ...(input.minAdvanceAfterDiscount !== undefined && {
          minAdvanceAfterDiscount: input.minAdvanceAfterDiscount != null ? new Decimal(input.minAdvanceAfterDiscount) : null,
        }),
        ...(input.allowPostBooking !== undefined && { allowPostBooking: input.allowPostBooking }),
        ...(input.allowPostInvoice !== undefined && { allowPostInvoice: input.allowPostInvoice }),
        ...(input.totalUsageLimit !== undefined && { totalUsageLimit: input.totalUsageLimit }),
        ...(input.perUserLimit !== undefined && { perUserLimit: input.perUserLimit }),
        ...(input.perBranchLimit !== undefined && { perBranchLimit: input.perBranchLimit }),
        ...(input.perDayLimit !== undefined && { perDayLimit: input.perDayLimit }),
        ...(input.stackable !== undefined && { stackable: input.stackable }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.startDate && { startDate: input.startDate }),
        ...(input.endDate && { endDate: input.endDate }),
      },
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: actor.actorBranchId,
      action: "UPDATE_DISCOUNT_RULE",
      category: AuditCategory.DISCOUNT,
      description: `Discount rule "${updated.code}" updated`,
      entity: "DiscountRule",
      entityId: updated.publicId,
      entityLabel: updated.name,
      before: { code: existing.code, value: existing.value, isActive: existing.isActive },
      after: { code: updated.code, value: updated.value, isActive: updated.isActive },
    });

    if (actor.actorBranchId) {
      await staffActivityService.log({
        actorPublicId: actor.actorPublicId,
        actorName: actor.actorName,
        actorRole: actor.actorRole,
        branchId: actor.actorBranchId,
        branchName: actor.branchName,
        actionType: StaffActionType.UPDATED,
        entityType: StaffEntityType.DISCOUNT_RULE,
        entityRef: updated.publicId,
        description: `Discount rule "${updated.code}" updated`,
      });
    }

    return updated;
  }

  async deactivateRule(publicId: string, actor: ActorContext): Promise<DiscountRule> {
    const existing = await prisma.discountRule.findUnique({ where: { publicId } });
    if (!existing) throw new Error("Discount rule not found.");
    if (!existing.isActive) throw new Error("Discount rule is already inactive.");

    const updated = await prisma.discountRule.update({
      where: { publicId },
      data: { isActive: false },
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: actor.actorBranchId,
      action: "DEACTIVATE_DISCOUNT_RULE",
      category: AuditCategory.DISCOUNT,
      severity: "WARNING",
      description: `Discount rule "${updated.code}" deactivated`,
      entity: "DiscountRule",
      entityId: updated.publicId,
      entityLabel: updated.name,
      before: { isActive: true },
      after: { isActive: false },
    });

    if (actor.actorBranchId) {
      await staffActivityService.log({
        actorPublicId: actor.actorPublicId,
        actorName: actor.actorName,
        actorRole: actor.actorRole,
        branchId: actor.actorBranchId,
        branchName: actor.branchName,
        actionType: StaffActionType.UPDATED,
        entityType: StaffEntityType.DISCOUNT_RULE,
        entityRef: updated.publicId,
        description: `Discount rule "${updated.code}" deactivated`,
      });
    }

    return updated;
  }

  async getRuleByCode(code: string): Promise<DiscountRule | null> {
    return prisma.discountRule.findUnique({
      where: { code: code.toUpperCase().trim() },
    });
  }

  async getRuleByPublicId(publicId: string): Promise<DiscountRule | null> {
    return prisma.discountRule.findUnique({ where: { publicId } });
  }

  /**
   * Branch-manager coupon creation with hard guardrails enforced server-side.
   * All limits (value cap, validity, usage limit, daily count) come from
   * BranchDiscountConfig — managers cannot exceed them regardless of input.
   */
  async createManagerCoupon(
    input: {
      discountType: "PERCENTAGE" | "FLAT";
      value: number;
      name: string;
      description?: string;
      validityDays: number;
      usageLimit: number;
      targetCustomerIds: number[];
      reason: string;
    },
    actor: ActorContext,
  ): Promise<DiscountRule> {
    const branchId = actor.actorBranchId;
    if (!branchId) throw new Error("Branch manager must belong to a branch.");

    // Load branch config — feature must be enabled by admin
    const config = await prisma.branchDiscountConfig.findUnique({ where: { branchId } });
    if (!config || !config.managerCouponCreationEnabled) {
      throw new Error("Coupon creation by branch managers is not enabled for this branch.");
    }

    // ── Enforce guardrails (server-side, never trust client input) ──────────

    // 1. Value cap
    if (input.discountType === "PERCENTAGE") {
      const maxPct = Number(config.maxManagerCouponDiscountPercent);
      if (input.value > maxPct) {
        throw new Error(`Discount percentage cannot exceed ${maxPct}% for manager-created coupons.`);
      }
    } else {
      const maxFlat = Number(config.maxManagerCouponFlatAmount);
      if (input.value > maxFlat) {
        throw new Error(`Flat discount cannot exceed ₹${maxFlat} for manager-created coupons.`);
      }
    }

    // 2. Validity window cap
    const maxDays = config.maxManagerCouponValidityDays;
    const clampedValidityDays = Math.min(input.validityDays, maxDays);

    // 3. Usage limit cap
    const clampedUsageLimit = Math.min(input.usageLimit, config.maxManagerCouponUsageLimit);

    // 4. Per-day creation limit for this manager
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);

    const todayCount = await prisma.discountRule.count({
      where: {
        createdById: actor.actorId,
        createdAt: { gte: todayStart, lte: todayEnd },
      },
    });
    if (todayCount >= config.maxManagerCouponsPerDay) {
      throw new Error(
        `Daily coupon creation limit (${config.maxManagerCouponsPerDay}) reached. Contact admin to create more.`,
      );
    }

    // ── Generate a unique branch-prefixed code ──────────────────────────────
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { name: true },
    });
    const branchPrefix = (branch?.name ?? "BR").replace(/\s+/g, "").toUpperCase().slice(0, 4);

    // Import generator inline to avoid circular dep
    const { couponCodeGeneratorService } = await import("./coupon-code-generator.service.js");
    const code = await couponCodeGeneratorService.generateCode({
      pattern: "BRANCH_PREFIX",
      branchCode: branchPrefix,
      length: 6,
    });

    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + clampedValidityDays);

    const rule = await prisma.discountRule.create({
      data: {
        publicId: createID(),
        code,
        name: input.name,
        description: input.description
          ? `[Manager Coupon] ${input.description}. Reason: ${input.reason}`
          : `[Manager Coupon] Reason: ${input.reason}`,
        discountType: input.discountType,
        value: new Decimal(input.value),
        maxDiscountCap: null,
        // Hardcoded guardrails — managers cannot override these
        scope: "BRANCH",
        applicableBranchIds: [branchId],
        targetCustomerIds: input.targetCustomerIds,
        newCustomersOnly: false,
        applicableVehicleCategoryIds: [],
        applicablePaymentPlans: [],
        allowPartialPayment: true,
        allowPostBooking: false,
        allowPostInvoice: false,  // never allowed for manager coupons
        stackable: false,          // never stackable
        priority: 0,
        totalUsageLimit: clampedUsageLimit,
        perUserLimit: 1,           // one use per customer — prevents abuse
        perBranchLimit: null,
        perDayLimit: null,
        startDate: now,
        endDate,
        isActive: true,
        createdById: actor.actorId,
      },
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: branchId,
      action: "MANAGER_CREATE_COUPON",
      category: AuditCategory.DISCOUNT,
      description: `Manager coupon "${code}" created. Reason: ${input.reason}`,
      entity: "DiscountRule",
      entityId: rule.publicId,
      entityLabel: rule.name,
      after: {
        code,
        discountType: input.discountType,
        value: input.value,
        usageLimit: clampedUsageLimit,
        validityDays: clampedValidityDays,
        targetCustomerIds: input.targetCustomerIds,
      },
    });

    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId,
      branchName: actor.branchName,
      actionType: StaffActionType.CREATED,
      entityType: StaffEntityType.DISCOUNT_RULE,
      entityRef: rule.publicId,
      description: `Manager coupon "${code}" created. Reason: ${input.reason}`,
      metadata: { code, discountType: input.discountType, value: input.value, reason: input.reason },
    });

    return rule;
  }

  async listRules(filters: {
    isActive?: boolean;
    scope?: DiscountScope;
    branchId?: number;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ rules: DiscountRuleWithMeta[]; total: number; page: number; pageSize: number }> {
    const { isActive, scope, branchId, search, page = 1, pageSize = 20 } = filters;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (isActive !== undefined) where.isActive = isActive;
    if (scope) where.scope = scope;
    if (branchId) {
      where.AND = [
        ...(where.AND ?? []),
        {
          OR: [
            { scope: "GLOBAL" },
            { applicableBranchIds: { has: branchId } },
          ],
        },
      ];
    }
    if (search) {
      where.AND = [
        ...(where.AND ?? []),
        {
          OR: [
            { code: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
          ],
        },
      ];
    }

    const [rules, total] = await Promise.all([
      prisma.discountRule.findMany({
        where,
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        skip,
        take: pageSize,
        include: {
          createdBy: { select: { name: true, publicId: true } },
          _count: { select: { usageLogs: true } },
        },
      }),
      prisma.discountRule.count({ where }),
    ]);

    return { rules, total, page, pageSize };
  }
}

export const discountRuleService = new DiscountRuleService();

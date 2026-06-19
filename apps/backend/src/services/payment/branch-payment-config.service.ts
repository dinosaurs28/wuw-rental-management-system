import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import type { BranchPaymentConfig, Role } from "@repo/database/client";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../staffActivity/staffActivity.service.js";

interface ActorContext {
  actorId: number;
  actorName: string;
  actorRole: Role;
  actorBranchId?: number;
  actorPublicId: string;
  branchName: string;
}

// Defaults returned when no config row exists — simple mode, strict payment.
const DEFAULT_CONFIG = {
  cashConfirmationEnabled: false,
  blockProgressionUntilConfirmed: true,
  maxCashPerEmployee: null,
  requireShiftSettlement: false,
  splitPaymentEnabled: false,
  crossBranchSettlementEnabled: false,
  refundApprovalRequired: true,
  onlineRefundEnabled: true,
  delayedCashAlertHours: 2,
  customerPaymentMode: 'ADVANCE_ONLY' as const,
} as const;

class BranchPaymentConfigService {
  async getConfig(branchId: number): Promise<BranchPaymentConfig | typeof DEFAULT_CONFIG & { branchId: number }> {
    const config = await prisma.branchPaymentConfig.findUnique({ where: { branchId } });
    if (!config) return { ...DEFAULT_CONFIG, branchId } as any;
    return config;
  }

  async upsertConfig(
    branchId: number,
    data: {
      cashConfirmationEnabled?: boolean;
      blockProgressionUntilConfirmed?: boolean;
      maxCashPerEmployee?: number | null;
      requireShiftSettlement?: boolean;
      splitPaymentEnabled?: boolean;
      crossBranchSettlementEnabled?: boolean;
      refundApprovalRequired?: boolean;
      onlineRefundEnabled?: boolean;
      delayedCashAlertHours?: number;
      customerPaymentMode?: 'ADVANCE_ONLY' | 'FULL_ONLY' | 'BOTH';
    },
    actor: ActorContext,
  ): Promise<BranchPaymentConfig> {
    const payload: any = { ...data };
    if (data.maxCashPerEmployee != null) {
      payload.maxCashPerEmployee = new Decimal(data.maxCashPerEmployee);
    } else if (data.maxCashPerEmployee === null) {
      payload.maxCashPerEmployee = null;
    }

    const config = await prisma.branchPaymentConfig.upsert({
      where: { branchId },
      create: { branchId, ...payload },
      update: payload,
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: branchId,
      action: "UPDATE_PAYMENT_CONFIG",
      category: AuditCategory.PAYMENT,
      description: `Branch payment config updated for branch ${branchId}`,
      entity: "BranchPaymentConfig",
      entityId: String(branchId),
      after: payload,
    });

    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId: actor.actorBranchId ?? branchId,
      branchName: actor.branchName,
      actionType: StaffActionType.UPDATED,
      entityType: StaffEntityType.PAYMENT,
      entityRef: String(branchId),
      description: `Payment config updated`,
      metadata: payload,
    });

    return config;
  }
}

export const branchPaymentConfigService = new BranchPaymentConfigService();

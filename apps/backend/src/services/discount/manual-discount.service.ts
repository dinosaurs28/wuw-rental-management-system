import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { createID } from "../../utils/nanoID.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../staffActivity/staffActivity.service.js";
import type { ManualDiscount, Role } from "@repo/database/client";

type ManualDiscountWithRelations = ManualDiscount & {
  issuedBy: { publicId: string; name: string; role: Role };
  approvedBy: { publicId: string; name: string; role: Role } | null;
  booking: { publicId: string; status: string };
};

interface ActorContext {
  actorId: number;
  actorName: string;
  actorRole: Role;
  actorBranchId: number;
  actorPublicId: string;
  branchName: string;
}

class ManualDiscountService {
  /**
   * Issue a manual discount for a booking.
   * If the amount >= branch managerApprovalThreshold, sets requiresApproval = true
   * and status = PENDING_APPROVAL, blocking booking finalization until approved.
   */
  async issue(
    bookingId: number,
    bookingPublicId: string,
    amount: number,
    reason: string,
    actor: ActorContext,
  ): Promise<ManualDiscount> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { branchId: true, status: true, manualDiscount: { select: { id: true } } },
    });
    if (!booking) throw new Error("Booking not found.");
    if (booking.status === "RETURNED" || booking.status === "CANCELLED") {
      throw new Error("Cannot apply a manual discount to a completed or cancelled booking.");
    }
    if (booking.manualDiscount) {
      throw new Error("A manual discount has already been issued for this booking.");
    }

    // Check per-employee daily limit
    const config = await prisma.branchDiscountConfig.findUnique({
      where: { branchId: actor.actorBranchId },
      select: { maxManualDiscountsPerEmployeePerDay: true, managerApprovalThreshold: true },
    });

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);

    const dailyCount = await prisma.manualDiscount.count({
      where: {
        issuedById: actor.actorId,
        createdAt: { gte: todayStart, lte: todayEnd },
      },
    });

    const dailyLimit = config?.maxManualDiscountsPerEmployeePerDay ?? 5;
    if (dailyCount >= dailyLimit) {
      throw new Error(`Daily manual discount limit (${dailyLimit}) reached for this employee.`);
    }

    const threshold = config?.managerApprovalThreshold
      ? new Decimal(config.managerApprovalThreshold.toString())
      : new Decimal(500);
    const requiresApproval = new Decimal(amount).gte(threshold);

    const discount = await prisma.manualDiscount.create({
      data: {
        publicId: createID(),
        bookingId,
        amount: new Decimal(amount),
        reason,
        issuedById: actor.actorId,
        requiresApproval,
        status: requiresApproval ? "PENDING_APPROVAL" : "APPROVED",
        approvedById: requiresApproval ? null : actor.actorId,
        approvedAt: requiresApproval ? null : new Date(),
      },
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: actor.actorBranchId,
      action: "ISSUE_MANUAL_DISCOUNT",
      category: AuditCategory.DISCOUNT,
      severity: requiresApproval ? "WARNING" : "INFO",
      description: `Manual discount of ₹${amount} issued for booking ${bookingPublicId}. Reason: ${reason}`,
      entity: "ManualDiscount",
      entityId: discount.publicId,
      entityLabel: bookingPublicId,
      after: { amount, reason, requiresApproval, status: discount.status },
    });

    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId: actor.actorBranchId,
      branchName: actor.branchName,
      actionType: StaffActionType.OVERRIDDEN,
      entityType: StaffEntityType.MANUAL_DISCOUNT,
      entityRef: discount.publicId,
      description: `Manual discount ₹${amount} issued for booking ${bookingPublicId}`,
      metadata: { requiresApproval, reason },
    });

    return discount;
  }

  /**
   * Approve a pending manual discount. Only MANAGER or ADMIN can approve.
   */
  async approve(publicId: string, actor: ActorContext): Promise<ManualDiscount> {
    const discount = await prisma.manualDiscount.findUnique({ where: { publicId } });
    if (!discount) throw new Error("Manual discount not found.");
    if (discount.status !== "PENDING_APPROVAL") {
      throw new Error("Only pending-approval discounts can be approved.");
    }

    const updated = await prisma.manualDiscount.update({
      where: { publicId },
      data: {
        status: "APPROVED",
        approvedById: actor.actorId,
        approvedAt: new Date(),
      },
    });

    const booking = await prisma.booking.findUnique({
      where: { id: discount.bookingId },
      select: { publicId: true },
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: actor.actorBranchId,
      action: "APPROVE_MANUAL_DISCOUNT",
      category: AuditCategory.DISCOUNT,
      description: `Manual discount approved for booking ${booking?.publicId ?? discount.bookingId}`,
      entity: "ManualDiscount",
      entityId: discount.publicId,
      before: { status: "PENDING_APPROVAL" },
      after: { status: "APPROVED", approvedById: actor.actorId },
    });

    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId: actor.actorBranchId,
      branchName: actor.branchName,
      actionType: StaffActionType.APPROVED,
      entityType: StaffEntityType.MANUAL_DISCOUNT,
      entityRef: discount.publicId,
      description: `Manual discount approved`,
    });

    return updated;
  }

  /**
   * Reject a pending manual discount.
   */
  async reject(publicId: string, rejectionReason: string, actor: ActorContext): Promise<ManualDiscount> {
    const discount = await prisma.manualDiscount.findUnique({ where: { publicId } });
    if (!discount) throw new Error("Manual discount not found.");
    if (discount.status !== "PENDING_APPROVAL") {
      throw new Error("Only pending-approval discounts can be rejected.");
    }

    const updated = await prisma.manualDiscount.update({
      where: { publicId },
      data: {
        status: "REJECTED",
        rejectionReason,
        rejectedAt: new Date(),
      },
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: actor.actorBranchId,
      action: "REJECT_MANUAL_DISCOUNT",
      category: AuditCategory.DISCOUNT,
      severity: "WARNING",
      description: `Manual discount rejected. Reason: ${rejectionReason}`,
      entity: "ManualDiscount",
      entityId: discount.publicId,
      before: { status: "PENDING_APPROVAL" },
      after: { status: "REJECTED", rejectionReason },
    });

    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId: actor.actorBranchId,
      branchName: actor.branchName,
      actionType: StaffActionType.REJECTED,
      entityType: StaffEntityType.MANUAL_DISCOUNT,
      entityRef: discount.publicId,
      description: `Manual discount rejected: ${rejectionReason}`,
    });

    return updated;
  }

  async getByPublicId(publicId: string): Promise<ManualDiscountWithRelations | null> {
    return prisma.manualDiscount.findUnique({
      where: { publicId },
      include: {
        issuedBy: { select: { publicId: true, name: true, role: true } },
        approvedBy: { select: { publicId: true, name: true, role: true } },
        booking: { select: { publicId: true, status: true } },
      },
    });
  }

  async listPendingForBranch(branchId: number): Promise<
    (ManualDiscount & {
      issuedBy: { publicId: string; name: string };
      booking: { publicId: string; status: string };
    })[]
  > {
    return prisma.manualDiscount.findMany({
      where: {
        status: "PENDING_APPROVAL",
        booking: { branchId },
      },
      include: {
        issuedBy: { select: { publicId: true, name: true } },
        booking: { select: { publicId: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}

export const manualDiscountService = new ManualDiscountService();

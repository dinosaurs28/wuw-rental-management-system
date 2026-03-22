import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { createID } from "../../utils/nanoID.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../staffActivity/staffActivity.service.js";
import type { RefundRequest, PaymentMethod, Role } from "@repo/database/client";

interface ActorContext {
  actorId: number;
  actorName: string;
  actorRole: Role;
  actorBranchId: number;
  actorPublicId: string;
  branchName: string;
}

const ZERO = new Decimal(0);

class RefundService {
  async request(
    bookingPublicId: string,
    amount: number,
    reason: string,
    method: PaymentMethod,
    actor: ActorContext,
  ): Promise<RefundRequest> {
    const booking = await prisma.booking.findUnique({
      where: { publicId: bookingPublicId },
      select: { id: true, branchId: true, status: true, publicId: true },
    });
    if (!booking) throw new Error("Booking not found.");

    const config = await prisma.branchPaymentConfig.findUnique({
      where: { branchId: booking.branchId },
      select: { refundApprovalRequired: true, onlineRefundEnabled: true },
    });

    if (method === "ONLINE" && config?.onlineRefundEnabled === false) {
      throw new Error("Online refunds are not enabled for this branch.");
    }

    // Validate refundable amount: cannot exceed total confirmed payments
    const confirmedAgg = await prisma.paymentTransaction.aggregate({
      where: { bookingId: booking.id, status: "CONFIRMED" },
      _sum: { totalAmount: true },
    });
    const alreadyRefundedAgg = await prisma.refundRequest.aggregate({
      where: {
        bookingId: booking.id,
        status: { in: ["APPROVED", "COMPLETED"] },
      },
      _sum: { amount: true },
    });

    const totalConfirmed = new Decimal((confirmedAgg._sum.totalAmount ?? ZERO).toString());
    const alreadyRefunded = new Decimal((alreadyRefundedAgg._sum.amount ?? ZERO).toString());
    const refundable = totalConfirmed.sub(alreadyRefunded);
    const refundAmount = new Decimal(amount);

    if (refundAmount.gt(refundable)) {
      throw new Error(
        `Refund of ₹${refundAmount.toFixed(2)} exceeds the refundable amount of ₹${refundable.toFixed(2)}.`,
      );
    }

    // Online refunds with approval disabled auto-approve
    const needsApproval = method === "CASH" ? (config?.refundApprovalRequired ?? true) : false;

    const refund = await prisma.refundRequest.create({
      data: {
        publicId: createID(),
        bookingId: booking.id,
        branchId: booking.branchId,
        amount: refundAmount,
        reason,
        method,
        status: needsApproval ? "PENDING_APPROVAL" : "APPROVED",
        requestedById: actor.actorId,
        approvedById: needsApproval ? null : actor.actorId,
        approvedAt: needsApproval ? null : new Date(),
      },
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: booking.branchId,
      action: "REQUEST_REFUND",
      category: AuditCategory.PAYMENT,
      severity: "WARNING",
      description: `Refund of ₹${refundAmount.toFixed(2)} requested for booking ${booking.publicId} via ${method}. Reason: ${reason}`,
      entity: "RefundRequest",
      entityId: refund.publicId,
      after: { amount, method, status: refund.status },
    });

    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId: booking.branchId,
      branchName: actor.branchName,
      actionType: StaffActionType.INITIATED,
      entityType: StaffEntityType.REFUND_REQUEST,
      entityRef: refund.publicId,
      description: `Refund ₹${refundAmount.toFixed(2)} requested for booking ${booking.publicId}`,
      metadata: { method, reason },
    });

    return refund;
  }

  async approve(publicId: string, actor: ActorContext): Promise<RefundRequest> {
    const refund = await prisma.refundRequest.findUnique({ where: { publicId } });
    if (!refund) throw new Error("Refund request not found.");
    if (refund.status !== "PENDING_APPROVAL") {
      throw new Error(`Cannot approve refund in ${refund.status} state.`);
    }
    if (actor.actorRole !== "MANAGER" && actor.actorRole !== "ADMIN") {
      throw new Error("Only MANAGER or ADMIN can approve refunds.");
    }

    const updated = await prisma.refundRequest.update({
      where: { publicId },
      data: { status: "APPROVED", approvedById: actor.actorId, approvedAt: new Date() },
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: refund.branchId,
      action: "APPROVE_REFUND",
      category: AuditCategory.PAYMENT,
      description: `Refund ₹${refund.amount} approved`,
      entity: "RefundRequest",
      entityId: refund.publicId,
      before: { status: "PENDING_APPROVAL" },
      after: { status: "APPROVED" },
    });

    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId: refund.branchId,
      branchName: actor.branchName,
      actionType: StaffActionType.APPROVED,
      entityType: StaffEntityType.REFUND_REQUEST,
      entityRef: refund.publicId,
      description: `Refund ₹${refund.amount} approved`,
    });

    return updated;
  }

  async complete(publicId: string, onlineTransactionRef: string | undefined, actor: ActorContext): Promise<RefundRequest> {
    const refund = await prisma.refundRequest.findUnique({ where: { publicId } });
    if (!refund) throw new Error("Refund request not found.");
    if (refund.status !== "APPROVED") {
      throw new Error(`Cannot complete refund in ${refund.status} state. Approve it first.`);
    }

    const updated = await prisma.refundRequest.update({
      where: { publicId },
      data: {
        status: "COMPLETED",
        completedById: actor.actorId,
        completedAt: new Date(),
        onlineTransactionRef: onlineTransactionRef ?? null,
      },
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: refund.branchId,
      action: "COMPLETE_REFUND",
      category: AuditCategory.PAYMENT,
      description: `Refund ₹${refund.amount} disbursed via ${refund.method}`,
      entity: "RefundRequest",
      entityId: refund.publicId,
      before: { status: "APPROVED" },
      after: { status: "COMPLETED", onlineTransactionRef },
    });

    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId: refund.branchId,
      branchName: actor.branchName,
      actionType: StaffActionType.DISBURSED,
      entityType: StaffEntityType.REFUND_REQUEST,
      entityRef: refund.publicId,
      description: `Refund ₹${refund.amount} completed`,
    });

    return updated;
  }

  async reject(publicId: string, rejectionReason: string, actor: ActorContext): Promise<RefundRequest> {
    const refund = await prisma.refundRequest.findUnique({ where: { publicId } });
    if (!refund) throw new Error("Refund request not found.");
    if (refund.status !== "PENDING_APPROVAL") {
      throw new Error(`Cannot reject refund in ${refund.status} state.`);
    }
    if (actor.actorRole !== "MANAGER" && actor.actorRole !== "ADMIN") {
      throw new Error("Only MANAGER or ADMIN can reject refunds.");
    }

    const updated = await prisma.refundRequest.update({
      where: { publicId },
      data: { status: "REJECTED", rejectionReason, rejectedAt: new Date() },
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: refund.branchId,
      action: "REJECT_REFUND",
      category: AuditCategory.PAYMENT,
      severity: "WARNING",
      description: `Refund ₹${refund.amount} rejected. Reason: ${rejectionReason}`,
      entity: "RefundRequest",
      entityId: refund.publicId,
    });

    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId: refund.branchId,
      branchName: actor.branchName,
      actionType: StaffActionType.REJECTED,
      entityType: StaffEntityType.REFUND_REQUEST,
      entityRef: refund.publicId,
      description: `Refund ₹${refund.amount} rejected: ${rejectionReason}`,
    });

    return updated;
  }

  async getByPublicId(publicId: string): Promise<RefundRequest | null> {
    return prisma.refundRequest.findUnique({
      where: { publicId },
      include: {
        requestedBy: { select: { publicId: true, name: true, role: true } },
        approvedBy: { select: { publicId: true, name: true, role: true } },
        completedBy: { select: { publicId: true, name: true, role: true } },
        booking: { select: { publicId: true, status: true } },
      },
    }) as Promise<RefundRequest | null>;
  }

  async listPendingForBranch(branchId: number): Promise<RefundRequest[]> {
    return prisma.refundRequest.findMany({
      where: { branchId, status: "PENDING_APPROVAL" },
      include: {
        requestedBy: { select: { publicId: true, name: true } },
        booking: { select: { publicId: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    }) as Promise<RefundRequest[]>;
  }
}

export const refundService = new RefundService();

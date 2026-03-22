import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { createID } from "../../utils/nanoID.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../staffActivity/staffActivity.service.js";
import { fraudDetectionService } from "./fraud-detection.service.js";
import type {
  PaymentTransaction,
  PaymentPurpose,
  PaymentMethod,
  PaymentTransactionStatus,
  Role,
} from "@repo/database/client";

export interface RecordPaymentInput {
  bookingPublicId: string;
  purpose: PaymentPurpose;
  method: PaymentMethod;
  totalAmount: number;
  cashAmount?: number;
  onlineAmount?: number;
  onlineTransactionRef?: string;
  onlineGateway?: string;
  idempotencyKey: string;
  notes?: string;
}

interface ActorContext {
  actorId: number;
  actorName: string;
  actorRole: Role;
  actorBranchId: number;
  actorPublicId: string;
  branchName: string;
}

export interface PaginatedTransactions {
  transactions: PaymentTransaction[];
  total: number;
  page: number;
  pageSize: number;
}

const ZERO = new Decimal(0);

class PaymentTransactionService {
  /**
   * Record a new payment transaction. Determines initial status based on
   * payment method and branch config. Links to active cash shift if any.
   */
  async record(input: RecordPaymentInput, actor: ActorContext): Promise<PaymentTransaction> {
    // Resolve booking by publicId
    const booking = await prisma.booking.findUnique({
      where: { publicId: input.bookingPublicId },
      select: { id: true, branchId: true, publicId: true, status: true },
    });
    if (!booking) throw new Error("Booking not found.");

    const bookingId = booking.id;
    const branchId = booking.branchId;
    const totalAmount = new Decimal(input.totalAmount);
    const cashAmount = new Decimal(input.cashAmount ?? 0);
    const onlineAmount = new Decimal(input.onlineAmount ?? 0);

    // Idempotency: return existing transaction if key already used
    const existing = await prisma.paymentTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return existing;

    // Load branch payment config
    const config = await prisma.branchPaymentConfig.findUnique({
      where: { branchId },
      select: {
        cashConfirmationEnabled: true,
        splitPaymentEnabled: true,
        maxCashPerEmployee: true,
      },
    });

    // Guard: SPLIT requires explicit enablement
    if (input.method === "SPLIT" && !config?.splitPaymentEnabled) {
      throw new Error("Split payments are not enabled for this branch.");
    }

    // Fraud checks
    await fraudDetectionService.checkExcessPayment(bookingId, totalAmount);
    if (cashAmount.gt(ZERO)) {
      await fraudDetectionService.checkEmployeeCashLimit(actor.actorId, branchId, cashAmount);
    }

    // Determine initial status
    // Online payments always confirm immediately.
    // Cash in simple mode (cashConfirmationEnabled=false) also confirms immediately.
    // Cash in control mode goes to COLLECTED (awaiting manager confirmation).
    let status: PaymentTransactionStatus;
    if (input.method === "ONLINE") {
      status = "CONFIRMED";
    } else if (input.method === "CASH") {
      status = config?.cashConfirmationEnabled ? "COLLECTED" : "CONFIRMED";
    } else {
      // SPLIT — online portion goes through but cash portion needs confirmation
      status = config?.cashConfirmationEnabled ? "COLLECTED" : "CONFIRMED";
    }

    const now = new Date();

    // Link to active cash shift for cash/split methods
    let cashShiftId: number | null = null;
    if (input.method !== "ONLINE" && cashAmount.gt(ZERO)) {
      const activeShift = await prisma.cashShift.findFirst({
        where: { employeeId: actor.actorId, status: "OPEN" },
        select: { id: true },
      });
      cashShiftId = activeShift?.id ?? null;
    }

    const txn = await prisma.paymentTransaction.create({
      data: {
        publicId: createID(),
        idempotencyKey: input.idempotencyKey,
        bookingId,
        branchId,
        purpose: input.purpose,
        method: input.method,
        status,
        totalAmount,
        cashAmount,
        onlineAmount,
        onlineTransactionRef: input.onlineTransactionRef ?? null,
        onlineGateway: input.onlineGateway ?? null,
        collectedById: input.method !== "ONLINE" ? actor.actorId : null,
        collectedAt: input.method !== "ONLINE" ? now : null,
        confirmedById: status === "CONFIRMED" ? actor.actorId : null,
        confirmedAt: status === "CONFIRMED" ? now : null,
        cashShiftId,
        notes: input.notes ?? null,
      },
    });

    // If immediately confirmed and has cash, update shift expectedTotal
    if (status === "CONFIRMED" && cashAmount.gt(ZERO) && cashShiftId) {
      await prisma.cashShift.update({
        where: { id: cashShiftId },
        data: { expectedTotal: { increment: cashAmount.toNumber() } },
      });
    }

    const actionType = status === "COLLECTED" ? StaffActionType.COLLECTED : StaffActionType.CONFIRMED;

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: branchId,
      action: "RECORD_PAYMENT",
      category: AuditCategory.PAYMENT,
      description: `Payment of ₹${totalAmount.toFixed(2)} recorded for booking ${booking.publicId} [${input.purpose}] via ${input.method} — status: ${status}`,
      entity: "PaymentTransaction",
      entityId: txn.publicId,
      entityLabel: booking.publicId,
      after: { purpose: input.purpose, method: input.method, amount: totalAmount.toFixed(2), status },
    });

    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId,
      branchName: actor.branchName,
      actionType,
      entityType: StaffEntityType.PAYMENT_TRANSACTION,
      entityRef: txn.publicId,
      description: `Payment ₹${totalAmount.toFixed(2)} [${input.purpose}] ${status === "COLLECTED" ? "collected, awaiting confirmation" : "confirmed"}`,
      metadata: { method: input.method, purpose: input.purpose, amount: totalAmount.toFixed(2) },
    });

    return txn;
  }

  /**
   * Manager confirms a COLLECTED cash transaction after physical verification.
   */
  async confirmCash(publicId: string, notes: string | undefined, actor: ActorContext): Promise<PaymentTransaction> {
    const txn = await prisma.paymentTransaction.findUnique({ where: { publicId } });
    if (!txn) throw new Error("Payment transaction not found.");
    if (txn.status !== "COLLECTED") {
      throw new Error(`Cannot confirm: transaction is in ${txn.status} state. Only COLLECTED transactions can be confirmed.`);
    }
    if (actor.actorRole !== "MANAGER" && actor.actorRole !== "ADMIN") {
      throw new Error("Only MANAGER or ADMIN can confirm cash payments.");
    }

    const confirmed = await prisma.paymentTransaction.update({
      where: { publicId },
      data: {
        status: "CONFIRMED",
        confirmedById: actor.actorId,
        confirmedAt: new Date(),
        notes: notes ?? txn.notes,
      },
    });

    // Update shift expected total
    if (txn.cashShiftId) {
      await prisma.cashShift.update({
        where: { id: txn.cashShiftId },
        data: { expectedTotal: { increment: new Decimal(txn.cashAmount.toString()).toNumber() } },
      });
    }

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: txn.branchId,
      action: "CONFIRM_CASH_PAYMENT",
      category: AuditCategory.PAYMENT,
      description: `Cash payment ₹${txn.totalAmount} confirmed for booking ID ${txn.bookingId}`,
      entity: "PaymentTransaction",
      entityId: txn.publicId,
      before: { status: "COLLECTED" },
      after: { status: "CONFIRMED", confirmedById: actor.actorId },
    });

    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId: txn.branchId,
      branchName: actor.branchName,
      actionType: StaffActionType.CONFIRMED,
      entityType: StaffEntityType.PAYMENT_TRANSACTION,
      entityRef: txn.publicId,
      description: `Cash payment ₹${txn.totalAmount} confirmed`,
    });

    return confirmed;
  }

  /**
   * Manager rejects a COLLECTED cash transaction (e.g. cash not physically present).
   */
  async rejectCash(publicId: string, rejectionReason: string, actor: ActorContext): Promise<PaymentTransaction> {
    const txn = await prisma.paymentTransaction.findUnique({ where: { publicId } });
    if (!txn) throw new Error("Payment transaction not found.");
    if (txn.status !== "COLLECTED") {
      throw new Error(`Cannot reject: transaction is in ${txn.status} state.`);
    }
    if (actor.actorRole !== "MANAGER" && actor.actorRole !== "ADMIN") {
      throw new Error("Only MANAGER or ADMIN can reject cash payments.");
    }

    const rejected = await prisma.paymentTransaction.update({
      where: { publicId },
      data: {
        status: "REJECTED",
        rejectedById: actor.actorId,
        rejectedAt: new Date(),
        rejectionReason,
      },
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: txn.branchId,
      action: "REJECT_CASH_PAYMENT",
      category: AuditCategory.PAYMENT,
      severity: "WARNING",
      description: `Cash payment ₹${txn.totalAmount} rejected. Reason: ${rejectionReason}`,
      entity: "PaymentTransaction",
      entityId: txn.publicId,
      before: { status: "COLLECTED" },
      after: { status: "REJECTED", rejectionReason },
    });

    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId: txn.branchId,
      branchName: actor.branchName,
      actionType: StaffActionType.REJECTED,
      entityType: StaffEntityType.PAYMENT_TRANSACTION,
      entityRef: txn.publicId,
      description: `Cash payment ₹${txn.totalAmount} rejected: ${rejectionReason}`,
    });

    return rejected;
  }

  async getByPublicId(publicId: string): Promise<PaymentTransaction | null> {
    return prisma.paymentTransaction.findUnique({
      where: { publicId },
      include: {
        collectedBy: { select: { publicId: true, name: true, role: true } },
        confirmedBy: { select: { publicId: true, name: true, role: true } },
        rejectedBy: { select: { publicId: true, name: true, role: true } },
      },
    }) as Promise<PaymentTransaction | null>;
  }

  async listForBooking(bookingId: number): Promise<PaymentTransaction[]> {
    return prisma.paymentTransaction.findMany({
      where: { bookingId },
      orderBy: { createdAt: "asc" },
    });
  }

  async listPendingCashForBranch(
    branchId: number,
    filters: { employeePublicId?: string; page?: number; pageSize?: number },
  ): Promise<PaginatedTransactions> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: any = { branchId, status: "COLLECTED" };
    if (filters.employeePublicId) {
      where.collectedBy = { publicId: filters.employeePublicId };
    }

    const [transactions, total] = await Promise.all([
      prisma.paymentTransaction.findMany({
        where,
        include: {
          booking: { select: { publicId: true, status: true } },
          collectedBy: { select: { publicId: true, name: true } },
        },
        orderBy: { collectedAt: "asc" },
        skip,
        take: pageSize,
      }),
      prisma.paymentTransaction.count({ where }),
    ]);

    return { transactions: transactions as PaymentTransaction[], total, page, pageSize };
  }
}

export const paymentTransactionService = new PaymentTransactionService();

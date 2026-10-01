import { prisma, PaymentPurpose, ExtensionStatus } from "@repo/database/client";
import type {
  PaymentTransaction,
  PaymentMethod,
  PaymentTransactionStatus,
  Role,
} from "@repo/database/client";
import Decimal from "decimal.js";
import { createID } from "../../utils/nanoID.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../staffActivity/staffActivity.service.js";
import { fraudDetectionService } from "./fraud-detection.service.js";
import { notifyEvents } from "../notification/notification.events.js";
import { assertOpenShift, claimUtr, normalizeUtr } from "./counter-guard.service.js";
import { redis } from "../../lib/redisconfig.js";
import { invalidateVehicleAvailability } from "../../utils/cache/vehicleCacheKeys.js";
import { refreshInvoiceTotals } from "../invoice-totals.service.js";
import { syncLegacyReturnInvoice } from "../invoice-finalization.service.js";
import { refreshBookingPeriodFields } from "../../utils/booking/rentalPeriod.js";

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

/** A manager acting on another branch's payment (cash confirm / reject). */
export class PaymentTransactionBranchError extends Error {
  readonly code = "TRANSACTION_OTHER_BRANCH";
  readonly status = 403;
}

/**
 * Cash confirm / reject are branch-scoped for managers: another branch's
 * COLLECTED cash sits in that branch's open shift drawer.
 */
function assertSameBranch(
  txn: { branchId: number },
  actor: ActorContext,
  action: "confirm" | "reject",
): void {
  if (actor.actorRole === "MANAGER" && txn.branchId !== actor.actorBranchId) {
    throw new PaymentTransactionBranchError(
      `This payment belongs to another branch — only that branch's manager can ${action} it.`,
    );
  }
}

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

    // Counter money needs the staff member's open cash shift
    await assertOpenShift({ id: actor.actorId, role: actor.actorRole });

    // Online part: a UPI transfer (gateway unset or "UPI") is recorded by its
    // 12-digit UTR; other gateways keep their own reference. Either way one
    // reference can back only one live payment (claimed in the insert below).
    let onlineRef: string | null = null;
    let onlineGateway: string | null = input.onlineGateway?.trim() || null;
    if (onlineAmount.gt(ZERO) || input.method === "ONLINE") {
      const isUpi = !onlineGateway || onlineGateway.toUpperCase() === "UPI";
      if (isUpi) {
        onlineRef = normalizeUtr(input.onlineTransactionRef);
        onlineGateway = "UPI";
      } else {
        onlineRef = input.onlineTransactionRef?.trim() || null;
        if (!onlineRef) throw new Error("Transaction reference is required for online payments.");
      }
    }

    // Fraud checks
    await fraudDetectionService.checkExcessPayment(bookingId, totalAmount, input.purpose);
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

    // Link to the active cash shift: cash/split for the drawer, UPI (UTR) for
    // the shift's UPI-collected figure
    let cashShiftId: number | null = null;
    if ((input.method !== "ONLINE" && cashAmount.gt(ZERO)) || (onlineRef && onlineGateway === "UPI")) {
      const activeShift = await prisma.cashShift.findFirst({
        where: { employeeId: actor.actorId, status: "OPEN" },
        select: { id: true },
      });
      cashShiftId = activeShift?.id ?? null;
    }

    const txn = await prisma.$transaction(async (tx) => {
      if (onlineRef) await claimUtr(onlineRef, tx);
      return tx.paymentTransaction.create({
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
          onlineTransactionRef: onlineRef,
          onlineGateway: onlineRef ? onlineGateway : null,
          collectedById: input.method !== "ONLINE" ? actor.actorId : null,
          collectedAt: input.method !== "ONLINE" ? now : null,
          confirmedById: status === "CONFIRMED" ? actor.actorId : null,
          confirmedAt: status === "CONFIRMED" ? now : null,
          cashShiftId,
          notes: input.notes ?? null,
        },
      });
    });

    // No shift counter to bump: a shift's expected drawer is computed from its
    // linked transactions (and snapshotted at close).

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
    if (actor.actorRole !== "MANAGER" && actor.actorRole !== "ADMIN") {
      throw new Error("Only MANAGER or ADMIN can confirm cash payments.");
    }
    assertSameBranch(txn, actor, "confirm");
    if (txn.status !== "COLLECTED") {
      throw new Error(`Cannot confirm: transaction is in ${txn.status} state. Only COLLECTED transactions can be confirmed.`);
    }

    // Conditional flips, all in one transaction: two managers (or a retried
    // request) racing past the COLLECTED check confirm — and finalize the
    // linked extension, raising totalFinal / extensionCount — only once.
    const linkedExtension = await prisma.$transaction(async (tx) => {
      const { count } = await tx.paymentTransaction.updateMany({
        where: { id: txn.id, status: "COLLECTED" },
        data: {
          status: "CONFIRMED",
          confirmedById: actor.actorId,
          confirmedAt: new Date(),
          notes: notes ?? txn.notes,
        },
      });
      if (count === 0) {
        throw new Error("Cannot confirm: this payment was already confirmed or rejected.");
      }

      // Extension finalization hook: if this cash payment was for an extension,
      // finalize the booking date update now that cash is confirmed.
      if (txn.purpose !== PaymentPurpose.EXTENSION) return null;
      const ext = await tx.bookingExtension.findFirst({
        where: { paymentTransactionId: txn.id, extensionStatus: ExtensionStatus.PAYMENT_COLLECTED },
      });
      if (!ext) return null;
      const flipped = await tx.bookingExtension.updateMany({
        where: { id: ext.id, extensionStatus: ExtensionStatus.PAYMENT_COLLECTED },
        data: {
          extensionStatus: ExtensionStatus.CONFIRMED,
          actualNewEndAt: ext.requestedEndAt,
        },
      });
      if (flipped.count === 0) return null;

      const current = await tx.booking.findUniqueOrThrow({
        where: { id: ext.bookingId },
        select: { extensionCount: true },
      });
      await tx.booking.update({
        where: { id: ext.bookingId },
        data: {
          endAt: ext.requestedEndAt,
          extensionCount: { increment: 1 },
          lastExtendedAt: new Date(),
          totalFinal: { increment: ext.additionalAmount },
          activeExtensionId: null,
          ...(current.extensionCount === 0 ? { originalEndAt: ext.oldEndAt } : {}),
        },
      });
      // days / rentalPeriodType / hours follow the extended end (#5/#17)
      await refreshBookingPeriodFields(ext.bookingId, tx);
      return ext;
    });

    const confirmed = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: txn.id } });

    // Confirmation is verification only: the cash already counted in its
    // shift's drawer when it was COLLECTED, and a closed shift's snapshot
    // never changes.

    if (linkedExtension) {
      const effectiveEndAt = linkedExtension.requestedEndAt;
      await auditService.log({
        actorId: actor.actorId,
        actorName: actor.actorName,
        actorRole: actor.actorRole,
        actorBranchId: txn.branchId,
        action: "Extension finalized after cash confirmation",
        category: AuditCategory.BOOKING,
        description: `Extension ${linkedExtension.publicId} confirmed. Booking extended to ${effectiveEndAt.toISOString()}`,
        entity: "BookingExtension",
        entityId: linkedExtension.publicId,
        before: { extensionStatus: "PAYMENT_COLLECTED" },
        after: { extensionStatus: "CONFIRMED", actualNewEndAt: effectiveEndAt },
      });

      // The confirmed extension (taxable + GST) and the new return time belong
      // on the invoice — a fresh PDF even when the totals did not move
      refreshInvoiceTotals(linkedExtension.bookingId, { forceRegenerate: true }).catch((err) =>
        console.error("[confirmCash] Invoice refresh error:", err),
      );

      void notifyEvents.extensionConfirmed({ extensionId: linkedExtension.id, actorUserId: actor.actorId });
    } else {
      // A legacy drop's settlement cash: the invoice turns PAID once the
      // manager's settlement shows nothing owed (no-op for other bookings)
      const booking = await prisma.booking.findUnique({ where: { id: txn.bookingId }, select: { status: true } });
      if (booking?.status === "RETURNED") {
        syncLegacyReturnInvoice(txn.bookingId).catch((err) =>
          console.error("[confirmCash] Invoice sync error:", err),
        );
      }
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

    if (txn.collectedById) {
      void notifyEvents.approvalResolved({
        kind: "CASH_PAYMENT",
        entity: "PaymentTransaction",
        entityPublicId: txn.publicId,
        branchId: txn.branchId,
        approved: true,
        recipientUserId: txn.collectedById,
        bookingId: txn.bookingId,
        amount: txn.totalAmount,
        actorUserId: actor.actorId,
      });
    }

    return confirmed;
  }

  /**
   * Manager rejects a COLLECTED cash transaction (e.g. cash not physically present).
   */
  async rejectCash(publicId: string, rejectionReason: string, actor: ActorContext): Promise<PaymentTransaction> {
    const txn = await prisma.paymentTransaction.findUnique({ where: { publicId } });
    if (!txn) throw new Error("Payment transaction not found.");
    if (actor.actorRole !== "MANAGER" && actor.actorRole !== "ADMIN") {
      throw new Error("Only MANAGER or ADMIN can reject cash payments.");
    }
    assertSameBranch(txn, actor, "reject");
    if (txn.status !== "COLLECTED") {
      throw new Error(`Cannot reject: transaction is in ${txn.status} state.`);
    }

    // Conditional flips in one transaction, so a concurrent confirm/reject of
    // the same payment can't both win (see confirmCash).
    const linkedExtension = await prisma.$transaction(async (tx) => {
      const { count } = await tx.paymentTransaction.updateMany({
        where: { id: txn.id, status: "COLLECTED" },
        data: {
          status: "REJECTED",
          rejectedById: actor.actorId,
          rejectedAt: new Date(),
          rejectionReason,
        },
      });
      if (count === 0) {
        throw new Error("Cannot reject: this payment was already confirmed or rejected.");
      }

      // A rejected extension payment means the extension was never paid for:
      // reject it and release the vehicle hold that commit placed.
      if (txn.purpose !== PaymentPurpose.EXTENSION) return null;
      const ext = await tx.bookingExtension.findFirst({
        where: { paymentTransactionId: txn.id, extensionStatus: ExtensionStatus.PAYMENT_COLLECTED },
        select: {
          id: true,
          bookingId: true,
          oldEndAt: true,
          booking: { select: { activeExtensionId: true, items: { select: { vehicleId: true } } } },
        },
      });
      if (!ext) return null;
      const flipped = await tx.bookingExtension.updateMany({
        where: { id: ext.id, extensionStatus: ExtensionStatus.PAYMENT_COLLECTED },
        data: { extensionStatus: ExtensionStatus.REJECTED, rejectionReason },
      });
      if (flipped.count === 0) return null;
      if (ext.booking.activeExtensionId === ext.id) {
        await tx.booking.update({
          where: { id: ext.bookingId },
          data: { activeExtensionId: null, endAt: ext.oldEndAt },
        });
      }
      return ext;
    });

    const rejected = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: txn.id } });

    if (linkedExtension) {
      try {
        await invalidateVehicleAvailability(
          redis,
          linkedExtension.booking.items.map((i) => i.vehicleId),
        );
      } catch {
        // non-fatal
      }

      void notifyEvents.extensionRejected({ extensionId: linkedExtension.id, actorUserId: actor.actorId });
    }

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

    if (txn.collectedById) {
      void notifyEvents.approvalResolved({
        kind: "CASH_PAYMENT",
        entity: "PaymentTransaction",
        entityPublicId: txn.publicId,
        branchId: txn.branchId,
        approved: false,
        recipientUserId: txn.collectedById,
        bookingId: txn.bookingId,
        amount: txn.totalAmount,
        reason: rejectionReason,
        actorUserId: actor.actorId,
      });
    }

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

  async listAllForBranch(
    branchId: number,
    filters: { status?: string; page?: number; pageSize?: number },
  ): Promise<PaginatedTransactions> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: any = { branchId };
    if (filters.status) {
      where.status = filters.status;
    }

    const [transactions, total] = await Promise.all([
      prisma.paymentTransaction.findMany({
        where,
        include: {
          booking: {
            select: {
              publicId: true,
              status: true,
              customer: {
                select: { user: { select: { name: true } } },
              },
            },
          },
          collectedBy: { select: { publicId: true, name: true } },
          confirmedBy: { select: { publicId: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.paymentTransaction.count({ where }),
    ]);

    const mapped = (transactions as any[]).map((t) => ({
      transactionPublicId: t.publicId,
      bookingPublicId: t.booking.publicId,
      customerName: t.booking.customer?.user?.name ?? "Unknown",
      amount: t.totalAmount.toString(),
      method: t.method,
      purpose: t.purpose,
      status: t.status,
      onlineTransactionRef: t.onlineTransactionRef ?? null,
      employeeName: t.collectedBy?.name ?? null,
      confirmedByName: t.confirmedBy?.name ?? null,
      collectedAt: t.collectedAt?.toISOString() ?? t.createdAt.toISOString(),
      confirmedAt: t.confirmedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    }));

    return { transactions: mapped as any, total, page, pageSize };
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
          booking: {
            select: {
              publicId: true,
              status: true,
              customer: {
                select: {
                  user: { select: { name: true } },
                },
              },
            },
          },
          collectedBy: { select: { publicId: true, name: true } },
        },
        orderBy: { collectedAt: "asc" },
        skip,
        take: pageSize,
      }),
      prisma.paymentTransaction.count({ where }),
    ]);

    // Map to PendingCashItem format expected by frontend
    const mapped = (transactions as any[]).map((t) => ({
      transactionPublicId: t.publicId,
      bookingPublicId: t.booking.publicId,
      customerName: t.booking.customer.user.name,
      amount: t.totalAmount.toString(),
      employeeName: t.collectedBy?.name ?? "Unknown",
      collectedAt: t.collectedAt?.toISOString() ?? t.createdAt.toISOString(),
      purpose: t.purpose,
    }));

    return { transactions: mapped as any, total, page, pageSize };
  }
}

export const paymentTransactionService = new PaymentTransactionService();

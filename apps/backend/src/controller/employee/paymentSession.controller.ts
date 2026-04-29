/**
 * Payment Session controllers — session-driven ledger-based financial flow.
 *
 * Endpoints:
 *   GET  /employee/sessions/:sessionPublicId
 *   GET  /employee/bookings/:bookingId/active-session
 *   POST /employee/sessions/:sessionPublicId/add-deposit
 *   POST /employee/sessions/:sessionPublicId/record-payment
 *   POST /employee/sessions/:sessionPublicId/record-refund
 */
import { Request, Response } from "express";
import { z } from "zod";
import Decimal from "decimal.js";
import {
  prisma,
  BookingStatus,
  LedgerEntryType,
  LedgerEntryClassification,
  PaymentPurpose,
  PaymentSessionStatus,
  PaymentSessionType,
  ExtensionStatus,
  VehicleStatus,
} from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { paymentSessionService } from "../../services/payment/paymentSession.service.js";
import { ledgerService } from "../../services/payment/ledger.service.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";
import { createID } from "../../utils/nanoID.js";
import { redis } from "../../lib/redisconfig.js";
import { invalidateVehicleAvailability } from "../../utils/cache/vehicleCacheKeys.js";
import { finalizeInvoice } from "../../services/invoice-finalization.service.js";

// ── Schemas ──────────────────────────────────────────────────────────────────

const addDepositSchema = z.object({
  amount: z.coerce.number().positive(),
  reason: z.string().min(1).max(500),
  idempotencyKey: z.string().min(1),
});

const recordPaymentSchema = z.object({
  method: z.enum(["CASH", "ONLINE"]),
  amount: z.coerce.number().min(0),
  idempotencyKey: z.string().min(1),
  notes: z.string().optional(),
  onlineTransactionRef: z.string().optional(),
  onlineGateway: z.string().optional(),
}).refine(
  (d) => d.method !== "ONLINE" || !!d.onlineTransactionRef?.trim(),
  { message: "Transaction reference is required for online payments", path: ["onlineTransactionRef"] },
);

const recordRefundSchema = z.object({
  method: z.enum(["CASH", "ONLINE"]),
  amount: z.coerce.number().positive(),
  idempotencyKey: z.string().min(1),
  notes: z.string().optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveActor(req: Request) {
  const user = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true, branchId: true },
  });
  if (!user) throw new Error("Actor not found");
  return user;
}

async function resolveSession(sessionPublicId: string, branchId: number) {
  const session = await prisma.paymentSession.findUnique({
    where: { publicId: sessionPublicId },
    include: {
      entries: { where: { isVoided: false }, orderBy: { createdAt: "asc" } },
      booking: { select: { publicId: true, status: true, branchId: true } },
    },
  });
  if (!session) throw Object.assign(new Error("Session not found"), { status: 404 });
  if (session.branchId !== branchId) {
    throw Object.assign(new Error("Access denied"), { status: 403 });
  }
  return session;
}

// ── GET /sessions/:sessionPublicId ────────────────────────────────────────────

export const GetPaymentSession = async (req: Request, res: Response) => {
  try {
    const actor = await resolveActor(req);
    const session = await resolveSession(req.params.sessionPublicId!, actor.branchId!);

    return res.status(StatusCode.OK).json({
      message: "Session fetched",
      data: serializeSession(session),
    });
  } catch (err: any) {
    return res.status(err.status ?? StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message });
  }
};

// ── GET /bookings/:bookingId/active-session ───────────────────────────────────

export const GetActiveSession = async (req: Request, res: Response) => {
  try {
    const session = await paymentSessionService.getActiveSessionForBooking(req.params.bookingId!);
    if (!session) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "No active session for this booking" });
    }
    return res.status(StatusCode.OK).json({ message: "Active session", data: serializeSession(session) });
  } catch (err: any) {
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message });
  }
};

// ── POST /sessions/:sessionPublicId/add-deposit ───────────────────────────────

export const AddDepositToSession = async (req: Request, res: Response) => {
  try {
    const validation = addDepositSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Validation failed", errors: validation.error.format() });
    }
    const { amount, reason, idempotencyKey } = validation.data;
    const actor = await resolveActor(req);
    const session = await resolveSession(req.params.sessionPublicId!, actor.branchId!);

    // Verify safety deposit is enabled on this booking's frozen config
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: session.bookingId },
      select: { id: true, frozenChargeConfig: true },
    });
    const config = (booking.frozenChargeConfig as any) ?? {};
    if (!config.safetyDepositEnabled) {
      return res.status(StatusCode.FORBIDDEN).json({ message: "Safety deposit is not enabled for this booking" });
    }

    await prisma.$transaction(async (tx) => {
      // Auto-approve SafetyDepositRequest (no manager gate in session flow)
      const existingRequest = await tx.safetyDepositRequest.findUnique({
        where: { bookingId: booking.id },
      });

      if (!existingRequest) {
        await tx.safetyDepositRequest.create({
          data: {
            publicId: createID(),
            bookingId: booking.id,
            requestedAmount: String(amount),
            reason,
            status: "APPROVED",
            requestedById: actor.id,
            approvedById: actor.id,
            approvedAmount: String(amount),
            approvedAt: new Date(),
          },
        });
      } else {
        // If deposit request already exists (e.g. from pickup), update it
        await tx.safetyDepositRequest.update({
          where: { bookingId: booking.id },
          data: {
            requestedAmount: { increment: amount },
            approvedAmount: { increment: amount },
            approvedAt: new Date(),
          },
        });
      }

      // Update booking safety deposit amount
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          safetyDeposit: { increment: amount },
          safetyDepositPaidAt: new Date(),
        },
      });

      // Add DEPOSIT ledger entry
      await ledgerService.addEntry(
        session.id,
        booking.id,
        LedgerEntryType.DEPOSIT,
        LedgerEntryClassification.NON_TAXABLE,
        amount,
        reason,
        actor.id,
        String(actor.role),
        { idempotencyKey, referenceType: "SAFETY_DEPOSIT" },
        tx as any,
      );
    });

    // Log outside transaction
    await staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.APPLIED,
      entityType: StaffEntityType.PAYMENT_SESSION,
      entityRef: session.publicId,
      description: `Safety deposit ₹${amount} added to session ${session.publicId}`,
      metadata: { amount, reason },
    });

    const updatedSession = await paymentSessionService.getSession(session.publicId);
    return res.status(StatusCode.OK).json({
      message: "Safety deposit added to session",
      data: serializeSession(updatedSession!),
    });
  } catch (err: any) {
    console.error("AddDepositToSession Error:", err);
    return res.status(err.status ?? StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message ?? "Internal server error" });
  }
};

// ── POST /sessions/:sessionPublicId/record-payment ────────────────────────────

export const RecordPayment = async (req: Request, res: Response) => {
  try {
    const validation = recordPaymentSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Validation failed", errors: validation.error.format() });
    }
    const { method, amount, idempotencyKey, notes, onlineTransactionRef, onlineGateway } = validation.data;
    const actor = await resolveActor(req);
    const session = await resolveSession(req.params.sessionPublicId!, actor.branchId!);

    if (!["AWAITING_PAYMENT", "PAYMENT_INITIATED"].includes(session.status)) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `Session is not awaiting payment (current status: ${session.status})`,
      });
    }

    // Validate amount matches ledger
    const validation2 = await ledgerService.validateSessionAmount(session.id, amount);
    if (!validation2.valid) {
      return res.status(StatusCode.CONFLICT).json({
        message: `Amount mismatch. Session netPayable is ₹${validation2.recomputed.toFixed(2)}, you provided ₹${amount}. Re-fetch session and retry.`,
        sessionNetPayable: validation2.recomputed.toFixed(2),
      });
    }

    let returnedVehicleIds: number[] = [];

    if (amount === 0) {
      // Zero-balance session: complete immediately without creating a PaymentTransaction.
      // A ₹0 record would pollute financial reports with meaningless rows.
      await prisma.$transaction(async (tx) => {
        await paymentSessionService.updateStatus(session.id, PaymentSessionStatus.COMPLETED, {}, tx as any);
        await (tx as any).booking.update({
          where: { id: session.bookingId },
          data: { activePaymentSessionId: null },
        });
        returnedVehicleIds = await runPostCompletionHooks(session.sessionType as PaymentSessionType, session.bookingId, session.id, actor.id, tx as any);
      }, { timeout: 15000 });
    } else if (method === "CASH") {
      await prisma.$transaction(async (tx) => {
        // Add PAYMENT ledger entry (negative = money in)
        await ledgerService.addEntry(
          session.id,
          session.bookingId,
          LedgerEntryType.PAYMENT,
          LedgerEntryClassification.PAYMENT,
          -Math.abs(amount),
          notes ?? `Cash payment of ₹${amount}`,
          actor.id,
          String(actor.role),
          { idempotencyKey, referenceType: "CASH_PAYMENT" },
          tx as any,
        );

        // Link to the employee's open cash shift so the manager can track handover
        const activeShift = await (tx as any).cashShift.findFirst({
          where: { employeeId: actor.id, status: "OPEN" },
          select: { id: true },
        });

        // Create backward-compat PaymentTransaction (COLLECTED — awaits manager cash confirmation)
        await tx.paymentTransaction.create({
          data: {
            publicId: createID(),
            idempotencyKey: `pt:${idempotencyKey}`,
            bookingId: session.bookingId,
            branchId: session.branchId,
            purpose: sessionTypeToPurpose(session.sessionType as PaymentSessionType),
            method: "CASH",
            status: "COLLECTED",
            totalAmount: amount.toFixed(2),
            cashAmount: amount.toFixed(2),
            onlineAmount: "0.00",
            collectedById: actor.id,
            collectedAt: new Date(),
            cashShiftId: activeShift?.id ?? null,
            notes: notes ?? null,
          },
        });

        // Mark session completed
        await paymentSessionService.updateStatus(session.id, PaymentSessionStatus.COMPLETED, {}, tx as any);
        await (tx as any).booking.update({
          where: { id: session.bookingId },
          data: { activePaymentSessionId: null },
        });

        // Run post-completion hooks (returns vehicle IDs for RETURN sessions)
        returnedVehicleIds = await runPostCompletionHooks(session.sessionType as PaymentSessionType, session.bookingId, session.id, actor.id, tx as any);
      }, { timeout: 15000 });

      // Invalidate vehicle availability cache for returned vehicles
      if (returnedVehicleIds.length > 0) {
        try {
          await invalidateVehicleAvailability(redis, returnedVehicleIds);
        } catch (redisErr) {
          console.warn("[record-payment] Cache invalidation failed (non-fatal):", redisErr);
        }
      }
    } else if (method === "ONLINE") {
      await prisma.$transaction(async (tx) => {
        await ledgerService.addEntry(
          session.id,
          session.bookingId,
          LedgerEntryType.PAYMENT,
          LedgerEntryClassification.PAYMENT,
          -Math.abs(amount),
          notes ?? `Online payment of ₹${amount}${onlineTransactionRef ? ` (ref: ${onlineTransactionRef})` : ""}`,
          actor.id,
          String(actor.role),
          { idempotencyKey, referenceType: "ONLINE_PAYMENT" },
          tx as any,
        );

        await tx.paymentTransaction.create({
          data: {
            publicId: createID(),
            idempotencyKey: `pt:${idempotencyKey}`,
            bookingId: session.bookingId,
            branchId: session.branchId,
            purpose: sessionTypeToPurpose(session.sessionType as PaymentSessionType),
            method: "ONLINE",
            status: "CONFIRMED",
            totalAmount: amount.toFixed(2),
            cashAmount: "0.00",
            onlineAmount: amount.toFixed(2),
            onlineTransactionRef: onlineTransactionRef ?? null,
            onlineGateway: onlineGateway ?? null,
            collectedById: actor.id,
            collectedAt: new Date(),
            confirmedById: actor.id,
            confirmedAt: new Date(),
            notes: notes ?? null,
          },
        });

        await paymentSessionService.updateStatus(session.id, PaymentSessionStatus.COMPLETED, {}, tx as any);
        await (tx as any).booking.update({
          where: { id: session.bookingId },
          data: { activePaymentSessionId: null },
        });

        returnedVehicleIds = await runPostCompletionHooks(session.sessionType as PaymentSessionType, session.bookingId, session.id, actor.id, tx as any);
      }, { timeout: 15000 });
    }

    // Rebuild and regenerate invoice after RETURN session completes
    if (session.sessionType === PaymentSessionType.RETURN) {
      finalizeInvoice(session.bookingId).catch((err) =>
        console.error("[record-payment] Invoice finalization error:", err),
      );
    }

    // Audit + activity outside transaction
    await auditService.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      actorBranchId: actor.branchId ?? undefined,
      action: "PAYMENT_RECORDED",
      category: AuditCategory.PAYMENT,
      description: `${method} payment of ₹${amount} recorded on session ${session.publicId}`,
      entity: "PaymentSession",
      entityId: session.publicId,
      metadata: { method, amount, sessionType: session.sessionType },
    });

    await staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.COLLECTED,
      entityType: StaffEntityType.PAYMENT_SESSION,
      entityRef: session.publicId,
      description: `Payment ₹${amount} (${method}) recorded on ${session.sessionType} session`,
      metadata: { amount, method },
    });

    const updatedSession = await paymentSessionService.getSession(session.publicId);
    return res.status(StatusCode.OK).json({
      message: "Payment recorded successfully",
      data: serializeSession(updatedSession!),
    });
  } catch (err: any) {
    console.error("RecordPayment Error:", err);
    return res.status(err.status ?? StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message ?? "Internal server error" });
  }
};

// ── POST /sessions/:sessionPublicId/record-refund ─────────────────────────────

export const RecordRefund = async (req: Request, res: Response) => {
  try {
    const validation = recordRefundSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Validation failed", errors: validation.error.format() });
    }
    const { method, amount, idempotencyKey, notes } = validation.data;
    const actor = await resolveActor(req);
    const session = await resolveSession(req.params.sessionPublicId!, actor.branchId!);

    if (session.status !== PaymentSessionStatus.AWAITING_PAYMENT) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: `Session is not awaiting payment` });
    }

    // Validate: netPayable must be negative (refund situation)
    const validation2 = await ledgerService.validateSessionAmount(session.id, -Math.abs(amount));
    if (!validation2.valid) {
      return res.status(StatusCode.CONFLICT).json({
        message: `Refund amount mismatch. Session refundable is ₹${validation2.recomputed.abs().toFixed(2)}.`,
        sessionNetPayable: validation2.recomputed.toFixed(2),
      });
    }

    let returnedVehicleIds: number[] = [];

    await prisma.$transaction(async (tx) => {
      await ledgerService.addEntry(
        session.id,
        session.bookingId,
        LedgerEntryType.REFUND,
        LedgerEntryClassification.PAYMENT,
        Math.abs(amount),
        notes ?? `Cash refund of ₹${amount}`,
        actor.id,
        String(actor.role),
        { idempotencyKey, referenceType: "REFUND" },
        tx as any,
      );

      await tx.paymentTransaction.create({
        data: {
          publicId: createID(),
          idempotencyKey: `pt:${idempotencyKey}`,
          bookingId: session.bookingId,
          branchId: session.branchId,
          purpose: PaymentPurpose.OVERPAYMENT_REFUND,
          method: method as any,
          status: "CONFIRMED",
          totalAmount: amount.toFixed(2),
          cashAmount: method === "CASH" ? amount.toFixed(2) : "0.00",
          onlineAmount: method === "ONLINE" ? amount.toFixed(2) : "0.00",
          collectedById: actor.id,
          collectedAt: new Date(),
          confirmedById: actor.id,
          confirmedAt: new Date(),
          notes: notes ?? null,
        },
      });

      // Create a RefundRequest so the branch manager can see and acknowledge the refund.
      // CASH refunds need manager acknowledgment (PENDING_APPROVAL); online refunds auto-approve.
      await (tx as any).refundRequest.create({
        data: {
          publicId: createID(),
          bookingId: session.bookingId,
          branchId: session.branchId,
          amount: amount.toFixed(2),
          reason: notes ?? "Deposit refund on vehicle return",
          method: method as any,
          status: method === "CASH" ? "PENDING_APPROVAL" : "APPROVED",
          requestedById: actor.id,
          approvedById: method !== "CASH" ? actor.id : null,
          approvedAt: method !== "CASH" ? new Date() : null,
        },
      });

      await paymentSessionService.updateStatus(session.id, PaymentSessionStatus.COMPLETED, {}, tx as any);
      await (tx as any).booking.update({
        where: { id: session.bookingId },
        data: { activePaymentSessionId: null },
      });

      returnedVehicleIds = await runPostCompletionHooks(session.sessionType as PaymentSessionType, session.bookingId, session.id, actor.id, tx as any);
    }, { timeout: 15000 });

    if (returnedVehicleIds.length > 0) {
      try {
        await invalidateVehicleAvailability(redis, returnedVehicleIds);
      } catch (redisErr) {
        console.warn("[record-refund] Cache invalidation failed (non-fatal):", redisErr);
      }
    }

    // Rebuild and regenerate invoice after RETURN session completes
    if (session.sessionType === PaymentSessionType.RETURN) {
      finalizeInvoice(session.bookingId).catch((err) =>
        console.error("[record-refund] Invoice finalization error:", err),
      );
    }

    await auditService.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      actorBranchId: actor.branchId ?? undefined,
      action: "REFUND_RECORDED",
      category: AuditCategory.PAYMENT,
      description: `Refund of ₹${amount} (${method}) issued via session ${session.publicId}`,
      entity: "PaymentSession",
      entityId: session.publicId,
      metadata: { method, amount },
    });

    const updatedSession = await paymentSessionService.getSession(session.publicId);
    return res.status(StatusCode.OK).json({
      message: "Refund recorded successfully",
      data: serializeSession(updatedSession!),
    });
  } catch (err: any) {
    console.error("RecordRefund Error:", err);
    return res.status(err.status ?? StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message ?? "Internal server error" });
  }
};

// ── Post-completion hooks ─────────────────────────────────────────────────────

/**
 * Actions to run after a session reaches COMPLETED state.
 * Each session type has different post-payment effects on the booking.
 */
/**
 * Returns vehicle IDs that need Redis cache invalidation (RETURN sessions only).
 */
async function runPostCompletionHooks(
  sessionType: PaymentSessionType,
  bookingId: number,
  sessionId: number,
  actorId: number,
  tx: any,
): Promise<number[]> {
  if (sessionType === PaymentSessionType.PICKUP) {
    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { items: { select: { vehicleId: true } } },
    });
    const vehicleIds = booking.items.map((i: any) => i.vehicleId);

    await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.PICKED_UP,
        remainingPaidAt: new Date(),
        remainingPaidDuring: "PICKUP",
      },
    });

    await tx.vehicle.updateMany({
      where: { id: { in: vehicleIds } },
      data: { status: VehicleStatus.OUT_FOR_RENTAL },
    });

    // Case 1: Extension was paid directly (PAYMENT_COLLECTED) before this session
    const pendingExtension = await tx.bookingExtension.findFirst({
      where: { bookingId, extensionStatus: ExtensionStatus.PAYMENT_COLLECTED },
      orderBy: { createdAt: "desc" },
    });
    if (pendingExtension) {
      await tx.bookingExtension.update({
        where: { id: pendingExtension.id },
        data: {
          extensionStatus: ExtensionStatus.CONFIRMED,
          actualNewEndAt: pendingExtension.requestedEndAt,
        },
      });
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          endAt: pendingExtension.requestedEndAt,
          activeExtensionId: null,
          extensionCount: { increment: 1 },
          lastExtendedAt: new Date(),
        },
      });
    }

    // Case 2: Extension was added to this pickup session via an EXTENSION ledger entry
    // (extension status is PENDING_PAYMENT — payment deferred to this session)
    if (!pendingExtension) {
      const extLedgerEntry = await tx.ledgerEntry.findFirst({
        where: { sessionId, entryType: LedgerEntryType.EXTENSION, isVoided: false },
      });
      if (extLedgerEntry?.referenceId) {
        const sessionExt = await tx.bookingExtension.findUnique({
          where: { publicId: extLedgerEntry.referenceId },
          include: { booking: { select: { extensionCount: true, originalEndAt: true } } },
        });
        if (sessionExt && sessionExt.extensionStatus === ExtensionStatus.PENDING_PAYMENT) {
          await tx.bookingExtension.update({
            where: { id: sessionExt.id },
            data: {
              extensionStatus: ExtensionStatus.CONFIRMED,
              actualNewEndAt: sessionExt.requestedEndAt,
            },
          });
          // booking.endAt is already set by commit() as the vehicle hold —
          // just clear activeExtensionId and increment the counter.
          await tx.booking.update({
            where: { id: bookingId },
            data: {
              activeExtensionId: null,
              extensionCount: { increment: 1 },
              lastExtendedAt: new Date(),
              totalFinal: sessionExt.newTotalFinal,
              ...(sessionExt.booking.extensionCount === 0 && !sessionExt.booking.originalEndAt
                ? { originalEndAt: sessionExt.oldEndAt }
                : {}),
            },
          });
        }
      }
    }

    // Case 3: Discount ledger entry — apply to booking record
    const discountLedgerEntry = await tx.ledgerEntry.findFirst({
      where: { sessionId, entryType: LedgerEntryType.DISCOUNT, isVoided: false },
    });
    if (discountLedgerEntry?.referenceId) {
      const rule = await tx.discountRule.findUnique({
        where: { publicId: discountLedgerEntry.referenceId },
        select: { id: true, code: true },
      });
      if (rule) {
        const discountedAmount = new Decimal(discountLedgerEntry.amount.toString()).abs();
        const fullBooking = await tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
          select: { customerId: true, branchId: true, totalFinal: true },
        });

        // Upsert DiscountApplication
        await (tx as any).discountApplication.upsert({
          where: { bookingId },
          update: {
            couponDiscountAmount: discountedAmount.toFixed(2),
            discountRuleId: rule.id,
            totalDiscountAmount: discountedAmount.toFixed(2),
            finalAmount: new Decimal(fullBooking.totalFinal?.toString() ?? "0").minus(discountedAmount).toFixed(2),
          },
          create: {
            publicId: createID(),
            bookingId,
            originalAmount: fullBooking.totalFinal?.toString() ?? "0",
            couponDiscountAmount: discountedAmount.toFixed(2),
            discountRuleId: rule.id,
            totalDiscountAmount: discountedAmount.toFixed(2),
            finalAmount: new Decimal(fullBooking.totalFinal?.toString() ?? "0").minus(discountedAmount).toFixed(2),
            paymentPlan: "FULL",
          },
        });

        // Append usage log
        await (tx as any).couponUsageLog.create({
          data: {
            discountRuleId: rule.id,
            bookingId,
            customerId: fullBooking.customerId,
            branchId: fullBooking.branchId,
            discountedAmount: discountedAmount.toFixed(2),
          },
        });
      }
    }

    return [];
  } else if (sessionType === PaymentSessionType.EXTENSION) {
    const extension = await tx.bookingExtension.findFirst({
      where: { bookingId, extensionStatus: ExtensionStatus.PENDING_PAYMENT },
      orderBy: { createdAt: "desc" },
    });
    if (extension) {
      await tx.bookingExtension.update({
        where: { id: extension.id },
        data: {
          extensionStatus: ExtensionStatus.CONFIRMED,
          actualNewEndAt: extension.requestedEndAt,
        },
      });
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          endAt: extension.requestedEndAt,
          activeExtensionId: null,
          extensionCount: { increment: 1 },
          lastExtendedAt: new Date(),
        },
      });
    }
    return [];
  } else if (sessionType === PaymentSessionType.RETURN) {
    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { items: { select: { vehicleId: true } } },
    });
    const vehicleIds = booking.items.map((i: any) => i.vehicleId);

    await tx.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.RETURNED },
    });

    await tx.vehicle.updateMany({
      where: { id: { in: vehicleIds } },
      data: { status: VehicleStatus.AVAILABLE },
    });

    // Bust the cached PDF synchronously inside the transaction so any
    // download request that arrives before finalizeInvoice completes
    // sees a null invoicePdfFileId and is forced to wait for regeneration.
    await (tx as any).invoice.updateMany({
      where: { bookingId },
      data: { invoicePdfFileId: null, generatedAt: null },
    });

    return vehicleIds;
  }
  return [];
}

// ── Purpose mapping ───────────────────────────────────────────────────────────

function sessionTypeToPurpose(sessionType: PaymentSessionType): PaymentPurpose {
  switch (sessionType) {
    case PaymentSessionType.PICKUP:    return PaymentPurpose.REMAINING_BALANCE;
    case PaymentSessionType.EXTENSION: return PaymentPurpose.EXTENSION;
    case PaymentSessionType.RETURN:    return PaymentPurpose.REMAINING_BALANCE;
    default:                           return PaymentPurpose.FULL_PAYMENT;
  }
}

// ── Serializer ────────────────────────────────────────────────────────────────

function serializeSession(session: any) {
  return {
    publicId: session.publicId,
    sessionType: session.sessionType,
    status: session.status,
    netPayable: new Decimal(session.netPayable.toString()).toFixed(2),
    totalCharges: new Decimal(session.totalCharges.toString()).toFixed(2),
    totalDiscounts: new Decimal(session.totalDiscounts.toString()).toFixed(2),
    totalPaymentsRecorded: new Decimal(session.totalPaymentsRecorded.toString()).toFixed(2),
    taxableBase: new Decimal(session.taxableBase.toString()).toFixed(2),
    nonTaxableBase: new Decimal(session.nonTaxableBase.toString()).toFixed(2),
    gstAmount: new Decimal(session.gstAmount.toString()).toFixed(2),
    isRefund: new Decimal(session.netPayable.toString()).lt(0),
    entries: (session.entries ?? []).map((e: any) => ({
      publicId: e.publicId,
      entryType: e.entryType,
      classification: e.classification,
      amount: new Decimal(e.amount.toString()).toFixed(2),
      gstAmount: new Decimal(e.gstAmount?.toString() ?? "0").toFixed(2),
      description: e.description,
      referenceId: e.referenceId,
      referenceType: e.referenceType,
      isVoided: e.isVoided,
      createdAt: e.createdAt,
    })),
  };
}

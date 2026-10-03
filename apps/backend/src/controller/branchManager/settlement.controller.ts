import { Request, Response } from "express";
import { z } from "zod";
import Decimal from "decimal.js";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, PaymentPurpose } from "@repo/database/client";
import { listPendingSettlementsSchema, recordPaymentSchema } from "@repo/schemas";
import { settlementEngineService, paymentTransactionService } from "../../services/payment/index.js";
import { CounterGuardError } from "../../services/payment/counter-guard.service.js";
import { syncLegacyReturnInvoice } from "../../services/invoice-finalization.service.js";
import { computeBookingOwed, creditOutstanding, getBookingMoney } from "../../services/payment/booking-owed.service.js";
import { getBookingCreditSummary } from "../../services/payment/customer-credit.service.js";
import { depositToRefund } from "../../services/payment/settlement-engine.service.js";
import { LEGACY_DEPOSIT_REFUND_KEY_PREFIX } from "../../services/payment/safety-deposit.service.js";
import { resolvePaymentProof, claimPaymentProof } from "../../services/payment/payment-proof.service.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";
import { createID } from "../../utils/nanoID.js";

const refundDepositSchema = z.object({
  method: z.enum(["CASH", "UPI"]),
  // Defaults to everything still to refund under the drop's choice
  amount: z.number().positive().optional(),
  // Optional photo of the UPI transfer to the customer
  proof_file_id: z.string().trim().min(1).max(64).optional(),
  notes: z.string().max(500).optional(),
});

const buildActorContext = async (req: Request) => {
  const user = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true, branch: { select: { name: true } } },
  });
  if (!user) throw new Error("Actor not found");
  return {
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    actorBranchId: req.branch_Id,
    actorPublicId: req.public_Id,
    branchName: user.branch?.name ?? "Unknown",
  };
};

export const ListPendingSettlements = async (req: Request, res: Response): Promise<void> => {
  try {
    const query = listPendingSettlementsSchema.safeParse(req.query);
    if (!query.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid query", errors: query.error.format() });
      return;
    }
    const result = await settlementEngineService.listPendingSettlements(req.branch_Id, query.data);
    res.status(StatusCode.OK).json(result);
  } catch (error) {
    console.error("ListPendingSettlements Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const GetSettlementSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { publicId: req.params.bookingPublicId! },
      select: { id: true, branchId: true },
    });
    if (!booking || booking.branchId !== req.branch_Id) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
      return;
    }
    const summary = await settlementEngineService.calculateSettlement(booking.id);
    res.status(StatusCode.OK).json({ data: summary });
  } catch (error) {
    console.error("GetSettlementSummary Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const RecordSettlementPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    // Verify booking belongs to this branch and is in RETURNED status
    const booking = await prisma.booking.findUnique({
      where: { publicId: req.params.bookingPublicId! },
      select: { id: true, branchId: true, status: true, publicId: true },
    });
    if (!booking || booking.branchId !== req.branch_Id) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
      return;
    }
    if (booking.status !== "RETURNED") {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Settlement payments can only be recorded for RETURNED bookings." });
      return;
    }

    // Inject the bookingPublicId from the URL — caller should not re-specify it
    const body = { ...req.body, bookingPublicId: booking.publicId };

    const validation = recordPaymentSchema.safeParse(body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
      return;
    }

    const actor = await buildActorContext(req);
    const txn = await paymentTransactionService.record(validation.data, actor);

    // Legacy drop: the return charges this settles go on the invoice, which turns
    // PAID once nothing is owed or awaiting confirmation (no-op for a drop-bill return)
    syncLegacyReturnInvoice(booking.id).catch((err) =>
      console.error("[settlement] Invoice sync failed:", err),
    );

    res.status(StatusCode.CREATED).json({
      message: txn.status === "COLLECTED" ? "Settlement cash collected — awaiting manager confirmation" : "Settlement payment recorded",
      data: { publicId: txn.publicId, status: txn.status, totalAmount: txn.totalAmount },
    });
  } catch (error: any) {
    if (error instanceof CounterGuardError) {
      res.status(error.status).json(error.toJSON());
      return;
    }
    console.error("RecordSettlementPayment Error:", error);
    if (error.message?.includes("reference is required")) {
      res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
      return;
    }
    if (error.message?.includes("exceed") || error.message?.includes("limit")) {
      res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
      return;
    }
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/** A deposit-refund precondition that no longer holds under the lock — sent as-is. */
class DepositRefundRejection extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(String(body.message));
  }
}

/**
 * POST /api/branchManager/payment/settlements/:bookingPublicId/refund-deposit
 *
 * Legacy drop (#6): pays the safety deposit back as the Fleet Executive chose at
 * the drop — REFUND_IN_FULL: the whole deposit; SET_OFF: what is left of it after
 * the return charges. Records an OVERPAYMENT_REFUND PaymentTransaction (key `sdr:`)
 * that the settlement and financial state count, and a COMPLETED RefundRequest.
 */
export const RefundSettlementDeposit = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = refundDepositSchema.safeParse(req.body ?? {});
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "VALIDATION_FAILED",
        message: validation.error.issues[0]?.message ?? "Invalid input",
        errors: validation.error.format(),
      });
      return;
    }
    const { method, notes } = validation.data;

    const booking = await prisma.booking.findUnique({
      where: { publicId: req.params.bookingPublicId! },
      select: { id: true, branchId: true, status: true, publicId: true },
    });
    if (!booking || booking.branchId !== req.branch_Id) {
      res.status(StatusCode.NOT_FOUND).json({ success: false, code: "BOOKING_NOT_FOUND", message: "Booking not found" });
      return;
    }
    if (booking.status !== "RETURNED") {
      res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "BOOKING_NOT_RETURNED",
        message: "The safety deposit is refunded once the vehicle is returned.",
      });
      return;
    }

    const actor = await buildActorContext(req);
    const proof = method === "UPI" ? await resolvePaymentProof(validation.data.proof_file_id, booking.branchId) : null;

    const refund = await prisma.$transaction(async (tx) => {
      // One deposit refund at a time per booking
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"deposit-refund:" + booking.id}))`;

      const [owed, money, credit, flags] = await Promise.all([
        computeBookingOwed(booking.id, tx),
        getBookingMoney(booking.id, tx),
        getBookingCreditSummary(booking.id, tx),
        tx.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { safetyDepositRefunded: true } }),
      ]);
      if (!owed.safetyDepositHandling) {
        throw new DepositRefundRejection(StatusCode.BAD_REQUEST, {
          success: false,
          code: "NO_DEPOSIT_TO_REFUND",
          message: "No safety deposit is waiting to be refunded on this booking.",
        });
      }
      // Marked refunded outside Settlements (the old Return Review flag) with no
      // refund recorded here — paying it again would refund it twice
      if (flags.safetyDepositRefunded && owed.legacyDepositRefunded.lte(0)) {
        throw new DepositRefundRejection(StatusCode.CONFLICT, {
          success: false,
          code: "DEPOSIT_ALREADY_REFUNDED",
          message: "This safety deposit was already marked as refunded to the customer.",
        });
      }
      // Money on credit stays owed against its collateral — the deposit isn't set off against it
      const netPayable = owed.totalOwed.sub(money.netConfirmed);
      const due = depositToRefund(owed, netPayable, creditOutstanding(owed, money.netConfirmed, credit?.pending ?? new Decimal(0)));
      if (due.lte(0)) {
        throw new DepositRefundRejection(StatusCode.BAD_REQUEST, {
          success: false,
          code: "NO_DEPOSIT_TO_REFUND",
          message: owed.safetyDepositHandling === "SET_OFF"
            ? "The safety deposit was used up against the return charges — nothing is left to refund."
            : "The safety deposit has already been refunded.",
        });
      }
      const amount = validation.data.amount != null
        ? new Decimal(validation.data.amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        : due;
      if (amount.gt(due)) {
        throw new DepositRefundRejection(StatusCode.BAD_REQUEST, {
          success: false,
          code: "REFUND_EXCEEDS_DEPOSIT",
          message: `Only ₹${due.toFixed(2)} of the safety deposit is left to refund.`,
          depositToRefund: due.toFixed(2),
        });
      }

      if (proof) await claimPaymentProof(proof, tx);
      const isCash = method === "CASH";
      const shift = isCash
        ? await tx.cashShift.findFirst({ where: { employeeId: actor.actorId, status: "OPEN" }, select: { id: true } })
        : null;
      const now = new Date();
      const reason = notes?.trim() ||
        (owed.safetyDepositHandling === "SET_OFF"
          ? "Safety deposit left after the return charges, refunded"
          : "Safety deposit refunded in full");

      const txn = await tx.paymentTransaction.create({
        data: {
          publicId: createID(),
          idempotencyKey: `${LEGACY_DEPOSIT_REFUND_KEY_PREFIX}${booking.publicId}:${createID()}`,
          bookingId: booking.id,
          branchId: booking.branchId,
          purpose: PaymentPurpose.OVERPAYMENT_REFUND,
          method: isCash ? "CASH" : "ONLINE",
          status: "CONFIRMED",
          totalAmount: amount.toFixed(2),
          cashAmount: isCash ? amount.toFixed(2) : "0.00",
          onlineAmount: isCash ? "0.00" : amount.toFixed(2),
          onlineGateway: isCash ? null : "UPI",
          proofFileId: proof?.id ?? null,
          collectedById: actor.actorId,
          collectedAt: now,
          confirmedById: actor.actorId,
          confirmedAt: now,
          cashShiftId: shift?.id ?? null,
          notes: reason,
        },
      });
      // The manager pays it out, so the request is approved and completed at once
      await tx.refundRequest.create({
        data: {
          publicId: createID(),
          bookingId: booking.id,
          branchId: booking.branchId,
          amount: amount.toFixed(2),
          reason,
          method: isCash ? "CASH" : "ONLINE",
          status: "COMPLETED",
          requestedById: actor.actorId,
          approvedById: actor.actorId,
          approvedAt: now,
          completedById: actor.actorId,
          completedAt: now,
        },
      });
      const remaining = due.sub(amount);
      if (remaining.lte(0)) {
        await tx.booking.update({
          where: { id: booking.id },
          data: { safetyDepositRefunded: true, safetyDepositRefundedAt: now },
        });
      }
      return { txn, amount, remaining, handling: owed.safetyDepositHandling };
    });

    syncLegacyReturnInvoice(booking.id).catch((err) =>
      console.error("[settlement] Invoice sync failed:", err),
    );

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: req.branch_Id,
      action: "SAFETY_DEPOSIT_REFUNDED",
      category: AuditCategory.PAYMENT,
      description: `Safety deposit ₹${refund.amount.toFixed(2)} refunded (${method}) on booking ${booking.publicId} — ${refund.handling === "SET_OFF" ? "remainder after charges" : "refund in full"}`,
      entity: "PaymentTransaction",
      entityId: refund.txn.publicId,
      entityLabel: booking.publicId,
      metadata: { method, amount: refund.amount.toFixed(2), handling: refund.handling, ...(proof && { proofFileId: proof.publicId }) },
    });
    staffActivityService
      .logFromRequest(req, {
        actionType: StaffActionType.REFUNDED,
        entityType: StaffEntityType.DEPOSIT,
        entityRef: booking.publicId,
        description: `Safety deposit ₹${refund.amount.toFixed(2)} refunded (${method})`,
        metadata: { method, amount: refund.amount.toFixed(2), handling: refund.handling },
      })
      .catch(() => {});

    const summary = await settlementEngineService.calculateSettlement(booking.id);
    res.status(StatusCode.CREATED).json({
      success: true,
      message: `Safety deposit of ₹${refund.amount.toFixed(2)} refunded`,
      data: {
        refund: {
          publicId: refund.txn.publicId,
          method,
          amount: refund.amount.toFixed(2),
          status: refund.txn.status,
          remainingToRefund: refund.remaining.toFixed(2),
        },
        settlement: summary,
      },
    });
  } catch (error: any) {
    if (error instanceof DepositRefundRejection) {
      res.status(error.status).json(error.body);
      return;
    }
    if (error instanceof CounterGuardError) {
      res.status(error.status).json(error.toJSON());
      return;
    }
    console.error("RefundSettlementDeposit Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

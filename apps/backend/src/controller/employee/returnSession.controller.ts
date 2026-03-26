/**
 * Return Session controller — session-driven ledger flow for vehicle return.
 *
 * Endpoints:
 *   POST /employee/bookings/:bookingId/return/session/compute
 *   GET  /employee/bookings/:bookingId/return/session
 *
 * Flow:
 *  1. Compute return charges via ChargeEngine (same as legacy ComputeReturnCharges)
 *  2. Create/return RETURN PaymentSession
 *  3. Map ChargeBreakdown results → LedgerEntry rows
 *  4. Apply safety deposit credit as a PAYMENT entry (reduces netPayable)
 *  5. Transition session to AWAITING_PAYMENT
 *  6. Return session with full charge + balance breakdown
 *
 * Only active when BranchChargeConfig.usePaymentSessions = true.
 */
import { Request, Response } from "express";
import { z } from "zod";
import Decimal from "decimal.js";
import {
  prisma,
  BookingStatus,
  BookingPhotoType,
  LedgerEntryType,
  LedgerEntryClassification,
  PaymentSessionType,
  PaymentSessionStatus,
} from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { paymentSessionService } from "../../services/payment/paymentSession.service.js";
import { ledgerService } from "../../services/payment/ledger.service.js";
import { returnChargeService } from "../../services/charges/return-charge.service.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";
import { createID } from "../../utils/nanoID.js";

const computeReturnSessionSchema = z.object({
  endOdometer: z.coerce.number().min(0),
  returnFuelLevel: z.enum(["EMPTY", "QUARTER", "HALF", "THREE_QUARTER", "FULL"]).optional(),
  fuelDeficitCharge: z.coerce.number().min(0).optional(),
  fuelSkipReason: z.string().min(1).optional(),
  fastagAmount: z.coerce.number().min(0).optional(),
  fastagNotes: z.string().optional(),
  applyGrace: z.boolean().optional(),
  returnImageIds: z.array(z.string()).optional(),
});

// ── POST /employee/bookings/:bookingId/return/session/compute ──────────────────

export const ComputeReturnSession = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;

    const validation = computeReturnSessionSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation failed",
        errors: validation.error.format(),
      });
    }
    const { endOdometer, returnImageIds, ...returnInput } = validation.data;

    // Resolve actor
    const actor = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, name: true, role: true, branchId: true },
    });
    if (!actor) {
      return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
    }

    // Fetch booking with branch config
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId: actor.branchId! },
      include: {
        branch: {
          include: { chargeConfig: { select: { usePaymentSessions: true } } },
        },
      },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    if (booking.status !== BookingStatus.PICKED_UP) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `Cannot compute return session. Booking status: ${booking.status}`,
      });
    }

    // Feature flag check
    const usePaymentSessions = booking.branch?.chargeConfig?.usePaymentSessions ?? false;
    if (!usePaymentSessions) {
      return res.status(StatusCode.CONFLICT).json({
        message: "Payment session flow is not enabled for this branch. Use the legacy return-charges endpoint.",
      });
    }

    // Run the charge engine — computes and persists ChargeEntry records
    const breakdown = await returnChargeService.processReturnCharges(
      bookingId!,
      endOdometer,
      returnInput,
      actor.id,
    );

    // Create or return existing RETURN session
    const session = await paymentSessionService.createSession(
      booking.id,
      booking.branchId,
      PaymentSessionType.RETURN,
      actor.id,
    );

    // If session already has entries, void them all so we can re-compute
    // (employee re-submitted the form with new odometer/fuel values)
    const existingEntries = session.entries?.filter((e: any) => !e.isVoided) ?? [];
    if (existingEntries.length > 0) {
      await Promise.all(
        existingEntries.map((e: any) =>
          ledgerService.voidEntry(e.publicId, actor.id, "Return charges recomputed"),
        ),
      );
    }

    // Map ChargeBreakdown → LedgerEntry rows
    await ledgerService.addEntriesFromChargeBreakdown(
      session.id,
      booking.id,
      breakdown.results,
      actor.id,
      String(actor.role),
    );

    // Apply safety deposit credit — reduces netPayable
    // The deposit was collected at pickup; deduct it from what the customer owes now
    const safetyDeposit = new Decimal(booking.safetyDeposit?.toString() ?? "0");
    if (safetyDeposit.gt(0)) {
      await ledgerService.addEntry(
        session.id,
        booking.id,
        LedgerEntryType.DEPOSIT,
        LedgerEntryClassification.PAYMENT,  // Deposit used as payment credit
        safetyDeposit.negated(),             // Negative = reduces netPayable
        `Safety deposit credit (₹${safetyDeposit.toFixed(2)})`,
        actor.id,
        String(actor.role),
        {
          idempotencyKey: `return:${booking.id}:deposit-credit:${session.id}`,
          referenceType: "SAFETY_DEPOSIT_CREDIT",
        },
      );
    }

    // Save POST_RETURN photos if provided
    if (returnImageIds && returnImageIds.length > 0) {
      const files = await prisma.fileObject.findMany({
        where: { publicId: { in: returnImageIds } },
        select: { id: true, publicId: true },
      });
      if (files.length !== returnImageIds.length) {
        return res.status(StatusCode.BAD_REQUEST).json({ message: "One or more returnImageIds are invalid" });
      }
      await prisma.bookingPhoto.createMany({
        data: files.map((f) => ({
          publicId: createID(),
          bookingId: booking.id,
          fileId: f.id,
          type: BookingPhotoType.POST_RETURN,
        })),
        skipDuplicates: true,
      });
    }

    // Transition to AWAITING_PAYMENT
    await paymentSessionService.updateStatus(
      session.id,
      PaymentSessionStatus.AWAITING_PAYMENT,
    );

    await auditService.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      actorBranchId: actor.branchId ?? undefined,
      action: "RETURN_SESSION_COMPUTED",
      category: AuditCategory.PAYMENT,
      description: `Return session computed for booking ${booking.publicId}: ₹${breakdown.finalTotal.toFixed(2)} charges`,
      entity: "PaymentSession",
      entityId: session.publicId,
      metadata: {
        finalTotal: breakdown.finalTotal.toFixed(2),
        safetyDepositCredit: safetyDeposit.toFixed(2),
        chargeCount: breakdown.results.filter((r) => !r.skip).length,
      },
    });

    await staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.RECALCULATED,
      entityType: StaffEntityType.PAYMENT_SESSION,
      entityRef: session.publicId,
      description: `Return charges computed for booking ${bookingId}: ₹${breakdown.finalTotal.toFixed(2)} total`,
      metadata: {
        subtotal: breakdown.subtotal.toFixed(2),
        waivedTotal: breakdown.waivedTotal.toFixed(2),
        finalTotal: breakdown.finalTotal.toFixed(2),
      },
    });

    const updatedSession = await paymentSessionService.getSession(session.publicId);
    return res.status(StatusCode.OK).json({
      message: "Return session computed",
      data: {
        session: serializeReturnSession(updatedSession!),
        chargeBreakdown: {
          subtotal: breakdown.subtotal.toFixed(2),
          waivedTotal: breakdown.waivedTotal.toFixed(2),
          finalTotal: breakdown.finalTotal.toFixed(2),
          charges: breakdown.results
            .filter((r) => !r.skip)
            .map((r) => ({
              chargeType: r.chargeType,
              moduleKey: r.moduleKey,
              label: r.label,
              originalAmount: r.originalAmount.toFixed(2),
              finalAmount: r.finalAmount.toFixed(2),
              quantity: r.quantity?.toFixed(4) ?? null,
              unitRate: r.unitRate?.toFixed(2) ?? null,
              isOverridden: r.isOverridden ?? false,
              notes: r.notes ?? null,
            })),
        },
      },
    });
  } catch (err: any) {
    console.error("ComputeReturnSession Error:", err);
    const isValidationError =
      err.message?.includes("required") || err.message?.includes("enabled");
    return res.status(
      err.status ?? (isValidationError ? StatusCode.BAD_REQUEST : StatusCode.INTERNAL_SERVER_ERROR),
    ).json({ message: err.message ?? "Internal server error" });
  }
};

// ── GET /employee/bookings/:bookingId/return/session ──────────────────────────

export const GetReturnSession = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;

    const actor = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, branchId: true },
    });
    if (!actor) {
      return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
    }

    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId: actor.branchId! },
      select: { id: true },
    });
    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    const session = await prisma.paymentSession.findFirst({
      where: {
        bookingId: booking.id,
        sessionType: PaymentSessionType.RETURN,
        status: {
          in: [
            PaymentSessionStatus.OPEN,
            PaymentSessionStatus.AWAITING_PAYMENT,
            PaymentSessionStatus.PAYMENT_INITIATED,
          ],
        },
      },
      include: {
        entries: { where: { isVoided: false }, orderBy: { createdAt: "asc" } },
      },
    });

    if (!session) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "No active return session found" });
    }

    return res.status(StatusCode.OK).json({
      message: "Return session fetched",
      data: { session: serializeReturnSession(session) },
    });
  } catch (err: any) {
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message });
  }
};

// ── Serializer ────────────────────────────────────────────────────────────────

function serializeReturnSession(session: any) {
  const netPayable = new Decimal(session.netPayable.toString());
  return {
    publicId: session.publicId,
    sessionType: session.sessionType,
    status: session.status,
    netPayable: netPayable.toFixed(2),
    totalCharges: new Decimal(session.totalCharges.toString()).toFixed(2),
    totalDiscounts: new Decimal(session.totalDiscounts.toString()).toFixed(2),
    totalPaymentsRecorded: new Decimal(session.totalPaymentsRecorded.toString()).toFixed(2),
    taxableBase: new Decimal(session.taxableBase.toString()).toFixed(2),
    nonTaxableBase: new Decimal(session.nonTaxableBase.toString()).toFixed(2),
    gstAmount: new Decimal(session.gstAmount.toString()).toFixed(2),
    isRefund: netPayable.lt(0),
    entries: (session.entries ?? []).map((e: any) => ({
      publicId: e.publicId,
      entryType: e.entryType,
      classification: e.classification,
      amount: new Decimal(e.amount.toString()).toFixed(2),
      description: e.description,
      referenceType: e.referenceType,
      referenceId: e.referenceId,
      isVoided: e.isVoided,
      createdAt: e.createdAt,
    })),
  };
}

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
 *  3. Map ChargeBreakdown results → LedgerEntry rows (in a single transaction)
 *  4. Apply safety deposit credit as a PAYMENT entry (reduces netPayable)
 *  5. Store chargeBreakdown in session.metadata for page-reload restoration
 *  6. Transition session to AWAITING_PAYMENT
 *  7. Return session with full charge + balance breakdown
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
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";
import { createID } from "../../utils/nanoID.js";

const computeReturnSessionSchema = z.object({
  endOdometer: z.coerce.number().min(0),
  returnFuelLevel: z.string().regex(/^([1-9]|10)$/).optional(),
  extraKmCharge: z.coerce.number().min(0).optional(),
  fuelCharge: z.coerce.number().min(0).optional(),
  fastagAmount: z.coerce.number().min(0).optional(),
  fastagNotes: z.string().optional(),
  otherCharges: z.array(z.object({ label: z.string().min(1), amount: z.coerce.number().min(0) })).optional(),
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
    const { endOdometer, returnImageIds, returnFuelLevel, extraKmCharge, fuelCharge, fastagAmount, fastagNotes, otherCharges } = validation.data;

    // Resolve actor
    const actor = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, name: true, role: true, branchId: true },
    });
    if (!actor) {
      return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
    }

    // Fetch booking with branch config and fuel record
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId: actor.branchId! },
      include: {
        branch: {
          include: { chargeConfig: { select: { usePaymentSessions: true } } },
        },
        fuelRecord: true,
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

    // Build manual charge entries list (skip zero-amount entries)
    const manualCharges: { type: LedgerEntryType; label: string; amount: Decimal }[] = [];
    if (extraKmCharge && extraKmCharge > 0) {
      manualCharges.push({ type: LedgerEntryType.EXTRA_KM, label: "Extra km charge", amount: new Decimal(extraKmCharge) });
    }
    if (fuelCharge && fuelCharge > 0) {
      manualCharges.push({ type: LedgerEntryType.FUEL, label: "Fuel deficit charge", amount: new Decimal(fuelCharge) });
    }
    if (fastagAmount && fastagAmount > 0) {
      manualCharges.push({ type: LedgerEntryType.FASTAG, label: fastagNotes ? `FASTag: ${fastagNotes}` : "FASTag charges", amount: new Decimal(fastagAmount) });
    }
    for (const other of otherCharges ?? []) {
      if (other.amount > 0) {
        manualCharges.push({ type: LedgerEntryType.DAMAGE, label: other.label, amount: new Decimal(other.amount) });
      }
    }

    const totalManualCharges = manualCharges.reduce((sum, c) => sum.plus(c.amount), new Decimal(0));
    const safetyDeposit = new Decimal(booking.safetyDeposit?.toString() ?? "0");

    // Build chargeBreakdown for metadata / display
    const chargeBreakdownForMeta = {
      subtotal: totalManualCharges.toFixed(2),
      waivedTotal: "0.00",
      finalTotal: totalManualCharges.toFixed(2),
      charges: manualCharges.map((c) => ({
        chargeType: c.type,
        moduleKey: c.type.toLowerCase(),
        label: c.label,
        originalAmount: c.amount.toFixed(2),
        finalAmount: c.amount.toFixed(2),
        quantity: null,
        unitRate: null,
        isOverridden: false,
        notes: null,
      })),
    };

    // Create or return existing RETURN session
    const session = await paymentSessionService.createSession(
      booking.id,
      booking.branchId,
      PaymentSessionType.RETURN,
      actor.id,
    );

    // Atomically: void existing entries, add manual charge entries, add deposit credit,
    // store metadata, and transition to AWAITING_PAYMENT.
    await prisma.$transaction(async (tx) => {
      // Void any previously computed entries (recompute case)
      const existingEntries = session.entries?.filter((e: any) => !e.isVoided) ?? [];
      for (const e of existingEntries) {
        await ledgerService.voidEntry(e.publicId, actor.id, "Return charges recomputed", tx as any);
      }

      // Add manual charge entries
      for (const charge of manualCharges) {
        await ledgerService.addEntry(
          session.id,
          booking.id,
          charge.type,
          LedgerEntryClassification.NON_TAXABLE,
          charge.amount,
          charge.label,
          actor.id,
          String(actor.role),
          { referenceType: charge.type },
          tx as any,
        );
      }

      // Apply safety deposit credit — reduces netPayable
      if (safetyDeposit.gt(0)) {
        await ledgerService.addEntry(
          session.id,
          booking.id,
          LedgerEntryType.DEPOSIT,
          LedgerEntryClassification.PAYMENT,
          safetyDeposit.negated(),
          `Safety deposit credit (₹${safetyDeposit.toFixed(2)})`,
          actor.id,
          String(actor.role),
          {
            idempotencyKey: `return:${booking.id}:deposit-credit:${session.id}`,
            referenceType: "SAFETY_DEPOSIT_CREDIT",
          },
          tx as any,
        );
      }

      // Store chargeBreakdown in session metadata for page-reload restoration
      await (tx as any).paymentSession.update({
        where: { id: session.id },
        data: { metadata: { chargeBreakdown: chargeBreakdownForMeta } },
      });

      // Transition to AWAITING_PAYMENT (skip if already there — recompute case)
      if (session.status !== PaymentSessionStatus.AWAITING_PAYMENT) {
        await paymentSessionService.updateStatus(
          session.id,
          PaymentSessionStatus.AWAITING_PAYMENT,
          {},
          tx as any,
        );
      }
    }, { timeout: 30000 });

    // Update booking endOdometer and fuelRecord outside transaction (non-blocking)
    await prisma.booking.update({
      where: { id: booking.id },
      data: { endOdometer, totalKmDriven: Math.max(0, endOdometer - (booking.startOdometer ?? 0)) },
    });

    if (booking.fuelRecord && returnFuelLevel) {
      await prisma.fuelRecord.update({
        where: { bookingId: booking.id },
        data: { returnFuelLevel: returnFuelLevel as any, returnAt: new Date(), capturedByReturnId: actor.id },
      });
    }

    // Save POST_RETURN photos if provided (outside transaction — non-critical)
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

    await auditService.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      actorBranchId: actor.branchId ?? undefined,
      action: "RETURN_SESSION_COMPUTED",
      category: AuditCategory.PAYMENT,
      description: `Return session computed for booking ${booking.publicId}: ₹${totalManualCharges.toFixed(2)} additional charges`,
      entity: "PaymentSession",
      entityId: session.publicId,
      metadata: {
        finalTotal: totalManualCharges.toFixed(2),
        safetyDepositCredit: safetyDeposit.toFixed(2),
        chargeCount: manualCharges.length,
      },
    });

    await staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.RECALCULATED,
      entityType: StaffEntityType.PAYMENT_SESSION,
      entityRef: session.publicId,
      description: `Return charges computed for booking ${bookingId}: ₹${totalManualCharges.toFixed(2)} additional charges`,
      metadata: { totalManualCharges: totalManualCharges.toFixed(2), chargeCount: manualCharges.length },
    });

    const updatedSession = await paymentSessionService.getSession(session.publicId);
    return res.status(StatusCode.OK).json({
      message: "Return session computed",
      data: {
        session: serializeReturnSession(updatedSession!),
        chargeBreakdown: chargeBreakdownForMeta,
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

    // Read chargeBreakdown stored in metadata during compute (may be null for old sessions)
    const meta = session.metadata as any;
    const chargeBreakdown = meta?.chargeBreakdown ?? null;

    return res.status(StatusCode.OK).json({
      message: "Return session fetched",
      data: {
        session: serializeReturnSession(session),
        chargeBreakdown,
      },
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
      gstAmount: new Decimal(e.gstAmount?.toString() ?? "0").toFixed(2),
      description: e.description,
      referenceType: e.referenceType,
      referenceId: e.referenceId,
      isVoided: e.isVoided,
      createdAt: e.createdAt,
    })),
  };
}

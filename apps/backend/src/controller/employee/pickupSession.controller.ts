/**
 * Pickup Session controller — session-driven ledger flow for vehicle pickup.
 *
 * Endpoints:
 *   POST /employee/bookings/:bookingId/pickup-session/initiate
 *   GET  /employee/bookings/:bookingId/pickup-session
 *
 * Only active when BranchChargeConfig.usePaymentSessions = true.
 * Falls back gracefully when the flag is off (returns 409 with message).
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
import type { FrozenChargeConfig } from "../../types/charge-engine.types.js";
import { DEFAULT_FROZEN_CHARGE_CONFIG } from "../../types/charge-engine.types.js";
import { createID } from "../../utils/nanoID.js";

const initiatePickupSessionSchema = z.object({
  // Optional: override the computed remaining balance (e.g. after discount)
  overrideRemainingBalance: z.coerce.number().positive().optional(),
  // Safety deposit
  safetyDepositAmount: z.coerce.number().positive().optional(),
  safetyDepositReason: z.string().min(1).optional(),
  // Handover metadata — saved now; vehicle status set when payment is recorded
  odo: z.coerce.number().min(0).optional(),
  fuelLevel: z.coerce.number().min(0).max(100).optional(),
  pickupFuelLevel: z.enum(["EMPTY", "QUARTER", "HALF", "THREE_QUARTER", "FULL"]).optional(),
  pickupImageIds: z.array(z.string()).optional(),
  captureImages: z.array(z.object({ fileId: z.string(), label: z.string() })).optional(),
});

// ── POST /employee/bookings/:bookingId/pickup-session/initiate ─────────────────

export const InitiatePickupSession = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;

    const validation = initiatePickupSessionSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation failed",
        errors: validation.error.format(),
      });
    }
    const {
      overrideRemainingBalance,
      safetyDepositAmount,
      safetyDepositReason,
      odo,
      fuelLevel,
      pickupFuelLevel,
      pickupImageIds,
      captureImages,
    } = validation.data;

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

    if (booking.status !== BookingStatus.CONFIRMED) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `Cannot initiate pickup session. Booking status: ${booking.status}`,
      });
    }

    // Feature flag check
    const usePaymentSessions = booking.branch?.chargeConfig?.usePaymentSessions ?? false;
    if (!usePaymentSessions) {
      return res.status(StatusCode.CONFLICT).json({
        message: "Payment session flow is not enabled for this branch. Use the legacy pickup endpoint.",
      });
    }

    const frozenConfig = (booking.frozenChargeConfig as FrozenChargeConfig | null)
      ?? DEFAULT_FROZEN_CHARGE_CONFIG;

    // Validate safety deposit inputs
    if (frozenConfig.safetyDepositEnabled && safetyDepositAmount !== undefined) {
      if (!safetyDepositReason) {
        return res.status(StatusCode.BAD_REQUEST).json({
          message: "safetyDepositReason is required when safetyDepositAmount is provided",
        });
      }
    }

    // Create or return existing PICKUP session
    const session = await paymentSessionService.createSession(
      booking.id,
      booking.branchId,
      PaymentSessionType.PICKUP,
      actor.id,
    );

    // If session already had entries (idempotent re-initiation), return it as-is
    const remainingBalance = overrideRemainingBalance
      ?? new Decimal(booking.remainingBalance?.toString() ?? "0").toNumber();

    if (session.entries && session.entries.length > 0) {
      // Already populated — return existing session
      await paymentSessionService.updateStatus(
        session.id,
        PaymentSessionStatus.AWAITING_PAYMENT,
        {},
      );
      const updatedSession = await paymentSessionService.getSession(session.publicId);
      return res.status(StatusCode.OK).json({
        message: "Pickup session already initiated",
        data: serializePickupSession(updatedSession!),
      });
    }

    // Add BOOKING_BASE ledger entry (the remaining balance to be collected)
    await prisma.$transaction(async (tx) => {
      if (remainingBalance > 0) {
        await ledgerService.addEntry(
          session.id,
          booking.id,
          LedgerEntryType.BOOKING_BASE,
          LedgerEntryClassification.TAXABLE,
          remainingBalance,
          "Remaining balance due at pickup",
          actor.id,
          String(actor.role),
          {
            idempotencyKey: `pickup:${booking.id}:base:${session.id}`,
            referenceType: "BOOKING_REMAINING",
            referenceId: booking.publicId,
          },
          tx as any,
        );
      }

      // Add DEPOSIT ledger entry if safety deposit is requested
      if (
        frozenConfig.safetyDepositEnabled &&
        safetyDepositAmount !== undefined &&
        safetyDepositReason
      ) {
        await ledgerService.addEntry(
          session.id,
          booking.id,
          LedgerEntryType.DEPOSIT,
          LedgerEntryClassification.NON_TAXABLE,
          safetyDepositAmount,
          safetyDepositReason,
          actor.id,
          String(actor.role),
          {
            idempotencyKey: `pickup:${booking.id}:deposit:${session.id}`,
            referenceType: "SAFETY_DEPOSIT",
          },
          tx as any,
        );

        // Create SafetyDepositRequest
        await tx.safetyDepositRequest.create({
          data: {
            publicId: `sdp_${session.id}`,
            bookingId: booking.id,
            requestedAmount: String(safetyDepositAmount),
            reason: safetyDepositReason,
            status: frozenConfig.safetyDepositRequiresApproval ? "PENDING_APPROVAL" : "APPROVED",
            requestedById: actor.id,
            approvedAmount: frozenConfig.safetyDepositRequiresApproval
              ? undefined
              : String(safetyDepositAmount),
            approvedAt: frozenConfig.safetyDepositRequiresApproval ? undefined : new Date(),
          },
        });

        if (!frozenConfig.safetyDepositRequiresApproval) {
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              safetyDeposit: { increment: safetyDepositAmount },
              safetyDepositPaidAt: new Date(),
            },
          });
        }
      }

      // ── Handover metadata ────────────────────────────────────────────────
      // Save odo/fuel/photos now; vehicle status is updated by runPostCompletionHooks
      // when payment is recorded.

      if (odo !== undefined) {
        await tx.booking.update({
          where: { id: booking.id },
          data: { startOdometer: odo },
        });
        // Pre-set vehicle odometer so it's ready when status flips to OUT_FOR_RENTAL
        const vehicleIds = (await tx.bookingItem.findMany({
          where: { bookingId: booking.id },
          select: { vehicleId: true },
        })).map((i: any) => i.vehicleId);
        if (vehicleIds.length > 0) {
          await tx.vehicle.updateMany({
            where: { id: { in: vehicleIds } },
            data: {
              odo,
              ...(fuelLevel !== undefined && { fuelLevel }),
            },
          });
        }
      }

      if (frozenConfig.fuelModuleEnabled && pickupFuelLevel) {
        await tx.fuelRecord.create({
          data: {
            publicId: createID(),
            bookingId: booking.id,
            pickupFuelLevel,
            capturedByPickupId: actor.id,
            pickupAt: new Date(),
          },
        });
      }

      if (pickupImageIds && pickupImageIds.length > 0) {
        const files = await tx.fileObject.findMany({
          where: { publicId: { in: pickupImageIds } },
        });
        if (files.length !== pickupImageIds.length) {
          throw new Error("Invalid pickupImageIds provided");
        }
        await tx.bookingPhoto.createMany({
          data: files.map((f: any) => ({
            publicId: createID(),
            bookingId: booking.id,
            fileId: f.id,
            type: BookingPhotoType.PRE_DELIVERY,
          })),
        });
      }

      if (captureImages && captureImages.length > 0) {
        const fileIds = captureImages.map((c) => c.fileId);
        const files = await tx.fileObject.findMany({ where: { publicId: { in: fileIds } } });
        if (files.length !== fileIds.length) throw new Error("Invalid captureImages fileIds");
        const fileMap = new Map((files as any[]).map((f) => [f.publicId, f]));
        await tx.bookingPhoto.createMany({
          data: captureImages.map((c) => ({
            publicId: createID(),
            bookingId: booking.id,
            fileId: fileMap.get(c.fileId)!.id,
            type: BookingPhotoType.PRE_DELIVERY,
            captureLabel: c.label,
          })),
        });
      }

      // Transition session to AWAITING_PAYMENT
      await paymentSessionService.updateStatus(
        session.id,
        PaymentSessionStatus.AWAITING_PAYMENT,
        {},
        tx as any,
      );
    });

    await auditService.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      actorBranchId: actor.branchId ?? undefined,
      action: "PICKUP_SESSION_INITIATED",
      category: AuditCategory.PAYMENT,
      description: `Pickup payment session initiated for booking ${booking.publicId}`,
      entity: "PaymentSession",
      entityId: session.publicId,
      metadata: { remainingBalance, safetyDepositAmount },
    });

    await staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.INITIATED,
      entityType: StaffEntityType.PAYMENT_SESSION,
      entityRef: session.publicId,
      description: `Pickup session initiated for booking ${booking.publicId}: ₹${remainingBalance} due`,
      metadata: { remainingBalance },
    });

    const updatedSession = await paymentSessionService.getSession(session.publicId);
    return res.status(StatusCode.CREATED).json({
      message: "Pickup session initiated",
      data: serializePickupSession(updatedSession!),
    });
  } catch (err: any) {
    console.error("InitiatePickupSession Error:", err);
    return res.status(err.status ?? StatusCode.INTERNAL_SERVER_ERROR).json({
      message: err.message ?? "Internal server error",
    });
  }
};

// ── GET /employee/bookings/:bookingId/pickup-session ───────────────────────────

export const GetPickupSession = async (req: Request, res: Response) => {
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
        sessionType: PaymentSessionType.PICKUP,
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
      return res.status(StatusCode.NOT_FOUND).json({ message: "No active pickup session found" });
    }

    return res.status(StatusCode.OK).json({
      message: "Pickup session fetched",
      data: serializePickupSession(session),
    });
  } catch (err: any) {
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message });
  }
};

// ── Serializer ────────────────────────────────────────────────────────────────

function serializePickupSession(session: any) {
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
      description: e.description,
      referenceType: e.referenceType,
      createdAt: e.createdAt,
    })),
  };
}

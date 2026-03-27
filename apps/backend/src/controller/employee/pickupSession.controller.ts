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
  ExtensionStatus,
  LedgerEntryType,
  LedgerEntryClassification,
  PaymentSessionType,
  PaymentSessionStatus,
  DiscountType,
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
  // Optional: a PENDING_PAYMENT extension to include in this session
  extensionPublicId: z.string().min(1).optional(),
  // Optional: coupon code to apply as a DISCOUNT ledger entry at initiation
  discountCode: z.string().min(1).optional(),
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
      extensionPublicId,
      discountCode,
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
    if (safetyDepositAmount !== undefined && !safetyDepositReason) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "safetyDepositReason is required when safetyDepositAmount is provided",
      });
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
    // timeout: many chained ledger ops (addEntry calls recomputeTotals internally)
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

      // Add DEPOSIT ledger entry if safety deposit is provided
      if (safetyDepositAmount !== undefined && safetyDepositReason) {
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

        // Create SafetyDepositRequest (auto-approved — no manager step)
        await tx.safetyDepositRequest.create({
          data: {
            publicId: `sdp_${session.id}`,
            bookingId: booking.id,
            requestedAmount: String(safetyDepositAmount),
            reason: safetyDepositReason,
            status: "APPROVED",
            requestedById: actor.id,
            approvedAmount: String(safetyDepositAmount),
            approvedAt: new Date(),
          },
        });

        await tx.booking.update({
          where: { id: booking.id },
          data: {
            safetyDeposit: { increment: safetyDepositAmount },
            safetyDepositPaidAt: new Date(),
          },
        });
      }

      // ── Extension ledger entry ───────────────────────────────────────────
      // If a PENDING_PAYMENT extension is provided, add its charge to the session.
      // The extension is confirmed atomically when payment is recorded.
      if (extensionPublicId) {
        const extension = await (tx as any).bookingExtension.findFirst({
          where: {
            publicId: extensionPublicId,
            bookingId: booking.id,
            extensionStatus: ExtensionStatus.PENDING_PAYMENT,
          },
          select: { id: true, publicId: true, additionalAmount: true, requestedEndAt: true },
        });
        if (!extension) {
          throw Object.assign(
            new Error("Extension not found or not in PENDING_PAYMENT status"),
            { status: 400 },
          );
        }
        const extAmount = new Decimal(extension.additionalAmount.toString());
        if (extAmount.gt(0)) {
          const extDate = new Date(extension.requestedEndAt).toLocaleDateString("en-IN", {
            day: "2-digit", month: "short", year: "numeric",
          });
          await ledgerService.addEntry(
            session.id,
            booking.id,
            LedgerEntryType.EXTENSION,
            LedgerEntryClassification.TAXABLE,
            extAmount,
            `Extension charge (until ${extDate})`,
            actor.id,
            String(actor.role),
            {
              idempotencyKey: `pickup:${booking.id}:ext:${extension.id}:${session.id}`,
              referenceType: "BOOKING_EXTENSION",
              referenceId: extension.publicId,
            },
            tx as any,
          );
        }
      }

      // ── Discount ledger entry ────────────────────────────────────────────
      if (discountCode) {
        const now = new Date();
        const rule = await (tx as any).discountRule.findUnique({ where: { code: discountCode } });
        if (rule && rule.isActive && rule.startDate <= now && rule.endDate >= now) {
          // We need the session totals recomputed after base+deposit+extension to compute %
          await paymentSessionService.recomputeTotals(session.id, tx as any);
          const refreshedSession = await (tx as any).paymentSession.findUnique({
            where: { id: session.id },
            select: { taxableBase: true, totalCharges: true },
          });
          const taxableBase = new Decimal(refreshedSession.taxableBase?.toString() ?? "0");
          const totalCharges = new Decimal(refreshedSession.totalCharges?.toString() ?? "0");
          let discountAmount: Decimal;
          if (rule.discountType === DiscountType.PERCENTAGE) {
            discountAmount = taxableBase.mul(rule.value).div(100);
            if (rule.maxDiscountCap) {
              discountAmount = Decimal.min(discountAmount, new Decimal(rule.maxDiscountCap.toString()));
            }
          } else {
            discountAmount = Decimal.min(new Decimal(rule.value.toString()), totalCharges);
          }
          discountAmount = discountAmount.toDecimalPlaces(2);
          if (discountAmount.gt(0)) {
            await (tx as any).ledgerEntry.create({
              data: {
                publicId: createID(),
                sessionId: session.id,
                bookingId: booking.id,
                entryType: LedgerEntryType.DISCOUNT,
                classification: LedgerEntryClassification.DISCOUNT,
                amount: discountAmount.negated().toFixed(2),
                baseAmount: "0.00",
                gstAmount: "0.00",
                description: `Coupon discount (${rule.code})`,
                referenceId: rule.publicId,
                referenceType: "DISCOUNT_RULE",
                idempotencyKey: `pickup:${booking.id}:discount:${session.id}:${rule.id}`,
                actorId: actor.id,
                actorRole: String(actor.role),
              },
            });
          }
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
    }, { timeout: 30000 });

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

// ── POST /employee/bookings/:bookingId/pickup-session/abandon ──────────────────

export const AbandonPickupSession = async (req: Request, res: Response) => {
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
      select: { id: true },
    });

    if (!session) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "No active pickup session to abandon" });
    }

    await prisma.paymentSession.update({
      where: { id: session.id },
      data: { status: PaymentSessionStatus.ABANDONED },
    });

    return res.status(StatusCode.OK).json({ message: "Pickup session abandoned" });
  } catch (err: any) {
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message });
  }
};

// ── POST /employee/bookings/:bookingId/pickup-session/apply-discount ──────────

const applyDiscountSchema = z.object({
  discountCode: z.string().min(1),
});

export const ApplyDiscountToPickupSession = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;

    const validation = applyDiscountSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Validation failed", errors: validation.error.format() });
    }
    const { discountCode } = validation.data;

    const actor = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, name: true, role: true, branchId: true },
    });
    if (!actor) return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });

    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId: actor.branchId! },
      select: { id: true, customerId: true },
    });
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });

    // Validate discount rule
    const now = new Date();
    const rule = await prisma.discountRule.findUnique({
      where: { code: discountCode },
    });
    if (!rule || !rule.isActive || rule.startDate > now || rule.endDate < now) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid or expired discount code" });
    }
    if (rule.scope === "BRANCH" && !rule.applicableBranchIds.includes(actor.branchId!)) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Discount code not valid for this branch" });
    }

    // Find active PICKUP session
    const session = await prisma.paymentSession.findFirst({
      where: {
        bookingId: booking.id,
        sessionType: PaymentSessionType.PICKUP,
        status: { in: [PaymentSessionStatus.OPEN, PaymentSessionStatus.AWAITING_PAYMENT] },
      },
      include: { entries: { where: { isVoided: false } } },
    });
    if (!session) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "No active pickup session found. Initiate a session first." });
    }

    // Compute discount amount from rule
    const taxableBase = new Decimal(session.taxableBase?.toString() ?? "0");
    const totalCharges = new Decimal(session.totalCharges?.toString() ?? "0");

    let discountAmount: Decimal;
    if (rule.discountType === DiscountType.PERCENTAGE) {
      discountAmount = taxableBase.mul(rule.value).div(100);
      if (rule.maxDiscountCap) {
        discountAmount = Decimal.min(discountAmount, new Decimal(rule.maxDiscountCap.toString()));
      }
    } else {
      // FLAT
      discountAmount = Decimal.min(new Decimal(rule.value.toString()), totalCharges);
    }
    discountAmount = discountAmount.toDecimalPlaces(2);

    if (discountAmount.lte(0)) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Discount amount is zero — no charges to discount" });
    }

    await prisma.$transaction(async (tx) => {
      // Void any existing DISCOUNT entry
      await (tx as any).ledgerEntry.updateMany({
        where: { sessionId: session.id, entryType: LedgerEntryType.DISCOUNT, isVoided: false },
        data: { isVoided: true, voidedAt: new Date(), voidedById: actor.id, voidReason: "Replaced by new discount" },
      });

      // Create new DISCOUNT entry (negative = reduces net payable)
      await (tx as any).ledgerEntry.create({
        data: {
          publicId: createID(),
          sessionId: session.id,
          bookingId: booking.id,
          entryType: LedgerEntryType.DISCOUNT,
          classification: LedgerEntryClassification.DISCOUNT,
          amount: discountAmount.negated().toFixed(2),
          baseAmount: "0.00",
          gstAmount: "0.00",
          description: `Coupon discount (${rule.code})`,
          referenceId: rule.publicId,
          referenceType: "DISCOUNT_RULE",
          idempotencyKey: `pickup:${booking.id}:discount:${session.id}:${rule.id}`,
          actorId: actor.id,
          actorRole: String(actor.role),
        },
      });

      await paymentSessionService.recomputeTotals(session.id, tx as any);
    });

    const updatedSession = await paymentSessionService.getSession(session.publicId);
    return res.status(StatusCode.OK).json({
      message: "Discount applied to session",
      data: serializePickupSession(updatedSession!),
    });
  } catch (err: any) {
    console.error("ApplyDiscountToPickupSession Error:", err);
    return res.status(err.status ?? StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message ?? "Internal server error" });
  }
};

// ── DELETE /employee/bookings/:bookingId/pickup-session/remove-discount ────────

export const RemoveDiscountFromPickupSession = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;

    const actor = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, branchId: true },
    });
    if (!actor) return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });

    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId: actor.branchId! },
      select: { id: true },
    });
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });

    const session = await prisma.paymentSession.findFirst({
      where: {
        bookingId: booking.id,
        sessionType: PaymentSessionType.PICKUP,
        status: { in: [PaymentSessionStatus.OPEN, PaymentSessionStatus.AWAITING_PAYMENT] },
      },
    });
    if (!session) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "No active pickup session found" });
    }

    await prisma.$transaction(async (tx) => {
      await (tx as any).ledgerEntry.updateMany({
        where: { sessionId: session.id, entryType: LedgerEntryType.DISCOUNT, isVoided: false },
        data: { isVoided: true, voidedAt: new Date(), voidedById: actor.id, voidReason: "Discount removed by employee" },
      });
      await paymentSessionService.recomputeTotals(session.id, tx as any);
    });

    const updatedSession = await paymentSessionService.getSession(session.publicId);
    return res.status(StatusCode.OK).json({
      message: "Discount removed from session",
      data: serializePickupSession(updatedSession!),
    });
  } catch (err: any) {
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message });
  }
};

// ── POST /employee/bookings/:bookingId/pickup-session/add-deposit ─────────────

const addDepositSchema = z.object({
  amount: z.coerce.number().positive(),
  reason: z.string().min(1),
});

export const AddDepositToPickupSession = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;

    const validation = addDepositSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Validation failed", errors: validation.error.format() });
    }
    const { amount, reason } = validation.data;

    const actor = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, name: true, role: true, branchId: true },
    });
    if (!actor) return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });

    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId: actor.branchId! },
      select: { id: true, safetyDeposit: true },
    });
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });

    const session = await prisma.paymentSession.findFirst({
      where: {
        bookingId: booking.id,
        sessionType: PaymentSessionType.PICKUP,
        status: { in: [PaymentSessionStatus.OPEN, PaymentSessionStatus.AWAITING_PAYMENT] },
      },
      include: { entries: { where: { isVoided: false, entryType: LedgerEntryType.DEPOSIT } } },
    });
    if (!session) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "No active pickup session found" });
    }

    await prisma.$transaction(async (tx) => {
      // Subtract old deposit from booking if one exists in session
      const oldDeposit = session.entries[0];
      if (oldDeposit) {
        const oldAmt = new Decimal(oldDeposit.amount.toString());
        await (tx as any).ledgerEntry.update({
          where: { id: oldDeposit.id },
          data: { isVoided: true, voidedAt: new Date(), voidedById: actor.id, voidReason: "Replaced by updated deposit amount" },
        });
        await (tx as any).booking.update({
          where: { id: booking.id },
          data: { safetyDeposit: { decrement: oldAmt.toNumber() } },
        });
      }

      // Create new DEPOSIT entry
      await (tx as any).ledgerEntry.create({
        data: {
          publicId: createID(),
          sessionId: session.id,
          bookingId: booking.id,
          entryType: LedgerEntryType.DEPOSIT,
          classification: LedgerEntryClassification.NON_TAXABLE,
          amount: new Decimal(amount).toFixed(2),
          baseAmount: "0.00",
          gstAmount: "0.00",
          description: reason,
          referenceType: "SAFETY_DEPOSIT",
          idempotencyKey: `pickup:${booking.id}:deposit:${session.id}:${Date.now()}`,
          actorId: actor.id,
          actorRole: String(actor.role),
        },
      });

      // Upsert SafetyDepositRequest
      await (tx as any).safetyDepositRequest.upsert({
        where: { bookingId: booking.id },
        update: {
          requestedAmount: String(amount),
          reason,
          status: "APPROVED",
          requestedById: actor.id,
          approvedAmount: String(amount),
          approvedAt: new Date(),
          rejectedAt: null,
          rejectionReason: null,
        },
        create: {
          publicId: createID(),
          bookingId: booking.id,
          requestedAmount: String(amount),
          reason,
          status: "APPROVED",
          requestedById: actor.id,
          approvedAmount: String(amount),
          approvedAt: new Date(),
        },
      });

      // Add deposit to booking
      await (tx as any).booking.update({
        where: { id: booking.id },
        data: {
          safetyDeposit: { increment: amount },
          safetyDepositPaidAt: new Date(),
        },
      });

      await paymentSessionService.recomputeTotals(session.id, tx as any);
    });

    const updatedSession = await paymentSessionService.getSession(session.publicId);
    return res.status(StatusCode.OK).json({
      message: "Safety deposit added to session",
      data: serializePickupSession(updatedSession!),
    });
  } catch (err: any) {
    console.error("AddDepositToPickupSession Error:", err);
    return res.status(err.status ?? StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message ?? "Internal server error" });
  }
};

// ── DELETE /employee/bookings/:bookingId/pickup-session/remove-deposit ─────────

export const RemoveDepositFromPickupSession = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;

    const actor = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, branchId: true },
    });
    if (!actor) return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });

    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId: actor.branchId! },
      select: { id: true, safetyDeposit: true },
    });
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });

    const session = await prisma.paymentSession.findFirst({
      where: {
        bookingId: booking.id,
        sessionType: PaymentSessionType.PICKUP,
        status: { in: [PaymentSessionStatus.OPEN, PaymentSessionStatus.AWAITING_PAYMENT] },
      },
      include: { entries: { where: { isVoided: false, entryType: LedgerEntryType.DEPOSIT } } },
    });
    if (!session) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "No active pickup session found" });
    }

    if (session.entries.length === 0) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "No safety deposit in this session to remove" });
    }

    const depositEntry = session.entries[0];
    const depositAmt = new Decimal(depositEntry.amount.toString());

    await prisma.$transaction(async (tx) => {
      // Void the DEPOSIT ledger entry
      await (tx as any).ledgerEntry.update({
        where: { id: depositEntry.id },
        data: { isVoided: true, voidedAt: new Date(), voidedById: actor.id, voidReason: "Deposit removed by employee" },
      });

      // Delete the SafetyDepositRequest
      await (tx as any).safetyDepositRequest.deleteMany({
        where: { bookingId: booking.id },
      });

      // Reverse the booking safetyDeposit increment
      await (tx as any).booking.update({
        where: { id: booking.id },
        data: {
          safetyDeposit: { decrement: depositAmt.toNumber() },
          safetyDepositPaidAt: null,
        },
      });

      await paymentSessionService.recomputeTotals(session.id, tx as any);
    });

    const updatedSession = await paymentSessionService.getSession(session.publicId);
    return res.status(StatusCode.OK).json({
      message: "Safety deposit removed from session",
      data: serializePickupSession(updatedSession!),
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

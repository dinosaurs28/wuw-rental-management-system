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
import { cancelledPickupRefusal, lockBookingForPickup, PickupStateError } from "../../services/booking/booking-row-lock.js";
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
import {
  quoteCounterCoupon,
  writeCounterCouponEntry,
  serializeCounterCouponQuote,
  CounterCouponError,
  COUNTER_COUPON_REF,
} from "../../services/discount/counter-coupon.service.js";
import {
  quoteSessionPickupDiscount,
  writeSessionPickupDiscount,
  voidSessionPickupDiscount,
} from "../../services/discount/pickup-discount.service.js";
import {
  PICKUP_DISCOUNT_REF,
  PickupDiscountError,
  parsePickupDiscountAmount,
  parsePickupDiscountReason,
  pickupBillRent,
} from "../../services/discount/pickup-discount-rules.js";
import { DL_COLLECTION_STATUSES, DL_DEPOSIT_NOTE_MAX } from "@repo/schemas";
import { fastagBalanceField } from "../../services/charges/fastag-usage.js";
import {
  resolvePickupDlStatus,
  dlStatusUpdateData,
  dlValidationError,
  DlStatusError,
} from "../../services/booking/dl-status.service.js";
import { checkVehiclesReadyForPickup } from "../../utils/availability/outForRental.js";

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
  // Optional: manual pickup discount (flat ₹ off the rent incl. GST), checked like
  // POST …/pickup-session/manual-discount (amount / reason validated in the handler)
  pickupDiscount: z.object({ amount: z.unknown(), reason: z.unknown().optional() }).optional(),
  // Handover metadata — saved now; vehicle status set when payment is recorded
  odo: z.coerce.number().min(0).optional(),
  fuelLevel: z.coerce.number().min(0).max(100).optional(),
  pickupFuelLevel: z.string().regex(/^([1-9]|10)$/).optional(),
  // FASTag balance at the handover (cars with a FASTag) — optional: older builds don't send it
  pickupFastagBalance: fastagBalanceField,
  pickupImageIds: z.array(z.string()).optional(),
  captureImages: z.array(z.object({ fileId: z.string(), label: z.string() })).optional(),
  // Original licence custody (#3), OPTIONAL (X1): COLLECTED / NOT_COLLECTED /
  // DEPOSIT (+ note); omitted or null ⇒ left unset. licenseCollected is the old
  // builds' tick: true ⇒ COLLECTED, false ⇒ NOT_COLLECTED.
  dlStatus: z.enum(DL_COLLECTION_STATUSES).nullish(),
  dlDepositNote: z.string().trim().max(DL_DEPOSIT_NOTE_MAX).nullish(),
  licenseCollected: z.boolean().optional(),
});

// ── POST /employee/bookings/:bookingId/pickup-session/initiate ─────────────────

export const InitiatePickupSession = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;

    const validation = initiatePickupSessionSchema.safeParse(req.body);
    if (!validation.success) {
      const dlError = dlValidationError(validation.error);
      if (dlError) return res.status(dlError.status).json(dlError.toJSON());
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
      pickupDiscount,
      odo,
      fuelLevel,
      pickupFuelLevel,
      pickupFastagBalance,
      pickupImageIds,
      captureImages,
      dlStatus,
      dlDepositNote,
      licenseCollected,
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

    // Cancelled (e.g. by the branch manager): 409 BOOKING_CANCELLED
    const cancelled = cancelledPickupRefusal(booking);
    if (cancelled) return res.status(cancelled.status).json(cancelled.toJSON());

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

    // Manual pickup discount sent with the initiate: 400 PICKUP_DISCOUNT_INVALID now
    const manualDiscount = pickupDiscount
      ? { amount: parsePickupDiscountAmount(pickupDiscount.amount), reason: parsePickupDiscountReason(pickupDiscount.reason) }
      : null;

    // Validate safety deposit inputs
    if (safetyDepositAmount !== undefined && !safetyDepositReason) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "safetyDepositReason is required when safetyDepositAmount is provided",
      });
    }

    // The DL number is no longer asked at pickup (client, Oct 17 2026): a
    // `drivingLicenceNumber` older app builds still send is ignored.

    // Original licence custody (#3), optional (X1). Old builds send the boolean
    // tick instead (true ⇒ COLLECTED, false ⇒ NOT_COLLECTED); sending neither
    // records nothing. Throws DlStatusError (DL_STATUS_INVALID for DEPOSIT).
    const dlChoice = resolvePickupDlStatus({ dlStatus, dlDepositNote, licenseCollected });

    // A re-initiated session may change the choice; licenseCollectedAt is only
    // written while unset, so it keeps the first collection time.
    const licenseCollectedData = dlChoice ? dlStatusUpdateData(dlChoice, actor.id, booking) : null;

    // The car must be here and AVAILABLE before any money is taken: 409
    // VEHICLE_STILL_OUT (another rental hasn't come back) / VEHICLE_NOT_READY
    // (damage review, maintenance …). Re-checked when the session completes.
    const pickupVehicleIds = (
      await prisma.bookingItem.findMany({ where: { bookingId: booking.id }, select: { vehicleId: true } })
    ).map((i) => i.vehicleId);
    const notReady = await checkVehiclesReadyForPickup(pickupVehicleIds, booking.id);
    if (notReady) {
      return res.status(StatusCode.CONFLICT).json(notReady);
    }

    // Create or return existing PICKUP session
    const session = await paymentSessionService.createSession(
      booking.id,
      booking.branchId,
      PaymentSessionType.PICKUP,
      actor.id,
    );

    // Remaining balance already settled separately (e.g. collected on the
    // phone) — the session must not charge it again, override or not.
    const remainingBalance = booking.remainingPaidAt
      ? 0
      : overrideRemainingBalance
        ?? new Decimal(booking.remainingBalance?.toString() ?? "0").toNumber();

    // Idempotent re-initiation: a session past OPEN was already set up — even
    // one with no entries (nothing due) — so return it as-is instead of
    // re-writing handover data (fuel record, photos, deposit request).
    if (session.status !== PaymentSessionStatus.OPEN || (session.entries?.length ?? 0) > 0) {
      if (licenseCollectedData) {
        await prisma.booking.update({
          where: { id: booking.id },
          data: licenseCollectedData,
        });
      }
      // Already awaiting payment (staff pressed initiate again): no transition —
      // AWAITING_PAYMENT → AWAITING_PAYMENT is not an allowed move and used to 500.
      if (session.status !== PaymentSessionStatus.AWAITING_PAYMENT) {
        await paymentSessionService.updateStatus(
          session.id,
          PaymentSessionStatus.AWAITING_PAYMENT,
          {},
        );
      }
      // Balance paid after this session was created: drop its stale line
      if (booking.remainingPaidAt) {
        const staleLines = (session.entries ?? []).filter(
          (e: any) => e.referenceType === "BOOKING_REMAINING" && !e.isVoided,
        );
        for (const line of staleLines) {
          await ledgerService.voidEntry(line.publicId, actor.id, "Remaining balance paid separately");
        }
        // A counter coupon / manual discount was sized against that balance — staff re-apply it if still wanted
        if (staleLines.length > 0) {
          const couponLines = (session.entries ?? []).filter(
            (e: any) => (e.referenceType === COUNTER_COUPON_REF || e.referenceType === PICKUP_DISCOUNT_REF) && !e.isVoided,
          );
          for (const line of couponLines) {
            await ledgerService.voidEntry(line.publicId, actor.id, "Balance it discounted was paid separately");
          }
        }
      }
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
          select: {
            id: true, publicId: true, additionalAmount: true, requestedEndAt: true,
            baseAmount: true, taxableAmount: true, taxAmount: true, cgstAmount: true, sgstAmount: true, taxRate: true,
          },
        });
        if (!extension) {
          throw Object.assign(
            new Error("Extension not found or not in PENDING_PAYMENT status"),
            { status: 400 },
          );
        }
        const extAmount = new Decimal(extension.additionalAmount.toString());
        if (extAmount.gt(0)) {
          const extDate = new Date(extension.requestedEndAt).toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
          });
          // The extension's GST was computed and frozen when it was priced: post
          // the taxable value as the TAXABLE amount and its stored GST alongside,
          // so the session net (taxable + GST) still equals additionalAmount.
          const extTaxable = new Decimal(extension.taxableAmount.toString());
          const extGst = new Decimal(extension.taxAmount.toString());
          const splitHolds = extTaxable.gt(0) && extTaxable.add(extGst).eq(extAmount);
          await ledgerService.addEntry(
            session.id,
            booking.id,
            LedgerEntryType.EXTENSION,
            LedgerEntryClassification.TAXABLE,
            splitHolds ? extTaxable : extAmount,
            `Extension charge (until ${extDate})`,
            actor.id,
            String(actor.role),
            {
              idempotencyKey: `pickup:${booking.id}:ext:${extension.id}:${session.id}`,
              referenceType: "BOOKING_EXTENSION",
              referenceId: extension.publicId,
              ...(splitHolds && {
                baseAmount: new Decimal(extension.baseAmount.toString()),
                gstAmount: extGst,
                metadata: {
                  cgstAmount: new Decimal(extension.cgstAmount.toString()).toFixed(2),
                  sgstAmount: new Decimal(extension.sgstAmount.toString()).toFixed(2),
                  taxRate: new Decimal(extension.taxRate.toString()).toFixed(2),
                },
              }),
            },
            tx as any,
          );
        }
      }

      // ── Counter coupon ───────────────────────────────────────────────────
      // Fully validated against the booking (same rules as online). An invalid
      // code fails the whole initiate (422/409 with its code) instead of being
      // silently skipped, so staff never promise a discount that isn't applied.
      if (discountCode) {
        const quote = await quoteCounterCoupon(tx, booking.id, session.id, discountCode);
        await writeCounterCouponEntry(tx, {
          sessionId: session.id,
          bookingId: booking.id,
          quote,
          actor: { id: actor.id, role: String(actor.role) },
        });
      }

      // ── Manual pickup discount ───────────────────────────────────────────
      // Capped at the rent on this bill less the coupon above; above it the whole
      // initiate fails (400 PICKUP_DISCOUNT_EXCEEDS) so nothing is half-saved.
      if (manualDiscount) {
        const quote = await quoteSessionPickupDiscount(tx, booking.id, session.id, manualDiscount.amount);
        await writeSessionPickupDiscount(tx, {
          sessionId: session.id,
          bookingId: booking.id,
          quote,
          reason: manualDiscount.reason,
          actor: { id: actor.id, role: String(actor.role) },
        });
      }

      // ── Handover metadata ────────────────────────────────────────────────
      // Save odo/fuel/photos now; vehicle status is updated by runPostCompletionHooks
      // when payment is recorded.

      if (licenseCollectedData) {
        await tx.booking.update({
          where: { id: booking.id },
          data: licenseCollectedData,
        });
      }

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

      // FASTag balance at the handover — any car (a car not marked as having a
      // FASTag still counts as one for this booking once its balance is read)
      if (pickupFastagBalance !== undefined) {
        await tx.booking.update({
          where: { id: booking.id },
          data: { pickupFastagBalance: pickupFastagBalance.toFixed(2) },
        });
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
      metadata: {
        remainingBalance,
        safetyDepositAmount,
        pickupDiscount: manualDiscount ? manualDiscount.amount.toFixed(2) : null,
        pickupFastagBalance: pickupFastagBalance ?? null,
        dlStatus: dlChoice?.dlStatus ?? null,
        dlDepositNote: dlChoice?.dlDepositNote ?? null,
      },
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
    if (err instanceof DlStatusError) {
      return res.status(err.status).json(err.toJSON());
    }
    if (err instanceof CounterCouponError) {
      return res.status(err.status).json({ ...err.toJSON(), couponRejected: true });
    }
    if (err instanceof PickupDiscountError) {
      return res.status(err.status).json({ ...err.toJSON(), pickupDiscountRejected: true });
    }
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
      select: { id: true, customerId: true, status: true },
    });
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    if (booking.status !== BookingStatus.CONFIRMED) {
      return res.status(StatusCode.BAD_REQUEST).json({
        code: "INVALID_BOOKING_STATUS",
        message: `A counter coupon can only be applied before pickup. Booking status: ${booking.status}`,
      });
    }

    // Find active PICKUP session
    const session = await prisma.paymentSession.findFirst({
      where: {
        bookingId: booking.id,
        sessionType: PaymentSessionType.PICKUP,
        status: { in: [PaymentSessionStatus.OPEN, PaymentSessionStatus.AWAITING_PAYMENT] },
      },
      select: { id: true, publicId: true },
    });
    if (!session) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "No active pickup session found. Initiate a session first." });
    }

    // Full coupon check + amount (off the GST-inclusive rent, split into rent
    // without GST + the GST it takes off, capped at the rental/extension still
    // owed — never the safety deposit)
    let quoteView: ReturnType<typeof serializeCounterCouponQuote> | null = null;
    await prisma.$transaction(async (tx) => {
      // Serialised with the payment of this bill (it locks the same row)
      await lockOpenPickupSession(tx, booking.id, session.id);
      const quote = await quoteCounterCoupon(tx, booking.id, session.id, discountCode);
      await writeCounterCouponEntry(tx, {
        sessionId: session.id,
        bookingId: booking.id,
        quote,
        actor: { id: actor.id, role: String(actor.role) },
      });
      quoteView = serializeCounterCouponQuote(quote);
    }, { timeout: 15000 });

    const updatedSession = await paymentSessionService.getSession(session.publicId);
    return res.status(StatusCode.OK).json({
      message: "Coupon applied to the pickup bill",
      data: serializePickupSession(updatedSession!),
      coupon: quoteView,
    });
  } catch (err: any) {
    if (err instanceof CounterCouponError) {
      return res.status(err.status).json({ ...err.toJSON(), couponRejected: true });
    }
    if (err instanceof PickupStateError || err instanceof PickupBillClosedError) {
      return res.status(err.status).json(err.toJSON());
    }
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
      await lockOpenPickupSession(tx, booking.id, session.id);
      await (tx as any).ledgerEntry.updateMany({
        where: {
          sessionId: session.id,
          entryType: LedgerEntryType.DISCOUNT,
          referenceType: COUNTER_COUPON_REF,
          isVoided: false,
        },
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
    if (err instanceof PickupStateError || err instanceof PickupBillClosedError) {
      return res.status(err.status).json(err.toJSON());
    }
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message });
  }
};

// ── POST /employee/bookings/:bookingId/pickup-session/manual-discount ─────────
// Body: { amount: number (₹, off the GST-inclusive rent, 2 dp), reason?: string }
// Replaces any manual discount already on the bill. 400 PICKUP_DISCOUNT_EXCEEDS
// above the rental balance payable at this pickup (after a counter coupon; an
// extension on the bill is never discounted), with maxAmount.

/** 409: the pickup bill was paid / closed meanwhile — nothing was changed. */
class PickupBillClosedError extends Error {
  readonly status = StatusCode.CONFLICT;
  readonly code = "PICKUP_BILL_CLOSED";
  constructor(public readonly sessionStatus: string) {
    super("This pickup bill is no longer open (it was paid or closed). Reload it.");
    this.name = "PickupBillClosedError";
  }
  toJSON() {
    return { success: false, code: this.code, message: this.message, sessionStatus: this.sessionStatus };
  }
}

/**
 * First step of a change to the pickup bill's discounts: locks the booking row
 * (the bill's payment takes the same lock, so they never interleave), refuses a
 * booking no longer waiting for pickup (409 PickupStateError) and a bill that
 * is no longer open.
 */
async function lockOpenPickupSession(tx: any, bookingId: number, sessionId: number): Promise<void> {
  await lockBookingForPickup(tx, bookingId);
  const current = await tx.paymentSession.findUniqueOrThrow({ where: { id: sessionId }, select: { status: true } });
  if (current.status !== PaymentSessionStatus.OPEN && current.status !== PaymentSessionStatus.AWAITING_PAYMENT) {
    throw new PickupBillClosedError(current.status);
  }
}

/** The open PICKUP session of a booking at the actor's branch, or an HTTP refusal. */
async function openPickupSessionFor(bookingPublicId: string, branchId: number | null) {
  const booking = await prisma.booking.findFirst({
    where: { publicId: bookingPublicId, branchId: branchId! },
    select: { id: true, publicId: true, status: true },
  });
  if (!booking) return { ok: false, status: StatusCode.NOT_FOUND, body: { message: "Booking not found" } } as const;
  if (booking.status !== BookingStatus.CONFIRMED) {
    return {
      ok: false,
      status: StatusCode.BAD_REQUEST,
      body: {
        code: "INVALID_BOOKING_STATUS",
        message: `A pickup discount can only be given before the handover. Booking status: ${booking.status}`,
      },
    } as const;
  }
  const session = await prisma.paymentSession.findFirst({
    where: {
      bookingId: booking.id,
      sessionType: PaymentSessionType.PICKUP,
      status: { in: [PaymentSessionStatus.OPEN, PaymentSessionStatus.AWAITING_PAYMENT] },
    },
    select: { id: true, publicId: true },
  });
  if (!session) {
    return {
      ok: false,
      status: StatusCode.NOT_FOUND,
      body: { message: "No active pickup session found. Initiate a session first." },
    } as const;
  }
  return { ok: true, booking, session } as const;
}

export const SetPickupSessionManualDiscount = async (req: Request, res: Response) => {
  try {
    const amount = parsePickupDiscountAmount(req.body?.amount);
    const reason = parsePickupDiscountReason(req.body?.reason);

    const actor = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, name: true, role: true, branchId: true },
    });
    if (!actor) return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });

    const found = await openPickupSessionFor(req.params.bookingId!, actor.branchId);
    if (!found.ok) return res.status(found.status).json(found.body);
    const { booking, session } = found;

    let total = "0.00";
    await prisma.$transaction(async (tx) => {
      await lockOpenPickupSession(tx, booking.id, session.id);
      const quote = await quoteSessionPickupDiscount(tx, booking.id, session.id, amount);
      await writeSessionPickupDiscount(tx, {
        sessionId: session.id,
        bookingId: booking.id,
        quote,
        reason,
        actor: { id: actor.id, role: String(actor.role) },
      });
      total = quote.split.total.toFixed(2);
    }, { timeout: 15000 });

    await auditService.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      actorBranchId: actor.branchId ?? undefined,
      action: "PICKUP_DISCOUNT_APPLIED",
      category: AuditCategory.PAYMENT,
      description: `Pickup discount of ₹${total} given on booking ${booking.publicId}`,
      entity: "PaymentSession",
      entityId: session.publicId,
      metadata: { amount: total, reason },
    });
    await staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.APPLIED,
      entityType: StaffEntityType.PAYMENT_SESSION,
      entityRef: session.publicId,
      description: `Pickup discount of ₹${total} given on booking ${booking.publicId}${reason ? ` (${reason})` : ""}`,
      metadata: { bookingId: booking.publicId, pickupDiscount: total, reason },
    });

    const updatedSession = await paymentSessionService.getSession(session.publicId);
    return res.status(StatusCode.OK).json({
      message: "Discount added to the pickup bill",
      data: serializePickupSession(updatedSession!),
    });
  } catch (err: any) {
    if (err instanceof PickupDiscountError) return res.status(err.status).json(err.toJSON());
    if (err instanceof PickupStateError || err instanceof PickupBillClosedError) {
      return res.status(err.status).json(err.toJSON());
    }
    console.error("SetPickupSessionManualDiscount Error:", err);
    return res.status(err.status ?? StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message ?? "Internal server error" });
  }
};

// ── DELETE /employee/bookings/:bookingId/pickup-session/manual-discount ───────

export const RemovePickupSessionManualDiscount = async (req: Request, res: Response) => {
  try {
    const actor = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, name: true, role: true, branchId: true },
    });
    if (!actor) return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });

    const found = await openPickupSessionFor(req.params.bookingId!, actor.branchId);
    if (!found.ok) return res.status(found.status).json(found.body);
    const { booking, session } = found;

    const removed = await prisma.$transaction(async (tx) => {
      await lockOpenPickupSession(tx, booking.id, session.id);
      const count = await voidSessionPickupDiscount(tx, session.id, actor.id, "Pickup discount removed by employee");
      await paymentSessionService.recomputeTotals(session.id, tx as any);
      return count;
    });

    if (removed > 0) {
      await staffActivityService.logFromRequest(req, {
        actionType: StaffActionType.UPDATED,
        entityType: StaffEntityType.PAYMENT_SESSION,
        entityRef: session.publicId,
        description: `Pickup discount removed from booking ${booking.publicId}`,
        metadata: { bookingId: booking.publicId, pickupDiscount: null },
      });
    }

    const updatedSession = await paymentSessionService.getSession(session.publicId);
    return res.status(StatusCode.OK).json({
      message: "Discount removed from the pickup bill",
      data: serializePickupSession(updatedSession!),
    });
  } catch (err: any) {
    if (err instanceof PickupStateError || err instanceof PickupBillClosedError) {
      return res.status(err.status).json(err.toJSON());
    }
    console.error("RemovePickupSessionManualDiscount Error:", err);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message ?? "Internal server error" });
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

    const depositEntry = session.entries[0]!;
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

/** A stored CGST/SGST part, signed like the line's gstAmount (a coupon's metadata keeps it positive). */
function signedGstPart(part: unknown, gstAmount: unknown): string {
  const value = new Decimal(String(part ?? "0")).abs();
  return (new Decimal(String(gstAmount ?? "0")).lt(0) ? value.negated() : value).toFixed(2);
}

function pickupDiscountView(entries: any[]) {
  const live = entries.filter((e) => !e.isVoided);
  const bill = pickupBillRent(live, COUNTER_COUPON_REF);
  const line = live.find((e) => e.entryType === LedgerEntryType.DISCOUNT && e.referenceType === PICKUP_DISCOUNT_REF);
  return {
    rentDue: bill.rentDue.toFixed(2),
    pickupDiscountMax: bill.cap.toFixed(2),
    pickupDiscount: line
      ? {
          amount: bill.manual.toFixed(2),
          reason: typeof line.metadata?.reason === "string" ? line.metadata.reason : null,
          entryPublicId: line.publicId,
        }
      : null,
  };
}

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
    // Manual pickup discount (additive): rental balance on this bill incl. GST (no extension), the
    // discount on it and the most it may be (rent due less a counter coupon)
    ...pickupDiscountView(session.entries ?? []),
    entries: (session.entries ?? []).map((e: any) => ({
      publicId: e.publicId,
      entryType: e.entryType,
      classification: e.classification,
      amount: new Decimal(e.amount.toString()).toFixed(2),
      // Stored per-line GST (#23): an extension line's amount is its taxable
      // value with gstAmount on top; a counter coupon's amount is −(discount +
      // GST) with baseAmount −discount; the remaining balance is GST-inclusive
      // (referenceType BOOKING_REMAINING, gstAmount 0).
      baseAmount: new Decimal(e.baseAmount?.toString() ?? "0").toFixed(2),
      gstAmount: new Decimal(e.gstAmount?.toString() ?? "0").toFixed(2),
      cgst: signedGstPart(e.metadata?.cgst ?? e.metadata?.cgstAmount, e.gstAmount),
      sgst: signedGstPart(e.metadata?.sgst ?? e.metadata?.sgstAmount, e.gstAmount),
      description: e.description,
      referenceType: e.referenceType,
      referenceId: e.referenceId ?? null,
      isVoided: e.isVoided ?? false,
      createdAt: e.createdAt,
    })),
  };
}

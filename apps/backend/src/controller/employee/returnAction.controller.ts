import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import {
  prisma,
  BookingStatus,
  VehicleStatus,
  BookingPhotoType,
  ExtensionStatus,
} from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { fileCleanupQueue } from "../../lib/queue.client.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import { r2 } from "../../lib/r2.client.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs/promises";
import { redis } from "../../lib/redisconfig.js";
import { invalidateVehicleAvailability } from "../../utils/cache/vehicleCacheKeys.js";
import path from "path";
import { processImage } from "../../utils/image-processor.js";
import { vehicleStatusAfterDrop, lockBookingForDrop } from "../../services/damage/drop-damage.service.js";
import { activeExtensionState } from "../../services/charges/rental-timeline.service.js";
import { notifyEvents } from "../../services/notification/notification.events.js";
import { z } from "zod";
import Decimal from "decimal.js";
import { ChargeType } from "@repo/database/client";
import {
  resolveKmAllowance,
  calculateKmCharge,
  getOdometerSegments,
  serializeKmCharge,
  KmAllowanceUnavailableError,
  type KmCharge,
  type OdometerSegments,
} from "../../services/charges/km-allowance.service.js";
import {
  resolveLateReturnPolicy,
  calculateLateReturnCharge,
  lateReturnLabel,
  serializeLateReturn,
} from "../../services/charges/late-return.service.js";
import {
  upsertLegacyReturnCharge,
  removeLegacyReturnCharge,
  removeStaleLegacySwapCharges,
  legacyVehicleSwapKey,
  LEGACY_EXTRA_KM_KEY,
  LEGACY_EXTRA_TIME_KEY,
} from "../../services/charges/legacy-return-charges.service.js";
import {
  getBranchGstRates,
  computeLineGst,
  GstRuleMissingError,
  type BranchGstRates,
} from "../../services/tax/gst.service.js";
import { syncLegacyReturnInvoice } from "../../services/invoice-finalization.service.js";

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;

/** '' / null from a form field means "not sent", never 0. */
const blankToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

/**
 * Legacy (non-Unified-Payments) drop. Older app builds send only returnImageIds,
 * requireManagerConfirmation and licenseReturned — every new field is optional.
 */
const completeReturnSchema = z.object({
  returnImageIds: z.array(z.string()).optional(),
  requireManagerConfirmation: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])
    .optional(),
  // Deprecated: the driving-licence-returned tick was removed from the drop — accepted and ignored
  licenseReturned: z.unknown().optional(),
  // Odometer at drop — extra km is worked out on the server and left for the manager to collect
  endOdometer: z.preprocess(
    blankToUndefined,
    z.coerce.number().int("End odometer must be a whole number").min(0, "End odometer can't be negative").optional(),
  ),
  // Extra km typed by staff — used only after a mid-rental swap recorded without odometer readings
  manualExtraKm: z.preprocess(
    blankToUndefined,
    z.coerce
      .number()
      .int("Extra km must be a whole number")
      .min(0, "Extra km can't be negative")
      .max(100000, "Extra km looks too large — check the figure")
      .optional(),
  ),
  // Late return: "Apply grace" for branches on MANUAL grace (ignored otherwise)
  applyGrace: z.boolean().optional(),
  // Late return: waive the automatic late charge — the reason is audit-logged
  waiveLateCharge: z
    .object({
      reason: z.string().trim().min(3, "Give a reason for waiving the late charge (at least 3 characters)"),
    })
    .nullable()
    .optional(),
});

/** A return charge the branch manager collects later (legacy drop). */
interface LegacyChargeLine {
  type: "EXTRA_KM" | "EXTRA_TIME" | "VEHICLE_SWAP";
  label: string;
  /** VEHICLE_SWAP: the swap's publicId; null otherwise */
  referenceId: string | null;
  /** taxable value (before GST) */
  amount: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  gst: Decimal;
}

/** Refusal raised inside the completion transaction (mapped to its HTTP response). */
class CompleteRejection extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(String(body.message));
    this.name = "CompleteRejection";
  }
}

/** 409 body for a drop already recorded and sent for the manager's confirmation. */
const RETURN_AWAITING_MANAGER_BODY = {
  code: "RETURN_AWAITING_MANAGER",
  message: "This return is already recorded and is waiting for the branch manager to confirm it.",
};

/** 409 body while a committed extension is unpaid or its cash awaits the manager. */
function extensionPendingBody(extension: { publicId: string; extensionStatus: ExtensionStatus }) {
  return {
    code: "EXTENSION_PENDING",
    message:
      extension.extensionStatus === ExtensionStatus.PAYMENT_COLLECTED
        ? "The extension's cash payment is waiting for the branch manager to confirm it. Ask them to confirm it, then complete the return."
        : "Collect or cancel the pending extension before completing the return.",
    pendingExtensionPublicId: extension.publicId,
    pendingExtensionStatus: extension.extensionStatus,
  };
}

export const UploadReturnImage = async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "File is required",
      });
    }

    // Upload to R2
    const fileContent = await fs.readFile(file.path);
    const ext = path.extname(file.originalname);
    const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const key = `returns/${date}/${createID()}${ext}`;

    // Process image with Sharp
    const processed = await processImage(fileContent);

    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: processed.buffer,
        ContentType: processed.mimeType,
      }),
    );

    // Clean up local file
    await fs.unlink(file.path);

    const filePublicId = createID();
    const fileRecord = await prisma.fileObject.create({
      data: {
        publicId: filePublicId,
        key: key,
        url: `${R2_PUBLIC_URL}/${key}`,
        mime: processed.mimeType,
        size: processed.size,
      },
    });

    return res.status(StatusCode.CREATED).json({
      message: "Return Image Uploaded Successfully",
      fileId: fileRecord.publicId,
      url: fileRecord.url,
    });
  } catch (error) {
    console.error("Error uploading return image:", error);
    // Try to cleanup temp file if it exists and error happened before unlink
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error during upload",
    });
  }
};

export const CompleteReturn = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const branchId = req.branch_Id;

  try {
    const validation = completeReturnSchema.safeParse(req.body ?? {});
    if (!validation.success) {
      const issue = validation.error.issues[0];
      return res.status(StatusCode.BAD_REQUEST).json({
        code: "VALIDATION_FAILED",
        message: issue?.message ?? "Validation failed",
        errors: validation.error.format(),
      });
    }
    const { returnImageIds, requireManagerConfirmation, endOdometer, manualExtraKm, applyGrace, waiveLateCharge } =
      validation.data;
    // The vehicle is back now — the late charge is measured to this moment
    const returnedAt = new Date();

    const booking = await prisma.booking.findFirst({
      where: {
        publicId: bookingId,
        branchId: branchId,
      },
      select: {
        id: true,
        publicId: true,
        status: true,
        endAt: true,
        branchId: true,
        isAdvancePayment: true,
        remainingBalance: true,
        remainingPaidAt: true,
        requiresManagerConfirmation: true,
        activeExtensionId: true,
        items: {
          select: { vehicleId: true },
        },
        branch: { select: { chargeConfig: { select: { usePaymentSessions: true } } } },
      },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Booking not found or access denied",
      });
    }

    if (booking.status !== BookingStatus.PICKED_UP) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `Cannot complete return. Current status: ${booking.status}`,
      });
    }

    // Already recorded and sent for the manager's confirmation: completing it again
    // would re-measure the late charge to now and skip the manager
    if (booking.requiresManagerConfirmation) {
      return res.status(StatusCode.CONFLICT).json(RETURN_AWAITING_MANAGER_BODY);
    }

    // Branches on payment sessions settle every drop (extra km, damage, discount) on
    // the drop bill — a plain complete here would skip that billing.
    const chargedAtDropCount = await prisma.damageReport.count({
      where: { bookingId: booking.id, chargedAtDrop: true },
    });
    if ((booking.branch?.chargeConfig?.usePaymentSessions ?? false) || chargedAtDropCount > 0) {
      return res.status(StatusCode.CONFLICT).json({
        code: "USE_DROP_BILL",
        message: "This return is settled on the drop bill. Use the drop bill to complete this return.",
      });
    }

    // A committed-but-unpaid extension has already moved endAt — it must not earn
    // free km or hide the late return (same rule as the drop bill)
    const extensionState = await activeExtensionState(booking.activeExtensionId);
    if (extensionState.blocking) {
      return res.status(StatusCode.CONFLICT).json(extensionPendingBody(extensionState.blocking));
    }

    // Advance payment gate: remaining balance MUST be collected before return
    if (booking.isAdvancePayment && !booking.remainingPaidAt) {
      return res.status(StatusCode.PAYMENT_REQUIRED).json({
        message: `Remaining balance of ₹${booking.remainingBalance} must be collected before completing the return.`,
        remainingBalance: booking.remainingBalance,
      });
    }

    const actingUserPublicId = req.public_Id;
    const actingUser = await prisma.user.findUnique({
      where: { publicId: actingUserPublicId },
      select: { id: true, name: true, role: true, branchId: true },
    });

    if (!actingUser) {
      return res.status(StatusCode.UNAUTHORIZED).json({
        message: "Unauthorized: User not found",
      });
    }

    // ── Extra km — server-computed from the end odometer, as on the drop bill ──
    // Older app builds don't send the reading: the return still completes, nothing is recorded.
    let km: KmCharge | null = null;
    let segments: OdometerSegments | null = null;
    if (endOdometer === undefined) {
      console.warn(
        `[return] CompleteReturn for booking ${booking.publicId} without endOdometer (older app build?) — extra km not recorded`,
      );
    } else {
      segments = await getOdometerSegments(booking.id);
      const vehicleSwapped = !segments.complete;
      if (!vehicleSwapped && segments.currentStartOdometer != null && endOdometer < segments.currentStartOdometer) {
        return res.status(StatusCode.BAD_REQUEST).json({
          code: "END_ODOMETER_TOO_LOW",
          message: segments.swapCount > 0
            ? `End odometer can't be less than the replacement vehicle's reading at the swap (${segments.currentStartOdometer} km).`
            : `End odometer can't be less than the pickup reading (${segments.currentStartOdometer} km).`,
        });
      }
      try {
        const allowance = await resolveKmAllowance(booking.id);
        km = calculateKmCharge(segments.currentStartOdometer, endOdometer, allowance, vehicleSwapped, {
          priorKm: segments.priorKm,
          manualExtraKm: vehicleSwapped ? manualExtraKm ?? null : null,
        });
      } catch (allowanceErr) {
        if (allowanceErr instanceof KmAllowanceUnavailableError) {
          return res.status(StatusCode.CONFLICT).json({
            code: "KM_ALLOWANCE_UNAVAILABLE",
            message: allowanceErr.message,
          });
        }
        throw allowanceErr;
      }
    }

    // ── Late return beyond endAt without a formal extension ──
    const latePolicy = await resolveLateReturnPolicy(booking.id);
    const late = calculateLateReturnCharge(booking.endAt, returnedAt, latePolicy, {
      applyGrace: applyGrace === true,
      waive: waiveLateCharge != null,
    });
    if (late.status === "RATE_UNAVAILABLE") {
      // Older builds can't waive, so a missing rate must not lock the drop — it is reported instead
      console.warn(
        `[return] Late return on booking ${booking.publicId} not billed: the vehicle has no extra-hour rate configured`,
      );
    }
    const lateWaiver = late.status === "WAIVED" && waiveLateCharge ? { reason: waiveLateCharge.reason } : null;

    // All taxable (distance / rental time / vehicle upgrade); GST frozen at the branch rate now
    const chargeLines: LegacyChargeLine[] = [];
    if (km && km.extraKmCharge.gt(0)) {
      chargeLines.push({
        type: "EXTRA_KM",
        label: km.kmSource === "STAFF_ENTERED"
          ? `Extra km (entered at drop, vehicle swapped): ${km.extraKm} km × ₹${km.extraKmRate.toFixed(2)}`
          : `Extra km: ${km.extraKm} km × ₹${km.extraKmRate.toFixed(2)}`,
        referenceId: null,
        amount: km.extraKmCharge,
        cgst: new Decimal(0),
        sgst: new Decimal(0),
        gst: new Decimal(0),
      });
    }
    if (late.status === "CHARGED" && late.amount.gt(0)) {
      chargeLines.push({
        type: "EXTRA_TIME",
        label: lateReturnLabel(late),
        referenceId: null,
        amount: late.amount,
        cgst: new Decimal(0),
        sgst: new Decimal(0),
        gst: new Decimal(0),
      });
    }
    // Vehicle-swap difference staff chose to bill at the swap (pre-GST, one line per
    // swap) — the drop bill's VEHICLE_SWAP line, left for the manager to collect
    const chargedSwaps = await prisma.vehicleSwap.findMany({
      where: { bookingId: booking.id, chargeDifference: true, priceDifference: { gt: 0 } },
      orderBy: { swappedAt: "asc" },
      select: {
        publicId: true,
        priceDifference: true,
        originalVehicle: { select: { regNo: true } },
        newVehicle: { select: { regNo: true } },
      },
    });
    for (const swap of chargedSwaps) {
      chargeLines.push({
        type: "VEHICLE_SWAP",
        label: `Vehicle upgrade: ${swap.originalVehicle.regNo} → ${swap.newVehicle.regNo}`,
        referenceId: swap.publicId,
        amount: new Decimal(swap.priceDifference.toString()),
        cgst: new Decimal(0),
        sgst: new Decimal(0),
        gst: new Decimal(0),
      });
    }
    let rates: BranchGstRates | null = null;
    if (chargeLines.length > 0) {
      try {
        rates = await getBranchGstRates(booking.branchId);
      } catch (ratesErr) {
        if (ratesErr instanceof GstRuleMissingError) {
          return res.status(StatusCode.CONFLICT).json({
            code: ratesErr.code,
            message: "GST rates aren't set up for this branch, so the return charges (extra km, late return, vehicle swap) can't be billed. Ask the branch manager to set the GST rule.",
          });
        }
        throw ratesErr;
      }
      for (const line of chargeLines) {
        const g = computeLineGst(line.amount, rates);
        line.cgst = g.cgst;
        line.sgst = g.sgst;
        line.gst = g.gst;
      }
    }
    const kmLine = chargeLines.find((l) => l.type === "EXTRA_KM");
    const lateLine = chargeLines.find((l) => l.type === "EXTRA_TIME");
    const lateData = serializeLateReturn(
      late,
      lateLine && rates ? { cgst: lateLine.cgst, sgst: lateLine.sgst, gst: lateLine.gst, rate: new Decimal(rates.rate) } : null,
      lateWaiver,
    );
    const returnChargesTotal = chargeLines.reduce((s, l) => s.plus(l.amount).plus(l.gst), new Decimal(0));

    const vehicleIds = booking.items.map((item) => item.vehicleId);
    const returnedStatuses = new Set<VehicleStatus>();

    await prisma.$transaction(async (tx) => {
      // With the booking row locked, re-check what the charges were worked out from —
      // a second tap / another device can't record the return twice
      await lockBookingForDrop(tx as any, booking.id);
      const locked = await tx.booking.findUniqueOrThrow({
        where: { id: booking.id },
        select: { status: true, endAt: true, requiresManagerConfirmation: true, activeExtensionId: true },
      });
      if (locked.status !== BookingStatus.PICKED_UP) {
        throw new CompleteRejection(StatusCode.BAD_REQUEST, {
          message: `Cannot complete return. Current status: ${locked.status}`,
        });
      }
      if (locked.requiresManagerConfirmation) {
        throw new CompleteRejection(StatusCode.CONFLICT, RETURN_AWAITING_MANAGER_BODY);
      }
      const lockedExtension = await activeExtensionState(locked.activeExtensionId, tx as any);
      if (lockedExtension.blocking) {
        throw new CompleteRejection(StatusCode.CONFLICT, extensionPendingBody(lockedExtension.blocking));
      }
      if (locked.endAt.getTime() !== booking.endAt.getTime()) {
        throw new CompleteRejection(StatusCode.CONFLICT, {
          message: "The rental period changed while the return was being completed. Try again.",
        });
      }
      // A customer quote that was never committed holds no slot and no money —
      // release it so it can't be paid for after the vehicle is back
      if (lockedExtension.uncommittedQuoteId != null) {
        await tx.bookingExtension.update({
          where: { id: lockedExtension.uncommittedQuoteId },
          data: {
            extensionStatus: ExtensionStatus.CANCELLED,
            rejectionReason: "Released at drop: the vehicle was returned before the quote was paid",
          },
        });
        await tx.booking.update({ where: { id: booking.id }, data: { activeExtensionId: null } });
      }

      // Actual return time, readings and the return charges the manager collects in Settlements
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          returnedAt,
          ...(km && {
            endOdometer: km.endOdometer,
            // Unknown after a mid-rental swap recorded without readings
            totalKmDriven: km.autoKmSkipped ? null : km.kmDriven,
            freeKmLimit: km.includedKm,
            extraKmCharged: km.extraKm,
          }),
        },
      });

      if (km) {
        if (kmLine && rates) {
          await upsertLegacyReturnCharge(tx as any, {
            bookingId: booking.id,
            moduleKey: LEGACY_EXTRA_KM_KEY,
            chargeType: ChargeType.EXTRA_KM,
            label: kmLine.label,
            amount: kmLine.amount,
            quantity: km.extraKm,
            unitRate: km.extraKmRate,
            actorId: actingUser.id,
            gst: computeLineGst(kmLine.amount, rates),
            details: { kmSource: km.kmSource, kmDriven: km.kmDriven, includedKm: km.includedKm },
          });
        } else {
          await removeLegacyReturnCharge(tx as any, booking.id, LEGACY_EXTRA_KM_KEY);
        }
      }

      if (lateLine && rates && late.rate) {
        await upsertLegacyReturnCharge(tx as any, {
          bookingId: booking.id,
          moduleKey: LEGACY_EXTRA_TIME_KEY,
          chargeType: ChargeType.EXTRA_TIME,
          label: lateLine.label,
          amount: lateLine.amount,
          quantity: late.hours,
          unitRate: late.rate,
          actorId: actingUser.id,
          gst: computeLineGst(lateLine.amount, rates),
          details: {
            dueAt: late.dueAt.toISOString(),
            returnedAt: late.returnedAt.toISOString(),
            lateMinutes: late.lateMinutes,
            graceApplied: late.graceApplied,
          },
        });
      } else {
        await removeLegacyReturnCharge(tx as any, booking.id, LEGACY_EXTRA_TIME_KEY);
      }

      // Vehicle-swap differences — one VEHICLE_SWAP row per chargeable swap
      const swapKeys: string[] = [];
      for (const line of chargeLines) {
        if (line.type !== "VEHICLE_SWAP" || !line.referenceId || !rates) continue;
        const moduleKey = legacyVehicleSwapKey(line.referenceId);
        swapKeys.push(moduleKey);
        await upsertLegacyReturnCharge(tx as any, {
          bookingId: booking.id,
          moduleKey,
          chargeType: ChargeType.VEHICLE_SWAP,
          label: line.label,
          amount: line.amount,
          quantity: 1,
          unitRate: line.amount,
          actorId: actingUser.id,
          gst: computeLineGst(line.amount, rates),
          details: { swapPublicId: line.referenceId },
        });
      }
      await removeStaleLegacySwapCharges(tx as any, booking.id, swapKeys);

      if (requireManagerConfirmation) {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            requiresManagerConfirmation: true,
          },
        });
      } else {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.RETURNED,
          },
        });

        // Damage recorded at drop holds that vehicle for the manager's disposition
        // (MANAGER_REPORTED); every other vehicle is back in the fleet.
        for (const vehicleId of vehicleIds) {
          const status = (await vehicleStatusAfterDrop(booking.id, vehicleId, tx as any)) ?? VehicleStatus.AVAILABLE;
          returnedStatuses.add(status);
          await tx.vehicle.update({
            where: { id: vehicleId },
            data: { status },
          });
        }
      }

      if (
        returnImageIds &&
        Array.isArray(returnImageIds) &&
        returnImageIds.length > 0
      ) {
        const files = await tx.fileObject.findMany({
          where: { publicId: { in: returnImageIds } },
        });

        if (files.length !== returnImageIds.length) {
          throw new CompleteRejection(StatusCode.BAD_REQUEST, { message: "One or more return photos are invalid — retake them." });
        }

        await tx.bookingPhoto.createMany({
          data: files.map((f) => ({
            publicId: createID(),
            bookingId: booking.id,
            fileId: f.id,
            type: BookingPhotoType.POST_RETURN,
          })),
        });
      }
    }, { timeout: 15000 });

    // The return charges just recorded belong on the tax invoice (and so in the
    // GST report) now; it stays PENDING until the manager's settlement clears them.
    syncLegacyReturnInvoice(booking.id).catch((err) =>
      console.error("[return] Invoice sync after legacy drop failed:", err),
    );

    // Logging outside the transaction — audit/activity logs add latency that can
    // push the transaction past Prisma's 5 s interactive timeout.
    await staffActivityService.logFromRequest(req, {
      actionType: requireManagerConfirmation ? StaffActionType.INITIATED : StaffActionType.COMPLETED,
      entityType: StaffEntityType.BOOKING,
      entityRef: booking.publicId,
      description: requireManagerConfirmation
        ? `Return approval requested for booking ${booking.publicId}`
        : `Vehicle return completed for booking ${booking.publicId}`,
    });

    if (!requireManagerConfirmation) {
      await auditService.log({
        actorId: actingUser.id,
        actorName: actingUser.name,
        actorRole: actingUser.role,
        actorBranchId: actingUser.branchId ?? undefined,
        action: "BOOKING_CHECKED_OUT",
        category: AuditCategory.BOOKING,
        description: `Vehicle returned by customer for booking ${booking.publicId}`,
        entity: "Booking",
        entityId: booking.publicId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });
    }

    if (lateWaiver) {
      await auditService.log({
        actorId: actingUser.id,
        actorName: actingUser.name,
        actorRole: actingUser.role,
        actorBranchId: actingUser.branchId ?? undefined,
        action: "RETURN_LATE_CHARGE_WAIVED",
        category: AuditCategory.CHARGE,
        description: `Late return charge of ₹${lateData.waivedAmount} (${lateData.hours} hr, before GST) waived on booking ${booking.publicId}: ${lateWaiver.reason}`,
        entity: "Booking",
        entityId: booking.publicId,
        metadata: { late: lateData },
      });
      await staffActivityService.logFromRequest(req, {
        actionType: StaffActionType.OVERRIDDEN,
        entityType: StaffEntityType.BOOKING,
        entityRef: booking.publicId,
        description: `Late return charge ₹${lateData.waivedAmount} waived on booking ${booking.publicId}: ${lateWaiver.reason}`,
        metadata: { lateMinutes: lateData.lateMinutes, hours: lateData.hours, waiverReason: lateWaiver.reason },
      });
    }

    if (km?.kmSource === "STAFF_ENTERED") {
      await auditService.log({
        actorId: actingUser.id,
        actorName: actingUser.name,
        actorRole: actingUser.role,
        actorBranchId: actingUser.branchId ?? undefined,
        action: "RETURN_MANUAL_EXTRA_KM",
        category: AuditCategory.CHARGE,
        description: `Extra km entered by staff on booking ${booking.publicId} (vehicle swapped without odometer readings): ${km.manualExtraKm} km × ₹${km.extraKmRate.toFixed(2)} = ₹${km.extraKmCharge.toFixed(2)} before GST`,
        entity: "Booking",
        entityId: booking.publicId,
        metadata: { km: serializeKmCharge(km, segments) },
      });
    }

    if (chargeLines.length > 0) {
      await auditService.log({
        actorId: actingUser.id,
        actorName: actingUser.name,
        actorRole: actingUser.role,
        actorBranchId: actingUser.branchId ?? undefined,
        action: "RETURN_CHARGES_RECORDED",
        category: AuditCategory.CHARGE,
        description: `Return charges of ₹${returnChargesTotal.toFixed(2)} (incl. GST) recorded on booking ${booking.publicId} for the branch manager to collect`,
        entity: "Booking",
        entityId: booking.publicId,
        metadata: {
          lines: chargeLines.map((l) => ({ type: l.type, label: l.label, amount: l.amount.toFixed(2), gst: l.gst.toFixed(2) })),
          km: km ? serializeKmCharge(km, segments) : null,
          late: lateData,
        },
      });
    }

    // Targeted availability cache invalidation only if actual return occurred (TASK-019)
    if (!requireManagerConfirmation) {
      try {
        await invalidateVehicleAvailability(redis, vehicleIds);
      } catch (redisErr) {
        console.warn("[return] Cache invalidation failed (non-fatal):", redisErr);
      }
    }

    if (requireManagerConfirmation) {
      void notifyEvents.returnApprovalRequested({ bookingId: booking.id, actorUserId: actingUser.id });
    } else {
      void notifyEvents.returnCompleted({ bookingId: booking.id, actorUserId: actingUser.id });
      void notifyEvents.damageReported({ bookingId: booking.id, actorUserId: actingUser.id });
    }

    const chargesNote = returnChargesTotal.gt(0)
      ? ` Return charges of ₹${returnChargesTotal.toFixed(2)} (incl. GST) will be collected by the branch manager.`
      : "";
    return res.status(StatusCode.OK).json({
      message: (requireManagerConfirmation
        ? "Return sent to manager for confirmation."
        : returnedStatuses.has(VehicleStatus.MANAGER_REPORTED)
          ? "Return Processed Successfully. Vehicle is held for the manager's damage review."
          : `Return Processed Successfully. Vehicle is now ${[...returnedStatuses].join(", ") || VehicleStatus.AVAILABLE}.`) + chargesNote,
      returnedAt: returnedAt.toISOString(),
      km: km ? serializeKmCharge(km, segments) : null,
      late: lateData,
      returnCharges: {
        /** Collected by the branch manager in Settlements (legacy branches have no drop bill). */
        collectedBy: "BRANCH_MANAGER",
        gstRates: rates ? { cgstRate: rates.cgstRate, sgstRate: rates.sgstRate, rate: rates.rate } : null,
        lines: chargeLines.map((l) => ({
          type: l.type,
          label: l.label,
          // VEHICLE_SWAP: the swap's publicId
          referenceId: l.referenceId,
          taxable: true,
          amount: l.amount.toFixed(2),
          cgst: l.cgst.toFixed(2),
          sgst: l.sgst.toFixed(2),
          gst: l.gst.toFixed(2),
          total: l.amount.plus(l.gst).toFixed(2),
        })),
        total: returnChargesTotal.toFixed(2),
      },
    });
  } catch (error) {
    if (error instanceof CompleteRejection) {
      return res.status(error.status).json(error.body);
    }
    console.error("Return Action Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error during Return",
    });
  }
};

export const DeleteReturnImage = async (req: Request, res: Response) => {
  const { publicId } = req.params;

  try {
    const file = await prisma.fileObject.findUnique({
      where: { publicId },
    });

    if (!file) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "File not found",
      });
    }

    // Add to cleanup queue
    await fileCleanupQueue.add("cleanup", {
      key: file.key,
    });

    // Hard delete from DB
    await prisma.fileObject.delete({
      where: { id: file.id },
    });

    return res.status(StatusCode.OK).json({
      message: "File deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting return image:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error during deletion",
    });
  }
};

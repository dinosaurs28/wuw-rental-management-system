import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { z } from "zod";
const chargeOverrideSchema = z.object({
  overriddenAmount: z.coerce.number().min(0, "Override amount must be non-negative"),
  reason: z.string().min(1, "Reason is required for all overrides"),
});
import { createID } from "../../utils/nanoID.js";
import type { FrozenChargeConfig } from "../../types/charge-engine.types.js";
import { DEFAULT_FROZEN_CHARGE_CONFIG } from "../../types/charge-engine.types.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";
import Decimal from "decimal.js";

/**
 * Employee submits a charge override for a specific ChargeEntry.
 * Only permitted when frozenChargeConfig.employeeOverrideEnabled = true.
 */
export const SubmitChargeOverride = async (req: Request, res: Response) => {
  try {
    const { bookingPublicId, chargeEntryPublicId } = req.params;

    const validation = chargeOverrideSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid input",
        errors: validation.error.format(),
      });
    }

    const { overriddenAmount, reason } = validation.data;

    // Load booking and charge entry
    const booking = await prisma.booking.findUnique({
      where: { publicId: bookingPublicId },
      select: {
        id: true,
        publicId: true,
        branchId: true,
        frozenChargeConfig: true,
        chargeConfigVersion: true,
      },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    const frozenConfig = (booking.frozenChargeConfig as FrozenChargeConfig | null)
      ?? DEFAULT_FROZEN_CHARGE_CONFIG;

    if (!frozenConfig.employeeOverrideEnabled) {
      return res.status(StatusCode.FORBIDDEN).json({
        message: "Charge overrides are not permitted for this booking",
      });
    }

    const chargeEntry = await prisma.chargeEntry.findUnique({
      where: { publicId: chargeEntryPublicId },
      select: { id: true, bookingId: true, originalAmount: true, finalAmount: true, moduleKey: true },
    });

    if (!chargeEntry || chargeEntry.bookingId !== booking.id) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Charge entry not found" });
    }

    const originalAmount = new Decimal(chargeEntry.originalAmount.toString());
    const overriddenDec = new Decimal(overriddenAmount);

    if (overriddenDec.gt(originalAmount)) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Overridden amount cannot exceed the original charge",
      });
    }

    const waivedAmount = originalAmount.sub(overriddenDec);

    // Check max override percent constraint
    if (frozenConfig.maxOverridePercent !== null && originalAmount.gt(0)) {
      const waivedPercent = waivedAmount.div(originalAmount).mul(100);
      if (waivedPercent.gt(frozenConfig.maxOverridePercent)) {
        return res.status(StatusCode.BAD_REQUEST).json({
          message: `Override exceeds maximum allowed waiver of ${frozenConfig.maxOverridePercent}%`,
        });
      }
    }

    // Determine if approval is required
    const needsApproval =
      frozenConfig.overrideRequiresApproval &&
      frozenConfig.overrideApprovalThreshold !== null &&
      waivedAmount.gt(frozenConfig.overrideApprovalThreshold);

    const overrideStatus = needsApproval ? "PENDING" : "AUTO_APPROVED";

    // Look up the acting employee
    const actor = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, role: true },
    });

    if (!actor) {
      return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
    }

    await prisma.$transaction(async (tx) => {
      const override = await tx.chargeOverride.create({
        data: {
          publicId: createID(),
          bookingId: booking.id,
          chargeEntryId: chargeEntry.id,
          originalAmount: originalAmount.toFixed(2),
          overriddenAmount: overriddenDec.toFixed(2),
          waivedAmount: waivedAmount.toFixed(2),
          reason,
          status: overrideStatus,
          actorId: actor.id,
          actorRole: actor.role,
        },
      });

      // If auto-approved, apply to ChargeEntry immediately
      if (overrideStatus === "AUTO_APPROVED") {
        await tx.chargeEntry.update({
          where: { id: chargeEntry.id },
          data: {
            finalAmount: overriddenDec.toFixed(2),
            isOverridden: true,
          },
        });

        await tx.booking.update({
          where: { id: booking.id },
          data: { chargeConfigVersion: { increment: 1 } },
        });
      }

      return override;
    });

    // Anomaly detection: count recent approved overrides by this actor
    const recentOverrideCount = await prisma.chargeOverride.count({
      where: {
        actorId: actor.id,
        status: { in: ["APPROVED", "AUTO_APPROVED"] },
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    });

    const ANOMALY_THRESHOLD = 10;
    const bPublicId = booking.publicId;

    if (recentOverrideCount >= ANOMALY_THRESHOLD) {
      // Log anomaly in staff activity
      staffActivityService.logFromRequest(req, {
        actionType: StaffActionType.FLAGGED,
        entityType: StaffEntityType.CHARGE_OVERRIDE,
        entityRef: bPublicId,
        description: `Override anomaly: employee has ${recentOverrideCount} approved overrides in last 30 days`,
        metadata: { recentOverrideCount, actorId: actor.id },
      });
    }

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.OVERRIDDEN,
      entityType: StaffEntityType.CHARGE_OVERRIDE,
      entityRef: bPublicId,
      description: `Charge override submitted: ₹${originalAmount.toFixed(2)} → ₹${overriddenDec.toFixed(2)} (waived ₹${waivedAmount.toFixed(2)}) — ${overrideStatus}`,
      metadata: {
        chargeEntryPublicId,
        moduleKey: chargeEntry.moduleKey,
        originalAmount: originalAmount.toFixed(2),
        overriddenAmount: overriddenDec.toFixed(2),
        waivedAmount: waivedAmount.toFixed(2),
        status: overrideStatus,
        reason,
      },
    });

    return res.status(StatusCode.OK).json({
      message: needsApproval
        ? "Override submitted and pending manager approval"
        : "Override applied",
      status: overrideStatus,
    });
  } catch (error) {
    console.error("SubmitChargeOverride Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

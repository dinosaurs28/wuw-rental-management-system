import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { z } from "zod";
const chargeReturnDataSchema = z.object({
  returnFuelLevel: z.enum(["EMPTY", "QUARTER", "HALF", "THREE_QUARTER", "FULL"]).optional(),
  fuelDeficitCharge: z.coerce.number().min(0).optional(),
  fuelSkipReason: z.string().min(1).optional(),
  fastagAmount: z.coerce.number().min(0).optional(),
  fastagNotes: z.string().optional(),
  applyGrace: z.boolean().optional(),
});
import { returnChargeService } from "../../services/charges/return-charge.service.js";
import { chargeEngineService } from "../../services/charges/charge-engine.service.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";

/**
 * Computes return charges and returns the breakdown for employee review.
 * Does NOT finalize the booking or collect payment — that is done in /settlement/confirm.
 */
export const ComputeReturnCharges = async (req: Request, res: Response) => {
  try {
    const bookingId = req.params.bookingId!;

    const returnInput = chargeReturnDataSchema.safeParse(req.body);
    if (!returnInput.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid return data",
        errors: returnInput.error.format(),
      });
    }

    const endOdometer = req.body.endOdometer;
    if (typeof endOdometer !== "number" || endOdometer < 0) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "endOdometer is required" });
    }

    // Look up actor
    const actor = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true },
    });
    if (!actor) {
      return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
    }

    const breakdown = await returnChargeService.processReturnCharges(
      bookingId,
      endOdometer,
      returnInput.data,
      actor.id,
    );

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.RECALCULATED,
      entityType: StaffEntityType.CHARGE_ENTRY,
      entityRef: bookingId,
      description: `Return charges computed for booking ${bookingId}: ₹${breakdown.finalTotal.toFixed(2)} total`,
      metadata: {
        subtotal: breakdown.subtotal.toFixed(2),
        waivedTotal: breakdown.waivedTotal.toFixed(2),
        finalTotal: breakdown.finalTotal.toFixed(2),
        chargeCount: breakdown.results.filter((r) => !r.skip).length,
      },
    });

    return res.status(StatusCode.OK).json({
      message: "Return charges computed",
      data: {
        bookingId,
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
    });
  } catch (error: any) {
    console.error("ComputeReturnCharges Error:", error);
    const isValidationError = error.message?.includes("required") || error.message?.includes("enabled");
    return res.status(isValidationError ? StatusCode.BAD_REQUEST : StatusCode.INTERNAL_SERVER_ERROR).json({
      message: error.message ?? "Internal server error",
    });
  }
};

/**
 * Returns the current charge breakdown for a booking (for display in return review UI).
 */
export const GetChargeBreakdown = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;

    const booking = await prisma.booking.findUnique({
      where: { publicId: bookingId },
      select: { id: true, branchId: true },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    const breakdown = await chargeEngineService.loadBreakdown(booking.id);

    return res.status(StatusCode.OK).json({
      data: {
        subtotal: breakdown.subtotal.toFixed(2),
        waivedTotal: breakdown.waivedTotal.toFixed(2),
        finalTotal: breakdown.finalTotal.toFixed(2),
        charges: breakdown.results.map((r) => ({
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
    });
  } catch (error) {
    console.error("GetChargeBreakdown Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

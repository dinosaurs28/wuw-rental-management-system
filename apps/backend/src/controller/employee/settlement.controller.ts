import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { z } from "zod";
const confirmSettlementSchema = z.object({
  chargeConfigVersion: z.coerce.number().int().positive(),
  paymentMethod: z.enum(["CASH", "ONLINE", "SPLIT"]).optional(),
  cashAmount: z.coerce.number().min(0).optional(),
  onlineAmount: z.coerce.number().min(0).optional(),
  onlineTransactionRef: z.string().optional(),
});
import { chargeEngineService } from "../../services/charges/charge-engine.service.js";
import { createID } from "../../utils/nanoID.js";
import type { SettlementOutcome } from "../../types/charge-engine.types.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";
import { generateReturnReceipt } from "../../services/receipt-generator.service.js";

/**
 * Compute and return the settlement outcome for employee review.
 * Read-only — does not write to DB.
 */
export const InitiateSettlement = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;

    const booking = await prisma.booking.findUnique({
      where: { publicId: bookingId },
      select: {
        id: true,
        publicId: true,
        branchId: true,
        totalDeposit: true,
        safetyDeposit: true,
        chargeConfigVersion: true,
        status: true,
      },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    const breakdown = await chargeEngineService.loadBreakdown(booking.id);
    const depositPaid = new Decimal(booking.totalDeposit.toString())
      .add(new Decimal(booking.safetyDeposit.toString()));

    const totalCharges = breakdown.finalTotal;
    const diff = totalCharges.sub(depositPaid);

    let outcomeType: SettlementOutcome["outcomeType"];
    let amountDue = new Decimal(0);
    let refundAmount = new Decimal(0);

    if (diff.gt(0)) {
      outcomeType = "ADDITIONAL_PAYMENT_REQUIRED";
      amountDue = diff;
    } else if (diff.lt(0)) {
      outcomeType = diff.abs().lt(0.01) ? "BALANCED" : "PARTIAL_REFUND";
      refundAmount = diff.abs();
      // Full refund if no extra charges at all beyond base
      const hasExtraCharges = breakdown.results.some(
        (r) => !r.skip && r.chargeType !== "BASE" && r.finalAmount.gt(0),
      );
      if (!hasExtraCharges) outcomeType = "FULL_REFUND";
    } else {
      outcomeType = "BALANCED";
    }

    const outcome: SettlementOutcome = {
      outcomeType,
      totalCharges,
      depositPaid,
      amountDue,
      refundAmount,
      breakdown,
    };

    return res.status(StatusCode.OK).json({
      data: {
        outcomeType: outcome.outcomeType,
        totalCharges: outcome.totalCharges.toFixed(2),
        depositPaid: outcome.depositPaid.toFixed(2),
        amountDue: outcome.amountDue.toFixed(2),
        refundAmount: outcome.refundAmount.toFixed(2),
        chargeConfigVersion: booking.chargeConfigVersion,
        charges: breakdown.results
          .filter((r) => !r.skip)
          .map((r) => ({
            chargeType: r.chargeType,
            label: r.label,
            originalAmount: r.originalAmount.toFixed(2),
            finalAmount: r.finalAmount.toFixed(2),
            isOverridden: r.isOverridden ?? false,
          })),
      },
    });
  } catch (error) {
    console.error("InitiateSettlement Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * Confirm settlement — locks charge breakdown and creates the appropriate
 * PaymentTransaction or RefundRequest based on the outcome type.
 * Includes optimistic concurrency guard via chargeConfigVersion.
 */
export const ConfirmSettlement = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;

    const validation = confirmSettlementSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid input",
        errors: validation.error.format(),
      });
    }

    const { chargeConfigVersion, paymentMethod, cashAmount, onlineAmount, onlineTransactionRef } =
      validation.data;

    const booking = await prisma.booking.findUnique({
      where: { publicId: bookingId },
      select: {
        id: true,
        publicId: true,
        branchId: true,
        totalDeposit: true,
        safetyDeposit: true,
        chargeConfigVersion: true,
        status: true,
      },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    // Optimistic concurrency check
    if (booking.chargeConfigVersion !== chargeConfigVersion) {
      return res.status(StatusCode.CONFLICT).json({
        message: "Charge data has changed since you last loaded it. Please refresh and try again.",
        currentVersion: booking.chargeConfigVersion,
      });
    }

    // Look up actor
    const actor = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true },
    });
    if (!actor) {
      return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
    }

    const breakdown = await chargeEngineService.loadBreakdown(booking.id);
    const depositPaid = new Decimal(booking.totalDeposit.toString())
      .add(new Decimal(booking.safetyDeposit.toString()));
    const totalCharges = breakdown.finalTotal;
    const diff = totalCharges.sub(depositPaid);

    await prisma.$transaction(async (tx) => {
      // Increment version to prevent double-settlement
      await tx.booking.update({
        where: { id: booking.id },
        data: { chargeConfigVersion: { increment: 1 } },
      });

      if (diff.gt(0.009)) {
        // Additional payment required
        const method = (paymentMethod ?? "CASH") as "CASH" | "ONLINE" | "SPLIT";
        const cash = cashAmount != null ? new Decimal(cashAmount) : diff;
        const online = onlineAmount != null ? new Decimal(onlineAmount) : new Decimal(0);

        await tx.paymentTransaction.create({
          data: {
            publicId: createID(),
            idempotencyKey: `SETTLE_${booking.publicId}_${Date.now()}`,
            bookingId: booking.id,
            branchId: booking.branchId,
            purpose: "REMAINING_BALANCE",
            method,
            status: method === "CASH" ? "COLLECTED" : "CONFIRMED",
            totalAmount: diff.toFixed(2),
            cashAmount: cash.toFixed(2),
            onlineAmount: online.toFixed(2),
            onlineTransactionRef: onlineTransactionRef ?? null,
            collectedById: method !== "ONLINE" ? actor.id : null,
            collectedAt: method !== "ONLINE" ? new Date() : null,
            confirmedById: method === "ONLINE" ? actor.id : null,
            confirmedAt: method === "ONLINE" ? new Date() : null,
          },
        });
      } else if (diff.lt(-0.009)) {
        // Refund required
        await tx.refundRequest.create({
          data: {
            publicId: createID(),
            bookingId: booking.id,
            branchId: booking.branchId,
            amount: diff.abs().toFixed(2),
            reason: "Overpayment refund on vehicle return",
            method: "CASH",
            status: "PENDING_APPROVAL",
            requestedById: actor.id,
          },
        });
      }
      // If balanced (diff ≈ 0), no transaction needed
    });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.SETTLED,
      entityType: StaffEntityType.BOOKING,
      entityRef: booking.publicId,
      description: `Settlement confirmed for booking ${booking.publicId}: ₹${totalCharges.toFixed(2)} charges vs ₹${depositPaid.toFixed(2)} deposit`,
      metadata: {
        totalCharges: totalCharges.toFixed(2),
        depositPaid: depositPaid.toFixed(2),
        diff: diff.toFixed(2),
        paymentMethod,
      },
    });

    // Generate return receipt asynchronously — fire and forget (non-blocking)
    generateReturnReceipt(booking.id, {
      totalCharges,
      depositPaid,
      amountDue: diff.gt(0) ? diff : new Decimal(0),
      refundAmount: diff.lt(0) ? diff.abs() : new Decimal(0),
      charges: breakdown.results,
    }).catch((err) =>
      console.error("[ConfirmSettlement] Receipt generation error:", err),
    );

    return res.status(StatusCode.OK).json({
      message: "Settlement confirmed",
      data: {
        totalCharges: totalCharges.toFixed(2),
        depositPaid: depositPaid.toFixed(2),
        amountDue: diff.gt(0) ? diff.toFixed(2) : "0.00",
        refundAmount: diff.lt(0) ? diff.abs().toFixed(2) : "0.00",
      },
    });
  } catch (error) {
    console.error("ConfirmSettlement Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

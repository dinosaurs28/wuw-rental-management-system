/**
 * Manual pickup discount — legacy branches (no payment sessions).
 *
 *   PUT    /employee/pickup/:bookingId/discount   { amount, reason? }
 *   DELETE /employee/pickup/:bookingId/discount
 *
 * A legacy pickup collects the remaining balance on its own before the handover,
 * so the discount is folded into the booking at once: it lowers the remaining
 * balance (and totalFinal, the rental's GST, the invoice) that staff then
 * collect. Capped at the remaining balance still to be collected (plus a
 * discount already given, which this replaces). Branches with payment sessions
 * put it on the pickup bill instead (POST …/pickup-session/manual-discount).
 */
import { Request, Response } from "express";
import Decimal from "decimal.js";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";
import { lockBookingForPickup, PickupStateError } from "../../services/booking/booking-row-lock.js";
import { isRazorpayOrderId } from "../../services/payment/razorpay.service.js";
import {
  foldPickupDiscountIntoBooking,
  pickupDiscountRecord,
  quotePickupDiscount,
} from "../../services/discount/pickup-discount.service.js";
import {
  PickupDiscountError,
  ZERO_SPLIT,
  parsePickupDiscountAmount,
  parsePickupDiscountReason,
  readPickupDiscount,
  recordSplit,
  serializePickupDiscount,
  subtractSplit,
  type PickupDiscountSplit,
} from "../../services/discount/pickup-discount-rules.js";

const ZERO = new Decimal(0);

async function resolveActor(req: Request) {
  return prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true, branchId: true },
  });
}

/**
 * Sets (amount) or removes (null) the legacy pickup discount under the booking
 * lock. Returns the booking's new remaining balance and the discount.
 */
async function applyLegacyPickupDiscount(
  req: Request,
  res: Response,
  input: { amount: Decimal; reason: string | null } | null,
) {
  const actor = await resolveActor(req);
  if (!actor) return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });

  const booking = await prisma.booking.findFirst({
    where: { publicId: req.params.bookingId!, branchId: req.branch_Id },
    select: {
      id: true,
      publicId: true,
      branch: { select: { chargeConfig: { select: { usePaymentSessions: true } } } },
    },
  });
  if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
  if (booking.branch?.chargeConfig?.usePaymentSessions) {
    return res.status(StatusCode.CONFLICT).json({
      success: false,
      code: "USE_PICKUP_BILL",
      message: "This branch uses payment sessions — give the discount on the pickup bill.",
    });
  }

  const outcome = await prisma.$transaction(async (tx) => {
    await lockBookingForPickup(tx, booking.id);
    const locked = await tx.booking.findUniqueOrThrow({
      where: { id: booking.id },
      select: {
        requiresManagerConfirmation: true,
        isAdvancePayment: true,
        remainingBalance: true,
        remainingPaidAt: true,
        remainingPaymentId: true,
        pricingSnapshot: true,
      },
    });
    if (locked.requiresManagerConfirmation) {
      throw new PickupDiscountError(
        409,
        "PICKUP_AWAITING_MANAGER",
        "This handover is waiting for a manager to confirm it, so the discount can't be changed.",
      );
    }
    // An online payment of the balance is in flight (Razorpay order for the old amount)
    if (!locked.remainingPaidAt && isRazorpayOrderId(locked.remainingPaymentId)) {
      throw new PickupDiscountError(
        409,
        "PAYMENT_IN_PROGRESS",
        "An online payment of the remaining balance is in progress. Check its status first — the discount can be given if it failed.",
      );
    }
    const current = readPickupDiscount(locked.pricingSnapshot);
    const currentSplit = recordSplit(current);
    if (locked.remainingPaidAt && (input || current)) {
      throw new PickupDiscountError(
        409,
        "REMAINING_ALREADY_COLLECTED",
        "The remaining balance was already collected, so a discount can't come off it now.",
        { maxAmount: "0.00" },
      );
    }
    // The balance still to collect, as it was before the discount already given
    const due = locked.isAdvancePayment
      ? new Decimal(locked.remainingBalance.toString()).add(currentSplit.total)
      : ZERO;
    let target: PickupDiscountSplit = ZERO_SPLIT;
    let cap = due;
    if (input) {
      const quote = await quotePickupDiscount(tx, booking.id, input.amount, due);
      target = quote.split;
      cap = quote.cap;
    }
    const record = pickupDiscountRecord(target, {
      reason: input?.reason ?? null,
      cap: cap.toFixed(2),
      source: "LEGACY",
      sessionId: null,
      ledgerEntryPublicId: null,
      appliedById: actor.id,
    });
    await foldPickupDiscountIntoBooking(tx, booking.id, subtractSplit(target, currentSplit), record, {
      adjustRemaining: true,
    });
    const fresh = await tx.booking.findUniqueOrThrow({
      where: { id: booking.id },
      select: { remainingBalance: true, totalFinal: true, pricingSnapshot: true },
    });
    return { before: current, fresh };
  }, { timeout: 15000 });

  const after = readPickupDiscount(outcome.fresh.pricingSnapshot);
  const amount = after ? new Decimal(after.amount).toFixed(2) : "0.00";
  if (input || outcome.before) {
    await auditService.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      actorBranchId: actor.branchId ?? undefined,
      action: input ? "PICKUP_DISCOUNT_APPLIED" : "PICKUP_DISCOUNT_REMOVED",
      category: AuditCategory.PAYMENT,
      description: input
        ? `Pickup discount of ₹${amount} given on booking ${booking.publicId}`
        : `Pickup discount removed from booking ${booking.publicId}`,
      entity: "Booking",
      entityId: booking.publicId,
      before: outcome.before ? { amount: outcome.before.amount, reason: outcome.before.reason } : undefined,
      after: after ? { amount: after.amount, reason: after.reason } : undefined,
    });
    await staffActivityService.logFromRequest(req, {
      actionType: input ? StaffActionType.APPLIED : StaffActionType.UPDATED,
      entityType: StaffEntityType.BOOKING,
      entityRef: booking.publicId,
      description: input
        ? `Pickup discount of ₹${amount} given on booking ${booking.publicId}${input.reason ? ` (${input.reason})` : ""}`
        : `Pickup discount removed from booking ${booking.publicId}`,
      metadata: { pickupDiscount: after ? amount : null, reason: after?.reason ?? null },
    });
  }

  return res.status(StatusCode.OK).json({
    message: input ? "Pickup discount applied" : "Pickup discount removed",
    data: {
      pickupDiscount: serializePickupDiscount(after),
      remainingBalance: new Decimal(outcome.fresh.remainingBalance.toString()).toFixed(2),
      totalFinal: new Decimal(outcome.fresh.totalFinal.toString()).toFixed(2),
    },
  });
}

function sendError(res: Response, err: any, where: string) {
  if (err instanceof PickupDiscountError) return res.status(err.status).json(err.toJSON());
  if (err instanceof PickupStateError) return res.status(err.status).json(err.toJSON());
  console.error(`${where} Error:`, err);
  return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
}

// ── PUT /employee/pickup/:bookingId/discount ──────────────────────────────────

export const SetLegacyPickupDiscount = async (req: Request, res: Response) => {
  try {
    const amount = parsePickupDiscountAmount(req.body?.amount);
    const reason = parsePickupDiscountReason(req.body?.reason);
    return await applyLegacyPickupDiscount(req, res, { amount, reason });
  } catch (err) {
    return sendError(res, err, "SetLegacyPickupDiscount");
  }
};

// ── DELETE /employee/pickup/:bookingId/discount ───────────────────────────────

export const RemoveLegacyPickupDiscount = async (req: Request, res: Response) => {
  try {
    return await applyLegacyPickupDiscount(req, res, null);
  } catch (err) {
    return sendError(res, err, "RemoveLegacyPickupDiscount");
  }
};

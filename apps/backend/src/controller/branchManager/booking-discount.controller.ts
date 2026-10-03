import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { applyCouponSchema } from "@repo/schemas";
import { DateTime } from "luxon";
import PricingEngineService, {
  InclGstTotals,
  allocateByWeights,
  type PricingResult,
} from "../../services/pricing/pricing-engine.service.js";
import { discountApplicationService } from "../../services/discount/index.js";
import type { DiscountEvaluationResult } from "../../services/discount/index.js";
import { couponValidationService, normalizeCouponCode } from "../../services/discount/coupon-validation.service.js";
import {
  isGstRuleMissing,
  GST_RULE_MISSING,
  GST_RULE_MISSING_MESSAGE,
  computeLineGst,
} from "../../services/tax/gst.service.js";
import { refreshInvoiceTotals, isGstOnTopBooking } from "../../services/invoice-totals.service.js";
import Decimal from "decimal.js";

const pricingEngine = new PricingEngineService();

const buildActorContext = async (req: Request) => {
  const user = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true, branchId: true, branch: { select: { name: true } } },
  });
  if (!user || !user.branchId) throw new Error("Actor not found");
  return {
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    actorBranchId: user.branchId,
    actorPublicId: req.public_Id,
    branchName: user.branch?.name ?? "Unknown",
  };
};

// ── Booking repricing (coupon added or removed after creation) ────────────────

class BookingCouponError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "BookingCouponError";
  }
}

const loadBookingForCoupon = (publicId: string) =>
  prisma.booking.findUnique({
    where: { publicId },
    include: {
      items: { include: { vehicle: { select: { id: true, categoryId: true } } }, orderBy: { id: "asc" } },
      invoice: { select: { id: true, status: true } },
      manualDiscount: { select: { id: true, amount: true, status: true } },
    },
  });

type CouponBooking = NonNullable<Awaited<ReturnType<typeof loadBookingForCoupon>>>;
type ActorContext = Awaited<ReturnType<typeof buildActorContext>>;

/**
 * Where a booking's price may still change. A HOLD's price is locked by its
 * payment order, and a booking paid in full would need a refund — only a
 * CONFIRMED advance booking whose balance is still unpaid can be repriced
 * (the new price moves the balance due at pickup).
 */
function assertRepriceable(req: Request, booking: CouponBooking): void {
  // Branch-scoped access (branch_Id is set by EmployeeCheck/ManagerCheck)
  if (req.branch_Id && booking.branchId !== req.branch_Id) {
    throw new BookingCouponError(403, "FORBIDDEN", "Access denied");
  }
  if (booking.status === "HOLD") {
    throw new BookingCouponError(
      409,
      "COUPON_HOLD_PRICE_LOCKED",
      "The price of a booking awaiting payment is fixed. Cancel the hold and book again with the coupon.",
    );
  }
  if (booking.status !== "CONFIRMED") {
    throw new BookingCouponError(400, "INVALID_BOOKING_STATUS", "Coupon can only be changed before pickup.");
  }
  if (!booking.isAdvancePayment || booking.remainingPaidAt) {
    throw new BookingCouponError(
      409,
      "COUPON_BOOKING_ALREADY_PAID",
      "This booking is already paid in full, so its price can't be changed with a coupon.",
    );
  }
}

/**
 * One DiscountApplication for the whole booking: every vehicle's layers added
 * up (the coupon and a manual discount only ever sit on the first vehicle),
 * the same totals booking create records.
 */
function combineEvaluations(evaluations: DiscountEvaluationResult[]): DiscountEvaluationResult {
  const first = evaluations[0]!;
  const add = (pick: (e: DiscountEvaluationResult) => Decimal) =>
    evaluations.reduce((acc, e) => acc.add(pick(e)), new Decimal(0));
  const originalAmount = add((e) => e.originalAmount);
  const durationAmount = add((e) => e.durationDiscount.discountAmount);
  const slab = evaluations.find((e) => e.durationDiscount.slabId != null)?.durationDiscount ?? first.durationDiscount;
  return {
    ...first,
    durationDiscount: {
      ...slab,
      discountAmount: durationAmount,
      discountPercent: originalAmount.gt(0)
        ? durationAmount.div(originalAmount).mul(100).toDecimalPlaces(4)
        : new Decimal(0),
      postDiscountAmount: originalAmount.sub(durationAmount),
    },
    couponDiscountAmount: add((e) => e.couponDiscountAmount),
    manualDiscountAmount: add((e) => e.manualDiscountAmount),
    originalAmount,
    totalDiscountAmount: add((e) => e.totalDiscountAmount),
    finalAmount: add((e) => e.finalAmount),
  };
}

/**
 * An engine result re-stated the way a booking priced before GST-inclusive
 * rents (item 17) was priced: GST added ON TOP of the configured rent. The
 * engine evaluates every discount layer on the configured rent (₹1,300) —
 * exactly the taxable base such a booking stored (BookingItem.baseTotal) — so
 * `discountEvaluation` already holds its taxable-terms figures; GST then goes
 * on top of the rent after discounts at the branch rule (checked against the
 * booking's frozen rate before anything is written). `gross` / `rentWithoutGst`
 * are the matching GST-inclusive view for the response only.
 */
function repriceGstOnTop(p: PricingResult): PricingResult {
  const ZERO = new Decimal(0);
  const ev = p.discountEvaluation;
  const rates = { cgstRate: Number(p.cgstRate), sgstRate: Number(p.sgstRate) };
  const base = ev.originalAmount;
  const afterDiscount = ev.finalAmount;
  const discount = ev.totalDiscountAmount;
  const tax = computeLineGst(afterDiscount, rates);
  const finalTotal = afterDiscount.add(tax.gst);
  const grossPrice = computeLineGst(base, rates).total;
  const grossDiscount = Decimal.max(ZERO, grossPrice.sub(finalTotal));
  const [grossDuration, grossCoupon, grossManual] = allocateByWeights(grossDiscount, [
    ev.durationDiscount.discountAmount,
    ev.couponDiscountAmount,
    ev.manualDiscountAmount,
  ]) as [Decimal, Decimal, Decimal];
  return {
    ...p,
    basePrice: base,
    durationDiscountAmount: ev.durationDiscount.discountAmount,
    couponDiscountAmount: ev.couponDiscountAmount,
    manualDiscountAmount: ev.manualDiscountAmount,
    discountAmount: discount,
    discountPercent: base.gt(0) ? discount.div(base).mul(100).toDecimalPlaces(4) : ZERO,
    taxAmount: tax.gst,
    cgstAmount: tax.cgst,
    sgstAmount: tax.sgst,
    finalTotal,
    gross: {
      price: grossPrice,
      durationDiscount: grossDuration,
      couponDiscount: grossCoupon,
      manualDiscount: grossManual,
      discount: grossDiscount,
      total: finalTotal,
    },
    rentWithoutGst: afterDiscount,
  };
}

/**
 * Price every vehicle of the booking again (coupon once, on the first vehicle;
 * an APPROVED manual discount is kept) and write the new totals to Booking,
 * BookingItem, DiscountApplication and the coupon usage log in one
 * transaction, then re-sync the invoice. Only the discount may move: the
 * original rental period is priced, and the base, deposit and GST rate frozen
 * at booking must come out unchanged. totalFinal moves by the change in the
 * original rental only (confirmed extensions stay included), and so does the
 * unpaid balance (extensions are paid on their own). A booking priced before
 * GST-inclusive rents (item 17) is re-priced the way it was priced — GST on
 * top (repriceGstOnTop) — and its records stay in those terms.
 */
async function repriceBooking(booking: CouponBooking, couponCode: string | undefined, actor: ActorContext) {
  // A confirmed extension moved endAt; BookingItem describes the original period
  const firstExtension = await prisma.bookingExtension.findFirst({
    where: { bookingId: booking.id, extensionStatus: "CONFIRMED" },
    orderBy: { createdAt: "asc" },
    select: { oldEndAt: true },
  });
  const startAt = DateTime.fromJSDate(booking.startAt, { zone: "Asia/Kolkata" });
  const endAt = DateTime.fromJSDate(firstExtension?.oldEndAt ?? booking.endAt, { zone: "Asia/Kolkata" });
  const plan = booking.isAdvancePayment ? "ADVANCE" : "FULL";
  const manual = booking.manualDiscount?.status === "APPROVED" ? booking.manualDiscount : null;

  const enginePriced = await Promise.all(
    booking.items.map((item, index) =>
      pricingEngine.calculateBookingPrice(
        item.vehicleId,
        startAt,
        endAt,
        booking.branchId,
        booking.customerId,
        index === 0 ? couponCode : undefined,
        index === 0 && manual ? new Decimal(manual.amount.toString()) : undefined,
        index === 0 && manual ? manual.id : undefined,
        item.vehicle.categoryId,
        undefined,
        { paymentPlan: plan, excludeBookingId: booking.id },
      ),
    ),
  );
  // Priced with GST on top (before item 17): compare and store it that way, or
  // its rent without GST (₹1,066 of ₹1,300) would never match the stored base
  const gstOnTop = isGstOnTopBooking(booking.pricingSnapshot);
  const priced = gstOnTop ? enginePriced.map(repriceGstOnTop) : enginePriced;
  const first = priced[0]!;
  if (couponCode && !first.discountEvaluation.couponValid) {
    throw new BookingCouponError(
      422,
      first.discountEvaluation.couponFailureCode ?? "COUPON_INVALID",
      first.discountEvaluation.couponFailureReason ?? "Coupon is not valid for this booking.",
    );
  }
  // Same advance rule as booking create
  const minAdvance = first.discountEvaluation.couponRule?.minAdvanceAfterDiscount;
  if (couponCode && minAdvance != null && new Decimal(booking.advanceAmount.toString()).lt(minAdvance.toString())) {
    throw new BookingCouponError(
      422,
      "COUPON_PAYMENT_PLAN_MISMATCH",
      `This coupon needs an advance of at least ₹${Number(minAdvance).toFixed(2)}.`,
    );
  }

  // Today's rates, deposit or GST rule (or a swapped vehicle) would silently
  // change what the customer was charged for — only the discount may move
  const frozenDiffers = booking.items.some((item, index) => {
    const p = priced[index]!;
    const itemTaxRate = new Decimal(item.taxRate.toString());
    return (
      !p.basePrice.toDecimalPlaces(2).eq(new Decimal(item.baseTotal.toString()).toDecimalPlaces(2)) ||
      !p.deposit.toDecimalPlaces(2).eq(new Decimal(item.deposit.toString()).toDecimalPlaces(2)) ||
      (itemTaxRate.gt(0) && !p.taxRate.eq(itemTaxRate))
    );
  });
  if (frozenDiffers) {
    throw new BookingCouponError(
      409,
      "COUPON_REPRICE_RATES_CHANGED",
      "This booking's rates, deposit, GST or vehicle have changed since it was booked, so its price can't be recalculated with a coupon.",
    );
  }

  const sum = (pick: (p: (typeof priced)[number]) => Decimal) =>
    priced.reduce((acc, p) => acc.add(pick(p)), new Decimal(0));
  const newItemsFinal = sum((p) => p.finalTotal.add(p.deposit));
  const oldItemsFinal = booking.items.reduce((acc, i) => acc.add(i.finalTotal.toString()), new Decimal(0));
  const delta = newItemsFinal.sub(oldItemsFinal);
  const newTotalFinal = new Decimal(booking.totalFinal.toString()).add(delta).toDecimalPlaces(2);
  const newRemaining = new Decimal(booking.remainingBalance.toString()).add(delta).toDecimalPlaces(2);
  if (newRemaining.lte(0)) {
    throw new BookingCouponError(
      422,
      "COUPON_NOTHING_TO_DISCOUNT",
      "The advance already paid covers the discounted price, so this coupon would need a refund.",
    );
  }

  const totals = {
    totalBase: sum((p) => p.basePrice).toDecimalPlaces(2),
    totalDiscount: sum((p) => p.discountAmount).toDecimalPlaces(2),
    totalTax: sum((p) => p.taxAmount).toDecimalPlaces(2),
    durationDiscount: sum((p) => p.durationDiscountAmount).toDecimalPlaces(2),
    couponDiscount: sum((p) => p.couponDiscountAmount).toDecimalPlaces(2),
    cgst: sum((p) => p.cgstAmount).toDecimalPlaces(2),
    sgst: sum((p) => p.sgstAmount).toDecimalPlaces(2),
  };
  // GST-inclusive view (item 17): the rent the customer sees, discounts off it
  const inclGst = new InclGstTotals();
  priced.forEach((p) => inclGst.add(p));
  const inclGstTotals = inclGst.view();
  const evaluation = combineEvaluations(priced.map((p) => p.discountEvaluation));

  await prisma.$transaction(async (tx) => {
    // Serialise with a concurrent coupon change, balance collection or
    // extension on this booking, and re-check what the new price was built on
    await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${booking.id} FOR UPDATE`;
    const current = await tx.booking.findUniqueOrThrow({
      where: { id: booking.id },
      select: {
        status: true,
        remainingPaidAt: true,
        couponCode: true,
        discountRuleId: true,
        totalFinal: true,
        remainingBalance: true,
      },
    });
    if (
      current.status !== "CONFIRMED" ||
      current.remainingPaidAt ||
      current.couponCode !== booking.couponCode ||
      current.discountRuleId !== booking.discountRuleId ||
      !new Decimal(current.totalFinal.toString()).eq(booking.totalFinal.toString()) ||
      !new Decimal(current.remainingBalance.toString()).eq(booking.remainingBalance.toString())
    ) {
      throw new BookingCouponError(
        409,
        "BOOKING_CHANGED",
        "This booking changed while the coupon was being updated. Reload it and try again.",
      );
    }

    // Two bookings can't both take a limited coupon's last use: lock the rule
    // and count again (this booking's own use is excluded)
    if (evaluation.couponValid && evaluation.couponRule) {
      await couponValidationService.lockRule(tx, evaluation.couponRule.id);
      const usage = await couponValidationService.checkUsageLimits(
        evaluation.couponRule,
        { customerId: booking.customerId, branchId: booking.branchId, bookingId: booking.id },
        tx,
      );
      if (!usage.valid) {
        throw new BookingCouponError(
          422,
          usage.failureCode ?? "COUPON_USAGE_LIMIT_EXCEEDED",
          usage.failureReason ?? "This coupon has reached its usage limit.",
        );
      }
    }

    for (const [index, item] of booking.items.entries()) {
      const p = priced[index]!;
      await tx.bookingItem.update({
        where: { id: item.id },
        data: {
          baseTotal: p.basePrice.toFixed(2),
          discountAmount: p.discountAmount.toFixed(2),
          discountPercent: p.discountPercent.toString(),
          taxAmount: p.taxAmount.toFixed(2),
          cgstAmount: p.cgstAmount.toFixed(2),
          sgstAmount: p.sgstAmount.toFixed(2),
          finalTotal: p.finalTotal.add(p.deposit).toFixed(2),
        },
      });
    }
    const snapshot = (booking.pricingSnapshot ?? {}) as Record<string, any>;
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        totalBase: totals.totalBase.toFixed(2),
        totalDiscount: totals.totalDiscount.toFixed(2),
        totalTax: totals.totalTax.toFixed(2),
        totalFinal: newTotalFinal.toFixed(2),
        remainingBalance: newRemaining.toFixed(2),
        couponCode: first.appliedCouponCode ?? null,
        discountRuleId: first.couponRuleId ?? null,
        pricingSnapshot: {
          ...snapshot,
          totals: {
            ...(snapshot.totals ?? {}),
            grandBaseTotal: Number(totals.totalBase.toFixed(2)),
            grandDiscountTotal: Number(totals.totalDiscount.toFixed(2)),
            grandTaxTotal: Number(totals.totalTax.toFixed(2)),
            grandCGSTTotal: Number(totals.cgst.toFixed(2)),
            grandSGSTTotal: Number(totals.sgst.toFixed(2)),
            grandFinalTotal: Number(newItemsFinal.toFixed(2)),
            grandDurationDiscountTotal: Number(totals.durationDiscount.toFixed(2)),
            grandCouponDiscountTotal: Number(totals.couponDiscount.toFixed(2)),
            // Item-17 bookings only: a GST-on-top booking never gains the inclusive
            // totals, so it keeps being read (and re-priced) the way it was priced
            ...(gstOnTop ? {} : inclGstTotals),
            durationDiscountLabel: first.durationDiscountLabel,
            couponCode: first.appliedCouponCode ?? null,
          },
        } as any,
      },
    });

    // DiscountApplication (all vehicles) + coupon usage log: written with the
    // usage check above, or deleted when the coupon is removed
    await discountApplicationService.record(booking.id, booking.publicId, evaluation, plan, actor, tx);
  }, { timeout: 15000 });

  // The invoice (and its cached PDF) follow the new booking totals
  refreshInvoiceTotals(booking.id).catch((err) =>
    console.error(`[booking-coupon] invoice refresh failed for booking ${booking.publicId}:`, err),
  );

  return { first, totals, inclGstTotals, newTotalFinal, newRemaining };
}

/**
 * POST /api/branchManager/bookings/:bookingId/apply-coupon
 * POST /api/employee/discount/bookings/:bookingId/apply-coupon
 *
 * Applies a coupon to a CONFIRMED advance booking whose balance is still
 * unpaid (the coupon must allow post-booking use). One coupon per booking.
 * Every vehicle is repriced, the balance due at pickup drops with it, and a
 * DiscountApplication + usage log are recorded. The pickup counter coupon
 * (pickup-session/apply-discount) is the normal staff path.
 */
export const ApplyCoupon = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params; // publicId from frontend

    const validation = applyCouponSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
    }
    const couponCode = normalizeCouponCode(validation.data.couponCode);

    const booking = await loadBookingForCoupon(bookingId!);
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    assertRepriceable(req, booking);

    if (booking.couponCode || booking.discountRuleId) {
      return res.status(StatusCode.CONFLICT).json({
        code: "COUPON_ALREADY_APPLIED",
        message: `This booking already has ${booking.couponCode ?? "a coupon"} applied. Only one coupon can be used per booking.`,
      });
    }

    const rule = await prisma.discountRule.findUnique({ where: { code: couponCode } });
    if (rule && !rule.allowPostBooking) {
      return res.status(StatusCode.CONFLICT).json({
        code: "COUPON_POST_BOOKING_NOT_ALLOWED",
        message: "This coupon can only be used when booking, not added to a confirmed booking.",
      });
    }
    // Every confirmed booking gets an Invoice row at payment; an advance
    // booking's stays PENDING (re-synced with the booking) until the balance is
    // paid. Only an invoice past that point counts as generated.
    if (rule && booking.invoice && booking.invoice.status !== "PENDING" && !rule.allowPostInvoice) {
      return res.status(StatusCode.BAD_REQUEST).json({
        code: "DISCOUNT_POST_INVOICE_BLOCKED",
        message: "Discount cannot be applied after invoice has been generated.",
      });
    }

    const actor = await buildActorContext(req);
    // Also records the DiscountApplication + coupon use and re-syncs the invoice
    const { first, totals, inclGstTotals, newTotalFinal, newRemaining } = await repriceBooking(booking, couponCode, actor);

    return res.status(StatusCode.OK).json({
      message: "Coupon applied successfully",
      data: {
        couponCode: first.appliedCouponCode,
        durationDiscountAmount: totals.durationDiscount.toFixed(2),
        couponDiscountAmount: totals.couponDiscount.toFixed(2),
        totalDiscountAmount: totals.totalDiscount.toFixed(2),
        totalTax: totals.totalTax.toFixed(2),
        finalTotal: newTotalFinal.toFixed(2),
        remainingBalance: newRemaining.toFixed(2),
        // Off the GST-inclusive rent (item 17) — what the customer sees
        couponDiscountInclGst: inclGstTotals.grandCouponDiscountInclGst.toFixed(2),
        discountInclGst: inclGstTotals.grandDiscountInclGst.toFixed(2),
        rentAfterDiscountInclGst: inclGstTotals.grandRentAfterDiscountInclGst.toFixed(2),
      },
    });
  } catch (error) {
    if (error instanceof BookingCouponError) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    if (isGstRuleMissing(error)) {
      return res.status(StatusCode.CONFLICT).json({ code: GST_RULE_MISSING, message: GST_RULE_MISSING_MESSAGE });
    }
    console.error("ApplyCoupon Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * DELETE /api/branchManager/bookings/:bookingId/apply-coupon
 * DELETE /api/employee/discount/bookings/:bookingId/apply-coupon
 *
 * Removes the coupon from a CONFIRMED advance booking whose balance is still
 * unpaid, reprices every vehicle without it (duration discount and an approved
 * manual discount still apply), raises the balance due at pickup and gives the
 * coupon use back.
 */
export const RemoveCoupon = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params; // publicId

    const booking = await loadBookingForCoupon(bookingId!);
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    assertRepriceable(req, booking);
    if (!booking.couponCode) {
      return res.status(StatusCode.BAD_REQUEST).json({
        code: "NO_COUPON_APPLIED",
        message: "No coupon is currently applied to this booking",
      });
    }

    const actor = await buildActorContext(req);
    // Also rewrites the DiscountApplication (without coupon), gives the coupon
    // use back and re-syncs the invoice
    const { totals, newTotalFinal, newRemaining } = await repriceBooking(booking, undefined, actor);

    return res.status(StatusCode.OK).json({
      message: "Coupon removed",
      data: {
        totalDiscountAmount: totals.totalDiscount.toFixed(2),
        totalTax: totals.totalTax.toFixed(2),
        finalTotal: newTotalFinal.toFixed(2),
        remainingBalance: newRemaining.toFixed(2),
      },
    });
  } catch (error) {
    if (error instanceof BookingCouponError) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    if (isGstRuleMissing(error)) {
      return res.status(StatusCode.CONFLICT).json({ code: GST_RULE_MISSING, message: GST_RULE_MISSING_MESSAGE });
    }
    console.error("RemoveCoupon Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/branchManager/bookings/:bookingId/discount-summary
 * GET /api/employee/discount/bookings/:bookingId/discount-summary
 *
 * Returns a DiscountSummary for the booking.
 * Primary source: DiscountApplication record (created when manager/employee applies a discount).
 * Fallback: booking.couponCode / totalDiscount fields (set when customer applies coupon at booking time).
 */
export const GetBookingDiscountSummary = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params; // publicId

    const booking = await prisma.booking.findUnique({
      where: { publicId: bookingId },
      select: {
        id: true,
        publicId: true,
        branchId: true,
        couponCode: true,
        totalBase: true,
        totalDiscount: true,
        totalFinal: true,
        pricingSnapshot: true,
      },
    });
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });

    // Branch-scoped access check (branch_Id is set by EmployeeCheck/ManagerCheck middleware)
    if (req.branch_Id && booking.branchId !== req.branch_Id) {
      return res.status(StatusCode.FORBIDDEN).json({ message: "Access denied" });
    }

    const application = await discountApplicationService.getByBookingId(booking.id);

    if (application) {
      // Normalise DiscountApplication → DiscountSummary shape expected by frontend
      const summary = {
        bookingPublicId: booking.publicId,
        durationDiscountAmount: application.durationDiscountAmount.toString(),
        couponCode: application.discountRule?.code ?? null,
        couponDiscountAmount: application.couponDiscountAmount.toString(),
        manualDiscountAmount: application.manualDiscountAmount.toString(),
        totalDiscountAmount: application.totalDiscountAmount.toString(),
        finalTotal: application.finalAmount.toString(),
        manualDiscount: application.manualDiscount
          ? {
              publicId: (application.manualDiscount as any).publicId,
              amount: (application.manualDiscount as any).amount?.toString() ?? "0",
              reason: (application.manualDiscount as any).reason ?? "",
              status: (application.manualDiscount as any).status ?? "",
              appliedBy: (application.manualDiscount as any).appliedByName ?? "Unknown",
              requiresApproval: (application.manualDiscount as any).requiresApproval ?? false,
            }
          : null,
      };
      return res.status(StatusCode.OK).json({ data: summary });
    }

    // No DiscountApplication record (bookings created before it was recorded at
    // creation). Split the layers from the pricing snapshot when it has them;
    // otherwise a booking without a coupon got its whole discount from the slab.
    const totalDiscount = parseFloat(booking.totalDiscount?.toString() ?? "0");
    if (totalDiscount > 0 || booking.couponCode) {
      const snapTotals = ((booking.pricingSnapshot as any)?.totals ?? {}) as Record<string, unknown>;
      const hasSplit = snapTotals.grandDurationDiscountTotal != null || snapTotals.grandCouponDiscountTotal != null;
      const durationAmount = hasSplit
        ? Number(snapTotals.grandDurationDiscountTotal ?? 0)
        : booking.couponCode ? 0 : totalDiscount;
      const couponAmount = hasSplit
        ? Number(snapTotals.grandCouponDiscountTotal ?? 0)
        : booking.couponCode ? totalDiscount : 0;
      const summary = {
        bookingPublicId: booking.publicId,
        durationDiscountAmount: durationAmount.toFixed(2),
        couponCode: booking.couponCode ?? null,
        couponDiscountAmount: couponAmount.toFixed(2),
        manualDiscountAmount: Math.max(0, totalDiscount - durationAmount - couponAmount).toFixed(2),
        totalDiscountAmount: totalDiscount.toFixed(2),
        finalTotal: parseFloat(booking.totalFinal.toString()).toFixed(2),
        manualDiscount: null,
      };
      return res.status(StatusCode.OK).json({ data: summary });
    }

    return res.status(StatusCode.OK).json({ data: null });
  } catch (error) {
    console.error("GetBookingDiscountSummary Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

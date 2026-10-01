import Decimal from "decimal.js";
import {
  prisma,
  LedgerEntryType,
  LedgerEntryClassification,
} from "@repo/database/client";
import type { DiscountRule, Prisma } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { couponValidationService, normalizeCouponCode } from "./coupon-validation.service.js";
import { discountCalculationService } from "./discount-calculation.service.js";
import { paymentSessionService } from "../payment/paymentSession.service.js";
import {
  getBranchGstRates,
  computeLineGst,
  splitInclusiveGst,
  isGstRuleMissing,
  GST_RULE_MISSING,
  GST_RULE_MISSING_MESSAGE,
} from "../tax/gst.service.js";

/**
 * Counter (pickup-session) coupon — Unified Payments branches only.
 *
 * The coupon is the same rule the customer could have used online, applied to
 * the booking's pre-GST rental base (totalBase − existing discounts). Its GST is
 * reduced with it, so the session credit is discount + GST on the discount. It
 * is capped at the rental and extension amount still owed in the session —
 * never the safety deposit — and, when the branch sets one, at
 * maxCombinedDiscountPercent of the booking base.
 *
 * Flow: the pickup session gets a DISCOUNT ledger line (referenceType
 * DISCOUNT_RULE, metadata = the split) when staff apply the code; when the
 * session is paid, applyOnSessionCompletion re-checks the coupon under a row
 * lock and reprices the booking (Booking, first BookingItem, Invoice,
 * DiscountApplication) and records the usage.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export const COUNTER_COUPON_REF = "DISCOUNT_RULE";

export class CounterCouponError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CounterCouponError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message, ...this.extra };
  }
}

export interface CounterCouponQuote {
  rule: DiscountRule;
  code: string;
  /** Pre-GST rental base the coupon was calculated on (totalBase − totalDiscount). */
  rentalBase: Decimal;
  /** Pre-GST discount. */
  discount: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  gst: Decimal;
  /** discount + gst — the credit on the pickup bill. */
  total: Decimal;
  cgstRate: number;
  sgstRate: number;
  /** Rental + extension still owed in the session before the coupon. */
  owed: Decimal;
  /** Why the coupon's own amount was reduced, if it was. */
  cappedBy: "OWED" | "COMBINED_CAP" | null;
}

const ZERO = new Decimal(0);
const toDec = (v: { toString(): string } | null | undefined) => new Decimal(v?.toString() ?? "0");

/** Duration-slab discount already baked into the booking, with its label. */
async function bookingDurationDiscount(
  db: Db,
  booking: { id: number; couponCode: string | null; totalDiscount: unknown; pricingSnapshot: unknown },
): Promise<{ amount: Decimal; label: string | null }> {
  const application = await db.discountApplication.findUnique({
    where: { bookingId: booking.id },
    select: { durationDiscountAmount: true, durationSlabId: true },
  });
  const snapshotTotals = (booking.pricingSnapshot as any)?.totals ?? {};
  const snapshotLabel: string | null = snapshotTotals.durationDiscountLabel ?? null;
  if (application) {
    let label = snapshotLabel;
    if (!label && application.durationSlabId) {
      const slab = await db.durationDiscountSlab.findUnique({
        where: { id: application.durationSlabId },
        select: { label: true },
      });
      label = slab?.label ?? null;
    }
    return { amount: toDec(application.durationDiscountAmount), label };
  }
  if (snapshotTotals.grandDurationDiscountTotal != null) {
    return { amount: new Decimal(String(snapshotTotals.grandDurationDiscountTotal)), label: snapshotLabel };
  }
  // Older bookings carry no breakdown: without a coupon, the whole discount was the slab
  return {
    amount: booking.couponCode ? ZERO : toDec(booking.totalDiscount as any),
    label: null,
  };
}

/** Largest pre-GST discount whose discount + GST fits in `limit`. */
function fitDiscountToLimit(limit: Decimal, rates: { cgstRate: number; sgstRate: number }) {
  const rate = new Decimal(rates.cgstRate).add(rates.sgstRate);
  let d = limit.div(rate.div(100).add(1)).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  let line = computeLineGst(d, rates);
  while (d.gt(0) && line.total.gt(limit)) {
    d = d.sub("0.01");
    line = computeLineGst(d, rates);
  }
  return { discount: d, line };
}

/**
 * Validate a counter coupon for a pickup session and work out its amounts.
 * Throws CounterCouponError with the HTTP status/code to return.
 */
export async function quoteCounterCoupon(
  db: Db,
  bookingId: number,
  sessionId: number,
  rawCode: string,
): Promise<CounterCouponQuote> {
  const code = normalizeCouponCode(rawCode);
  if (!code) throw new CounterCouponError(400, "COUPON_NOT_FOUND", "Enter a coupon code.");

  const booking = await db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      id: true,
      branchId: true,
      customerId: true,
      days: true,
      totalBase: true,
      totalDiscount: true,
      couponCode: true,
      discountRuleId: true,
      isAdvancePayment: true,
      pricingSnapshot: true,
      items: { select: { vehicle: { select: { categoryId: true } } }, orderBy: { id: "asc" } },
    },
  });

  // One coupon per booking — an online coupon (or an earlier counter coupon) blocks another
  if (booking.couponCode || booking.discountRuleId) {
    const existing = booking.couponCode ?? "a coupon";
    throw new CounterCouponError(
      409,
      "COUPON_ALREADY_APPLIED",
      `This booking already has ${existing} applied. Only one coupon can be used per booking.`,
      { appliedCouponCode: booking.couponCode ?? null },
    );
  }

  const totalBase = toDec(booking.totalBase);
  const existingDiscount = toDec(booking.totalDiscount);
  const rentalBase = Decimal.max(ZERO, totalBase.sub(existingDiscount));

  const validation = await couponValidationService.validate(
    code,
    {
      branchId: booking.branchId,
      customerId: booking.customerId,
      bookingAmount: rentalBase,
      rentalDays: booking.days,
      vehicleCategoryId: booking.items[0]?.vehicle.categoryId ?? 0,
      paymentPlan: booking.isAdvancePayment ? "ADVANCE" : "FULL",
      bookingId: booking.id,
    },
    db,
  );
  if (!validation.valid || !validation.rule) {
    throw new CounterCouponError(
      422,
      validation.failureCode ?? "COUPON_INVALID",
      validation.failureReason ?? "This coupon can't be used for this booking.",
    );
  }
  const rule = validation.rule;

  const config = await db.branchDiscountConfig.findUnique({
    where: { branchId: booking.branchId },
    select: { stackWithCoupon: true, maxCombinedDiscountPercent: true },
  });

  // Stacking with a duration discount already in the booking
  const duration = await bookingDurationDiscount(db, booking);
  if (duration.amount.gt(0) && !(config?.stackWithCoupon || rule.stackable)) {
    const what = duration.label ? `the "${duration.label}" duration discount` : "a duration discount";
    throw new CounterCouponError(
      409,
      "COUPON_STACKING_NOT_ALLOWED",
      `This booking already has ${what} (₹${duration.amount.toFixed(2)}), and coupons can't be combined with it at this branch.`,
    );
  }

  let discount = discountCalculationService.calculateCouponDiscount(rule, rentalBase).discountAmount;
  let cappedBy: CounterCouponQuote["cappedBy"] = null;

  // Branch combined cap: existing discounts + coupon ≤ cap% of the booking base
  if (config?.maxCombinedDiscountPercent != null) {
    const cap = toDec(config.maxCombinedDiscountPercent);
    const maxTotal = totalBase.mul(cap).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const room = Decimal.max(ZERO, maxTotal.sub(existingDiscount));
    if (discount.gt(room)) {
      discount = room;
      cappedBy = "COMBINED_CAP";
    }
    if (discount.lte(0)) {
      throw new CounterCouponError(
        422,
        "COUPON_NOTHING_TO_DISCOUNT",
        `This booking already has the most discount the branch allows (${cap.toString()}% of the rental).`,
      );
    }
  }

  // What the coupon may come out of: the rental balance and extension still owed now
  const owedLines = await db.ledgerEntry.findMany({
    where: {
      sessionId,
      isVoided: false,
      entryType: { in: [LedgerEntryType.BOOKING_BASE, LedgerEntryType.EXTENSION] },
    },
    select: { amount: true, gstAmount: true },
  });
  // A TAXABLE line's payable is amount + its stored GST (0 when amount is GST-inclusive)
  const owed = owedLines.reduce((sum, l) => sum.add(toDec(l.amount)).add(toDec(l.gstAmount)), ZERO);
  if (owed.lte(0) || discount.lte(0)) {
    throw new CounterCouponError(
      422,
      "COUPON_NOTHING_TO_DISCOUNT",
      "Nothing for the rental is due at this pickup, so there is nothing to discount. A coupon can't be refunded or taken off the safety deposit.",
    );
  }

  let rates: { cgstRate: number; sgstRate: number };
  try {
    rates = await getBranchGstRates(booking.branchId, db);
  } catch (err) {
    if (isGstRuleMissing(err)) {
      throw new CounterCouponError(409, GST_RULE_MISSING, GST_RULE_MISSING_MESSAGE);
    }
    throw err;
  }

  let line = computeLineGst(discount, rates);
  if (line.total.gt(owed)) {
    const fitted = fitDiscountToLimit(owed, rates);
    discount = fitted.discount;
    line = fitted.line;
    cappedBy = "OWED";
  }
  if (discount.lte(0)) {
    throw new CounterCouponError(
      422,
      "COUPON_NOTHING_TO_DISCOUNT",
      "Nothing for the rental is due at this pickup, so there is nothing to discount.",
    );
  }

  return {
    rule,
    code: rule.code,
    rentalBase,
    discount,
    cgst: line.cgst,
    sgst: line.sgst,
    gst: line.gst,
    total: line.total,
    cgstRate: rates.cgstRate,
    sgstRate: rates.sgstRate,
    owed,
    cappedBy,
  };
}

/**
 * Put the coupon on the pickup bill: voids any earlier coupon line in the
 * session and adds a DISCOUNT line of −(discount + GST). Each apply gets its
 * own idempotency key, so apply → remove → apply again never collides.
 */
export async function writeCounterCouponEntry(
  tx: Db,
  args: {
    sessionId: number;
    bookingId: number;
    quote: CounterCouponQuote;
    actor: { id: number; role: string };
  },
): Promise<void> {
  const { sessionId, bookingId, quote, actor } = args;

  await tx.ledgerEntry.updateMany({
    where: {
      sessionId,
      entryType: LedgerEntryType.DISCOUNT,
      referenceType: COUNTER_COUPON_REF,
      isVoided: false,
    },
    data: { isVoided: true, voidedAt: new Date(), voidedById: actor.id, voidReason: "Replaced by new coupon" },
  });

  await tx.ledgerEntry.create({
    data: {
      publicId: createID(),
      sessionId,
      bookingId,
      entryType: LedgerEntryType.DISCOUNT,
      classification: LedgerEntryClassification.DISCOUNT,
      amount: quote.total.negated().toFixed(2),
      baseAmount: quote.discount.negated().toFixed(2),
      gstAmount: quote.gst.negated().toFixed(2),
      description: `Coupon ${quote.code} (₹${quote.discount.toFixed(2)} + GST ₹${quote.gst.toFixed(2)})`,
      referenceId: quote.rule.publicId,
      referenceType: COUNTER_COUPON_REF,
      idempotencyKey: `pickup:${bookingId}:discount:${sessionId}:${quote.rule.id}:${createID()}`,
      actorId: actor.id,
      actorRole: actor.role,
      metadata: {
        couponCode: quote.code,
        discountRuleId: quote.rule.id,
        discount: quote.discount.toFixed(2),
        cgst: quote.cgst.toFixed(2),
        sgst: quote.sgst.toFixed(2),
        gst: quote.gst.toFixed(2),
        cgstRate: quote.cgstRate,
        sgstRate: quote.sgstRate,
        rentalBase: quote.rentalBase.toFixed(2),
        owed: quote.owed.toFixed(2),
        cappedBy: quote.cappedBy,
      },
    },
  });

  await paymentSessionService.recomputeTotals(sessionId, tx as any);
}

/**
 * Session paid: make the counter coupon part of the booking. Runs inside the
 * settlement transaction. Re-checks the coupon under a DiscountRule row lock
 * (a concurrent booking may have used the last slot), then reprices:
 *   Booking      totalDiscount += d, totalTax −= gst, totalFinal −= d + gst,
 *                couponCode / discountRuleId, remainingBalance (advance bookings)
 *   BookingItem  (first item) discount / tax / CGST / SGST / final
 *   Invoice      discount, total, taxable value and CGST/SGST (when stored)
 *   DiscountApplication  coupon layer added to whatever is recorded
 *   CouponUsageLog       one row (released again only by the cases in releaseUsage)
 * Returns false when the session has no counter coupon.
 */
export async function applyCounterCouponOnSessionCompletion(
  tx: Db,
  bookingId: number,
  sessionId: number,
): Promise<boolean> {
  const entry = await tx.ledgerEntry.findFirst({
    where: {
      sessionId,
      entryType: LedgerEntryType.DISCOUNT,
      referenceType: COUNTER_COUPON_REF,
      isVoided: false,
    },
    orderBy: { createdAt: "desc" },
  });
  if (!entry?.referenceId) return false;

  const rule = await tx.discountRule.findUnique({ where: { publicId: entry.referenceId } });
  if (!rule) return false;

  await couponValidationService.lockRule(tx, rule.id);

  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      id: true,
      branchId: true,
      customerId: true,
      days: true,
      totalBase: true,
      totalDiscount: true,
      totalTax: true,
      totalFinal: true,
      couponCode: true,
      discountRuleId: true,
      isAdvancePayment: true,
      remainingBalance: true,
      pricingSnapshot: true,
      items: {
        select: {
          id: true,
          baseTotal: true,
          discountAmount: true,
          taxAmount: true,
          cgstAmount: true,
          sgstAmount: true,
          finalTotal: true,
          vehicle: { select: { categoryId: true } },
        },
        orderBy: { id: "asc" },
      },
    },
  });

  // Already folded in (retried completion) — nothing more to do
  if (booking.discountRuleId === rule.id) return true;
  if (booking.couponCode || booking.discountRuleId) {
    throw new CounterCouponError(
      409,
      "COUPON_ALREADY_APPLIED",
      `This booking already has ${booking.couponCode ?? "a coupon"} applied. Remove ${rule.code} from the bill and collect again.`,
    );
  }

  const totalBase = toDec(booking.totalBase);
  const existingDiscount = toDec(booking.totalDiscount);
  const recheck = await couponValidationService.validate(
    rule.code,
    {
      branchId: booking.branchId,
      customerId: booking.customerId,
      bookingAmount: Decimal.max(ZERO, totalBase.sub(existingDiscount)),
      rentalDays: booking.days,
      vehicleCategoryId: booking.items[0]?.vehicle.categoryId ?? 0,
      paymentPlan: booking.isAdvancePayment ? "ADVANCE" : "FULL",
      bookingId: booking.id,
    },
    tx,
  );
  if (!recheck.valid) {
    throw new CounterCouponError(
      409,
      "COUPON_NO_LONGER_VALID",
      `Coupon ${rule.code} can no longer be used (${recheck.failureReason ?? "not valid"}). Remove it from the bill and collect the full amount.`,
      { couponFailureCode: recheck.failureCode ?? null },
    );
  }

  // The split frozen on the ledger line; older lines carry none — split the inclusive credit
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const credit = toDec(entry.amount).abs();
  let discount: Decimal;
  let cgst: Decimal;
  let sgst: Decimal;
  if (meta.discount != null && meta.cgst != null && meta.sgst != null) {
    discount = new Decimal(String(meta.discount));
    cgst = new Decimal(String(meta.cgst));
    sgst = new Decimal(String(meta.sgst));
  } else {
    const rates = await getBranchGstRates(booking.branchId, tx);
    const split = splitInclusiveGst(credit, rates);
    discount = split.taxable;
    cgst = split.cgst;
    sgst = split.sgst;
  }
  const gst = cgst.add(sgst);
  const total = discount.add(gst);

  const newTotalDiscount = existingDiscount.add(discount);
  const remaining = toDec(booking.remainingBalance);
  const snapshot = (booking.pricingSnapshot ?? {}) as Record<string, unknown>;

  await tx.booking.update({
    where: { id: booking.id },
    data: {
      couponCode: rule.code,
      discountRuleId: rule.id,
      totalDiscount: newTotalDiscount.toFixed(2),
      totalTax: toDec(booking.totalTax).sub(gst).toFixed(2),
      totalFinal: toDec(booking.totalFinal).sub(total).toFixed(2),
      ...(booking.isAdvancePayment && remaining.gt(0)
        ? { remainingBalance: Decimal.max(ZERO, remaining.sub(total)).toFixed(2) }
        : {}),
      pricingSnapshot: {
        ...snapshot,
        counterCoupon: {
          couponCode: rule.code,
          discountRuleId: rule.id,
          discount: discount.toFixed(2),
          cgst: cgst.toFixed(2),
          sgst: sgst.toFixed(2),
          gst: gst.toFixed(2),
          total: total.toFixed(2),
          sessionId,
          ledgerEntryPublicId: entry.publicId,
          appliedAt: new Date().toISOString(),
        },
      } as any,
    },
  });

  const item = booking.items[0];
  if (item) {
    const itemDiscount = toDec(item.discountAmount).add(discount);
    const itemBase = toDec(item.baseTotal);
    await tx.bookingItem.update({
      where: { id: item.id },
      data: {
        discountAmount: itemDiscount.toFixed(2),
        discountPercent: itemBase.gt(0) ? itemDiscount.div(itemBase).mul(100).toDecimalPlaces(4).toString() : "0",
        taxAmount: toDec(item.taxAmount).sub(gst).toFixed(2),
        cgstAmount: toDec(item.cgstAmount).sub(cgst).toFixed(2),
        sgstAmount: toDec(item.sgstAmount).sub(sgst).toFixed(2),
        finalTotal: toDec(item.finalTotal).sub(total).toFixed(2),
      },
    });
  }

  const invoice = await tx.invoice.findUnique({
    where: { bookingId: booking.id },
    select: { id: true, discount: true, total: true, tax: true, taxableAmount: true, cgstAmount: true, sgstAmount: true },
  });
  if (invoice) {
    const lower = (v: unknown, by: Decimal) => {
      const cur = toDec(v as any);
      return cur.gt(0) ? Decimal.max(ZERO, cur.sub(by)).toFixed(2) : cur.toFixed(2);
    };
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        discount: newTotalDiscount.toFixed(2),
        total: toDec(invoice.total).sub(total).toFixed(2),
        tax: lower(invoice.tax, gst),
        taxableAmount: lower(invoice.taxableAmount, discount),
        cgstAmount: lower(invoice.cgstAmount, cgst),
        sgstAmount: lower(invoice.sgstAmount, sgst),
        // Cached PDF no longer matches
        invoicePdfFileId: null,
        generatedAt: null,
      },
    });
  }

  const rentalBase = Decimal.max(ZERO, totalBase.sub(existingDiscount));
  const couponPercent = rentalBase.gt(0) ? discount.div(rentalBase).mul(100).toDecimalPlaces(4) : ZERO;
  const application = await tx.discountApplication.findUnique({ where: { bookingId: booking.id } });
  if (application) {
    await tx.discountApplication.update({
      where: { bookingId: booking.id },
      data: {
        couponDiscountAmount: toDec(application.couponDiscountAmount).add(discount).toFixed(2),
        couponDiscountPercent: couponPercent.toString(),
        discountRuleId: rule.id,
        totalDiscountAmount: toDec(application.totalDiscountAmount).add(discount).toFixed(2),
        finalAmount: Decimal.max(ZERO, toDec(application.finalAmount).sub(discount)).toFixed(2),
      },
    });
  } else {
    const duration = await bookingDurationDiscount(tx, booking);
    await tx.discountApplication.create({
      data: {
        publicId: createID(),
        bookingId: booking.id,
        originalAmount: totalBase.toFixed(2),
        durationDiscountAmount: duration.amount.toFixed(2),
        durationDiscountPercent: totalBase.gt(0)
          ? duration.amount.div(totalBase).mul(100).toDecimalPlaces(4).toString()
          : "0",
        couponDiscountAmount: discount.toFixed(2),
        couponDiscountPercent: couponPercent.toString(),
        discountRuleId: rule.id,
        manualDiscountAmount: Decimal.max(ZERO, existingDiscount.sub(duration.amount)).toFixed(2),
        totalDiscountAmount: newTotalDiscount.toFixed(2),
        finalAmount: Decimal.max(ZERO, totalBase.sub(newTotalDiscount)).toFixed(2),
        paymentPlan: booking.isAdvancePayment ? "ADVANCE" : "FULL",
      },
    });
  }

  await tx.couponUsageLog.create({
    data: {
      discountRuleId: rule.id,
      bookingId: booking.id,
      customerId: booking.customerId,
      branchId: booking.branchId,
      discountedAmount: discount.toFixed(2),
    },
  });

  return true;
}

/** Serialisable view of a quote for API responses. */
export function serializeCounterCouponQuote(quote: CounterCouponQuote) {
  return {
    couponCode: quote.code,
    discountAmount: quote.discount.toFixed(2),
    cgstAmount: quote.cgst.toFixed(2),
    sgstAmount: quote.sgst.toFixed(2),
    gstAmount: quote.gst.toFixed(2),
    totalCredit: quote.total.toFixed(2),
    rentalBase: quote.rentalBase.toFixed(2),
    owedBeforeCoupon: quote.owed.toFixed(2),
    cappedBy: quote.cappedBy,
  };
}

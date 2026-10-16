import Decimal from "decimal.js";
import {
  prisma,
  LedgerEntryType,
  LedgerEntryClassification,
  PaymentSessionStatus,
  PaymentSessionType,
} from "@repo/database/client";
import type { Prisma } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { paymentSessionService } from "../payment/paymentSession.service.js";
import { isGstRuleMissing, GST_RULE_MISSING, GST_RULE_MISSING_MESSAGE, type BranchGstRates } from "../tax/gst.service.js";
import { bookingGstRates, isGstOnTopBooking } from "../invoice-totals.service.js";
import { COUNTER_COUPON_REF } from "./counter-coupon.service.js";
import {
  PICKUP_DISCOUNT_REF,
  PickupDiscountError,
  assertPickupDiscountWithinCap,
  pickupBillRent,
  readPickupDiscount,
  recordSplit,
  splitPickupDiscount,
  subtractSplit,
  ZERO_SPLIT,
  type PickupDiscountRecord,
  type PickupDiscountSplit,
} from "./pickup-discount-rules.js";

/**
 * Manual pickup discount — the database side (rules in pickup-discount-rules.ts).
 *
 * Unified Payments: staff put it on the open PICKUP session as a DISCOUNT line
 * (amount −(discount + GST), baseAmount −discount, gstAmount −GST, metadata =
 * the split + reason + cap); when the session is paid it is folded into the
 * booking (applyPickupDiscountOnSessionCompletion). Legacy branches fold it at
 * once, before the remaining balance is collected. Edit Pickup folds the change
 * when the edit is saved (its money difference is settled on the ADJUSTMENT
 * session). Folding reprices Booking, its first BookingItem, the Invoice and the
 * DiscountApplication like the counter coupon, and records it in
 * Booking.pricingSnapshot.pickupDiscount.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const ZERO = new Decimal(0);
const toDec = (v: { toString(): string } | null | undefined) => new Decimal(v?.toString() ?? "0");

/** The booking's frozen GST rates and whether it was priced with GST on top. */
async function bookingDiscountRates(db: Db, bookingId: number): Promise<{ rates: BranchGstRates; gstOnTop: boolean }> {
  const booking = await db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { branchId: true, pricingSnapshot: true, items: { select: { taxRate: true }, orderBy: { id: "asc" } } },
  });
  try {
    return { rates: await bookingGstRates(booking, db), gstOnTop: isGstOnTopBooking(booking.pricingSnapshot) };
  } catch (err) {
    if (isGstRuleMissing(err)) throw new PickupDiscountError(409, GST_RULE_MISSING, GST_RULE_MISSING_MESSAGE);
    throw err;
  }
}

export interface PickupDiscountQuote {
  amount: Decimal;
  split: PickupDiscountSplit;
  cap: Decimal;
  rates: BranchGstRates;
}

/** Works out a discount of `amount` at the booking's rates, refused above `cap`. */
export async function quotePickupDiscount(db: Db, bookingId: number, amount: Decimal, cap: Decimal): Promise<PickupDiscountQuote> {
  assertPickupDiscountWithinCap(amount, cap);
  const { rates, gstOnTop } = await bookingDiscountRates(db, bookingId);
  return { amount, split: splitPickupDiscount(amount, rates, gstOnTop), cap, rates };
}

/** The live lines of a pickup session the cap reads. */
async function sessionBillRent(db: Db, sessionId: number) {
  const entries = await db.ledgerEntry.findMany({
    where: { sessionId, isVoided: false },
    select: { entryType: true, classification: true, referenceType: true, amount: true, gstAmount: true },
  });
  return pickupBillRent(entries as any, COUNTER_COUPON_REF);
}

/** Validates a discount for the open PICKUP session (cap: rent due less a counter coupon). */
export async function quoteSessionPickupDiscount(db: Db, bookingId: number, sessionId: number, amount: Decimal) {
  const bill = await sessionBillRent(db, sessionId);
  return quotePickupDiscount(db, bookingId, amount, bill.cap);
}

/**
 * Puts the discount on the pickup bill: voids an earlier manual discount line of
 * the session and adds the new DISCOUNT line, then recomputes the session.
 */
export async function writeSessionPickupDiscount(
  tx: Db,
  args: {
    sessionId: number;
    bookingId: number;
    quote: PickupDiscountQuote;
    reason: string | null;
    actor: { id: number; role: string };
  },
): Promise<void> {
  const { sessionId, bookingId, quote, reason, actor } = args;
  await voidSessionPickupDiscount(tx, sessionId, actor.id, "Replaced by a new pickup discount");
  const { split } = quote;
  await tx.ledgerEntry.create({
    data: {
      publicId: createID(),
      sessionId,
      bookingId,
      entryType: LedgerEntryType.DISCOUNT,
      classification: LedgerEntryClassification.DISCOUNT,
      amount: split.total.negated().toFixed(2),
      baseAmount: split.discount.negated().toFixed(2),
      gstAmount: split.gst.negated().toFixed(2),
      description: reason
        ? `Pickup discount: ${reason} (₹${split.total.toFixed(2)} off the rent incl. GST)`
        : `Pickup discount (₹${split.total.toFixed(2)} off the rent incl. GST)`,
      referenceType: PICKUP_DISCOUNT_REF,
      idempotencyKey: `pickup:${bookingId}:manual-discount:${sessionId}:${createID()}`,
      actorId: actor.id,
      actorRole: actor.role,
      metadata: {
        discount: split.discount.toFixed(2),
        cgst: split.cgst.toFixed(2),
        sgst: split.sgst.toFixed(2),
        gst: split.gst.toFixed(2),
        cgstRate: quote.rates.cgstRate,
        sgstRate: quote.rates.sgstRate,
        reason,
        cap: quote.cap.toFixed(2),
      },
    },
  });
  await paymentSessionService.recomputeTotals(sessionId, tx as any);
}

/** Voids the session's manual discount line(s). Returns how many were voided (totals not recomputed). */
export async function voidSessionPickupDiscount(tx: Db, sessionId: number, actorId: number, reason: string): Promise<number> {
  const result = await tx.ledgerEntry.updateMany({
    where: { sessionId, entryType: LedgerEntryType.DISCOUNT, referenceType: PICKUP_DISCOUNT_REF, isVoided: false },
    data: { isVoided: true, voidedAt: new Date(), voidedById: actorId, voidReason: reason },
  });
  return result.count;
}

/**
 * Folds a change of the pickup discount into the booking: `change` (+ = more
 * discount) comes off Booking (totalDiscount / totalTax / totalFinal, and the
 * remaining balance when `adjustRemaining`), its first BookingItem, the Invoice
 * (cached PDF dropped) and the DiscountApplication; `record` (null = removed)
 * replaces Booking.pricingSnapshot.pickupDiscount.
 */
export async function foldPickupDiscountIntoBooking(
  tx: Db,
  bookingId: number,
  change: PickupDiscountSplit,
  record: PickupDiscountRecord | null,
  opts: { adjustRemaining: boolean },
): Promise<void> {
  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      id: true,
      totalBase: true,
      totalDiscount: true,
      totalTax: true,
      totalFinal: true,
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
        },
        orderBy: { id: "asc" },
      },
    },
  });
  const snapshot = (booking.pricingSnapshot ?? {}) as Record<string, unknown>;
  const snapshotTotals = (snapshot.totals ?? {}) as Record<string, unknown>;
  const gstOnTop = isGstOnTopBooking(booking.pricingSnapshot);
  const addSnap = (v: unknown, by: Decimal) =>
    Number(new Decimal(String(v ?? 0)).add(by).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
  const newTotalDiscount = toDec(booking.totalDiscount).add(change.discount);
  const remaining = toDec(booking.remainingBalance);

  await tx.booking.update({
    where: { id: booking.id },
    data: {
      totalDiscount: newTotalDiscount.toFixed(2),
      totalTax: toDec(booking.totalTax).sub(change.gst).toFixed(2),
      totalFinal: toDec(booking.totalFinal).sub(change.total).toFixed(2),
      ...(opts.adjustRemaining && booking.isAdvancePayment && (remaining.gt(0) || change.total.lt(0))
        ? { remainingBalance: Decimal.max(ZERO, remaining.sub(change.total)).toFixed(2) }
        : {}),
      pricingSnapshot: {
        ...snapshot,
        // The GST-inclusive view follows the discount (item 17; snapshots that have it)
        ...(snapshotTotals.grandRentInclGst != null && {
          totals: {
            ...snapshotTotals,
            grandPickupDiscountInclGst: addSnap(snapshotTotals.grandPickupDiscountInclGst, change.total),
            grandDiscountInclGst: addSnap(snapshotTotals.grandDiscountInclGst, change.total),
            grandRentAfterDiscountInclGst: addSnap(snapshotTotals.grandRentAfterDiscountInclGst, change.total.negated()),
            grandRentWithoutGst: addSnap(snapshotTotals.grandRentWithoutGst, change.discount.negated()),
          },
        }),
        pickupDiscount: record,
      } as any,
    },
  });

  const item = booking.items[0];
  if (item) {
    const itemDiscount = toDec(item.discountAmount).add(change.discount);
    const itemBase = toDec(item.baseTotal);
    await tx.bookingItem.update({
      where: { id: item.id },
      data: {
        discountAmount: itemDiscount.toFixed(2),
        discountPercent: itemBase.gt(0) ? itemDiscount.div(itemBase).mul(100).toDecimalPlaces(4).toString() : "0",
        taxAmount: toDec(item.taxAmount).sub(change.gst).toFixed(2),
        cgstAmount: toDec(item.cgstAmount).sub(change.cgst).toFixed(2),
        sgstAmount: toDec(item.sgstAmount).sub(change.sgst).toFixed(2),
        finalTotal: toDec(item.finalTotal).sub(change.total).toFixed(2),
      },
    });
  }

  const invoice = await tx.invoice.findUnique({
    where: { bookingId: booking.id },
    select: { id: true, total: true, tax: true, taxableAmount: true, cgstAmount: true, sgstAmount: true },
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
        total: toDec(invoice.total).sub(change.total).toFixed(2),
        tax: lower(invoice.tax, change.gst),
        taxableAmount: lower(invoice.taxableAmount, change.discount),
        cgstAmount: lower(invoice.cgstAmount, change.cgst),
        sgstAmount: lower(invoice.sgstAmount, change.sgst),
        // Cached PDF no longer matches
        invoicePdfFileId: null,
        generatedAt: null,
      },
    });
  }

  // DiscountApplication: a manual layer, in the booking's own terms (off the
  // inclusive rent on an item-17 booking, taxable on a GST-on-top one)
  const recorded = gstOnTop ? change.discount : change.total;
  const application = await tx.discountApplication.findUnique({ where: { bookingId: booking.id } });
  if (application) {
    await tx.discountApplication.update({
      where: { bookingId: booking.id },
      data: {
        manualDiscountAmount: Decimal.max(ZERO, toDec(application.manualDiscountAmount).add(recorded)).toFixed(2),
        totalDiscountAmount: Decimal.max(ZERO, toDec(application.totalDiscountAmount).add(recorded)).toFixed(2),
        finalAmount: Decimal.max(ZERO, toDec(application.finalAmount).sub(recorded)).toFixed(2),
      },
    });
  }
}

/**
 * A booking cancelled before its handover (manual cancel, no-show, displaced):
 * a legacy pickup discount — given against a pickup that never happened — is
 * taken back, so totals, the remaining balance and any cancellation math stand
 * as booked. Run inside the cancelling transaction, before the status changes.
 * Returns true when one was reverted.
 */
export async function revertLegacyPickupDiscountOnCancel(tx: Db, bookingId: number): Promise<boolean> {
  const booking = await tx.booking.findUnique({ where: { id: bookingId }, select: { status: true, pricingSnapshot: true } });
  if (!booking || booking.status !== "CONFIRMED") return false;
  const record = readPickupDiscount(booking.pricingSnapshot);
  if (!record || record.source !== "LEGACY") return false;
  const split = recordSplit(record);
  await foldPickupDiscountIntoBooking(tx, bookingId, subtractSplit(ZERO_SPLIT, split), null, { adjustRemaining: true });
  return true;
}

/** The record written for a discount (null when the amount is 0). */
export function pickupDiscountRecord(
  split: PickupDiscountSplit,
  meta: Omit<PickupDiscountRecord, "amount" | "discount" | "cgst" | "sgst" | "gst" | "appliedAt">,
): PickupDiscountRecord | null {
  if (split.total.lte(0)) return null;
  return {
    amount: split.total.toFixed(2),
    discount: split.discount.toFixed(2),
    cgst: split.cgst.toFixed(2),
    sgst: split.sgst.toFixed(2),
    gst: split.gst.toFixed(2),
    ...meta,
    appliedAt: new Date().toISOString(),
  };
}

/**
 * Session paid: make the manual discount part of the booking. Runs inside the
 * settlement transaction, after the counter coupon was folded in. Returns false
 * when the session has none. A retried completion finds it folded already.
 */
export async function applyPickupDiscountOnSessionCompletion(
  tx: Db,
  bookingId: number,
  sessionId: number,
): Promise<boolean> {
  const entry = await tx.ledgerEntry.findFirst({
    where: { sessionId, entryType: LedgerEntryType.DISCOUNT, referenceType: PICKUP_DISCOUNT_REF, isVoided: false },
    orderBy: { createdAt: "desc" },
  });
  if (!entry) return false;
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { pricingSnapshot: true } });
  const current = readPickupDiscount(booking.pricingSnapshot);
  if (current?.ledgerEntryPublicId === entry.publicId) return true;

  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const total = toDec(entry.amount).abs();
  let split: PickupDiscountSplit;
  if (meta.discount != null && meta.cgst != null && meta.sgst != null) {
    const discount = new Decimal(String(meta.discount));
    const cgst = new Decimal(String(meta.cgst));
    const sgst = new Decimal(String(meta.sgst));
    split = { discount, cgst, sgst, gst: cgst.add(sgst), total: discount.add(cgst).add(sgst) };
  } else {
    const { rates, gstOnTop } = await bookingDiscountRates(tx, bookingId);
    split = splitPickupDiscount(total, rates, gstOnTop);
  }
  const record = pickupDiscountRecord(split, {
    reason: typeof meta.reason === "string" ? meta.reason : null,
    cap: meta.cap != null ? String(meta.cap) : total.toFixed(2),
    source: "SESSION",
    sessionId,
    ledgerEntryPublicId: entry.publicId,
    appliedById: entry.actorId ?? null,
  });
  // A discount recorded earlier (e.g. legacy, before a branch switched) is replaced, not added to
  await foldPickupDiscountIntoBooking(tx, bookingId, subtractSplit(split, recordSplit(current)), record, {
    adjustRemaining: true,
  });
  return true;
}

/**
 * The rent that was payable at a completed pickup (incl. GST, after a counter
 * coupon) — the cap of a discount given or changed by Edit Pickup: the recorded
 * discount's cap, else the completed PICKUP session's rent lines, else (legacy)
 * the remaining balance when it was collected at the pickup.
 */
export async function completedPickupRentDue(db: Db, bookingId: number): Promise<Decimal> {
  const booking = await db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { pricingSnapshot: true, remainingBalance: true, remainingPaidDuring: true, isAdvancePayment: true },
  });
  const record = readPickupDiscount(booking.pricingSnapshot);
  if (record?.cap != null) return new Decimal(record.cap);
  const session = await db.paymentSession.findFirst({
    where: { bookingId, sessionType: PaymentSessionType.PICKUP, status: PaymentSessionStatus.COMPLETED },
    orderBy: { completedAt: "desc" },
    select: { id: true },
  });
  if (session) return (await sessionBillRent(db, session.id)).cap;
  if (booking.isAdvancePayment && booking.remainingPaidDuring === "PICKUP") {
    return toDec(booking.remainingBalance).toDecimalPlaces(2);
  }
  return ZERO;
}


/**
 * Manual pickup discount — the pure rules (no database).
 *
 * Fleet staff may take a flat ₹ amount off the RENT the customer pays at
 * pickup (never the safety deposit, never money already paid). The amount is
 * off the GST-inclusive rent, like the counter coupon: 0 < amount ≤ the rental
 * balance still payable at pickup (the booking's remaining balance — never an
 * extension billed on the same bill — after a counter coupon), 2 decimals, so
 * folding it into the booking's own totals / first item / invoice stays right. It is split into the rent-without-GST discount + the
 * GST it takes off at the booking's frozen rates — item-17 bookings the
 * client's way (splitRentTotal: GST = rate% of the amount), a booking priced
 * with GST on top backwards (taxable = amount / (1 + rate)).
 *
 * Where it lives:
 *   Unified Payments  a DISCOUNT line (referenceType PICKUP_DISCOUNT) on the
 *                     PICKUP payment session, folded into the booking when
 *                     the session is paid
 *   Legacy            folded into the booking at once (it lowers the
 *                     remaining balance staff then collect)
 *   Both              Booking.pricingSnapshot.pickupDiscount records it
 *   Edit Pickup       a change becomes an ADJUSTMENT delta line (part PICKUP)
 *                     and is folded into the booking when the edit is saved
 */
import Decimal from "decimal.js";
import { splitGstInclusive, splitRentTotal, type GstRates } from "@repo/schemas";
import { adjustmentLineKey, type AdjustmentDeltaLine } from "../booking/operation-adjustment.js";

const ZERO = new Decimal(0);

/** LedgerEntry.referenceType of the manual pickup discount (session line and edit delta lines). */
export const PICKUP_DISCOUNT_REF = "PICKUP_DISCOUNT";

/** Longest reason staff may give. */
export const PICKUP_DISCOUNT_REASON_MAX = 200;

/** A refusal with its HTTP status and error code. */
export class PickupDiscountError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "PickupDiscountError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message, ...this.extra };
  }
}

const inr = (d: Decimal) => `₹${d.toFixed(2)}`;

/**
 * The amount staff typed, as money: a finite number above 0 with at most two
 * decimals. 400 PICKUP_DISCOUNT_INVALID otherwise.
 */
export function parsePickupDiscountAmount(raw: unknown): Decimal {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new PickupDiscountError(400, "PICKUP_DISCOUNT_INVALID", "Enter the discount as a ₹ amount with up to 2 decimals.");
  }
  const amount = new Decimal(text);
  if (amount.lte(0)) {
    throw new PickupDiscountError(400, "PICKUP_DISCOUNT_INVALID", "The discount must be more than ₹0.");
  }
  return amount;
}

/** The optional reason, trimmed (null when blank). 400 PICKUP_DISCOUNT_INVALID when too long. */
export function parsePickupDiscountReason(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") {
    throw new PickupDiscountError(400, "PICKUP_DISCOUNT_INVALID", "The discount reason must be text.");
  }
  const reason = raw.trim();
  if (reason.length > PICKUP_DISCOUNT_REASON_MAX) {
    throw new PickupDiscountError(
      400,
      "PICKUP_DISCOUNT_INVALID",
      `Keep the discount reason under ${PICKUP_DISCOUNT_REASON_MAX} characters.`,
    );
  }
  return reason || null;
}

/**
 * The most the discount may be: the rental balance still payable at pickup
 * (incl. GST; extensions excluded) less a counter coupon already on the bill
 * (`couponCredit`, positive), never below 0.
 */
export function pickupDiscountCap(rentDue: Decimal, couponCredit: Decimal = ZERO): Decimal {
  return Decimal.max(ZERO, rentDue.sub(couponCredit.abs())).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** 400 PICKUP_DISCOUNT_EXCEEDS when the amount is above the cap (or nothing is payable). */
export function assertPickupDiscountWithinCap(amount: Decimal, cap: Decimal): void {
  if (cap.lte(0)) {
    throw new PickupDiscountError(
      400,
      "PICKUP_DISCOUNT_EXCEEDS",
      "No rental balance is payable at this pickup, so there is nothing to discount. A discount can't come off the safety deposit, an extension or money already paid.",
      { maxAmount: "0.00" },
    );
  }
  if (amount.gt(cap)) {
    throw new PickupDiscountError(
      400,
      "PICKUP_DISCOUNT_EXCEEDS",
      `The discount can't be more than the rental balance payable at pickup (${inr(cap)}).`,
      { maxAmount: cap.toFixed(2) },
    );
  }
}

/** A discount off the GST-inclusive rent: its rent-without-GST part + the GST it takes off. */
export interface PickupDiscountSplit {
  /** Rent-without-GST part (taxable discount) */
  discount: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  gst: Decimal;
  /** discount + gst = the amount off the inclusive rent */
  total: Decimal;
}

export const ZERO_SPLIT: PickupDiscountSplit = { discount: ZERO, cgst: ZERO, sgst: ZERO, gst: ZERO, total: ZERO };

/**
 * Splits the amount at the booking's frozen rates: item-17 bookings with the
 * rent rule (GST = rate% of the amount), a booking priced with GST on top
 * backwards (taxable = amount / (1 + rate)). The parts add up to the amount.
 */
export function splitPickupDiscount(amount: Decimal, rates: GstRates, gstOnTop: boolean): PickupDiscountSplit {
  const b = gstOnTop ? splitGstInclusive(amount.toNumber(), rates) : splitRentTotal(amount.toNumber(), rates);
  return {
    discount: new Decimal(b.taxable),
    cgst: new Decimal(b.cgst),
    sgst: new Decimal(b.sgst),
    gst: new Decimal(b.gst),
    total: new Decimal(b.total),
  };
}

/** a − b, part by part (a change from one recorded split to another). */
export function subtractSplit(a: PickupDiscountSplit, b: PickupDiscountSplit): PickupDiscountSplit {
  return {
    discount: a.discount.sub(b.discount),
    cgst: a.cgst.sub(b.cgst),
    sgst: a.sgst.sub(b.sgst),
    gst: a.gst.sub(b.gst),
    total: a.total.sub(b.total),
  };
}

export const isZeroSplit = (s: PickupDiscountSplit) => s.total.isZero() && s.gst.isZero() && s.discount.isZero();

/** What Booking.pricingSnapshot.pickupDiscount holds. */
export interface PickupDiscountRecord {
  /** The amount off the GST-inclusive rent */
  amount: string;
  discount: string;
  cgst: string;
  sgst: string;
  gst: string;
  reason: string | null;
  /** The rent payable at pickup it was capped at (incl. GST, after a counter coupon) */
  cap: string;
  /** SESSION (unified pickup bill), LEGACY (before the balance was collected), EDIT (Edit Pickup) */
  source: "SESSION" | "LEGACY" | "EDIT";
  sessionId?: number | null;
  ledgerEntryPublicId?: string | null;
  appliedById?: number | null;
  appliedAt: string;
}

/** The recorded pickup discount of a booking (null when none or unreadable). */
export function readPickupDiscount(pricingSnapshot: unknown): PickupDiscountRecord | null {
  const raw = (pricingSnapshot as { pickupDiscount?: unknown } | null)?.pickupDiscount as
    | Partial<PickupDiscountRecord>
    | null
    | undefined;
  if (!raw || raw.amount == null) return null;
  try {
    if (new Decimal(String(raw.amount)).lte(0)) return null;
  } catch {
    return null;
  }
  return raw as PickupDiscountRecord;
}

/** The split a record carries. */
export function recordSplit(record: PickupDiscountRecord | null): PickupDiscountSplit {
  if (!record) return ZERO_SPLIT;
  const d = (v: unknown) => new Decimal(v == null ? "0" : String(v));
  return { discount: d(record.discount), cgst: d(record.cgst), sgst: d(record.sgst), gst: d(record.gst), total: d(record.amount) };
}

/** The record clients see. */
export function serializePickupDiscount(record: PickupDiscountRecord | null) {
  if (!record) return null;
  return {
    amount: new Decimal(record.amount).toFixed(2),
    discountAmount: new Decimal(record.discount ?? "0").toFixed(2),
    gstAmount: new Decimal(record.gst ?? "0").toFixed(2),
    reason: record.reason ?? null,
    maxAmount: new Decimal(record.cap ?? "0").toFixed(2),
    source: record.source,
    appliedAt: record.appliedAt,
  };
}

/** The ledger fields the bill read below needs. */
export interface PickupBillEntry {
  entryType: string;
  classification: string;
  referenceType: string | null;
  amount: { toString(): string };
  gstAmount?: { toString(): string } | null;
  isVoided?: boolean;
}

/**
 * A pickup bill's rent and discounts from its live ledger lines: the rental
 * balance due (BOOKING_BASE, GST-inclusive), an extension on the bill (with its
 * stored GST), a counter coupon's credit and the manual discount (both
 * positive), and the cap left for the manual discount (rental balance less the
 * coupon — the extension is never discounted here).
 */
export function pickupBillRent(entries: PickupBillEntry[], couponRef: string) {
  let rentDue = ZERO;
  let extension = ZERO;
  let coupon = ZERO;
  let manual = ZERO;
  for (const e of entries) {
    if (e.isVoided) continue;
    const amount = new Decimal(e.amount.toString());
    if (e.entryType === "BOOKING_BASE") {
      rentDue = rentDue.add(amount).add(new Decimal(e.gstAmount?.toString() ?? "0"));
    } else if (e.entryType === "EXTENSION") {
      extension = extension.add(amount).add(new Decimal(e.gstAmount?.toString() ?? "0"));
    } else if (e.entryType === "DISCOUNT" && e.referenceType === couponRef) {
      coupon = coupon.add(amount.abs());
    } else if (e.entryType === "DISCOUNT" && e.referenceType === PICKUP_DISCOUNT_REF) {
      manual = manual.add(amount.abs());
    }
  }
  return { rentDue, extension, coupon, manual, cap: pickupDiscountCap(rentDue, coupon) };
}

/**
 * The pickup discount line of an edit: from the discount as last settled
 * (`settled` — the booking's record less the change an unsettled difference
 * being replaced carried) to `target`. Amounts are the effect on the bill
 * (a discount is negative). Null when they match.
 */
export function pickupDiscountAdjustmentLine(p: {
  settled: PickupDiscountSplit;
  target: PickupDiscountSplit;
}): AdjustmentDeltaLine | null {
  if (p.target.total.eq(p.settled.total) && p.target.gst.eq(p.settled.gst)) return null;
  const line = {
    part: "PICKUP" as const,
    entryType: "DISCOUNT",
    classification: "DISCOUNT",
    referenceType: PICKUP_DISCOUNT_REF,
    referenceId: null,
    label: "Pickup discount",
  };
  return {
    ...line,
    key: adjustmentLineKey(line),
    oldAmount: p.settled.total.negated(),
    newAmount: p.target.total.negated(),
    delta: p.settled.total.sub(p.target.total),
    gstDelta: p.settled.gst.sub(p.target.gst),
    baseDelta: p.settled.discount.sub(p.target.discount),
  };
}

/**
 * The pickup discount change an unsettled difference carried (lines of an
 * ADJUSTMENT session being replaced), as a split: + = it raised the discount.
 */
export function pendingPickupDiscountChange(
  entries: Array<{ referenceType: string | null; amount: { toString(): string }; gstAmount?: { toString(): string } | null; baseAmount?: { toString(): string } | null; isVoided?: boolean }>,
): PickupDiscountSplit {
  let total = ZERO;
  let gst = ZERO;
  let base = ZERO;
  for (const e of entries) {
    if (e.isVoided || e.referenceType !== PICKUP_DISCOUNT_REF) continue;
    total = total.add(new Decimal(e.amount.toString()));
    gst = gst.add(new Decimal(e.gstAmount?.toString() ?? "0"));
    base = base.add(new Decimal(e.baseAmount?.toString() ?? "0"));
  }
  // Lines are the effect on the bill (−): a raised discount wrote a negative line
  return { discount: base.negated(), cgst: ZERO, sgst: ZERO, gst: gst.negated(), total: total.negated() };
}

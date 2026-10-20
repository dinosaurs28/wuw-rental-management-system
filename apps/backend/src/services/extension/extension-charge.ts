/**
 * The extension charge rule (pure: no database). Client, Oct 2026: "price only
 * the added time".
 *
 * ADDED_TIME (every booking except monthly ones): the charge is the pricing
 * engine's GST-inclusive rent for the added window [current return, new
 * return] on its own — billed as a booking of that length starting at the
 * current return: the same slab rules (base-price-rule.ts: full days at the
 * 24 h rate, the remainder as the 12 h slab when ≤ 12 h else the 24 h slab,
 * each capped by the hourly rate), weekend blocks by the booking's weekend days
 * (pricingSnapshot.weekendDays), festival blocks by the branch's live rules
 * (a block starting on a festival date), and a duration discount for that
 * length. E.g. +1 day 11 h 30 min at ₹1,600 / ₹1,100 = ₹2,700.
 *   - The 12-hour package held to closing is never applied to the added window
 *     (heldToClosing: false — billed by its clock length): a short evening
 *     extension is billed by the hour, not as a 12-hour package. A booking
 *     MADE as that package (Fri 18:00 → 22:30 billed as 12 h) has already paid
 *     to pickup + 12 h (06:00): its added window starts there
 *     (extensionPaidUntil) — extending to 10:00 charges 06:00 → 10:00, to
 *     05:00 nothing — and its free km follow the same window.
 *   - The booking's coupon is locked in for a PERCENTAGE coupon only: the added
 *     window gets the same percentage off (its cap and booking constraints
 *     checked against the added window, as for a booking of that length). A
 *     FLAT coupon gave its amount once, on the booking, and is not taken off
 *     again (the old delta method cancelled it out the same way).
 *
 * DELTA (MONTHLY bookings): the engine rent over [pickup, new return] minus the
 * same over [pickup, current return] — the method used before for every
 * booking. A monthly booking crossing into another month gets the monthly
 * rate for it, which pricing the added days on their own would lose.
 *
 * Either way the charge is summed across the booking's vehicles, clamped at
 * ₹0, and GST is split out of the GST-inclusive amount once (splitRentTotal,
 * the branch rule) — never added on top. Free km follow the same blocks
 * (services/charges/extension-km.ts).
 */
import Decimal from "decimal.js";
import { HALF_DAY_PACKAGE_HOURS, splitRentTotal, type GstRates } from "@repo/schemas";
import type { FestivalBreakdown, WeekendBreakdown } from "../pricing/base-price-rule.js";

export type ExtensionPricingMode = "ADDED_TIME" | "DELTA";

/** One engine pricing an extension needs, added (+1) or taken off (−1). */
export interface ExtensionTermWindow {
  from: Date;
  to: Date;
  sign: 1 | -1;
}

/** The booking facts the extension windows depend on. */
export interface ExtensionBookingFacts {
  startAt: Date;
  /** rentalPeriodType MONTHLY → the DELTA method */
  monthly: boolean;
  /** Made as the 12-hour package held to closing (heldToClosingOf(pricingSnapshot)) */
  heldToClosing?: boolean;
}

const HALF_DAY_MS = HALF_DAY_PACKAGE_HOURS * 60 * 60 * 1000;

/**
 * Where the time an extension from `fromEndAt` adds starts being charged (and
 * earns free km): the current return — or, for a (non-monthly) booking made as
 * the 12-hour package held to closing, never before pickup + 12 h, the time it
 * already paid for.
 */
export function extensionPaidUntil(booking: ExtensionBookingFacts, fromEndAt: Date): Date {
  if (booking.monthly || !booking.heldToClosing) return fromEndAt;
  const halfDayEnd = booking.startAt.getTime() + HALF_DAY_MS;
  return fromEndAt.getTime() < halfDayEnd ? new Date(halfDayEnd) : fromEndAt;
}

/**
 * The windows an extension from `fromEndAt` (the current return) to
 * `newEndAt` is priced over: the added window alone (from extensionPaidUntil;
 * none when the new end is within the time already paid for — a ₹0 charge),
 * or — for a MONTHLY booking — the whole new window less the whole current one.
 */
export function extensionWindows(
  booking: ExtensionBookingFacts,
  fromEndAt: Date,
  newEndAt: Date,
): { mode: ExtensionPricingMode; terms: ExtensionTermWindow[] } {
  if (booking.monthly) {
    return {
      mode: "DELTA",
      terms: [
        { from: booking.startAt, to: newEndAt, sign: 1 },
        { from: booking.startAt, to: fromEndAt, sign: -1 },
      ],
    };
  }
  const from = extensionPaidUntil(booking, fromEndAt);
  return {
    mode: "ADDED_TIME",
    terms: newEndAt.getTime() > from.getTime() ? [{ from, to: newEndAt, sign: 1 }] : [],
  };
}

/** What the charge reads from one engine result (one vehicle, one window). */
export interface ExtensionChargeTerm {
  sign: 1 | -1;
  /** GST-inclusive rent before discounts (PricingResult.gross.price) */
  grossPrice: Decimal;
  /** GST-inclusive rent after discounts (PricingResult.gross.total) */
  grossTotal: Decimal;
  weekend?: WeekendBreakdown;
  festival?: FestivalBreakdown;
}

export interface ExtensionChargeSplit {
  /** The GST-inclusive charge (= taxableAmount + taxAmount) */
  additionalAmount: Decimal;
  /** Rent without GST before discounts / the discount's rent-without-GST share */
  baseAmount: Decimal;
  discountAmount: Decimal;
  taxableAmount: Decimal;
  taxAmount: Decimal;
  cgstAmount: Decimal;
  sgstAmount: Decimal;
}

const ZERO = new Decimal(0);
const sumOf = (terms: ExtensionChargeTerm[], pick: (t: ExtensionChargeTerm) => Decimal) =>
  terms.reduce((total, t) => total.add(pick(t).mul(t.sign)), ZERO);

const split = (gross: Decimal, rates: GstRates) => {
  const s = splitRentTotal(gross.toNumber(), rates);
  return { taxable: new Decimal(s.taxable), cgst: new Decimal(s.cgst), sgst: new Decimal(s.sgst), gst: new Decimal(s.gst) };
};

/**
 * The charge and its GST split: the post-discount inclusive rent of the terms
 * (clamped at ₹0), GST split out once (CGST / SGST rounded half-up per tax);
 * the discount's rent-without-GST share is the pre-discount rent split the
 * same way less the taxable value (never negative — the base absorbs it).
 */
export function extensionCharge(terms: ExtensionChargeTerm[], rates: GstRates): ExtensionChargeSplit {
  const rawGross = sumOf(terms, (t) => t.grossTotal).toDecimalPlaces(2);
  if (!rawGross.gt(0)) {
    return {
      additionalAmount: ZERO,
      baseAmount: ZERO,
      discountAmount: ZERO,
      taxableAmount: ZERO,
      taxAmount: ZERO,
      cgstAmount: ZERO,
      sgstAmount: ZERO,
    };
  }
  const line = split(rawGross, rates);
  const rawGrossBase = sumOf(terms, (t) => t.grossPrice).toDecimalPlaces(2);
  const baseTaxable = rawGrossBase.gt(0) ? split(rawGrossBase, rates).taxable : ZERO;
  const discountAmount = Decimal.max(ZERO, baseTaxable.sub(line.taxable));
  return {
    additionalAmount: line.taxable.add(line.gst).toDecimalPlaces(2),
    baseAmount: line.taxable.add(discountAmount),
    discountAmount,
    taxableAmount: line.taxable,
    taxAmount: line.gst,
    cgstAmount: line.cgst,
    sgstAmount: line.sgst,
  };
}

/** One festival / weekend part of an extension charge (GST-inclusive, before any coupon). */
export interface ExtensionSpecialShare {
  /** e.g. "Dussehra pricing", "Weekend pricing" */
  label: string;
  amount: Decimal;
}

/**
 * The festival and weekend parts of the charge, for staff (never customers —
 * festivalPrivacy strips `specialShare`): each festival rule's change to the
 * rent ("<rule name> pricing") and what weekend rents added over the weekday
 * ones ("Weekend pricing"), summed across vehicles (and, for DELTA, new window
 * less current window). Parts that come to ₹0 are left out.
 */
export function extensionSpecialShare(terms: ExtensionChargeTerm[]): ExtensionSpecialShare[] {
  const byLabel = new Map<string, Decimal>();
  const add = (label: string, amount: Decimal) => byLabel.set(label, (byLabel.get(label) ?? ZERO).add(amount));
  for (const t of terms) {
    for (const rule of t.festival?.rules ?? []) add(`${rule.name} pricing`, new Decimal(rule.amount).mul(t.sign));
    if (t.weekend) {
      add("Weekend pricing", new Decimal(t.weekend.weekendAmount).sub(t.weekend.weekdayAmount).mul(t.sign));
    }
  }
  return [...byLabel.entries()]
    .map(([label, amount]) => ({ label, amount: amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP) }))
    .filter((s) => !s.amount.isZero());
}

/** The special shares as response values: [{ label, amount: "400.00" }]. */
export function extensionSpecialShareView(shares: ExtensionSpecialShare[] | undefined) {
  return (shares ?? []).map((s) => ({ label: s.label, amount: s.amount.toFixed(2) }));
}

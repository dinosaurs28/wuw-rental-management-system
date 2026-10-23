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
 * MONTHLY_RENEWAL (MONTHLY bookings — client TODO items 7–9, Oct 2026: a
 * Fleet Member renews an active monthly rental by days, weeks, a month or to
 * any return): the added window [current return, new return] is split into
 * its whole 30-day months and the remainder, each billed by the engine as a
 * booking of that length on its own:
 *   - the months [current return, + N × 30 days] — the vehicle's monthly price
 *     × N (base-price-rule.ts: full months are never weekend / festival
 *     blocks) — exactly that, GST-inclusive: no duration slab (nor coupon)
 *     ever reduces the configured monthly price (user decision, Oct 23 2026;
 *     renewalTermTotal); free km = freeKmMonthly × N. A vehicle with no monthly price is billed
 *     per day for those months instead (the engine's own fallback: daily
 *     blocks, weekend / festival, the slab for that length; 24 h free km a day)
 *     — the staff screen says so (renewal.monthlyPriceMissing);
 *   - the remainder (< 30 days) — daily pricing exactly as an added-time
 *     extension of that length: the slab rules, weekend / festival blocks, the
 *     duration slab for the remainder's length; free km by its blocks.
 * E.g. +3 days → 3 days at the daily rate (slab for 3 days); +2 weeks → 14
 * days (slab for 14 days); +30 days → the monthly price; +45 days → the
 * monthly price + 15 days at the daily rate (slab for 15 days). The booking's
 * percentage coupon is applied to the daily-rate parts as for any added-time
 * extension (monthly bookings carry none today). It replaces the old delta-from-pickup
 * rule for monthly bookings (the whole new window less the whole current one).
 *
 * Either way the charge is summed across the booking's vehicles, clamped at
 * ₹0, and GST is split out of the GST-inclusive amount once (splitRentTotal,
 * the branch rule) — never added on top. Free km follow the same blocks
 * (services/charges/extension-km.ts).
 */
import Decimal from "decimal.js";
import { HALF_DAY_PACKAGE_HOURS, splitRentTotal, type GstRates } from "@repo/schemas";
import type { FestivalBreakdown, WeekendBreakdown } from "../pricing/base-price-rule.js";

export type ExtensionPricingMode = "ADDED_TIME" | "MONTHLY_RENEWAL";

/** One engine pricing an extension needs, added (+1) or taken off (−1). */
export interface ExtensionTermWindow {
  from: Date;
  to: Date;
  sign: 1 | -1;
  /** MONTHLY_RENEWAL: the whole 30-day months, or the remainder priced by the day */
  part?: RenewalPartKind;
}

/** The two parts of a monthly renewal (MONTHLY_RENEWAL). */
export type RenewalPartKind = "MONTHS" | "DAYS";

/**
 * What a renewal part costs after discounts (GST-inclusive): the months billed
 * at the vehicle's monthly price (engine billedAsType MONTHLY) cost exactly
 * that — the engine's duration slab / coupon on them is dropped; every other
 * part (the remainder, or months of a car with no monthly price, billed by the
 * day) keeps the engine's discounted total.
 */
export function renewalTermTotal(
  part: RenewalPartKind | undefined,
  billedAsType: string | undefined,
  grossPrice: Decimal,
  grossTotal: Decimal,
): Decimal {
  return part === "MONTHS" && billedAsType === "MONTHLY" ? grossPrice : grossTotal;
}

/** A renewal month: 30 days (the engine's monthly block, base-price-rule.ts). */
export const RENEWAL_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How a monthly renewal from `from` to `to` splits: its whole 30-day months
 * and the time after them (the remainder, priced by the day). Minute-precise.
 */
export function renewalSplit(from: Date, to: Date): { months: number; monthsEnd: Date; remainderMs: number } {
  const added = Math.max(0, to.getTime() - from.getTime());
  const months = Math.floor(added / RENEWAL_MONTH_MS);
  const monthsEnd = new Date(from.getTime() + months * RENEWAL_MONTH_MS);
  return { months, monthsEnd, remainderMs: to.getTime() - monthsEnd.getTime() };
}

/** The booking facts the extension windows depend on. */
export interface ExtensionBookingFacts {
  startAt: Date;
  /** rentalPeriodType MONTHLY → the MONTHLY_RENEWAL method */
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
 * or — for a MONTHLY booking (a renewal) — the added window split into its
 * whole 30-day months and the remainder (renewalSplit), each its own window.
 */
export function extensionWindows(
  booking: ExtensionBookingFacts,
  fromEndAt: Date,
  newEndAt: Date,
): { mode: ExtensionPricingMode; terms: ExtensionTermWindow[] } {
  if (booking.monthly) {
    if (newEndAt.getTime() <= fromEndAt.getTime()) return { mode: "MONTHLY_RENEWAL", terms: [] };
    const { months, monthsEnd, remainderMs } = renewalSplit(fromEndAt, newEndAt);
    return {
      mode: "MONTHLY_RENEWAL",
      terms: [
        ...(months > 0 ? [{ from: fromEndAt, to: monthsEnd, sign: 1 as const, part: "MONTHS" as const }] : []),
        ...(remainderMs > 0 ? [{ from: monthsEnd, to: newEndAt, sign: 1 as const, part: "DAYS" as const }] : []),
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
 * ones ("Weekend pricing"), summed across vehicles (and, for a renewal, its
 * parts). Parts that come to ₹0 are left out.
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

/** One part of a monthly renewal as the engine priced it (amounts summed across the booking's vehicles). */
export interface RenewalPartInput {
  part: RenewalPartKind;
  from: Date;
  to: Date;
  /** The (first vehicle's) engine label and type, e.g. "1 month" / MONTHLY, "15 days" / MULTI_DAY */
  billedAs: string;
  billedAsType: string;
  /** GST-inclusive rent before / after discounts */
  grossPrice: Decimal;
  grossTotal: Decimal;
  /** The BM duration slab applied (null = none, or it lost to a coupon) */
  durationDiscountLabel: string | null;
}

/** A monthly renewal's charge, part by part — shown to staff before collection. */
export interface RenewalBreakdown {
  /** Whole 30-day months renewed */
  months: number;
  /** Time after them, priced by the day (whole minutes) */
  remainderMinutes: number;
  /** The renewal's length, e.g. "1 month + 15 days", "2 weeks", "3 days 4 h" */
  label: string;
  /** The car has no monthly price: its months were billed at the daily rate */
  monthlyPriceMissing: boolean;
  parts: RenewalPartView[];
}

export interface RenewalPartView {
  part: RenewalPartKind;
  /** MONTHLY = the vehicle's monthly price; DAILY = its daily rate (with the BM's slabs) */
  rate: "MONTHLY" | "DAILY";
  /** e.g. "1 month at the monthly price", "15 days at the daily rate" */
  label: string;
  from: string;
  to: string;
  /** GST-inclusive: before discounts, the discount, after discounts */
  price: string;
  discount: string;
  discountLabel: string | null;
  total: string;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "15 days", "2 weeks", "3 days 4 h", "5 h 30 min" — the length of a renewal's remainder. */
export function renewalLengthLabel(minutes: number): string {
  const days = Math.floor(minutes / (24 * 60));
  const rest = minutes - days * 24 * 60;
  const h = Math.floor(rest / 60);
  const m = rest % 60;
  const time = [h > 0 ? `${h} h` : "", m > 0 ? `${m} min` : ""].filter(Boolean).join(" ");
  if (days === 0) return time || "0 min";
  const dayText = days % 7 === 0 && rest === 0 ? unit(days / 7, "week") : unit(days, "day");
  return time ? `${dayText} ${time}` : dayText;
}

/**
 * The renewal breakdown of a MONTHLY_RENEWAL charge: its length, and each part
 * with the rate it was billed at (the monthly price, or the daily rate — also
 * for the months of a car with no monthly price) and its discount.
 */
export function renewalBreakdown(fromEndAt: Date, newEndAt: Date, parts: RenewalPartInput[]): RenewalBreakdown {
  const { months, remainderMs } = renewalSplit(fromEndAt, newEndAt);
  const remainderMinutes = Math.max(0, Math.round(remainderMs / MINUTE_MS));
  const monthsPart = parts.find((p) => p.part === "MONTHS");
  const monthlyPriceMissing = !!monthsPart && monthsPart.billedAsType !== "MONTHLY";
  const money = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
  const label = [
    ...(months > 0 ? [unit(months, "month")] : []),
    ...(remainderMinutes > 0 ? [renewalLengthLabel(remainderMinutes)] : []),
  ].join(" + ");
  return {
    months,
    remainderMinutes,
    label: label || "0 min",
    monthlyPriceMissing,
    parts: parts.map((p) => {
      const monthly = p.part === "MONTHS" && !monthlyPriceMissing;
      const length = p.part === "MONTHS"
        ? monthly
          ? unit(months, "month")
          : unit(Math.round((p.to.getTime() - p.from.getTime()) / DAY_MS), "day")
        : renewalLengthLabel(Math.round((p.to.getTime() - p.from.getTime()) / MINUTE_MS));
      return {
        part: p.part,
        rate: monthly ? "MONTHLY" : "DAILY",
        label: monthly
          ? `${length} at the monthly price`
          : p.part === "MONTHS"
            ? `${length} at the daily rate (no monthly price set)`
            : `${length} at the daily rate`,
        from: p.from.toISOString(),
        to: p.to.toISOString(),
        price: money(p.grossPrice),
        discount: money(Decimal.max(0, p.grossPrice.sub(p.grossTotal))),
        discountLabel: p.grossPrice.gt(p.grossTotal) ? (p.durationDiscountLabel ?? "Discount") : null,
        total: money(p.grossTotal),
      };
    }),
  };
}

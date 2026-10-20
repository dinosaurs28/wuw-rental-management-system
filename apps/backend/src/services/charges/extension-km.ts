/**
 * Free km an extension adds (#7 — client: "if only hours are added by
 * extending, do not add km; km only when the extension is by 12 or 24
 * hours"), following the blocks the extension is PRICED in (extension-charge.ts:
 * the added time billed as a booking of that length, base-price-rule.ts):
 *
 *   each whole 24 h block                    → freeKm24Hour
 *   the remainder, billed as the 12 h slab   → freeKm12Hour (≤ 12 h)
 *   the remainder, billed as the 24 h slab   → freeKm24Hour (> 12 h, or no 12 h slab)
 *   the remainder, billed by the hour        → 0 km (hours only)
 *
 * The remainder is billed by the hour when that is cheaper than its slab
 * (hourly rate × started hours < slab), at the vehicle's weekday rates.
 * Examples (₹1,600 / ₹1,100 / ₹300 an hour, freeKm24Hour 250, freeKm12Hour
 * 80): 2 h (₹600) → 0 · 5 h (₹1,100, 12 h slab) → 80 · 14 h (₹1,600) → 250 ·
 * 1 day + 11 h 30 min (₹1,600 + ₹1,100) → 330 · 1 day + 12 h 30 min → 500.
 * Without prices (rates loaded before this rule) the older minutes-only rule
 * applies: a remainder of 12 h or more → freeKm12Hour, else 0.
 *
 * The drop's km allowance is the original period's free km plus this for
 * every extension (km-allowance.service). extensionFreeKm is pure;
 * loadFreeKmRates reads the vehicle's rates the way the pricing engine does.
 * (Monthly bookings' extensions are priced as a delta from pickup; their free
 * km follow the same added-time blocks.)
 */
import { prisma } from "@repo/database/client";
import type { TxClient } from "../payment/paymentSession.service.js";
import { extensionPaidUntil } from "../extension/extension-charge.js";
import { heldToClosingOf } from "../../utils/booking/halfDayPackage.js";

const DAY_MINUTES = 24 * 60;
const HALF_DAY_MINUTES = 12 * 60;

/** The vehicle's slab free km (VehicleCustomPricing when enabled, else BranchPricingDefaults). */
export interface FreeKmRates {
  freeKm12Hour: number;
  freeKm24Hour: number;
  /**
   * The weekday rents (GST-inclusive) that decide how the remainder is billed:
   * the hourly rate (null / 0 = none), the 12 h slab (null / 0 = none) and the
   * 24 h slab. Absent = the older minutes-only rule.
   */
  hourlyRate?: number | null;
  price12Hour?: number | null;
  price24Hour?: number | null;
}

/** Free km one extension adds, with how it was worked out. */
export interface ExtensionFreeKm {
  /** Free km this extension adds to the drop allowance. */
  km: number;
  /** Length of the extension the km were worked out for, in whole minutes. */
  minutes: number;
  /** Days billed at the 24 h slab — freeKm24Hour each (whole 24 h blocks, plus a remainder billed as a day). */
  fullDays: number;
  /** The remainder was billed as the 12 h slab and earned freeKm12Hour. */
  halfDay: boolean;
  /** Minutes that earn no km (a remainder billed by the hour; minutes-only rule: beyond the 12 h block). */
  minutesWithoutKm: number;
  freeKm24Hour: number;
  freeKm12Hour: number;
  /** e.g. "150 km for 1 day + 80 km for 12 h", "Extensions under 12 hours add no free km". */
  label: string;
}

const nonNegativeInt = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** "2 h", "2 h 30 min", "45 min". */
function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Whole minutes between two instants (never negative). */
export function extensionMinutes(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}

/** The booking fields an extension's free-km window depends on. */
export interface ExtensionKmBooking {
  startAt: Date;
  pricingSnapshot?: unknown;
  rentalPeriodType?: string | null;
}

/**
 * Minutes an extension from `from` to `to` earns free km for — the window it
 * is charged for (extension-charge.ts extensionPaidUntil): a booking made as
 * the 12-hour package held to closing already got the 12 h km up to pickup +
 * 12 h, so only the time after that counts.
 */
export function extensionKmMinutes(booking: ExtensionKmBooking, from: Date, to: Date): number {
  const paidUntil = extensionPaidUntil(
    {
      startAt: booking.startAt,
      monthly: booking.rentalPeriodType === "MONTHLY",
      heldToClosing: heldToClosingOf(booking.pricingSnapshot),
    },
    from,
  );
  return extensionMinutes(paidUntil, to);
}

const positiveOrNull = (n: number | null | undefined) => (n != null && Number.isFinite(n) && n > 0 ? n : null);

/**
 * How the remainder of an extension (after its whole days) is billed — the
 * slab / hourly choice of base-price-rule.ts at weekday rents; null without
 * prices (the minutes-only rule).
 */
function remainderBilling(remainder: number, rates: FreeKmRates): "HOURS" | "HALF_DAY" | "FULL_DAY" | null {
  const price24 = positiveOrNull(rates.price24Hour);
  if (price24 == null) return null;
  const price12 = positiveOrNull(rates.price12Hour);
  const slab = remainder <= HALF_DAY_MINUTES && price12 != null
    ? { kind: "HALF_DAY" as const, price: price12 }
    : { kind: "FULL_DAY" as const, price: price24 };
  const hourly = positiveOrNull(rates.hourlyRate);
  if (hourly != null && hourly * Math.max(1, Math.ceil(remainder / 60)) < slab.price) return "HOURS";
  return slab.kind;
}

/** Free km for an extension of `minutes` (whole minutes) at the vehicle's slab rates. */
export function extensionFreeKm(minutes: number, rates: FreeKmRates): ExtensionFreeKm {
  const total = nonNegativeInt(Math.round(minutes));
  const freeKm24Hour = nonNegativeInt(rates.freeKm24Hour);
  const freeKm12Hour = nonNegativeInt(rates.freeKm12Hour);

  const wholeDays = Math.floor(total / DAY_MINUTES);
  const remainder = total - wholeDays * DAY_MINUTES;
  const billing = remainder > 0 ? remainderBilling(remainder, rates) : null;

  let fullDays = wholeDays;
  let halfDay: boolean;
  let minutesWithoutKm: number;
  if (billing === null) {
    // Minutes-only rule (no prices): a remainder of 12 h or more earns the 12 h km
    halfDay = remainder >= HALF_DAY_MINUTES;
    minutesWithoutKm = halfDay ? remainder - HALF_DAY_MINUTES : remainder;
  } else {
    if (billing === "FULL_DAY") fullDays += 1;
    halfDay = billing === "HALF_DAY";
    minutesWithoutKm = billing === "HOURS" ? remainder : 0;
  }
  const km = fullDays * freeKm24Hour + (halfDay ? freeKm12Hour : 0);

  let label: string;
  if (fullDays === 0 && !halfDay) {
    label = billing === "HOURS"
      ? "Extensions billed by the hour add no free km"
      : "Extensions under 12 hours add no free km";
  } else {
    const parts: string[] = [];
    if (fullDays > 0) parts.push(`${fullDays * freeKm24Hour} km for ${fullDays} ${fullDays === 1 ? "day" : "days"}`);
    if (halfDay) parts.push(`${freeKm12Hour} km for 12 h`);
    label = parts.join(" + ");
    if (minutesWithoutKm > 0) label += `; no km for the other ${durationText(minutesWithoutKm)}`;
  }

  return { km, minutes: total, fullDays, halfDay, minutesWithoutKm, freeKm24Hour, freeKm12Hour, label };
}

/** A pricing row's rents as FreeKmRates prices — read the way the pricing engine reads them. */
type RentRow = {
  extraHourRate: unknown;
  totalRent12Hour: unknown;
  price12Hour: unknown;
  totalRent24Hour: unknown;
  price24Hour: unknown;
};
const num = (v: unknown) => (v == null ? null : Number(v.toString()));
const rentPrices = (row: RentRow) => ({
  hourlyRate: positiveOrNull(num(row.extraHourRate)),
  price12Hour: positiveOrNull(num(row.totalRent12Hour)) ?? positiveOrNull(num(row.price12Hour)),
  price24Hour: positiveOrNull(num(row.totalRent24Hour)) ?? positiveOrNull(num(row.price24Hour)),
});
const RENT_SELECT = {
  extraHourRate: true,
  totalRent12Hour: true,
  price12Hour: true,
  totalRent24Hour: true,
  price24Hour: true,
} as const;

/**
 * The vehicle's slab free km, from the same source the pricing engine bills
 * with: its VehicleCustomPricing when enabled, else the branch default for its
 * category. null when neither exists (no pricing configured).
 */
export async function loadFreeKmRates(
  vehicle: { vehicleId: number; categoryId: number },
  branchId: number,
  tx?: TxClient,
): Promise<FreeKmRates | null> {
  const db = tx ?? prisma;
  const custom = await db.vehicleCustomPricing.findUnique({
    where: { vehicleId: vehicle.vehicleId },
    select: { enabled: true, freeKm12Hour: true, freeKm24Hour: true, ...RENT_SELECT },
  });
  if (custom?.enabled) {
    return { freeKm12Hour: custom.freeKm12Hour, freeKm24Hour: custom.freeKm24Hour, ...rentPrices(custom) };
  }

  const defaults = await db.branchPricingDefaults.findUnique({
    where: { branchId_categoryId: { branchId, categoryId: vehicle.categoryId } },
    select: { freeKm12Hour: true, freeKm24Hour: true, ...RENT_SELECT },
  });
  return defaults
    ? { freeKm12Hour: defaults.freeKm12Hour, freeKm24Hour: defaults.freeKm24Hour, ...rentPrices(defaults) }
    : null;
}

/** Slab free km of a booking's (first) vehicle — the vehicle the km allowance is worked out for. */
export async function loadBookingFreeKmRates(bookingId: number, tx?: TxClient): Promise<FreeKmRates | null> {
  const db = tx ?? prisma;
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      branchId: true,
      items: {
        orderBy: { id: "asc" },
        take: 1,
        select: { vehicleId: true, vehicle: { select: { categoryId: true } } },
      },
    },
  });
  const item = booking?.items[0];
  if (!booking || !item) return null;
  return loadFreeKmRates({ vehicleId: item.vehicleId, categoryId: item.vehicle.categoryId }, booking.branchId, db);
}

/**
 * Free km an extension of a booking from `fromEndAt` to `toEndAt` adds, for
 * quotes and commit responses. Never throws: null when the vehicle's rates
 * can't be found (the quote then shows no km line rather than a guess).
 */
export async function describeExtensionFreeKm(
  bookingId: number,
  fromEndAt: Date,
  toEndAt: Date,
): Promise<ExtensionFreeKm | null> {
  try {
    const [rates, booking] = await Promise.all([
      loadBookingFreeKmRates(bookingId),
      prisma.booking.findUnique({
        where: { id: bookingId },
        select: { startAt: true, pricingSnapshot: true, rentalPeriodType: true },
      }),
    ]);
    if (!rates || !booking) return null;
    return extensionFreeKm(extensionKmMinutes(booking, fromEndAt, toEndAt), rates);
  } catch (err) {
    console.warn(`[extension-km] Free km unavailable for booking ${bookingId}:`, err);
    return null;
  }
}

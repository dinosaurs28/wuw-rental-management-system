/**
 * Free km an extension adds (#7 — client: "if only hours are added by
 * extending, do not add km; km only when the extension is by 12 or 24 hours").
 *
 *   each whole 24 h block      → freeKm24Hour
 *   a remaining block ≥ 12 h   → freeKm12Hour (once)
 *   any other hours            → 0 km (an extension under 12 h adds none,
 *                                and hours beyond the 12 h block add none)
 *
 * Examples (freeKm24Hour 150, freeKm12Hour 80): 2 h → 0 · 12 h → 80 ·
 * 14 h → 80 · 24 h → 150 · 26 h → 150 · 36 h → 230 · 44 h → 230 · 48 h → 300.
 *
 * Only the free km follow this rule — the extension's PRICE is the pricing
 * engine's delta (hourly parts at the vehicle's hourly rate). The drop's km
 * allowance is the original period's free km plus this for every extension
 * (km-allowance.service). extensionFreeKm is pure; loadFreeKmRates reads the
 * vehicle's rates the way the pricing engine does.
 */
import { prisma } from "@repo/database/client";
import type { TxClient } from "../payment/paymentSession.service.js";

const DAY_MINUTES = 24 * 60;
const HALF_DAY_MINUTES = 12 * 60;

/** The vehicle's slab free km (VehicleCustomPricing when enabled, else BranchPricingDefaults). */
export interface FreeKmRates {
  freeKm12Hour: number;
  freeKm24Hour: number;
}

/** Free km one extension adds, with how it was worked out. */
export interface ExtensionFreeKm {
  /** Free km this extension adds to the drop allowance. */
  km: number;
  /** Length of the extension the km were worked out for, in whole minutes. */
  minutes: number;
  /** Whole 24 h blocks — freeKm24Hour each. */
  fullDays: number;
  /** A remaining block of 12 h or more earned freeKm12Hour. */
  halfDay: boolean;
  /** Minutes that earn no km (under 12 h left after the full days, or beyond the 12 h block). */
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

/** Free km for an extension of `minutes` (whole minutes) at the vehicle's slab rates. */
export function extensionFreeKm(minutes: number, rates: FreeKmRates): ExtensionFreeKm {
  const total = nonNegativeInt(Math.round(minutes));
  const freeKm24Hour = nonNegativeInt(rates.freeKm24Hour);
  const freeKm12Hour = nonNegativeInt(rates.freeKm12Hour);

  const fullDays = Math.floor(total / DAY_MINUTES);
  const remainder = total - fullDays * DAY_MINUTES;
  const halfDay = remainder >= HALF_DAY_MINUTES;
  const minutesWithoutKm = halfDay ? remainder - HALF_DAY_MINUTES : remainder;
  const km = fullDays * freeKm24Hour + (halfDay ? freeKm12Hour : 0);

  let label: string;
  if (fullDays === 0 && !halfDay) {
    label = "Extensions under 12 hours add no free km";
  } else {
    const parts: string[] = [];
    if (fullDays > 0) parts.push(`${fullDays * freeKm24Hour} km for ${fullDays} ${fullDays === 1 ? "day" : "days"}`);
    if (halfDay) parts.push(`${freeKm12Hour} km for 12 h`);
    label = parts.join(" + ");
    if (minutesWithoutKm > 0) label += `; no km for the other ${durationText(minutesWithoutKm)}`;
  }

  return { km, minutes: total, fullDays, halfDay, minutesWithoutKm, freeKm24Hour, freeKm12Hour, label };
}

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
    select: { enabled: true, freeKm12Hour: true, freeKm24Hour: true },
  });
  if (custom?.enabled) return { freeKm12Hour: custom.freeKm12Hour, freeKm24Hour: custom.freeKm24Hour };

  const defaults = await db.branchPricingDefaults.findUnique({
    where: { branchId_categoryId: { branchId, categoryId: vehicle.categoryId } },
    select: { freeKm12Hour: true, freeKm24Hour: true },
  });
  return defaults ? { freeKm12Hour: defaults.freeKm12Hour, freeKm24Hour: defaults.freeKm24Hour } : null;
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
    const rates = await loadBookingFreeKmRates(bookingId);
    return rates ? extensionFreeKm(extensionMinutes(fromEndAt, toEndAt), rates) : null;
  } catch (err) {
    console.warn(`[extension-km] Free km unavailable for booking ${bookingId}:`, err);
    return null;
  }
}

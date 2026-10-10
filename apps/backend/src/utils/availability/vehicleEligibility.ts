/**
 * Vehicle eligibility — the one rule for "which cars can be listed and booked",
 * shared by the customer listing, the walk-in search, group pages and booking
 * creation (client item 7, Oct 2026).
 *
 * A car is listable when it is not removed, its status is AVAILABLE or
 * OUT_FOR_RENTAL, and its insurance is valid through the end of its expiry day
 * (Asia/Kolkata). OUT_FOR_RENTAL is listable because a car out on a rental is
 * part of the fleet: the PICKED_UP booking blocks the dates it is out for
 * (availabilityBatch), so it shows for windows after its return. A car set
 * OUT_FOR_RENTAL by hand (no booking behind it) or overdue on its rental stays
 * unbookable for every window (getUnavailableVehicleIds).
 *
 * MAINTENANCE, INACTIVE and MANAGER_REPORTED (drop damage awaiting review) stay
 * hidden for all dates.
 */

import { VehicleStatus, BookingStatus, Prisma } from "@repo/database/client";
import { DateTime } from "luxon";
import { SYSTEM_TIMEZONE } from "../../services/timezone/timezone.service.js";
import { DEFAULT_FROZEN_CHARGE_CONFIG, type FrozenChargeConfig } from "../../types/charge-engine.types.js";

/** Statuses a listed (and bookable) car may have. */
export const LISTABLE_STATUSES: VehicleStatus[] = [VehicleStatus.AVAILABLE, VehicleStatus.OUT_FOR_RENTAL];

export function isListableStatus(status: string | null | undefined): boolean {
  return status === VehicleStatus.AVAILABLE || status === VehicleStatus.OUT_FOR_RENTAL;
}

/**
 * Start of `now`'s day in Asia/Kolkata. Insurance whose expiry is at or after it
 * is valid today: a policy is good through the end of its expiry day, whatever
 * time of day the date was saved with (the BM form saves local midnight).
 */
export function insuranceValidFrom(now: Date = new Date()): Date {
  return DateTime.fromJSDate(now, { zone: SYSTEM_TIMEZONE }).startOf("day").toJSDate();
}

/** Insurance valid on `now`'s day (IST): expiry at or after the start of that day. */
export function isInsuranceValid(insuranceExpiry: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!insuranceExpiry) return false;
  const expiry = new Date(insuranceExpiry);
  if (Number.isNaN(expiry.getTime())) return false;
  return expiry.getTime() >= insuranceValidFrom(now).getTime();
}

/** Prisma filter for listable cars (add branch / category / make filters on top). */
export function listableVehicleWhere(now: Date = new Date()): Prisma.VehicleWhereInput {
  return {
    deletedAt: null,
    status: { in: LISTABLE_STATUSES },
    insuranceExpiry: { gte: insuranceValidFrom(now) },
  };
}

/** The listable rule on a loaded row (same as listableVehicleWhere). */
export function isListableVehicle(
  v: { status: string; insuranceExpiry: Date | string | null; deletedAt?: Date | null },
  now: Date = new Date(),
): boolean {
  return !v.deletedAt && isListableStatus(v.status) && isInsuranceValid(v.insuranceExpiry, now);
}

// ── Why a car is hidden ───────────────────────────────────────────────────────

/** Reasons a car never shows to customers (for any dates). */
export type HiddenReason =
  | "INSURANCE_EXPIRED"
  | "DAMAGE_REVIEW_PENDING"
  | "STATUS_MAINTENANCE"
  | "STATUS_INACTIVE"
  | "NO_PRICE"
  | "MANUAL_OUT_FOR_RENTAL"
  /** Out on a rental past its return time: no window is free until it is back. */
  | "OVERDUE_RETURN";

export const HIDDEN_REASON_LABEL: Record<HiddenReason, string> = {
  INSURANCE_EXPIRED: "Insurance expired",
  DAMAGE_REVIEW_PENDING: "Damage review pending",
  STATUS_MAINTENANCE: "In maintenance",
  STATUS_INACTIVE: "Inactive",
  NO_PRICE: "No price set",
  MANUAL_OUT_FOR_RENTAL: "Set Out for Rental by hand",
  OVERDUE_RETURN: "Not back from a rental (overdue)",
};

/**
 * Every reason a car is kept from customers, from the same facts the listing
 * rule reads. `onActiveRental` = a PICKED_UP booking holds the car (tells the
 * system's OUT_FOR_RENTAL from a hand-set one); `overdueRental` = that rental
 * is past its return time; `rent24Hour` = the 24 h rent the engine bills it
 * with (null / 0 = unpriced).
 */
export function vehicleHiddenReasons(
  v: {
    status: string;
    insuranceExpiry: Date | string | null;
    onActiveRental: boolean;
    overdueRental?: boolean;
    rent24Hour: number | null;
  },
  now: Date = new Date(),
): HiddenReason[] {
  const reasons: HiddenReason[] = [];
  switch (v.status) {
    case VehicleStatus.MAINTENANCE:
      reasons.push("STATUS_MAINTENANCE");
      break;
    case VehicleStatus.INACTIVE:
      reasons.push("STATUS_INACTIVE");
      break;
    case VehicleStatus.MANAGER_REPORTED:
      reasons.push("DAMAGE_REVIEW_PENDING");
      break;
    case VehicleStatus.OUT_FOR_RENTAL:
      if (!v.onActiveRental) reasons.push("MANUAL_OUT_FOR_RENTAL");
      break;
  }
  if (v.overdueRental) reasons.push("OVERDUE_RETURN");
  if (!isInsuranceValid(v.insuranceExpiry, now)) reasons.push("INSURANCE_EXPIRED");
  if (!(v.rent24Hour != null && v.rent24Hour > 0)) reasons.push("NO_PRICE");
  return reasons;
}

// ── Turnaround after a rental ─────────────────────────────────────────────────

type GraceKeys = Pick<FrozenChargeConfig, "gracePolicyEnabled" | "graceType" | "graceMinutes">;

/**
 * A booking's AUTOMATIC grace minutes (a return inside them is on time), else
 * null — each key from the booking's frozen charge config, else the live branch
 * config, else the defaults, as the drop bill resolves it (same rule as the
 * overdue list). MANUAL grace only applies when staff tick it at the drop.
 */
export function automaticGraceMinutes(
  frozenChargeConfig: Prisma.JsonValue | null | undefined,
  live: GraceKeys | null | undefined,
): number | null {
  const frozen = (frozenChargeConfig ?? null) as Partial<FrozenChargeConfig> | null;
  const pick = <K extends keyof GraceKeys>(key: K): GraceKeys[K] =>
    (frozen?.[key] ?? live?.[key] ?? DEFAULT_FROZEN_CHARGE_CONFIG[key]) as GraceKeys[K];
  const minutes = Number(pick("graceMinutes"));
  if (!pick("gracePolicyEnabled") || pick("graceType") !== "AUTOMATIC") return null;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return minutes;
}

/**
 * Whether a booking keeps its car from the window [start, end):
 *  - CONFIRMED: it overlaps the window;
 *  - PICKED_UP: the car is out until its return time plus the automatic grace
 *    (a return inside the grace is on time, so a pickup at the return time
 *    can't be promised), and for every window once the return is overdue.
 * Other statuses never block here (HOLD rows are checked where a booking is
 * created — they may expire).
 */
export function bookingBlocksWindow(
  b: { status: string; startAt: Date; endAt: Date },
  start: Date,
  end: Date,
  now: Date,
  graceMinutes: number | null,
): boolean {
  if (b.status === BookingStatus.PICKED_UP) {
    if (b.endAt.getTime() <= now.getTime()) return true;
    return start.getTime() < b.endAt.getTime() + (graceMinutes ?? 0) * 60_000;
  }
  if (b.status === BookingStatus.CONFIRMED) {
    return b.startAt.getTime() < end.getTime() && b.endAt.getTime() > start.getTime();
  }
  return false;
}

// ── Registration numbers ──────────────────────────────────────────────────────

/** Comparison form of a registration number: upper case, letters and digits only. */
export function normalizeRegNo(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Partial, case-insensitive match ignoring spaces / hyphens / dots. Empty queries match nothing. */
export function regNoMatches(regNo: string | null | undefined, query: string | null | undefined): boolean {
  const q = normalizeRegNo(query);
  return q.length > 0 && normalizeRegNo(regNo).includes(q);
}

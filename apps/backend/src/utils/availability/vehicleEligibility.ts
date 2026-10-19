/**
 * Vehicle eligibility — the one rule for "which cars can be listed and booked",
 * shared by the customer listing, the walk-in search, group pages and booking
 * creation (client item 7, Oct 2026).
 *
 * A car is listable when it is not removed, its status is AVAILABLE or
 * OUT_FOR_RENTAL, and its insurance is valid through the end of its expiry day
 * (Asia/Kolkata). OUT_FOR_RENTAL is listable because a car out on a rental is
 * part of the fleet: the PICKED_UP booking blocks the dates it is out for
 * (availabilityBatch), so it shows for windows from its return plus the 3 h
 * turnaround (bookingBlocksWindow). A car set OUT_FOR_RENTAL by hand (no
 * booking behind it) or overdue on its rental stays unbookable for every window
 * (getUnavailableVehicleIds) — the overdue one until fleet records its drop.
 *
 * MAINTENANCE, INACTIVE and MANAGER_REPORTED (drop damage awaiting review) stay
 * hidden for all dates.
 */

import { VehicleStatus, BookingStatus, Prisma } from "@repo/database/client";
import { DateTime } from "luxon";
import { SYSTEM_TIMEZONE } from "../../services/timezone/timezone.service.js";
import { DEFAULT_FROZEN_CHARGE_CONFIG, type FrozenChargeConfig } from "../../types/charge-engine.types.js";
import { BOOKING_TURNAROUND_MS, windowsConflictWithTurnaround } from "@repo/schemas";

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
 * The turnaround a booking keeps around itself (client request, Oct 2026):
 * BOOKING_TURNAROUND_HOURS (3 h), or the booking's automatic grace when that is
 * longer (a return inside the grace is on time, so a pickup inside it can't be
 * promised). `baseMs` overrides the 3 h (an extension swap uses its own buffer).
 */
export function turnaroundMsFor(graceMinutes: number | null | undefined, baseMs: number = BOOKING_TURNAROUND_MS): number {
  return Math.max(Math.max(0, baseMs), Math.max(0, graceMinutes ?? 0) * 60_000);
}

/**
 * Fleet has recorded the drop and only the branch manager's confirmation is
 * left (legacy drop "send to manager": the booking stays PICKED_UP with
 * requiresManagerConfirmation, and the drop stamps returnedAt in the same
 * transaction). The car is back, so it no longer blocks other customers — a
 * drop that raised damage holds the car by its status instead
 * (MANAGER_REPORTED, set at the drop). returnedAt is required too: a pickup
 * sent to the manager and then completed another way could leave the flag on
 * a car that is really out (no returnedAt), and that must keep blocking.
 */
export function isDropRecorded(b: {
  status: string;
  requiresManagerConfirmation?: boolean | null;
  returnedAt?: Date | null;
}): boolean {
  return b.status === BookingStatus.PICKED_UP && b.requiresManagerConfirmation === true && b.returnedAt != null;
}

/** Prisma filter: a PICKED_UP booking whose drop is NOT recorded (isDropRecorded false) — the car is out. */
export const DROP_NOT_RECORDED_WHERE = {
  OR: [{ requiresManagerConfirmation: false }, { returnedAt: null }],
} satisfies Prisma.BookingWhereInput;

/**
 * Whether a booking keeps its car from the window [start, end), with the
 * turnaround T = turnaroundMsFor(graceMinutes, turnaroundMs) on both sides:
 *  - CONFIRMED, or a HOLD not yet expired (a checkout in progress): the window
 *    must start at least T after the booking's return and end at least T before
 *    its pickup;
 *  - PICKED_UP: the car is out until its return plus T, and for every window
 *    once the return is overdue — until fleet records the drop (isDropRecorded),
 *    after which it blocks nothing.
 * Other statuses (RETURNED, CANCELLED, HOLD_EXPIRED) never block.
 */
export function bookingBlocksWindow(
  b: {
    status: string;
    startAt: Date;
    endAt: Date;
    holdExpiresAt?: Date | null;
    requiresManagerConfirmation?: boolean | null;
    returnedAt?: Date | null;
  },
  start: Date,
  end: Date,
  now: Date,
  graceMinutes: number | null,
  turnaroundMs: number = BOOKING_TURNAROUND_MS,
): boolean {
  const t = turnaroundMsFor(graceMinutes, turnaroundMs);
  if (b.status === BookingStatus.PICKED_UP) {
    if (isDropRecorded(b)) return false;
    if (b.endAt.getTime() <= now.getTime()) return true;
    return start.getTime() < b.endAt.getTime() + t;
  }
  const live =
    b.status === BookingStatus.CONFIRMED ||
    (b.status === BookingStatus.HOLD && !!b.holdExpiresAt && b.holdExpiresAt.getTime() > now.getTime());
  if (!live) return false;
  return windowsConflictWithTurnaround(b.startAt.getTime(), b.endAt.getTime(), start.getTime(), end.getTime(), t);
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

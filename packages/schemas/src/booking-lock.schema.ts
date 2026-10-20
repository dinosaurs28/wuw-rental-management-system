import { z } from "zod";
import { vehicleGroupKey } from "./special-pricing.schema.js";
import { istDayNumber } from "./booking-window.js";

// ─── Booking locks ────────────────────────────────────────────────────────────
//
// Client, Oct 2026: "create a booking lock for a Window". A branch manager (or
// admin) keeps cars from being booked for a date-time window [startAt, endAt):
// the whole branch, some vehicles, or some vehicle groups (make + model +
// category, vehicleGroupKey). A plain overlap — no turnaround around a lock.
// customersOnly: hidden from customers only (staff walk-ins, reschedules and
// swaps still allowed). Existing bookings are never changed.
//
// Lead day (client, Oct 2026: "one day before the date it's getting blocked,
// it won't be visible and no one can book it"): a lock acts from 00:00 IST on
// the calendar day before its start (effectiveLockStart) to its end — the
// effective window [effectiveLockStart(startAt), endAt). Computed, never
// stored, so locks created before the rule get the lead too.

export const BOOKING_LOCK_SCOPES = ["BRANCH", "VEHICLES", "GROUPS"] as const;
export type BookingLockScopeValue = (typeof BOOKING_LOCK_SCOPES)[number];
export const BOOKING_LOCK_REASON_MAX = 120;
/** The pickers' grid: a lock starts and ends on a 30-minute step. */
export const BOOKING_LOCK_STEP_MINUTES = 30;
/** Longest lock, in days. */
export const BOOKING_LOCK_MAX_DAYS = 60;
/** How far ahead a lock may start, in days. */
export const BOOKING_LOCK_MAX_AHEAD_DAYS = 365;
/** Most vehicles / vehicle groups one lock can name. */
export const BOOKING_LOCK_MAX_ITEMS = 500;
export const BOOKING_LOCK_LIST_FILTERS = ["current", "past", "all"] as const;
export type BookingLockListFilter = (typeof BOOKING_LOCK_LIST_FILTERS)[number];
export type BookingLockStatus = "UPCOMING" | "ACTIVE" | "ENDED" | "CANCELLED";

/** A lock as the availability rule reads it. */
export interface BookingLockRule {
  branchId: number;
  startAt: Date;
  endAt: Date;
  scope: BookingLockScopeValue | string;
  vehicleIds: number[];
  groupKeys: string[];
  customersOnly: boolean;
  cancelledAt?: Date | null;
}

/** Calendar days (IST) before a lock's start that it already hides the car and refuses bookings. */
export const LOCK_LEAD_DAYS = 1;

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/**
 * When a lock starting at `startAt` begins to act: 00:00 IST on the calendar
 * day LOCK_LEAD_DAYS before its start day (a lock from 25 Aug 10:00 IST acts
 * from 24 Aug 00:00 IST).
 */
export function effectiveLockStart(startAt: Date | string): Date {
  return new Date((istDayNumber(startAt) - LOCK_LEAD_DAYS) * DAY_MS - IST_OFFSET_MS);
}

/**
 * [effectiveLockStart, lockEnd) and [start, end) overlap — a plain overlap
 * with the effective window (the lead day included), no turnaround.
 */
export function lockOverlapsWindow(lock: { startAt: Date; endAt: Date }, start: Date, end: Date): boolean {
  return effectiveLockStart(lock.startAt).getTime() < end.getTime() && start.getTime() < lock.endAt.getTime();
}

/** The lock hides the car and refuses bookings right now: now ∈ [effectiveLockStart, endAt). */
export function lockActsAt(lock: { startAt: Date; endAt: Date; cancelledAt?: Date | null }, now: Date = new Date()): boolean {
  if (lock.cancelledAt) return false;
  return effectiveLockStart(lock.startAt).getTime() <= now.getTime() && now.getTime() < lock.endAt.getTime();
}

/** The lock names this vehicle (its branch, the vehicle itself, or its make + model + category group). */
export function lockCoversVehicle(
  lock: Pick<BookingLockRule, "branchId" | "scope" | "vehicleIds" | "groupKeys">,
  vehicle: { id: number; branchId: number; make: string; model: string; categoryId: number },
): boolean {
  if (lock.branchId !== vehicle.branchId) return false;
  if (lock.scope === "BRANCH") return true;
  if (lock.scope === "VEHICLES") return lock.vehicleIds.includes(vehicle.id);
  if (lock.scope === "GROUPS") return lock.groupKeys.includes(vehicleGroupKey(vehicle.make, vehicle.model, vehicle.categoryId));
  return false;
}

/**
 * Does the lock keep this vehicle from [start, end)? Not cancelled, covering
 * the vehicle, overlapping its effective window (the lead day included) — and, for a staff action (`forStaff`),
 * not a customers-only lock.
 */
export function lockBlocksVehicle(
  lock: BookingLockRule,
  vehicle: { id: number; branchId: number; make: string; model: string; categoryId: number },
  start: Date,
  end: Date,
  forStaff = false,
): boolean {
  if (lock.cancelledAt) return false;
  if (forStaff && lock.customersOnly) return false;
  return lockOverlapsWindow(lock, start, end) && lockCoversVehicle(lock, vehicle);
}

/**
 * A whole-day lock: From 00:00 IST through the end of To (the next day's
 * 00:00 IST), both "YYYY-MM-DD" IST calendar dates, as ISO instants. Null when
 * a date is malformed.
 */
export function wholeDayLockWindow(fromDate: string, toDate: string): { startAt: string; endAt: string } | null {
  const parse = (d: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  };
  const from = parse(fromDate);
  const to = parse(toDate);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return {
    startAt: new Date(from - IST_OFFSET_MS).toISOString(),
    endAt: new Date(to + DAY_MS - IST_OFFSET_MS).toISOString(),
  };
}

/** Where a lock stands at `now`. */
export function bookingLockStatus(
  lock: { startAt: Date; endAt: Date; cancelledAt?: Date | null },
  now: Date = new Date(),
): BookingLockStatus {
  if (lock.cancelledAt) return "CANCELLED";
  if (lock.endAt.getTime() <= now.getTime()) return "ENDED";
  if (lock.startAt.getTime() <= now.getTime()) return "ACTIVE";
  return "UPCOMING";
}

const STEP_MS = BOOKING_LOCK_STEP_MINUTES * 60_000;

/** Problems with a lock's window (both ISO instants), as { path, message }. */
export function bookingLockWindowIssues(
  input: { startAt: string; endAt: string },
  now: Date = new Date(),
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  if (Number.isNaN(start.getTime())) issues.push({ path: "startAt", message: "Pick a valid start" });
  if (Number.isNaN(end.getTime())) issues.push({ path: "endAt", message: "Pick a valid end" });
  if (issues.length > 0) return issues;
  if (start.getTime() % STEP_MS !== 0) issues.push({ path: "startAt", message: "The start must be on the hour or half hour" });
  if (end.getTime() % STEP_MS !== 0) issues.push({ path: "endAt", message: "The end must be on the hour or half hour" });
  if (end.getTime() <= start.getTime()) issues.push({ path: "endAt", message: "The end must be after the start" });
  else if (end.getTime() - start.getTime() > BOOKING_LOCK_MAX_DAYS * DAY_MS) {
    issues.push({ path: "endAt", message: `A lock can last at most ${BOOKING_LOCK_MAX_DAYS} days` });
  }
  if (end.getTime() <= now.getTime()) issues.push({ path: "endAt", message: "This window is already over" });
  if (start.getTime() > now.getTime() + BOOKING_LOCK_MAX_AHEAD_DAYS * DAY_MS) {
    issues.push({ path: "startAt", message: `A lock can start at most ${BOOKING_LOCK_MAX_AHEAD_DAYS} days ahead` });
  }
  return issues;
}

const bookingLockBase = z.object({
  startAt: z.string().min(1, "Pick a start"),
  endAt: z.string().min(1, "Pick an end"),
  reason: z
    .string()
    .trim()
    .min(1, "Give a reason")
    .max(BOOKING_LOCK_REASON_MAX, `Keep the reason under ${BOOKING_LOCK_REASON_MAX} characters`),
  scope: z.enum(BOOKING_LOCK_SCOPES).default("BRANCH"),
  vehicleIds: z.array(z.number().int().positive()).max(BOOKING_LOCK_MAX_ITEMS).default([]),
  groupKeys: z.array(z.string().min(1).max(300)).max(BOOKING_LOCK_MAX_ITEMS).default([]),
  customersOnly: z.boolean().default(false),
  /** The manager saw the existing bookings inside the window (required when there are any). */
  acknowledgeOverlaps: z.boolean().optional(),
});

function refineLock(v: z.infer<typeof bookingLockBase>, ctx: z.RefinementCtx) {
  for (const issue of bookingLockWindowIssues(v)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
  }
  if (v.scope === "VEHICLES" && v.vehicleIds.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["vehicleIds"], message: "Pick at least one vehicle" });
  }
  if (v.scope === "GROUPS" && v.groupKeys.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["groupKeys"], message: "Pick at least one vehicle group" });
  }
}

/** POST …/booking-locks (branch manager: own branch); …/preview takes the same body. */
export const createBookingLockSchema = bookingLockBase.superRefine(refineLock);

/** POST /admin/booking-locks — the same for any branch. */
export const adminCreateBookingLockSchema = bookingLockBase
  .extend({ branchId: z.number().int().positive() })
  .superRefine(refineLock);

export type CreateBookingLockInput = z.infer<typeof createBookingLockSchema>;
export type AdminCreateBookingLockInput = z.infer<typeof adminCreateBookingLockSchema>;

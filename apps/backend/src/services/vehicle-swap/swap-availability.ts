/**
 * Which cars can take over a booking at a vehicle swap — the customer booking
 * rule applied to the rest of the rental (client TODO, Oct 2026: "prevent
 * booking overlaps during vehicle swaps").
 *
 * A replacement must be free from max(now, booking start) until the booking's
 * end (an extension swap: the extended end). "Free" is what a customer booking
 * for that window checks (availabilityBatch): no CONFIRMED booking overlapping
 * it, no rental out over it (a PICKED_UP booking until its return plus the
 * turnaround; for good once overdue, until the drop is recorded), no checkout
 * in progress (an unexpired HOLD booking or a Redis hold) and not set Out for
 * Rental by hand — every booking and hold keeping the 3 h turnaround either
 * side (BOOKING_TURNAROUND_HOURS; the swapped booking's grace when longer) —
 * plus the eligibility rules (status, insurance through the rental's end,
 * vehicle type, no downgrade). After the swap the booking item points at the
 * replacement, so the same rule keeps it reserved for this booking until the
 * booking ends.
 *
 * Pure: no database (swap-replacements.ts runs it against the data).
 */
import { DateTime } from "luxon";
import { BOOKING_TURNAROUND_MS } from "@repo/schemas";
import type { UnavailableReason } from "../../utils/availability/availabilityBatch.js";
import { isInsuranceValid, turnaroundMsFor } from "../../utils/availability/vehicleEligibility.js";

/** PRE_PICKUP = booking CONFIRMED; ACTIVE_RENTAL = booking PICKED_UP (car with the customer). */
export type SwapAvailabilityStage = "PRE_PICKUP" | "ACTIVE_RENTAL";

/** Why a car of the branch can't take over the booking. */
export type SwapExclusionCode =
  | "STATUS_OUT_FOR_RENTAL"
  | "MANUAL_OUT_FOR_RENTAL"
  | "STATUS_MAINTENANCE"
  | "STATUS_INACTIVE"
  | "DAMAGE_REVIEW_PENDING"
  | "INSURANCE_EXPIRES"
  | "LOWER_CATEGORY"
  | "STILL_OUT"
  | "BOOKED"
  | "ON_HOLD"
  /** A branch manager's booking lock covers the car for part of the window. */
  | "BOOKING_LOCKED";

export interface SwapExclusion {
  code: SwapExclusionCode;
  /** Staff-facing reason, e.g. "Booked 18 Oct 2026, 10:00 AM – 19 Oct 2026, 10:00 AM" */
  reason: string;
}

/**
 * Exclusions that mean another booking, rental or checkout has the car for
 * part of the window (refused with SWAP_VEHICLE_UNAVAILABLE at the swap).
 */
export const DATE_CONFLICT_CODES: ReadonlySet<SwapExclusionCode> = new Set<SwapExclusionCode>([
  "STATUS_OUT_FOR_RENTAL",
  "MANUAL_OUT_FOR_RENTAL",
  "STILL_OUT",
  "BOOKED",
  "ON_HOLD",
  "BOOKING_LOCKED",
]);

/** 409 code of a swap refused because the replacement is taken for part of the window. */
export const SWAP_VEHICLE_UNAVAILABLE = "SWAP_VEHICLE_UNAVAILABLE";

export const formatSwapIst = (d: Date) =>
  DateTime.fromJSDate(d).setZone("Asia/Kolkata").toFormat("d LLL yyyy, h:mm a");

export interface SwapWindow {
  /** max(now, booking start); now for a rental already out (picked up early or not) */
  start: Date;
  /** The checked end: the booking's end (or the later extension end). */
  end: Date;
  /** The end the rental runs to: the replacement's insurance must cover it. */
  coverUntil: Date;
  /**
   * Turnaround either side of the window (explainUnavailableVehicles): another
   * booking on the replacement must end this long before `start` and start
   * this long after `end`. BOOKING_TURNAROUND_MS, or the booking's automatic
   * grace when longer for a rental already out (a return inside the grace is
   * on time); an extension swap passes its own buffer.
   */
  turnaroundMs: number;
}

/**
 * The window a replacement must be free for: from max(now, booking start) —
 * from now for a rental already out, since the replacement is handed over now
 * even when the car was picked up before the booked start — to the booking's end — or `availabilityEndAt` when later (an extension
 * swap), with the turnaround either side: `turnaroundMs` (default
 * BOOKING_TURNAROUND_MS) or `graceMinutes` (the booking's automatic grace)
 * when longer and the booking is PICKED_UP.
 */
export function swapAvailabilityWindow(
  booking: { status: string; startAt: Date; endAt: Date },
  now: Date,
  opts: { availabilityEndAt?: Date | null; graceMinutes?: number | null; turnaroundMs?: number | null } = {},
): SwapWindow {
  const coverUntil =
    opts.availabilityEndAt && opts.availabilityEndAt.getTime() > booking.endAt.getTime()
      ? opts.availabilityEndAt
      : booking.endAt;
  const active = booking.status === "PICKED_UP";
  const start = active ? now : new Date(Math.max(now.getTime(), booking.startAt.getTime()));
  const turnaroundMs = turnaroundMsFor(active ? opts.graceMinutes : null, opts.turnaroundMs ?? BOOKING_TURNAROUND_MS);
  return { start, end: coverUntil, coverUntil, turnaroundMs };
}

/**
 * Eligibility of a replacement (before its bookings are looked at), or why it
 * fails. `onRental` = a PICKED_UP booking other than this one has the car
 * (tells the system's OUT_FOR_RENTAL from a hand-set one).
 *  - MAINTENANCE / damage review / INACTIVE never qualify; a hand-set Out for
 *    Rental neither (no return time).
 *  - A car out on another rental qualifies for a swap before pickup when it is
 *    back (return + turnaround) before this booking starts — the booking rule
 *    decides — but never for a mid-rental swap: it is handed over now.
 *  - Insurance valid through the rental's last day; same or higher category.
 */
export function swapEligibilityExclusion(
  vehicle: {
    status: string;
    insuranceExpiry: Date | string | null;
    categoryName: string;
    categoryRank: number;
  },
  ctx: { stage: SwapAvailabilityStage; currentRank: number; coverUntil: Date; onRental: boolean },
): SwapExclusion | null {
  switch (vehicle.status) {
    case "AVAILABLE":
      break;
    case "OUT_FOR_RENTAL":
      if (!ctx.onRental) {
        return { code: "MANUAL_OUT_FOR_RENTAL", reason: "Set Out for Rental by the branch manager" };
      }
      if (ctx.stage === "ACTIVE_RENTAL") return { code: "STATUS_OUT_FOR_RENTAL", reason: "Out on another rental" };
      break;
    case "MAINTENANCE":
      return { code: "STATUS_MAINTENANCE", reason: "In maintenance" };
    case "MANAGER_REPORTED":
      return { code: "DAMAGE_REVIEW_PENDING", reason: "Damage review pending with the branch manager" };
    default:
      return { code: "STATUS_INACTIVE", reason: "Inactive" };
  }
  if (!isInsuranceValid(vehicle.insuranceExpiry, ctx.coverUntil)) {
    const expiry = vehicle.insuranceExpiry ? new Date(vehicle.insuranceExpiry) : null;
    return {
      code: "INSURANCE_EXPIRES",
      reason:
        expiry && !Number.isNaN(expiry.getTime())
          ? `Insurance expires on ${formatSwapIst(expiry)}, before this rental ends`
          : "No valid insurance",
    };
  }
  if (vehicle.categoryRank < ctx.currentRank) {
    return { code: "LOWER_CATEGORY", reason: `Lower category (${vehicle.categoryName})` };
  }
  return null;
}

/** The booking-rule refusal (explainUnavailableVehicles) as a swap exclusion. */
export function blockerExclusion(r: UnavailableReason): SwapExclusion {
  switch (r.code) {
    case "MANUAL_OUT_FOR_RENTAL":
      return { code: "MANUAL_OUT_FOR_RENTAL", reason: "Set Out for Rental by the branch manager" };
    case "OVERDUE_RENTAL":
      return { code: "STILL_OUT", reason: `Out on another rental (was due back ${formatSwapIst(r.endAt)})` };
    case "ON_RENT":
      return {
        code: "STILL_OUT",
        reason: `Out on another rental until ${formatSwapIst(r.endAt)} (available from ${formatSwapIst(r.availableFrom)})`,
      };
    case "BOOKED":
      return {
        code: "BOOKED",
        reason: `Booked ${formatSwapIst(r.startAt)} – ${formatSwapIst(r.endAt)} (free again from ${formatSwapIst(r.availableFrom)})`,
      };
    case "ON_HOLD":
      return { code: "ON_HOLD", reason: "Checkout in progress — a customer is booking it for part of this rental" };
    case "BOOKING_LOCKED":
      return { code: "BOOKING_LOCKED", reason: `Locked: ${r.reason} until ${formatSwapIst(r.endAt)}` };
  }
}

/**
 * Split cars into the ones that can take over the booking and the ones that
 * can't (with the first rule each fails: eligibility, then the booking rule).
 */
export function classifySwapCandidates<
  V extends { id: number; status: string; insuranceExpiry: Date | string | null; category: { name: string; rank: number } },
>(
  vehicles: V[],
  ctx: {
    stage: SwapAvailabilityStage;
    currentRank: number;
    window: SwapWindow;
    /** Cars out on a PICKED_UP booking other than this one */
    onRental: ReadonlySet<number>;
    /** The booking rule's refusals for the window */
    blockers: ReadonlyMap<number, UnavailableReason>;
  },
): { free: V[]; excluded: Array<{ vehicle: V; exclusion: SwapExclusion }> } {
  const free: V[] = [];
  const excluded: Array<{ vehicle: V; exclusion: SwapExclusion }> = [];
  for (const vehicle of vehicles) {
    const blocker = ctx.blockers.get(vehicle.id);
    const exclusion =
      swapEligibilityExclusion(
        {
          status: vehicle.status,
          insuranceExpiry: vehicle.insuranceExpiry,
          categoryName: vehicle.category.name,
          categoryRank: vehicle.category.rank,
        },
        {
          stage: ctx.stage,
          currentRank: ctx.currentRank,
          coverUntil: ctx.window.coverUntil,
          onRental: ctx.onRental.has(vehicle.id),
        },
      ) ?? (blocker ? blockerExclusion(blocker) : null);
    if (exclusion) excluded.push({ vehicle, exclusion });
    else free.push(vehicle);
  }
  return { free, excluded };
}

/** "<reg> is no longer available for these dates — pick another vehicle. <reason>." */
export function swapUnavailableMessage(regNo: string, exclusion: SwapExclusion): string {
  return `${regNo} is no longer available for these dates — pick another vehicle. ${exclusion.reason}.`;
}

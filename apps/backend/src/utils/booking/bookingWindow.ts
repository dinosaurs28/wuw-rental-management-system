/**
 * Booking window (#15; advance window 30 days since Oct 2026) — backend
 * wrapper around the shared @repo/schemas booking-window helpers: a pickup up
 * to ADVANCE_BOOKING_DAYS (30) ahead, a booking up to MAX_RENTAL_DAYS (30) long.
 *
 * Every role is bound by it (no staff/manager bypass). Monthly-plan bookings
 * (Booking.rentalPeriodType MONTHLY, chosen at the counter) are exempt except
 * that their pickup must be inside the window and they run 30–180 days.
 *
 * Violations surface as HTTP 400
 *   { success:false, code:'BOOKING_MAX_PERIOD_EXCEEDED', reason, maxEndAt, message }
 */
import {
  validateBookingWindow,
  validateExtensionWindow,
  maxRentalEnd,
  MONTHLY_MAX_DAYS,
  BOOKING_MAX_PERIOD_EXCEEDED,
  type BookingWindowReason,
} from "@repo/schemas";

const DAY_MS = 24 * 60 * 60 * 1000;

export class BookingWindowError extends Error {
  readonly code = BOOKING_MAX_PERIOD_EXCEEDED;
  readonly status = 400;

  constructor(
    message: string,
    public readonly reason: BookingWindowReason,
    public readonly maxEndAt: Date,
  ) {
    super(message);
    this.name = "BookingWindowError";
  }

  toJSON() {
    return {
      success: false,
      code: this.code,
      reason: this.reason,
      maxEndAt: this.maxEndAt.toISOString(),
      message: this.message,
    };
  }
}

/**
 * Latest allowed return for a standard booking starting at `startAt`:
 * startAt + MAX_RENTAL_DAYS × 24 h (the pickup itself is held to the advance
 * window separately). `now` is kept for callers' signatures.
 */
export function maxStandardEndAt(startAt: Date, _now: Date = new Date()): Date {
  return maxRentalEnd(startAt);
}

/**
 * New-booking check (customer create and walk-in create). Throws
 * BookingWindowError on a violation; returns the latest allowed return.
 */
export function assertBookingWindow(
  startAt: Date,
  endAt: Date,
  opts: { monthly?: boolean; now?: Date } = {},
): Date {
  const result = validateBookingWindow({ startAt, endAt, now: opts.now, monthly: opts.monthly });
  const monthlyMaxEnd = new Date(startAt.getTime() + MONTHLY_MAX_DAYS * DAY_MS);
  if (result.ok) return opts.monthly ? monthlyMaxEnd : maxStandardEndAt(startAt, opts.now);
  // The shared helper reports the window end; report the limit that actually
  // binds this request, which is what the client should clamp the return to:
  //   standard       → start + 30 days (a WINDOW failure is the pickup itself)
  //   MONTHLY_LENGTH → start + 180 days
  //   PICKUP_WINDOW  → the window end (latest allowed pickup)
  const maxEndAt = !opts.monthly
    ? maxStandardEndAt(startAt, opts.now)
    : result.reason === "MONTHLY_LENGTH"
      ? monthlyMaxEnd
      : result.maxEndAt;
  throw new BookingWindowError(result.message, result.reason, maxEndAt);
}

/**
 * Extension check, measured from the booking's ORIGINAL start so chained
 * extensions can't pass the cap. Throws BookingWindowError; returns maxEndAt.
 */
export function assertExtensionWindow(
  bookingStartAt: Date,
  newEndAt: Date,
  opts: { monthly?: boolean; now?: Date } = {},
): Date {
  const result = validateExtensionWindow({ bookingStartAt, newEndAt, now: opts.now, monthly: opts.monthly });
  if (result.ok) return result.maxEndAt;
  throw new BookingWindowError(result.message, result.reason, result.maxEndAt);
}

/** Latest end an extension may reach (same rule as assertExtensionWindow). */
export function extensionMaxEndAt(
  bookingStartAt: Date,
  opts: { monthly?: boolean; now?: Date } = {},
): Date {
  // validateExtensionWindow always reports maxEndAt; probe with the start itself
  return validateExtensionWindow({
    bookingStartAt,
    newEndAt: bookingStartAt,
    now: opts.now,
    monthly: opts.monthly,
  }).maxEndAt;
}

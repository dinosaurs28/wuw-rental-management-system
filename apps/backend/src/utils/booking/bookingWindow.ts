/**
 * 15-day booking window (#15) — backend wrapper around the shared
 * @repo/schemas booking-window helpers.
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
  bookingWindowEnd,
  MAX_BOOKING_DAYS,
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
 * min(23:59:59.999 IST on today + 15, startAt + 15 × 24 h).
 */
export function maxStandardEndAt(startAt: Date, now: Date = new Date()): Date {
  const windowEnd = bookingWindowEnd(now);
  const durationEnd = new Date(startAt.getTime() + MAX_BOOKING_DAYS * DAY_MS);
  return windowEnd.getTime() < durationEnd.getTime() ? windowEnd : durationEnd;
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
  //   standard       → min(window end, start + 15 days)
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

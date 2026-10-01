// Mirror of packages/schemas/src/booking-window.ts — mobile is outside the pnpm
// workspace, so keep the two files in sync.
/**
 * Booking window rules (IST). Keep in sync with packages/schemas/src/booking-window.ts.
 *
 * Standard (hourly / 12 h / daily / multi-day) bookings:
 *   1. WINDOW   — the return must be on or before 23:59:59.999 IST on
 *                 (today IST + MAX_BOOKING_DAYS). Pickup is never in the past,
 *                 so both dates fall in [today, today + 15].
 *   2. DURATION — endAt − startAt ≤ MAX_BOOKING_DAYS × 24 h. For an
 *                 extension, startAt is the booking's original start, so the
 *                 cap includes every extension.
 *
 * Monthly bookings (an explicit plan chosen at the counter; stored as
 * Booking.rentalPeriodType = MONTHLY) are exempt from both rules. Their
 * pickup must still be within the window, and their length must be between
 * MONTHLY_MIN_DAYS and MONTHLY_MAX_DAYS.
 */

export const MAX_BOOKING_DAYS = 15;
export const MONTHLY_MIN_DAYS = 30;
export const MONTHLY_MAX_DAYS = 180;
export const BOOKING_MAX_PERIOD_EXCEEDED = "BOOKING_MAX_PERIOD_EXCEEDED";

const IST_OFFSET_MS = 330 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type BookingWindowReason = "WINDOW" | "DURATION" | "PICKUP_WINDOW" | "MONTHLY_LENGTH";

export type BookingWindowResult =
  | { ok: true; maxEndAt: Date }
  | {
      ok: false;
      code: typeof BOOKING_MAX_PERIOD_EXCEEDED;
      reason: BookingWindowReason;
      maxEndAt: Date;
      message: string;
    };

/** Last allowed instant: 23:59:59.999 IST on (today IST + days). */
export function bookingWindowEnd(now: Date = new Date(), days: number = MAX_BOOKING_DAYS): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const endIstAsUtc = Date.UTC(
    ist.getUTCFullYear(),
    ist.getUTCMonth(),
    ist.getUTCDate() + days,
    23,
    59,
    59,
    999,
  );
  return new Date(endIstAsUtc - IST_OFFSET_MS);
}

/** "16 Oct 2026" in IST, for messages. */
function istDateLabel(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${ist.getUTCDate()} ${months[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
}

export interface BookingWindowInput {
  startAt: Date | string;
  endAt: Date | string;
  now?: Date;
  /** Explicit monthly plan (counter only). */
  monthly?: boolean;
}

export function validateBookingWindow(input: BookingWindowInput): BookingWindowResult {
  const now = input.now ?? new Date();
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  const maxEndAt = bookingWindowEnd(now);
  const fail = (reason: BookingWindowReason, message: string): BookingWindowResult => ({
    ok: false,
    code: BOOKING_MAX_PERIOD_EXCEEDED,
    reason,
    maxEndAt,
    message,
  });

  if (input.monthly) {
    if (startAt.getTime() > maxEndAt.getTime()) {
      return fail(
        "PICKUP_WINDOW",
        `Pickup must be on or before ${istDateLabel(maxEndAt)} (bookings open ${MAX_BOOKING_DAYS} days ahead).`,
      );
    }
    const days = (endAt.getTime() - startAt.getTime()) / DAY_MS;
    if (days < MONTHLY_MIN_DAYS || days > MONTHLY_MAX_DAYS) {
      return fail(
        "MONTHLY_LENGTH",
        `A monthly rental must be between ${MONTHLY_MIN_DAYS} and ${MONTHLY_MAX_DAYS} days long.`,
      );
    }
    return { ok: true, maxEndAt };
  }

  if (endAt.getTime() > maxEndAt.getTime()) {
    return fail(
      "WINDOW",
      `Bookings can run up to ${MAX_BOOKING_DAYS} days from today. Choose a return on or before ${istDateLabel(maxEndAt)}.`,
    );
  }
  if (endAt.getTime() - startAt.getTime() > MAX_BOOKING_DAYS * DAY_MS) {
    return fail("DURATION", `A booking can be at most ${MAX_BOOKING_DAYS} days long.`);
  }
  return { ok: true, maxEndAt };
}

/**
 * Extension check: the new end is validated against the booking's ORIGINAL
 * start, so chained extensions cannot exceed the cap. Monthly bookings are
 * only held to MONTHLY_MAX_DAYS.
 */
export function validateExtensionWindow(input: {
  bookingStartAt: Date | string;
  newEndAt: Date | string;
  now?: Date;
  monthly?: boolean;
}): BookingWindowResult {
  const now = input.now ?? new Date();
  const startAt = new Date(input.bookingStartAt);
  const newEndAt = new Date(input.newEndAt);
  if (input.monthly) {
    const maxEndAt = new Date(startAt.getTime() + MONTHLY_MAX_DAYS * DAY_MS);
    if (newEndAt.getTime() > maxEndAt.getTime()) {
      return {
        ok: false,
        code: BOOKING_MAX_PERIOD_EXCEEDED,
        reason: "MONTHLY_LENGTH",
        maxEndAt,
        message: `A monthly rental can be at most ${MONTHLY_MAX_DAYS} days long.`,
      };
    }
    return { ok: true, maxEndAt };
  }
  const windowEnd = bookingWindowEnd(now);
  const durationEnd = new Date(startAt.getTime() + MAX_BOOKING_DAYS * DAY_MS);
  const maxEndAt = windowEnd.getTime() < durationEnd.getTime() ? windowEnd : durationEnd;
  if (newEndAt.getTime() > maxEndAt.getTime()) {
    return {
      ok: false,
      code: BOOKING_MAX_PERIOD_EXCEEDED,
      reason: windowEnd.getTime() < durationEnd.getTime() ? "WINDOW" : "DURATION",
      maxEndAt,
      message: `This booking can be extended up to ${istDateLabel(maxEndAt)} (${MAX_BOOKING_DAYS}-day limit).`,
    };
  }
  return { ok: true, maxEndAt };
}

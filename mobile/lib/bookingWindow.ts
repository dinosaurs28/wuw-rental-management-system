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

// ── Customer packages (12 hours / whole days) ────────────────────────────────
/**
 * Customers book PACKAGES only: "12 hours", or "1 day" … "15 days" (whole
 * 24-hour blocks). The return is the pickup + the package length — customers
 * never pick a free return time, so odd lengths (e.g. 6 PM → 8 AM = 14 h) can't
 * be booked. Customer booking create refuses any other length with
 * BOOKING_PACKAGE_REQUIRED (±1 minute tolerance) — except the 12-hour package
 * held to closing on the pickup day (halfDayPackageReturn, client item 6).
 *
 * Customer self-extensions add +12 h or + N × 24 h (EXTENSION_PACKAGE_REQUIRED
 * otherwise). Fleet / Branch Manager walk-ins and extensions keep any length.
 */

export const HALF_DAY_PACKAGE_HOURS = 12;
export const DAY_PACKAGE_HOURS = 24;
/** Allowed slack between a requested length and a package length. */
export const PACKAGE_TOLERANCE_MS = 60 * 1000;

export const BOOKING_PACKAGE_REQUIRED = "BOOKING_PACKAGE_REQUIRED";
export const BOOKING_PACKAGE_REQUIRED_MESSAGE =
  "Bookings are 12 hours or whole days (24 hours each). Choose 12 hours or a number of days.";
export const EXTENSION_PACKAGE_REQUIRED = "EXTENSION_PACKAGE_REQUIRED";
export const EXTENSION_PACKAGE_REQUIRED_MESSAGE =
  "Extensions are 12 hours or whole days (24 hours each). Choose +12 hours or a number of days.";

export interface CustomerPackage {
  /** "12H" for the 12-hour package, "<N>D" for N days. */
  id: string;
  hours: number;
  /** Whole days, or null for the 12-hour package. */
  days: number | null;
  /** "12 hours", "1 day", "2 days" … */
  label: string;
}

/** Package length label: 12 → "12 hours", 24 → "1 day", 72 → "3 days". */
export function packageLabel(hours: number): string {
  if (hours === HALF_DAY_PACKAGE_HOURS) return "12 hours";
  if (hours > 0 && hours % DAY_PACKAGE_HOURS === 0) {
    const days = hours / DAY_PACKAGE_HOURS;
    return days === 1 ? "1 day" : `${days} days`;
  }
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

function makePackage(hours: number): CustomerPackage {
  const days = hours === HALF_DAY_PACKAGE_HOURS ? null : hours / DAY_PACKAGE_HOURS;
  return { id: days === null ? "12H" : `${days}D`, hours, days, label: packageLabel(hours) };
}

/** Every customer package, shortest first: 12 hours, 1 day … 15 days. */
export const CUSTOMER_PACKAGES: readonly CustomerPackage[] = [
  makePackage(HALF_DAY_PACKAGE_HOURS),
  ...Array.from({ length: MAX_BOOKING_DAYS }, (_, i) => makePackage((i + 1) * DAY_PACKAGE_HOURS)),
];

/** Allowed customer booking lengths in hours: 12, 24, 48 … 360. */
export const CUSTOMER_PACKAGE_HOURS: readonly number[] = CUSTOMER_PACKAGES.map((p) => p.hours);

/** Return of a package: pickup + its length (12 h or N × 24 h). */
export function customerPackageEnd(startAt: Date | string, pkg: CustomerPackage | number): Date {
  const hours = typeof pkg === "number" ? pkg : pkg.hours;
  return new Date(new Date(startAt).getTime() + hours * HOUR_MS);
}

/**
 * The package length (hours) a span matches — 12, or N × 24 with
 * 1 ≤ N ≤ maxDays — within PACKAGE_TOLERANCE_MS; null for any other length.
 */
export function matchPackageHours(
  startAt: Date | string,
  endAt: Date | string,
  maxDays: number = MAX_BOOKING_DAYS,
): number | null {
  const span = new Date(endAt).getTime() - new Date(startAt).getTime();
  if (!Number.isFinite(span) || span <= 0) return null;
  if (Math.abs(span - HALF_DAY_PACKAGE_HOURS * HOUR_MS) <= PACKAGE_TOLERANCE_MS) {
    return HALF_DAY_PACKAGE_HOURS;
  }
  const days = Math.round(span / DAY_MS);
  if (days >= 1 && days <= maxDays && Math.abs(span - days * DAY_MS) <= PACKAGE_TOLERANCE_MS) {
    return days * DAY_PACKAGE_HOURS;
  }
  return null;
}

/** The customer package a booking window is, or null (customer create refuses it). */
export function customerPackageFor(startAt: Date | string, endAt: Date | string): CustomerPackage | null {
  const hours = matchPackageHours(startAt, endAt);
  return hours === null ? null : makePackage(hours);
}

/** Customer booking create: exactly 12 h or N × 24 h (N = 1…15), ±1 minute. */
export function isCustomerPackageDuration(startAt: Date | string, endAt: Date | string): boolean {
  return matchPackageHours(startAt, endAt) !== null;
}

/**
 * Customer self-extension: the added time (current end → new end) is +12 h or
 * + N × 24 h, ±1 minute. How far it may reach is the extension window's job
 * (validateExtensionWindow — 15 days, or 180 for a monthly booking).
 */
export function isExtensionPackageDuration(currentEndAt: Date | string, newEndAt: Date | string): boolean {
  return matchPackageHours(currentEndAt, newEndAt, Number.MAX_SAFE_INTEGER) !== null;
}

/**
 * Packages a customer can pick for a pickup, each with its return, stopping at
 * the 15-day window (return ≤ 23:59 IST on today + 15). Office hours are checked
 * separately: a 12-hour return outside them is held to closing on the pickup
 * day (halfDayPackageReturn), while whole-day packages keep the pickup's clock
 * time. Pass that held return as `halfDayEndAt` so the 12-hour package is
 * listed — and checked against the window — with the return it really has
 * (an afternoon pickup on the window's last day returns at closing, in time).
 */
export function customerPackagesForPickup(
  startAt: Date | string,
  now: Date = new Date(),
  halfDayEndAt?: Date | null,
): Array<CustomerPackage & { endAt: Date }> {
  const start = new Date(startAt);
  const windowEnd = bookingWindowEnd(now).getTime();
  return CUSTOMER_PACKAGES.map((p) => ({
    ...p,
    endAt: p.hours === HALF_DAY_PACKAGE_HOURS && halfDayEndAt ? halfDayEndAt : customerPackageEnd(start, p),
  })).filter((p) => p.endAt.getTime() <= windowEnd);
}

// ── 12 hours from a late pickup (client item 6) ─────────────────────────────
/**
 * The 12-hour package stays bookable when pickup + 12 h would fall outside
 * office hours (after closing, past midnight, before opening, a closed day):
 * its return is then held to the branch's closing time on the pickup day —
 * "12 hours · return by 10:30 PM today" — as long as that still leaves
 * HALF_DAY_CLAMP_MIN_MINUTES after pickup. It is still the 12-hour package:
 * billed at the 12-hour price with the 12-hour free km, never by the hour,
 * and the customer can pick 1 day instead. Branch hours live in the schedule
 * validators (backend, web, mobile), which pass `returnAllowed` / `closingAt`.
 */
export const HALF_DAY_CLAMP_MIN_MINUTES = 60;

export interface HalfDayReturn {
  endAt: Date;
  /** true = held to closing on the pickup day (shorter than 12 h on the clock). */
  clamped: boolean;
}

/** The 12-hour package's return for a pickup, or null when only whole days fit. */
export function halfDayPackageReturn(
  startAt: Date | string,
  hours: {
    /** Does the branch take a return at this instant (open day, opening … closing + grace)? */
    returnAllowed: (at: Date) => boolean;
    /** Closing time on the pickup day; null on a closed day or with no hours (24-hour branch). */
    closingAt: Date | null;
  },
): HalfDayReturn | null {
  const start = new Date(startAt);
  const full = customerPackageEnd(start, HALF_DAY_PACKAGE_HOURS);
  if (hours.returnAllowed(full)) return { endAt: full, clamped: false };
  const closing = hours.closingAt?.getTime();
  if (
    closing !== undefined &&
    closing < full.getTime() &&
    closing - start.getTime() >= HALF_DAY_CLAMP_MIN_MINUTES * 60 * 1000
  ) {
    return { endAt: new Date(closing), clamped: true };
  }
  return null;
}

/** Is endAt the held-to-closing 12-hour return (±1 minute)? */
export function isClampedHalfDayReturn(half: HalfDayReturn | null, endAt: Date | string): boolean {
  return !!half?.clamped && Math.abs(new Date(endAt).getTime() - half.endAt.getTime()) <= PACKAGE_TOLERANCE_MS;
}

/**
 * What a customer can add to a booking ending at currentEndAt: +12 hours,
 * +1 day, +2 days … up to maxEndAt (the extension-eligibility response's
 * maxEndAt). Office hours are checked separately.
 */
export function extensionPackageOptions(
  currentEndAt: Date | string,
  maxEndAt: Date | string,
): Array<{ hours: number; label: string; newEndAt: Date }> {
  const from = new Date(currentEndAt).getTime();
  const max = new Date(maxEndAt).getTime();
  const options: Array<{ hours: number; label: string; newEndAt: Date }> = [];
  let hours = HALF_DAY_PACKAGE_HOURS;
  while (from + hours * HOUR_MS <= max) {
    options.push({ hours, label: packageLabel(hours), newEndAt: new Date(from + hours * HOUR_MS) });
    hours = hours === HALF_DAY_PACKAGE_HOURS ? DAY_PACKAGE_HOURS : hours + DAY_PACKAGE_HOURS;
  }
  return options;
}

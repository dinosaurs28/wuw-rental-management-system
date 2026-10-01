// Limits for booking date/time pickers: branch office hours (#2) and the
// 15-day booking window (#15). Pickers hold a calendar day (local-midnight
// Date) plus an "HH:mm" wall-clock time that the server reads as IST, so all
// instants here are built as IST regardless of the browser's timezone.
import {
  MAX_BOOKING_DAYS,
  MONTHLY_MAX_DAYS,
  MONTHLY_MIN_DAYS,
  bookingWindowEnd,
  validateBookingWindow,
} from "@repo/schemas";
import type { BranchScheduleConfig } from "@/services/branch.service";
import {
  isClosedCalendarDay,
  isPickupSlotAllowed,
  isReturnSlotAllowed,
  istTodayCalendarDay,
  nextPickupDayIfClosedToday,
  noPickupSlotLeftToday,
} from "@/utils/branchScheduleValidator";

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export { MAX_BOOKING_DAYS, MONTHLY_MIN_DAYS, MONTHLY_MAX_DAYS };

const pad = (n: number) => String(n).padStart(2, "0");

/** Picked calendar day + "HH:mm" (IST wall clock) → the instant. */
export function istInstant(day: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  return new Date(
    Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), h || 0, m || 0) - IST_OFFSET_MS,
  );
}

/** Instant → the IST calendar day (local-midnight Date) and "HH:mm". */
export function istCalendarParts(instant: Date): { day: Date; time: string } {
  const d = new Date(instant.getTime() + IST_OFFSET_MS);
  return {
    day: new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

/** Calendar day + time shifted by `hours`, rolling past midnight (18:00 + 12 h → next day 06:00). */
export function addHoursToSlot(day: Date, time: string, hours: number): { day: Date; time: string } {
  return istCalendarParts(new Date(istInstant(day, time).getTime() + hours * 60 * 60 * 1000));
}

const startOfCalendarDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Last calendar day a standard booking may run to (today IST + 15). */
export function windowLastDay(now: Date = new Date()): Date {
  return istCalendarParts(bookingWindowEnd(now)).day;
}

/**
 * Latest allowed return for a pickup instant: standard → min(window end,
 * pickup + 15 days); monthly → pickup + 180 days.
 */
export function maxReturnFor(startAt: Date, opts: { monthly?: boolean; now?: Date } = {}): Date {
  if (opts.monthly) return new Date(startAt.getTime() + MONTHLY_MAX_DAYS * DAY_MS);
  const windowEnd = bookingWindowEnd(opts.now ?? new Date());
  const durationEnd = new Date(startAt.getTime() + MAX_BOOKING_DAYS * DAY_MS);
  return windowEnd.getTime() < durationEnd.getTime() ? windowEnd : durationEnd;
}

/**
 * Default-range fix-up: when the pickup is today but no pickup slot is left
 * today (closed, or the last slot before closing has gone by — e.g. 21:50 with
 * a 22:00 close), the pickup moves to the next opening and the return to
 * one day later (or stays, if it is already after the new pickup). null = no
 * change needed.
 */
export function snapPickupPastClosedToday(input: {
  schedule?: BranchScheduleConfig;
  pickupDate: Date | null;
  returnDate: Date | null;
  returnTime: string;
  now?: Date;
}): { pickupDate: Date; pickupTime: string; returnDate: Date; returnTime: string } | null {
  const { schedule, pickupDate, returnDate, returnTime } = input;
  if (!schedule || !pickupDate) return null;
  const now = input.now ?? new Date();
  if (startOfCalendarDay(pickupDate).getTime() !== istTodayCalendarDay(now).getTime()) return null;
  const next = nextPickupDayIfClosedToday(schedule, now);
  if (!next) return null;
  const keepReturn =
    !!returnDate && istInstant(returnDate, returnTime || "10:00") > istInstant(next.day, next.time);
  const fallbackReturn = new Date(next.day.getFullYear(), next.day.getMonth(), next.day.getDate() + 1);
  return {
    pickupDate: next.day,
    pickupTime: next.time,
    returnDate: keepReturn ? returnDate! : fallbackReturn,
    returnTime: keepReturn ? returnTime : next.time,
  };
}

export interface BookingPickerInput {
  schedule?: BranchScheduleConfig;
  pickupDate: Date | null;
  pickupTime: string;
  returnDate: Date | null;
  returnTime: string;
  /** Counter monthly plan: pickup within the window, 30–180 days, no 15-day rule. */
  monthly?: boolean;
  now?: Date;
}

export interface BookingPickerLimits {
  /** Calendar `disabled` matcher for the pickup date. */
  isPickupDayDisabled: (day: Date) => boolean;
  /** Calendar `disabled` matcher for the return date. */
  isReturnDayDisabled: (day: Date) => boolean;
  /** TimeSelect `isDisabled` for the pickup time (undefined = no restriction). */
  isPickupSlotDisabled?: (hour: number, minute: number) => boolean;
  /** TimeSelect `isDisabled` for the return time. */
  isReturnSlotDisabled?: (hour: number, minute: number) => boolean;
  /** Server-identical 15-day / monthly-length message when the range breaks the rule. */
  windowError: string | null;
  /** Latest allowed return instant for the current pickup (null without a pickup). */
  maxReturnAt: Date | null;
  lastPickupDay: Date;
}

export function bookingPickerLimits(input: BookingPickerInput): BookingPickerLimits {
  const now = input.now ?? new Date();
  const today = istTodayCalendarDay(now);
  const lastPickupDay = windowLastDay(now);
  const { schedule, pickupDate, returnDate, monthly } = input;

  const startAt = pickupDate ? istInstant(pickupDate, input.pickupTime || "10:00") : null;
  const maxReturnAt = startAt ? maxReturnFor(startAt, { monthly, now }) : null;
  const maxReturnDay = maxReturnAt ? istCalendarParts(maxReturnAt).day : lastPickupDay;
  // Monthly plan: the return must be at least 30 days after pickup
  const minReturnAt =
    monthly && startAt ? new Date(startAt.getTime() + MONTHLY_MIN_DAYS * DAY_MS) : null;

  // Today is out once no pickup slot is left (closed, or the last slot before
  // closing has gone by)
  const noSlotLeftToday = noPickupSlotLeftToday(schedule, now);
  const pickupIsToday = !!pickupDate && startOfCalendarDay(pickupDate).getTime() === today.getTime();
  // Slots before the current minute are in the past (getCurrentTime() rounds up, so its default stays allowed)
  const nowFloor = new Date(Math.floor(now.getTime() / 60_000) * 60_000);

  const isPickupDayDisabled = (day: Date) => {
    const d = startOfCalendarDay(day);
    if (noSlotLeftToday && d.getTime() === today.getTime()) return true;
    return d < today || d > lastPickupDay || isClosedCalendarDay(schedule, d);
  };

  const isReturnDayDisabled = (day: Date) => {
    const d = startOfCalendarDay(day);
    let earliest = pickupDate && startOfCalendarDay(pickupDate) > today ? startOfCalendarDay(pickupDate) : today;
    if (minReturnAt) earliest = istCalendarParts(minReturnAt).day;
    return d < earliest || d > maxReturnDay || isClosedCalendarDay(schedule, d);
  };

  // Office hours, and for a pickup today no time that has already passed
  const isPickupSlotDisabled =
    pickupDate && (schedule || pickupIsToday)
      ? (hour: number, minute: number) => {
          if (!isPickupSlotAllowed(schedule, pickupDate, hour * 60 + minute)) return true;
          return pickupIsToday && istInstant(pickupDate, `${pad(hour)}:${pad(minute)}`) < nowFloor;
        }
      : undefined;

  const isReturnSlotDisabled =
    returnDate && (schedule || maxReturnAt)
      ? (hour: number, minute: number) => {
          if (!isReturnSlotAllowed(schedule, returnDate, hour * 60 + minute)) return true;
          const at = istInstant(returnDate, `${pad(hour)}:${pad(minute)}`);
          if (maxReturnAt && at > maxReturnAt) return true;
          if (minReturnAt && at < minReturnAt) return true;
          return false;
        }
      : undefined;

  let windowError: string | null = null;
  if (startAt && returnDate) {
    const endAt = istInstant(returnDate, input.returnTime || "10:00");
    if (endAt > startAt) {
      const res = validateBookingWindow({ startAt, endAt, now, monthly });
      if (!res.ok) windowError = res.message;
    }
  }

  return {
    isPickupDayDisabled,
    isReturnDayDisabled,
    isPickupSlotDisabled,
    isReturnSlotDisabled,
    windowError,
    maxReturnAt,
    lastPickupDay,
  };
}

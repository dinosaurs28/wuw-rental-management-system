// Client-side mirror of apps/backend/src/utils/booking/branchScheduleValidator.ts
// Keep both files in sync (and mobile/lib/branchSchedule.ts). All times are
// branch-local (IST for v1).

import type { BranchScheduleConfig, BranchScheduleRow } from "@/services/branch.service";
import { halfDayPackageReturn, isClampedHalfDayReturn, type HalfDayReturn } from "@repo/schemas";

/**
 * Hours a branch keeps on any day it has no saved row for — including every
 * day when it has saved no hours at all — unless it is open 24 hours.
 */
export const DEFAULT_BRANCH_HOURS = { openTime: "08:00", closeTime: "23:00" } as const;

/** A booking's pickup time must be at least this long before closing (last pickup 10:30 PM on default hours). */
export const PICKUP_CUTOFF_MINUTES = 30;

export type ScheduleVerdictStatus =
  | "OK"
  | "PICKUP_CLOSED_DAY"
  | "PICKUP_BEFORE_OPEN"
  | "PICKUP_AT_OR_AFTER_CLOSE"
  | "RETURN_GRACE"
  | "RETURN_BUMPED"
  | "NO_OPEN_DAY_IN_WINDOW"
  /** Extensions only (validateReturnTime): the new end is outside the return window. */
  | "RETURN_OUTSIDE_HOURS";

/** Why a return was moved (RETURN_BUMPED) or refused (RETURN_OUTSIDE_HOURS). */
export type ReturnScheduleReason = "CLOSED_DAY" | "AFTER_CLOSE" | "BEFORE_OPEN";

export interface ScheduleVerdict {
  status: ScheduleVerdictStatus;
  closingTime?: string;
  gracePeriodEnd?: string;
  /** Adjusted return when RETURN_BUMPED — never earlier than the requested return. */
  adjustedReturn?: Date;
  /** Weekday + the ACTUAL adjusted time, e.g. "Tuesday 6:00 PM". */
  nextOpenLabel?: string;
  openingTime?: string;
  closedDayName?: string;
  reason?: ReturnScheduleReason;
  /** Latest pickup that day (closing − PICKUP_CUTOFF_MINUTES) — set on PICKUP_AT_OR_AFTER_CLOSE. */
  lastPickupTime?: string;
}

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToDisplay(mins: number): string {
  const normalised = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(normalised / 60);
  const m = normalised % 60;
  const period = h < 12 ? "AM" : "PM";
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayH}:${String(m).padStart(2, "0")} ${period}`;
}

/** Format "HH:mm" (24-hr) to display like "9:00 AM". */
export function formatScheduleTime(hhmm: string): string {
  return minutesToDisplay(timeToMinutes(hhmm));
}

/**
 * The hours in force on one weekday (ignores is24Hours): the saved row, else
 * the server's filled-in row (`effectiveSchedules` on the schedule endpoints
 * and extension officeHours), else DEFAULT_BRANCH_HOURS.
 */
export function scheduleRowForDay(config: BranchScheduleConfig, dayOfWeek: number): BranchScheduleRow {
  return (
    config.schedules.find((s) => s.dayOfWeek === dayOfWeek) ??
    config.effectiveSchedules?.find((s) => s.dayOfWeek === dayOfWeek) ?? {
      dayOfWeek,
      isOpen: true,
      openTime: DEFAULT_BRANCH_HOURS.openTime,
      closeTime: DEFAULT_BRANCH_HOURS.closeTime,
    }
  );
}

/** All seven days (Sunday first) with the hours in force — for hours lists and editors. */
export function effectiveScheduleRows(config: BranchScheduleConfig): BranchScheduleRow[] {
  return DAY_NAMES.map((_, dayOfWeek) => scheduleRowForDay(config, dayOfWeek));
}

/** True when the branch has saved no hours, so DEFAULT_BRANCH_HOURS apply every day. */
export function usesDefaultHours(config: BranchScheduleConfig): boolean {
  return !config.is24Hours && config.schedules.length === 0;
}

/** Minutes before closing that the last pickup falls (the server's value when it sends one). */
export function pickupCutoffMinutes(config: BranchScheduleConfig | undefined): number {
  const sent = config?.pickupCutoffMinutes;
  return typeof sent === "number" && Number.isFinite(sent) && sent >= 0 ? sent : PICKUP_CUTOFF_MINUTES;
}

function getScheduleForDay(
  config: BranchScheduleConfig,
  dayOfWeek: number,
) {
  const row = scheduleRowForDay(config, dayOfWeek);
  return {
    isOpen: row.isOpen,
    openMinutes: timeToMinutes(row.openTime),
    closeMinutes: timeToMinutes(row.closeTime),
    openTime: row.openTime,
    closeTime: row.closeTime,
  };
}

/** Get hours, minutes, and dayOfWeek formatted in branch timezone (Asia/Kolkata). */
export function getBranchLocalTime(date: Date): { hours: number; minutes: number; dayOfWeek: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'long'
  });
  const parts = formatter.formatToParts(date);
  let hour = 0;
  let minute = 0;
  let weekdayLong = 'Sunday';
  for (const part of parts) {
    if (part.type === 'hour') hour = parseInt(part.value, 10) % 24;
    else if (part.type === 'minute') minute = parseInt(part.value, 10);
    else if (part.type === 'weekday') weekdayLong = part.value;
  }
  const dayOfWeek = DAY_NAMES.indexOf(weekdayLong as any);
  return { hours: hour, minutes: minute, dayOfWeek: dayOfWeek >= 0 ? dayOfWeek : 0 };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Tuesday 6:00 PM" — weekday and time-of-day of `date` in branch-local time. */
function formatDayTime(date: Date): string {
  const { dayOfWeek, hours, minutes } = getBranchLocalTime(date);
  return `${DAY_NAMES[dayOfWeek] ?? ""} ${minutesToDisplay(hours * 60 + minutes)}`;
}

/**
 * Adjusted return for an out-of-hours return: the first pickup + k × 24 h that
 * is at or after the requested return AND falls inside the return window
 * [open, close + grace] of an open day. Starting at k = ceil(span / 24 h) means
 * a booking is only ever lengthened, never shortened.
 */
function findBumpTarget(
  config: BranchScheduleConfig,
  pickupLocal: Date,
  returnLocal: Date,
  maxDays = 7,
): Date | null {
  const { hours: pHours, minutes: pMinutes } = getBranchLocalTime(pickupLocal);
  const pickupMins = pHours * 60 + pMinutes;
  const span = returnLocal.getTime() - pickupLocal.getTime();
  const firstK = Math.max(1, Math.ceil(span / DAY_MS));

  for (let k = firstK; k <= firstK + maxDays; k++) {
    const candidate = new Date(pickupLocal.getTime() + k * DAY_MS);
    const { dayOfWeek: dow } = getBranchLocalTime(candidate);
    const day = getScheduleForDay(config, dow);
    if (
      day.isOpen &&
      pickupMins >= day.openMinutes &&
      pickupMins <= day.closeMinutes + config.graceMinutes
    ) {
      return candidate;
    }
  }
  return null;
}

function bumpVerdict(
  config: BranchScheduleConfig,
  pickupLocal: Date,
  returnLocal: Date,
  extra: Pick<ScheduleVerdict, "reason" | "closingTime" | "openingTime" | "closedDayName">,
): ScheduleVerdict {
  const bumpTarget = findBumpTarget(config, pickupLocal, returnLocal);
  if (!bumpTarget) return { status: "NO_OPEN_DAY_IN_WINDOW" };
  return {
    status: "RETURN_BUMPED",
    adjustedReturn: bumpTarget,
    nextOpenLabel: formatDayTime(bumpTarget),
    ...extra,
  };
}

/**
 * Opening window of one branch-local day (the instant's IST day).
 * null = no restriction (24-hour branch). Pickups run to lastPickupMin.
 */
export function getDayWindow(
  config: BranchScheduleConfig,
  date: Date,
): { isOpen: boolean; openMin: number; closeMin: number; lastPickupMin: number; graceEndMin: number } | null {
  if (config.is24Hours) return null;
  const { dayOfWeek } = getBranchLocalTime(date);
  const day = getScheduleForDay(config, dayOfWeek);
  return {
    isOpen: day.isOpen,
    openMin: day.openMinutes,
    closeMin: day.closeMinutes,
    lastPickupMin: day.closeMinutes - pickupCutoffMinutes(config),
    graceEndMin: day.closeMinutes + config.graceMinutes,
  };
}

export function validateBookingSchedule(
  config: BranchScheduleConfig,
  pickupLocal: Date,
  returnLocal: Date,
): ScheduleVerdict {
  if (config.is24Hours) return { status: "OK" };

  // Pickup checks
  const { dayOfWeek: pickupDow, hours: pickupHours, minutes: pickupMinsVal } = getBranchLocalTime(pickupLocal);
  const pickupDay = getScheduleForDay(config, pickupDow);

  if (!pickupDay.isOpen) {
    return { status: "PICKUP_CLOSED_DAY", closedDayName: DAY_NAMES[pickupDow] };
  }

  const pickupMins = pickupHours * 60 + pickupMinsVal;

  if (pickupMins < pickupDay.openMinutes) {
    return { status: "PICKUP_BEFORE_OPEN", openingTime: minutesToDisplay(pickupDay.openMinutes) };
  }

  // Last pickup is PICKUP_CUTOFF_MINUTES before closing (status name kept for old clients)
  const lastPickupMins = pickupDay.closeMinutes - pickupCutoffMinutes(config);
  if (pickupMins > lastPickupMins) {
    return {
      status: "PICKUP_AT_OR_AFTER_CLOSE",
      closingTime: minutesToDisplay(pickupDay.closeMinutes),
      lastPickupTime: minutesToDisplay(lastPickupMins),
    };
  }

  // Return checks
  const { dayOfWeek: returnDow, hours: returnHours, minutes: returnMinsVal } = getBranchLocalTime(returnLocal);
  const returnDay = getScheduleForDay(config, returnDow);

  if (!returnDay.isOpen) {
    return bumpVerdict(config, pickupLocal, returnLocal, {
      reason: "CLOSED_DAY",
      closedDayName: DAY_NAMES[returnDow],
    });
  }

  const returnMins = returnHours * 60 + returnMinsVal;
  const closeMins = returnDay.closeMinutes;
  const graceEndMins = closeMins + config.graceMinutes;

  // Return before opening (e.g. an overnight 12 h trip) is treated like one after closing
  if (returnMins < returnDay.openMinutes) {
    return bumpVerdict(config, pickupLocal, returnLocal, {
      reason: "BEFORE_OPEN",
      openingTime: minutesToDisplay(returnDay.openMinutes),
    });
  }

  if (returnMins <= closeMins) return { status: "OK" };

  if (returnMins <= graceEndMins) {
    return {
      status: "RETURN_GRACE",
      closingTime: minutesToDisplay(closeMins),
      gracePeriodEnd: minutesToDisplay(graceEndMins),
    };
  }

  // Outside grace — bump to the next in-hours pickup + k × 24 h
  return bumpVerdict(config, pickupLocal, returnLocal, {
    reason: "AFTER_CLOSE",
    closingTime: minutesToDisplay(closeMins),
  });
}

/**
 * Extension check: is `returnLocal` inside the branch's return window — an open
 * day, at or after opening and no later than closing + grace? No adjustment.
 */
export function validateReturnTime(config: BranchScheduleConfig, returnLocal: Date): ScheduleVerdict {
  if (config.is24Hours) return { status: "OK" };
  const { dayOfWeek, hours, minutes } = getBranchLocalTime(returnLocal);
  const day = getScheduleForDay(config, dayOfWeek);

  if (!day.isOpen) {
    return { status: "RETURN_OUTSIDE_HOURS", reason: "CLOSED_DAY", closedDayName: DAY_NAMES[dayOfWeek] };
  }
  const returnMins = hours * 60 + minutes;
  const graceEndMins = day.closeMinutes + config.graceMinutes;
  if (returnMins < day.openMinutes) {
    return {
      status: "RETURN_OUTSIDE_HOURS",
      reason: "BEFORE_OPEN",
      openingTime: minutesToDisplay(day.openMinutes),
      closingTime: minutesToDisplay(day.closeMinutes),
    };
  }
  if (returnMins > graceEndMins) {
    return {
      status: "RETURN_OUTSIDE_HOURS",
      reason: "AFTER_CLOSE",
      openingTime: minutesToDisplay(day.openMinutes),
      closingTime: minutesToDisplay(day.closeMinutes),
      gracePeriodEnd: minutesToDisplay(graceEndMins),
    };
  }
  if (returnMins > day.closeMinutes) {
    return {
      status: "RETURN_GRACE",
      closingTime: minutesToDisplay(day.closeMinutes),
      gracePeriodEnd: minutesToDisplay(graceEndMins),
    };
  }
  return { status: "OK" };
}

// ── 12 hours from a late pickup (client item 6) ─────────────────────────────

/** Closing time on the branch-local day of `at`; null on a closed day or for a 24-hour branch. */
function closingOnDayOf(config: BranchScheduleConfig, at: Date): Date | null {
  if (config.is24Hours) return null;
  const { dayOfWeek, hours, minutes } = getBranchLocalTime(at);
  const day = getScheduleForDay(config, dayOfWeek);
  if (!day.isOpen) return null;
  const minuteStart = Math.floor(at.getTime() / 60_000) * 60_000;
  return new Date(minuteStart + (day.closeMinutes - (hours * 60 + minutes)) * 60_000);
}

/**
 * The 12-hour package's return for a pickup at this branch: pickup + 12 h, or —
 * when the branch won't take a return then — its closing time on the pickup
 * day (clamped). null = only whole-day packages fit this pickup.
 */
export function halfDayReturnFor(config: BranchScheduleConfig, pickupLocal: Date): HalfDayReturn | null {
  return halfDayPackageReturn(pickupLocal, {
    returnAllowed: (at) => validateReturnTime(config, at).status !== "RETURN_OUTSIDE_HOURS",
    closingAt: closingOnDayOf(config, pickupLocal),
  });
}

/** Is pickup → return the 12-hour package held to closing on the pickup day? */
export function isClampedHalfDay(config: BranchScheduleConfig, pickupLocal: Date, returnLocal: Date): boolean {
  return isClampedHalfDayReturn(halfDayReturnFor(config, pickupLocal), returnLocal);
}

export function buildScheduleUserMessage(verdict: ScheduleVerdict): string {
  switch (verdict.status) {
    case "PICKUP_CLOSED_DAY":
      return `Branch is closed on ${verdict.closedDayName ?? "that day"}. Please select a different pickup date.`;
    case "PICKUP_BEFORE_OPEN":
      return `Branch opens at ${verdict.openingTime}. Please select a later pickup time.`;
    case "PICKUP_AT_OR_AFTER_CLOSE":
      // Verdicts from an older server carry only the closing time
      return verdict.lastPickupTime
        ? `Last pickup is ${verdict.lastPickupTime} (${PICKUP_CUTOFF_MINUTES} minutes before closing). Please select an earlier pickup time.`
        : `Pickup cannot be at or after closing time (${verdict.closingTime}). Please select an earlier time.`;
    case "NO_OPEN_DAY_IN_WINDOW":
      return "No return window available in the next 7 days. Please contact the branch.";
    case "RETURN_OUTSIDE_HOURS":
      if (verdict.reason === "CLOSED_DAY") {
        return `Branch is closed on ${verdict.closedDayName ?? "that day"}. Please choose a return on a day the branch is open.`;
      }
      if (verdict.reason === "BEFORE_OPEN") {
        return `Branch opens at ${verdict.openingTime ?? "opening time"} that day. Please choose a later return time.`;
      }
      return `Branch closes at ${verdict.closingTime ?? "closing time"} that day${
        verdict.gracePeriodEnd && verdict.gracePeriodEnd !== verdict.closingTime
          ? ` (returns accepted until ${verdict.gracePeriodEnd})`
          : ""
      }. Please choose an earlier return time.`;
    case "RETURN_BUMPED":
      return `Return time adjusted to ${verdict.nextOpenLabel ?? "the next available time"} due to branch operating hours.`;
    default:
      return "Selected times conflict with branch operating hours.";
  }
}

// ── Picker helpers ────────────────────────────────────────────────────────────
// Pickers work with a calendar day (a local-midnight Date) plus an "HH:mm"
// wall-clock time, which the server reads as IST. These helpers use the
// calendar day's weekday directly, so they agree with the server whatever the
// browser's timezone.

/**
 * Opening window of a picked calendar day; null = no restriction (a 24-hour
 * branch, or hours not loaded yet). A day without a saved row keeps
 * DEFAULT_BRANCH_HOURS. Pickups run from openMin to lastPickupMin.
 */
export function calendarDayWindow(
  config: BranchScheduleConfig | undefined,
  day: Date,
): { isOpen: boolean; openMin: number; closeMin: number; lastPickupMin: number; graceEndMin: number } | null {
  if (!config || config.is24Hours) return null;
  const row = scheduleRowForDay(config, day.getDay());
  const openMin = timeToMinutes(row.openTime);
  const closeMin = timeToMinutes(row.closeTime);
  return {
    isOpen: row.isOpen,
    openMin,
    closeMin,
    lastPickupMin: closeMin - pickupCutoffMinutes(config),
    graceEndMin: closeMin + config.graceMinutes,
  };
}

/** True when the branch is closed all day on this calendar day. */
export function isClosedCalendarDay(config: BranchScheduleConfig | undefined, day: Date): boolean {
  const w = calendarDayWindow(config, day);
  return !!w && !w.isOpen;
}

/** Pickup allowed at `minutes` past midnight: open day, open ≤ t ≤ close − PICKUP_CUTOFF_MINUTES. */
export function isPickupSlotAllowed(
  config: BranchScheduleConfig | undefined,
  day: Date,
  minutes: number,
): boolean {
  const w = calendarDayWindow(config, day);
  if (!w) return true;
  return w.isOpen && minutes >= w.openMin && minutes <= w.lastPickupMin;
}

/** Return allowed at `minutes` past midnight: open day, open ≤ t ≤ close + grace. */
export function isReturnSlotAllowed(
  config: BranchScheduleConfig | undefined,
  day: Date,
  minutes: number,
): boolean {
  const w = calendarDayWindow(config, day);
  if (!w) return true;
  return w.isOpen && minutes >= w.openMin && minutes <= w.graceEndMin;
}

/** Today's calendar date in IST, as a local-midnight Date (what the pickers use). */
export function istTodayCalendarDay(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return new Date(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
}

/**
 * When the branch is closed for the rest of `day` (a closed day, or `day` is
 * today and closing time has passed — with `pickup`, once the last pickup
 * time has passed): "Tuesday 9:00 AM" / "tomorrow 9:00 AM", the next time it
 * opens. null when it is open (or opens later) that day, or when nothing
 * opens in the next week.
 */
export function nextOpeningAfterClosedDay(
  config: BranchScheduleConfig | undefined,
  day: Date,
  now: Date = new Date(),
  opts: { pickup?: boolean } = {},
): string | null {
  const w = calendarDayWindow(config, day);
  if (!w) return null;
  const today = istTodayCalendarDay(now);
  const isToday = day.getTime() === today.getTime();
  const { hours, minutes } = getBranchLocalTime(now);
  const nowMin = hours * 60 + minutes;
  const closedForRestOfDay =
    !w.isOpen || (isToday && (opts.pickup ? nowMin > w.lastPickupMin : nowMin >= w.closeMin));
  if (!closedForRestOfDay) return null;

  for (let i = 1; i <= 7; i++) {
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + i);
    const nw = calendarDayWindow(config, next);
    if (!nw) return `${i === 1 && isToday ? "tomorrow" : DAY_NAMES[next.getDay()]} (open 24 hours)`;
    if (nw.isOpen) {
      const dayLabel = i === 1 && isToday ? "tomorrow" : DAY_NAMES[next.getDay()];
      return `${dayLabel} ${minutesToDisplay(nw.openMin)}`;
    }
  }
  return null;
}

/** IST minutes past midnight of `now`, rounded up to the pickers' 15-minute steps (may be 1440). */
function firstQuarterFromNow(now: Date): number {
  const { hours, minutes } = getBranchLocalTime(now);
  return Math.ceil((hours * 60 + minutes) / 15) * 15;
}

/**
 * True when today (IST) has no 15-minute pickup slot left: the branch is
 * closed today, or every slot from now on is after the last pickup time
 * (closing − PICKUP_CUTOFF_MINUTES; for an unrestricted branch: past the last
 * slot of the day).
 */
export function noPickupSlotLeftToday(
  config: BranchScheduleConfig | undefined,
  now: Date = new Date(),
): boolean {
  const first = firstQuarterFromNow(now);
  const w = calendarDayWindow(config, istTodayCalendarDay(now));
  if (!w) return first >= 1440;
  if (!w.isOpen) return true;
  return Math.max(first, Math.ceil(w.openMin / 15) * 15) > w.lastPickupMin;
}

/**
 * When today has no pickup slot left (closed day, or the last pickup time
 * has gone by), the first pickup slot on the next open day: its calendar day
 * and the opening time rounded up to the pickers' 15-minute steps. null when
 * today still has a pickup slot, or nothing opens within a week.
 */
export function nextPickupDayIfClosedToday(
  config: BranchScheduleConfig | undefined,
  now: Date = new Date(),
): { day: Date; time: string } | null {
  const today = istTodayCalendarDay(now);
  if (!noPickupSlotLeftToday(config, now)) return null;
  for (let i = 1; i <= 7; i++) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const w = calendarDayWindow(config, day);
    // Unrestricted branch late at night: the next slot is midnight
    if (!w) return { day, time: "00:00" };
    if (!w.isOpen) continue;
    const start = Math.ceil(w.openMin / 15) * 15;
    if (start > w.lastPickupMin) continue;
    return { day, time: `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}` };
  }
  return null;
}

/**
 * Row check for the weekly-hours editors (BM + admin). Overnight hours are not
 * supported: an open day must close after it opens. Mirrors the server's
 * validateScheduleRows message.
 */
export function scheduleRowError(row: BranchScheduleRow): string | null {
  if (!row.isOpen) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.openTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.closeTime)) {
    return "Enter both times (HH:mm)";
  }
  if (timeToMinutes(row.closeTime) <= timeToMinutes(row.openTime)) {
    return "Closing time must be after opening time (use 23:59 for midnight, or switch the branch to open 24 hours)";
  }
  return null;
}

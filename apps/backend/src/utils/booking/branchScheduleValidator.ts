// Branch operating-hours validation utility.
// Used by both booking controllers, extension evaluate and the public schedule API.
// Day and time-of-day are read in branch-local time (IST for v1) via Intl, so
// any Date instant can be passed in.
// Keep in sync with apps/frontend/src/utils/branchScheduleValidator.ts and
// mobile/lib/branchSchedule.ts (same rules, same verdicts).
import { prisma } from "@repo/database/client";

export interface BranchScheduleRow {
  dayOfWeek: number; // 0 = Sunday … 6 = Saturday
  isOpen: boolean;
  openTime: string;  // "HH:mm" 24-hr
  closeTime: string; // "HH:mm" 24-hr
}

export interface BranchScheduleConfig {
  schedules: BranchScheduleRow[];
  graceMinutes: number;
  is24Hours: boolean;
}

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
  /** Effective closing time display string (e.g. "10:00 PM") — set on RETURN_GRACE / RETURN_BUMPED / RETURN_OUTSIDE_HOURS */
  closingTime?: string;
  /** Grace window end as display string — set on RETURN_GRACE / RETURN_OUTSIDE_HOURS */
  gracePeriodEnd?: string;
  /** Adjusted return date when status is RETURN_BUMPED — never earlier than the requested return */
  adjustedReturn?: Date;
  /** Weekday + the ACTUAL adjusted time, e.g. "Tuesday 6:00 PM" — set on RETURN_BUMPED */
  nextOpenLabel?: string;
  /** Branch opening time for display on pickup errors / before-open returns */
  openingTime?: string;
  /** Name of the closed day for display — set on PICKUP_CLOSED_DAY / RETURN_BUMPED / RETURN_OUTSIDE_HOURS (closed day) */
  closedDayName?: string;
  /** Why the return was moved or refused — set on RETURN_BUMPED / RETURN_OUTSIDE_HOURS */
  reason?: ReturnScheduleReason;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Convert "HH:mm" to total minutes since midnight. */
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Convert total minutes since midnight to display string e.g. "10:00 PM". */
export function minutesToDisplay(mins: number): string {
  const normalised = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(normalised / 60);
  const m = normalised % 60;
  const period = h < 12 ? "AM" : "PM";
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayH}:${String(m).padStart(2, "0")} ${period}`;
}

function getScheduleForDay(
  config: BranchScheduleConfig,
  dayOfWeek: number,
): { isOpen: boolean; openMinutes: number; closeMinutes: number; openTime: string; closeTime: string } {
  // No schedule rows → treat branch as 24/7 (RISK-001 guard)
  if (config.schedules.length === 0) {
    return { isOpen: true, openMinutes: 0, closeMinutes: 1440, openTime: "00:00", closeTime: "24:00" };
  }
  const row = config.schedules.find((s) => s.dayOfWeek === dayOfWeek);
  if (!row) {
    // Missing day row → treat as open 24hr for that day
    return { isOpen: true, openMinutes: 0, closeMinutes: 1440, openTime: "00:00", closeTime: "24:00" };
  }
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
  const dayOfWeek = DAY_NAMES.indexOf(weekdayLong);
  return { hours: hour, minutes: minute, dayOfWeek: dayOfWeek >= 0 ? dayOfWeek : 0 };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Adjusted return for an out-of-hours return: the first pickup + k × 24 h that
 * is at or after the requested return AND falls inside the return window
 * [open, close + grace] of an open day. Starting at k = ceil(span / 24 h) means
 * a booking is only ever lengthened (rounded up to whole 24 h blocks), never
 * shortened. Tries up to `maxDays` further days; null when none is open.
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
    // That day is closed or the time is outside its hours — try the next day
  }
  return null;
}

/** "Tuesday 6:00 PM" — weekday and time-of-day of `date` in branch-local time. */
function formatDayTime(date: Date): string {
  const { dayOfWeek, hours, minutes } = getBranchLocalTime(date);
  return `${DAY_NAMES[dayOfWeek] ?? ""} ${minutesToDisplay(hours * 60 + minutes)}`;
}

function bumpVerdict(
  config: BranchScheduleConfig,
  pickupLocal: Date,
  returnLocal: Date,
  extra: Pick<ScheduleVerdict, "reason" | "closingTime" | "openingTime" | "closedDayName">,
): ScheduleVerdict {
  const bumpTarget = findBumpTarget(config, pickupLocal, returnLocal);
  if (!bumpTarget) {
    return { status: "NO_OPEN_DAY_IN_WINDOW" };
  }
  return {
    status: "RETURN_BUMPED",
    adjustedReturn: bumpTarget,
    nextOpenLabel: formatDayTime(bumpTarget),
    ...extra,
  };
}

/**
 * Opening window of one branch-local day, for pickers and checks.
 * null = no restriction that day (24-hour branch, or no hours configured).
 * Minutes are since local midnight; returns are allowed up to graceEndMin.
 */
export function getDayWindow(
  config: BranchScheduleConfig,
  date: Date,
): { isOpen: boolean; openMin: number; closeMin: number; graceEndMin: number } | null {
  if (config.is24Hours || config.schedules.length === 0) return null;
  const { dayOfWeek } = getBranchLocalTime(date);
  const day = getScheduleForDay(config, dayOfWeek);
  return {
    isOpen: day.isOpen,
    openMin: day.openMinutes,
    closeMin: day.closeMinutes,
    graceEndMin: day.closeMinutes + config.graceMinutes,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validate pickup and return times against branch operating schedule.
 *
 * Both `pickupLocal` and `returnLocal` must be in branch-local time (IST for v1).
 *
 * Returns a ScheduleVerdict describing what action (if any) is needed.
 * Callers must write verdict.adjustedReturn back to the booking when status is RETURN_BUMPED.
 */
export function validateBookingSchedule(
  config: BranchScheduleConfig,
  pickupLocal: Date,
  returnLocal: Date,
): ScheduleVerdict {
  // 24/7 branch — no restrictions
  if (config.is24Hours || config.schedules.length === 0) {
    return { status: "OK" };
  }

  // ── Pickup checks ────────────────────────────────────────────────────────
  const { dayOfWeek: pickupDow, hours: pickupHours, minutes: pickupMinsVal } = getBranchLocalTime(pickupLocal);
  const pickupDay = getScheduleForDay(config, pickupDow);

  if (!pickupDay.isOpen) {
    return {
      status: "PICKUP_CLOSED_DAY",
      closedDayName: DAY_NAMES[pickupDow],
    };
  }

  const pickupMins = pickupHours * 60 + pickupMinsVal;

  if (pickupMins < pickupDay.openMinutes) {
    return {
      status: "PICKUP_BEFORE_OPEN",
      openingTime: minutesToDisplay(pickupDay.openMinutes),
    };
  }

  if (pickupMins >= pickupDay.closeMinutes) {
    return {
      status: "PICKUP_AT_OR_AFTER_CLOSE",
      closingTime: minutesToDisplay(pickupDay.closeMinutes),
    };
  }

  // ── Return checks ────────────────────────────────────────────────────────
  const { dayOfWeek: returnDow, hours: returnHours, minutes: returnMinsVal } = getBranchLocalTime(returnLocal);
  const returnDay = getScheduleForDay(config, returnDow);

  // Return on a closed day → bump
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

  if (returnMins <= closeMins) {
    return { status: "OK" };
  }

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
 * day, at or after opening and no later than closing + grace? No adjustment is
 * offered (staff and customers pick the new end explicitly).
 * Returns OK / RETURN_GRACE, or RETURN_OUTSIDE_HOURS with a reason.
 */
export function validateReturnTime(config: BranchScheduleConfig, returnLocal: Date): ScheduleVerdict {
  if (config.is24Hours || config.schedules.length === 0) {
    return { status: "OK" };
  }
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

/** Load a branch's hours as a validator config (null when the branch doesn't exist). */
export async function loadBranchScheduleConfig(branchId: number): Promise<BranchScheduleConfig | null> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      graceMinutes: true,
      is24Hours: true,
      schedules: { select: { dayOfWeek: true, isOpen: true, openTime: true, closeTime: true } },
    },
  });
  if (!branch) return null;
  return { schedules: branch.schedules, graceMinutes: branch.graceMinutes, is24Hours: branch.is24Hours };
}

/**
 * Extension end outside office hours. Controllers answer
 * 400 { code: 'BRANCH_SCHEDULE_VIOLATION', message, verdict }.
 */
export class BranchScheduleError extends Error {
  readonly code = "BRANCH_SCHEDULE_VIOLATION" as const;
  readonly status = 400;

  constructor(public readonly verdict: ScheduleVerdict) {
    super(buildScheduleErrorMessage(verdict));
    this.name = "BranchScheduleError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message, verdict: this.verdict };
  }
}

/** Valid "HH:mm" (00:00–23:59). */
export const SCHEDULE_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validates a weekly-hours payload (BM and admin upserts). Returns an error
 * message, or null when every row is valid. Overnight hours are not supported:
 * an open day must close after it opens (use 23:59 for midnight, or the
 * 24-hour switch).
 */
export function validateScheduleRows(rows: unknown): string | null {
  if (!Array.isArray(rows) || rows.length === 0) return "At least one day is required";
  if (rows.length > 7) return "At most 7 days can be sent";
  const seen = new Set<number>();
  for (const raw of rows) {
    const s = raw as Partial<BranchScheduleRow> | null;
    if (!s || typeof s !== "object") return "Each day must be an object";
    if (!Number.isInteger(s.dayOfWeek) || s.dayOfWeek! < 0 || s.dayOfWeek! > 6) {
      return `Invalid dayOfWeek: ${String(s.dayOfWeek)}`;
    }
    if (seen.has(s.dayOfWeek!)) return `${DAY_NAMES[s.dayOfWeek!]} is listed more than once`;
    seen.add(s.dayOfWeek!);
    if (typeof s.isOpen !== "boolean") return `isOpen must be true or false for ${DAY_NAMES[s.dayOfWeek!]}`;
    if (typeof s.openTime !== "string" || typeof s.closeTime !== "string" ||
        !SCHEDULE_TIME_RE.test(s.openTime) || !SCHEDULE_TIME_RE.test(s.closeTime)) {
      return `Invalid time format for ${DAY_NAMES[s.dayOfWeek!]} — use HH:mm`;
    }
    if (s.isOpen && timeToMinutes(s.closeTime) <= timeToMinutes(s.openTime)) {
      return `${DAY_NAMES[s.dayOfWeek!]}: closing time must be after opening time (use 23:59 for midnight, or switch the branch to open 24 hours)`;
    }
  }
  return null;
}

/** User-facing error message for each blocking verdict status. */
export function buildScheduleErrorMessage(verdict: ScheduleVerdict): string {
  switch (verdict.status) {
    case "PICKUP_CLOSED_DAY":
      return `Branch is closed on ${verdict.closedDayName ?? "that day"}. Please select a different pickup date.`;
    case "PICKUP_BEFORE_OPEN":
      return `Branch opens at ${verdict.openingTime ?? "opening time"}. Please select a later pickup time.`;
    case "PICKUP_AT_OR_AFTER_CLOSE":
      return `Pickup cannot be at or after closing time (${verdict.closingTime ?? "closing time"}). Please select an earlier time.`;
    case "NO_OPEN_DAY_IN_WINDOW":
      return "No available return window in the next 7 days. Please contact the branch directly.";
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

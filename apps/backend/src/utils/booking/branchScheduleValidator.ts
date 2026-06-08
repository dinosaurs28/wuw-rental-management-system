// Branch operating-hours validation utility.
// Used by both booking controllers (pre-check + TX) and the public schedule API.
// All times are in branch-local time (IST for v1). Dates passed in must already
// be converted to local time before calling validateBookingSchedule.

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
  | "NO_OPEN_DAY_IN_WINDOW";

export interface ScheduleVerdict {
  status: ScheduleVerdictStatus;
  /** Effective closing time string (HH:mm) for display — set on RETURN_GRACE / RETURN_BUMPED */
  closingTime?: string;
  /** Grace window end as display string (HH:mm) — set on RETURN_GRACE */
  gracePeriodEnd?: string;
  /** Adjusted return date when status is RETURN_BUMPED */
  adjustedReturn?: Date;
  /** Human-readable next-open label e.g. "Monday 9:00 AM" — set on RETURN_BUMPED */
  nextOpenLabel?: string;
  /** Branch opening time for display on pickup errors */
  openingTime?: string;
  /** Name of the closed day for display — set on PICKUP_CLOSED_DAY / RETURN_BUMPED (closed day reason) */
  closedDayName?: string;
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

/**
 * Find the first valid bump target starting from pickupLocal + 24 hr.
 * A valid target is a day that is open AND the pickupLocal time-of-day falls
 * within [openMinutes, closeMinutes).
 * Returns null if no open day is found within maxDays.
 */
function findBumpTarget(
  config: BranchScheduleConfig,
  pickupLocal: Date,
  maxDays = 7,
): Date | null {
  const pickupMins = pickupLocal.getHours() * 60 + pickupLocal.getMinutes();
  let candidate = new Date(pickupLocal.getTime() + 24 * 60 * 60 * 1000);

  for (let i = 0; i < maxDays; i++) {
    const dow = candidate.getDay();
    const day = getScheduleForDay(config, dow);

    if (day.isOpen && pickupMins >= day.openMinutes && pickupMins < day.closeMinutes) {
      return candidate;
    }
    // That day is closed or pickup time outside hours — try next day
    candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  }
  return null;
}

function formatDayTime(date: Date, openTime: string): string {
  const dayName = DAY_NAMES[date.getDay()] ?? "";
  const [h, m] = openTime.split(":").map(Number);
  const period = (h ?? 0) < 12 ? "AM" : "PM";
  const displayH = (h ?? 0) === 0 ? 12 : (h ?? 0) > 12 ? (h ?? 0) - 12 : (h ?? 0);
  return `${dayName} ${displayH}:${String(m ?? 0).padStart(2, "0")} ${period}`;
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
  const pickupDow = pickupLocal.getDay();
  const pickupDay = getScheduleForDay(config, pickupDow);

  if (!pickupDay.isOpen) {
    return {
      status: "PICKUP_CLOSED_DAY",
      closedDayName: DAY_NAMES[pickupDow],
    };
  }

  const pickupMins = pickupLocal.getHours() * 60 + pickupLocal.getMinutes();

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
  const returnDow = returnLocal.getDay();
  const returnDay = getScheduleForDay(config, returnDow);

  // Return on a closed day → bump
  if (!returnDay.isOpen) {
    const bumpTarget = findBumpTarget(config, pickupLocal);
    if (!bumpTarget) {
      return { status: "NO_OPEN_DAY_IN_WINDOW" };
    }
    const nextDow = bumpTarget.getDay();
    const nextDay = getScheduleForDay(config, nextDow);
    return {
      status: "RETURN_BUMPED",
      adjustedReturn: bumpTarget,
      closedDayName: DAY_NAMES[returnDow],
      nextOpenLabel: formatDayTime(bumpTarget, nextDay.openTime),
    };
  }

  const returnMins = returnLocal.getHours() * 60 + returnLocal.getMinutes();
  const closeMins = returnDay.closeMinutes;
  const graceEndMins = closeMins + config.graceMinutes;

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

  // Outside grace — bump to pickup + 24hr
  const bumpTarget = findBumpTarget(config, pickupLocal);
  if (!bumpTarget) {
    return { status: "NO_OPEN_DAY_IN_WINDOW" };
  }
  const nextDow = bumpTarget.getDay();
  const nextDay = getScheduleForDay(config, nextDow);
  return {
    status: "RETURN_BUMPED",
    closingTime: minutesToDisplay(closeMins),
    adjustedReturn: bumpTarget,
    nextOpenLabel: formatDayTime(bumpTarget, nextDay.openTime),
  };
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
    default:
      return "Selected times conflict with branch operating hours.";
  }
}

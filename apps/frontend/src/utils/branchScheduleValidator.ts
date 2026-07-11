// Client-side mirror of apps/backend/src/utils/booking/branchScheduleValidator.ts
// Keep both files in sync. All times are branch-local (IST for v1).

import type { BranchScheduleConfig } from "@/services/branch.service";

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
  closingTime?: string;
  gracePeriodEnd?: string;
  adjustedReturn?: Date;
  nextOpenLabel?: string;
  openingTime?: string;
  closedDayName?: string;
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

function getScheduleForDay(
  config: BranchScheduleConfig,
  dayOfWeek: number,
) {
  if (config.schedules.length === 0) {
    return { isOpen: true, openMinutes: 0, closeMinutes: 1440, openTime: "00:00", closeTime: "24:00" };
  }
  const row = config.schedules.find((s) => s.dayOfWeek === dayOfWeek);
  if (!row) {
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
  const dayOfWeek = DAY_NAMES.indexOf(weekdayLong as any);
  return { hours: hour, minutes: minute, dayOfWeek: dayOfWeek >= 0 ? dayOfWeek : 0 };
}

function formatDayTime(date: Date, openTime: string): string {
  const { dayOfWeek } = getBranchLocalTime(date);
  const dayName = DAY_NAMES[dayOfWeek] ?? "";
  return `${dayName} ${formatScheduleTime(openTime)}`;
}

function findBumpTarget(config: BranchScheduleConfig, pickupLocal: Date, maxDays = 7): Date | null {
  const { hours: pHours, minutes: pMinutes } = getBranchLocalTime(pickupLocal);
  const pickupMins = pHours * 60 + pMinutes;
  let candidate = new Date(pickupLocal.getTime() + 24 * 60 * 60 * 1000);

  for (let i = 0; i < maxDays; i++) {
    const { dayOfWeek: dow } = getBranchLocalTime(candidate);
    const day = getScheduleForDay(config, dow);
    if (day.isOpen && pickupMins >= day.openMinutes && pickupMins < day.closeMinutes) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  }
  return null;
}

export function validateBookingSchedule(
  config: BranchScheduleConfig,
  pickupLocal: Date,
  returnLocal: Date,
): ScheduleVerdict {
  if (config.is24Hours || config.schedules.length === 0) return { status: "OK" };

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

  if (pickupMins >= pickupDay.closeMinutes) {
    return { status: "PICKUP_AT_OR_AFTER_CLOSE", closingTime: minutesToDisplay(pickupDay.closeMinutes) };
  }

  // Return checks
  const { dayOfWeek: returnDow, hours: returnHours, minutes: returnMinsVal } = getBranchLocalTime(returnLocal);
  const returnDay = getScheduleForDay(config, returnDow);

  if (!returnDay.isOpen) {
    const bump = findBumpTarget(config, pickupLocal);
    if (!bump) return { status: "NO_OPEN_DAY_IN_WINDOW" };
    const { dayOfWeek: nextDow } = getBranchLocalTime(bump);
    const nextDay = getScheduleForDay(config, nextDow);
    return {
      status: "RETURN_BUMPED",
      adjustedReturn: bump,
      closedDayName: DAY_NAMES[returnDow],
      nextOpenLabel: formatDayTime(bump, nextDay.openTime),
    };
  }

  const returnMins = returnHours * 60 + returnMinsVal;
  const closeMins = returnDay.closeMinutes;
  const graceEndMins = closeMins + config.graceMinutes;

  if (returnMins <= closeMins) return { status: "OK" };

  if (returnMins <= graceEndMins) {
    return {
      status: "RETURN_GRACE",
      closingTime: minutesToDisplay(closeMins),
      gracePeriodEnd: minutesToDisplay(graceEndMins),
    };
  }

  const bump = findBumpTarget(config, pickupLocal);
  if (!bump) return { status: "NO_OPEN_DAY_IN_WINDOW" };
  const { dayOfWeek: nextDow } = getBranchLocalTime(bump);
  const nextDay = getScheduleForDay(config, nextDow);
  return {
    status: "RETURN_BUMPED",
    closingTime: minutesToDisplay(closeMins),
    adjustedReturn: bump,
    nextOpenLabel: formatDayTime(bump, nextDay.openTime),
  };
}

export function buildScheduleUserMessage(verdict: ScheduleVerdict): string {
  switch (verdict.status) {
    case "PICKUP_CLOSED_DAY":
      return `Branch is closed on ${verdict.closedDayName ?? "that day"}. Please select a different pickup date.`;
    case "PICKUP_BEFORE_OPEN":
      return `Branch opens at ${verdict.openingTime}. Please select a later pickup time.`;
    case "PICKUP_AT_OR_AFTER_CLOSE":
      return `Pickup cannot be at or after closing time (${verdict.closingTime}). Please select an earlier time.`;
    case "NO_OPEN_DAY_IN_WINDOW":
      return "No return window available in the next 7 days. Please contact the branch.";
    default:
      return "Selected times conflict with branch operating hours.";
  }
}

// Pickup slots for the reschedule sheet (P4c). A slot is offered only when the
// server would accept it (PK.md §6.5): the pickup is inside the pickup hours
// (open … close − 30 min), the shifted return (pickup + the booking's fixed
// length) is inside the return hours (open … close + grace), it lies between
// earliestStartAt − pastToleranceMinutes and latestStartAt, it isn't the
// current pickup, and the moved booking overlaps no other booking / hold on
// the vehicle and no other booking on the customer's licence. The server
// re-checks everything (incl. holds the GET may have missed). A 12-hour
// package's return is the package's return for the pickup (client item 6).
import type { RescheduleOptions } from "@/services/reschedule.service";
import { halfDayReturnFor, isPickupSlotAllowed, isReturnSlotAllowed } from "@/utils/branchScheduleValidator";
import { istCalendarParts, istInstant } from "@/utils/bookingPickers";

const MINUTE_MS = 60_000;
export const RESCHEDULE_SLOT_MINUTES = 15;

export interface RescheduleSlot {
  startAt: Date;
  /** "HH:mm" IST. */
  time: string;
  returnAt: Date;
}

export interface RescheduleDay {
  /** IST calendar day (local-midnight Date). */
  day: Date;
  slots: RescheduleSlot[];
  /** The branch is closed all day (pickup hours). */
  closed: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DDTHH:mm" IST — what the reschedule POST takes. */
export function istWallClock(at: Date): string {
  const { day, time } = istCalendarParts(at);
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T${time}`;
}

function overlaps(start: number, end: number, ranges: Array<{ startAt: string; endAt: string }>): boolean {
  return ranges.some((r) => start < new Date(r.endAt).getTime() && new Date(r.startAt).getTime() < end);
}

/** Every IST day from the earliest to the latest pickup, with the pickup slots the server would accept. */
export function rescheduleDays(options: RescheduleOptions, stepMinutes = RESCHEDULE_SLOT_MINUTES): RescheduleDay[] {
  const hours = options.officeHours;
  const durationMs = options.durationMinutes * MINUTE_MS;
  const earliest = new Date(options.earliestStartAt).getTime() - options.pastToleranceMinutes * MINUTE_MS;
  const latest = new Date(options.latestStartAt).getTime();
  const current = new Date(options.startAt).getTime();
  const busy = [...options.vehicleBusy, ...options.dlBusy];
  if (!Number.isFinite(earliest) || !Number.isFinite(latest) || latest < earliest) return [];

  const firstDay = istCalendarParts(new Date(earliest)).day;
  const lastDay = istCalendarParts(new Date(latest)).day;
  const days: RescheduleDay[] = [];
  for (
    let day = firstDay;
    day.getTime() <= lastDay.getTime();
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
  ) {
    const slots: RescheduleSlot[] = [];
    let anyPickupHour = false;
    for (let minutes = 0; minutes < 24 * 60; minutes += stepMinutes) {
      if (!isPickupSlotAllowed(hours, day, minutes)) continue;
      anyPickupHour = true;
      const time = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
      const startAt = istInstant(day, time);
      const t = startAt.getTime();
      if (t < earliest || t > latest) continue;
      if (Math.abs(t - current) < MINUTE_MS) continue;
      const returnAt = options.halfDayPackage
        ? halfDayReturnFor(hours, startAt)?.endAt
        : new Date(t + durationMs);
      if (!returnAt) continue;
      const ret = istCalendarParts(returnAt);
      const [rh, rm] = ret.time.split(":").map(Number);
      if (!isReturnSlotAllowed(hours, ret.day, (rh ?? 0) * 60 + (rm ?? 0))) continue;
      if (overlaps(t, returnAt.getTime(), busy)) continue;
      slots.push({ startAt, time, returnAt });
    }
    days.push({ day, slots, closed: !anyPickupHour });
  }
  return days;
}

// ── Reschedule rental period (TODO 4) ──────────────────────────────────────────
// Start: the pickup slots (30-minute grid inside the pickup hours) from now to
// the latest pickup, not inside a busy span. End: the return slots after the
// start, ≥ 12 h later (monthly 30–180 days), ≤ 30 days, nothing busy between.
// The server re-checks everything and prices the period.

export const PERIOD_SLOT_MINUTES = 30;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface PeriodDay {
  day: Date;
  times: Array<{ at: Date; time: string }>;
  closed: boolean;
}

function inBusy(t: number, ranges: Array<{ startAt: string; endAt: string }>): boolean {
  return ranges.some((r) => t >= new Date(r.startAt).getTime() && t < new Date(r.endAt).getTime());
}

export function periodStartDays(options: RescheduleOptions, now: Date = new Date()): PeriodDay[] {
  const hours = options.officeHours;
  const latest = new Date(options.latestStartAt).getTime();
  const busy = [...options.vehicleBusy, ...options.dlBusy];
  const firstDay = istCalendarParts(now).day;
  const lastDay = istCalendarParts(new Date(latest)).day;
  const own = new Date(options.startAt);
  const days: PeriodDay[] = [];
  for (let day = firstDay; day.getTime() <= lastDay.getTime(); day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
    const times: PeriodDay["times"] = [];
    let anyPickupHour = false;
    const minutesList = new Set<number>();
    for (let m = 0; m < 24 * 60; m += PERIOD_SLOT_MINUTES) minutesList.add(m);
    const ownParts = istCalendarParts(own);
    if (ownParts.day.getTime() === day.getTime()) {
      const [oh, om] = ownParts.time.split(":").map(Number);
      minutesList.add((oh ?? 0) * 60 + (om ?? 0));
    }
    for (const minutes of [...minutesList].sort((a, b) => a - b)) {
      if (!isPickupSlotAllowed(hours, day, minutes)) continue;
      anyPickupHour = true;
      const time = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
      const at = istInstant(day, time);
      const t = at.getTime();
      if (t <= now.getTime() || t > latest || inBusy(t, busy)) continue;
      times.push({ at, time });
    }
    days.push({ day, times, closed: !anyPickupHour });
  }
  return days;
}

export function periodEndLimits(options: RescheduleOptions, start: Date): { min: Date; max: Date } {
  const r = options.periodRules;
  const s = start.getTime();
  return options.isMonthly
    ? { min: new Date(s + (r?.monthlyMinDays ?? 30) * DAY_MS), max: new Date(s + (r?.monthlyMaxDays ?? 180) * DAY_MS) }
    : { min: new Date(s + (r?.minHours ?? 12) * HOUR_MS), max: new Date(s + (r?.maxRentalDays ?? 30) * DAY_MS) };
}

export function periodEndDays(options: RescheduleOptions, start: Date): PeriodDay[] {
  const hours = options.officeHours;
  const { min, max } = periodEndLimits(options, start);
  const busy = [...options.vehicleBusy, ...options.dlBusy];
  const s = start.getTime();
  const firstDay = istCalendarParts(min).day;
  const lastDay = istCalendarParts(max).day;
  const own = new Date(options.endAt);
  const days: PeriodDay[] = [];
  for (let day = firstDay; day.getTime() <= lastDay.getTime(); day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
    const times: PeriodDay["times"] = [];
    const minutesList = new Set<number>();
    for (let m = 0; m < 24 * 60; m += PERIOD_SLOT_MINUTES) minutesList.add(m);
    const ownParts = istCalendarParts(own);
    if (ownParts.day.getTime() === day.getTime()) {
      const [oh, om] = ownParts.time.split(":").map(Number);
      minutesList.add((oh ?? 0) * 60 + (om ?? 0));
    }
    let anyReturnHour = false;
    for (const minutes of [...minutesList].sort((a, b) => a - b)) {
      if (!isReturnSlotAllowed(hours, day, minutes)) continue;
      anyReturnHour = true;
      const time = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
      const at = istInstant(day, time);
      const e = at.getTime();
      if (e < min.getTime() || e > max.getTime() || e <= s) continue;
      if (overlaps(s, e, busy)) continue;
      times.push({ at, time });
    }
    days.push({ day, times, closed: !anyReturnHour });
  }
  return days;
}

/** Whether "Now" is a valid start (inside pickup hours incl. tonight's window — the server decides finally). */
export function canStartNow(options: RescheduleOptions, now: Date = new Date()): boolean {
  const { day, time } = istCalendarParts(now);
  const [h, m] = time.split(":").map(Number);
  if (!isPickupSlotAllowed(options.officeHours, day, (h ?? 0) * 60 + (m ?? 0))) return false;
  return !inBusy(now.getTime(), [...options.vehicleBusy, ...options.dlBusy]);
}

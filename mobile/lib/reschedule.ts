// Fleet "Reschedule" (BRIEF4 P4c): which new pickup times a confirmed booking
// can move to, from GET /api/employee/bookings/:publicId/reschedule. The same
// checks the server makes (contract PK §6.5); the server re-checks on submit.
import {
  halfDayReturnFor,
  hasOfficeHours,
  isPickupTimeAllowed,
  isReturnTimeAllowed,
  slotsWithinHours,
  toScheduleConfig,
  type BranchScheduleConfig,
} from './branchSchedule';
import { timeLabel, timeOf, withTime, type TimeSlot } from './dates';
import type { RescheduleOptions } from '../types/api';

const MINUTE_MS = 60_000;

/** IST wall clock "YYYY-MM-DDTHH:mm" of an instant — the employee endpoints' format, whatever the phone's zone. */
export function istMinuteIso(d: Date): string {
  return new Date(d.getTime() + 330 * MINUTE_MS).toISOString().slice(0, 16);
}

/** "4 hours 30 minutes", "2 days" — how far the pickup moves. */
export function shiftLabel(ms: number): string {
  const total = Math.round(Math.abs(ms) / MINUTE_MS);
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (mins) parts.push(`${mins} minute${mins === 1 ? '' : 's'}`);
  return parts.join(' ') || '0 minutes';
}

/**
 * The return a move to `start` gives: pickup + the booking's length, or — for a
 * 12-hour package (client item 6) — the package's return for that pickup
 * (pickup + 12 h, or closing that day). null when no 12-hour return fits.
 */
export function rescheduleReturn(
  start: Date,
  opts: Pick<RescheduleOptions, 'durationMinutes' | 'halfDayPackage'>,
  config: BranchScheduleConfig | null,
): Date | null {
  if (opts.halfDayPackage && hasOfficeHours(config)) return halfDayReturnFor(config, start)?.endAt ?? null;
  return new Date(start.getTime() + opts.durationMinutes * MINUTE_MS);
}

/**
 * The pickup times on `day` a booking can move to: the slots the branch takes
 * for a pickup (30-minute grid, opening and last pickup), plus the booking's
 * own clock time — kept only when
 *  1. the pickup is inside the pickup hours (open … close − cutoff);
 *  2. the return (pickup + the booking's length, or a 12-hour package's return) is inside the return hours;
 *  3. it is within earliest − tolerance … latest and not the current pickup;
 *  4. no other booking / hold on the vehicle or the customer's licence overlaps.
 */
export function rescheduleSlots(day: Date, opts: RescheduleOptions, now: Date = new Date()): TimeSlot[] {
  const config = toScheduleConfig(opts.officeHours);
  const earliest = new Date(opts.earliestStartAt).getTime() - opts.pastToleranceMinutes * MINUTE_MS;
  const latest = new Date(opts.latestStartAt);
  const current = new Date(opts.startAt);
  let slots = slotsWithinHours(day, config, 'pickup', { before: latest, now });
  // Keep the booking's clock time on another day (e.g. 10:15) when the branch takes it.
  const own = timeOf(current);
  const ownAt = withTime(day, own);
  if (
    !slots.some((s) => s.value === own) &&
    ownAt.getTime() > now.getTime() &&
    ownAt.getTime() <= latest.getTime() &&
    (!hasOfficeHours(config) || isPickupTimeAllowed(config, ownAt, now))
  ) {
    slots = [...slots, { value: own, label: timeLabel(own) }].sort((a, b) => a.value.localeCompare(b.value));
  }
  const busy = [...opts.vehicleBusy, ...opts.dlBusy].map((b) => ({
    start: new Date(b.startAt).getTime(),
    end: new Date(b.endAt).getTime(),
  }));
  return slots.filter((s) => {
    const t = withTime(day, s.value).getTime();
    const returnAt = rescheduleReturn(new Date(t), opts, config);
    if (!returnAt) return false;
    const r = returnAt.getTime();
    if (t < earliest || t > latest.getTime()) return false;
    if (Math.abs(t - current.getTime()) < MINUTE_MS) return false;
    if (hasOfficeHours(config) && !isReturnTimeAllowed(config, new Date(r))) return false;
    return !busy.some((b) => t < b.end && b.start < r);
  });
}

// ── Reschedule rental period (TODO 4) ────────────────────────────────────────
// The FE picks a new start AND a new end. The pickers offer only times the
// server would take (it re-checks everything and prices the move):
//   start: the branch's pickup slots (30-min grid, last pickup, tonight's late
//          window), from now (the "Now" chip is the immediate pickup) to the
//          latest pickup, not inside another booking / lock / the licence's;
//   end:   the branch's return slots after the start, at least 12 h later
//          (monthly: 30–180 days), at most 30 days, with nothing in the way
//          between the start and it.

const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

type PeriodOpts = Pick<
  RescheduleOptions,
  'officeHours' | 'latestStartAt' | 'vehicleBusy' | 'dlBusy' | 'isMonthly' | 'periodRules' | 'startAt' | 'endAt'
>;

function busySpans(opts: Pick<RescheduleOptions, 'vehicleBusy' | 'dlBusy'>) {
  return [...opts.vehicleBusy, ...opts.dlBusy].map((b) => ({
    start: new Date(b.startAt).getTime(),
    end: new Date(b.endAt).getTime(),
  }));
}

/** Pickup slots on `day` for a new period (no "Now" chip — see canPickupNow). */
export function periodStartSlots(day: Date, opts: PeriodOpts, now: Date = new Date()): TimeSlot[] {
  const config = toScheduleConfig(opts.officeHours);
  const latest = new Date(opts.latestStartAt);
  let slots = slotsWithinHours(day, config, 'pickup', { before: latest, now });
  // Keep the booking's own start on its day (e.g. 10:15), so only the end can be changed
  const own = new Date(opts.startAt);
  if (own.getTime() > now.getTime() && withTime(day, timeOf(own)).getTime() === own.getTime() && !slots.some((s) => s.value === timeOf(own))) {
    slots = [...slots, { value: timeOf(own), label: timeLabel(timeOf(own)) }].sort((a, b) => a.value.localeCompare(b.value));
  }
  const busy = busySpans(opts);
  return slots.filter((s) => {
    const t = withTime(day, s.value).getTime();
    return !busy.some((b) => t >= b.start && t < b.end);
  });
}

/** Whether "Now" (an immediate pickup) is a valid start. */
export function canPickupNow(opts: PeriodOpts, now: Date = new Date()): boolean {
  const config = toScheduleConfig(opts.officeHours);
  if (hasOfficeHours(config) && !isPickupTimeAllowed(config, now, now)) return false;
  const t = now.getTime();
  return !busySpans(opts).some((b) => t >= b.start && t < b.end);
}

/** Shortest / longest end for a start. */
export function periodEndLimits(start: Date, opts: PeriodOpts): { min: Date; max: Date } {
  const rules = opts.periodRules;
  if (opts.isMonthly) {
    return {
      min: new Date(start.getTime() + (rules?.monthlyMinDays ?? 30) * DAY_MS),
      max: new Date(start.getTime() + (rules?.monthlyMaxDays ?? 180) * DAY_MS),
    };
  }
  return {
    min: new Date(start.getTime() + (rules?.minHours ?? 12) * HOUR_MS),
    max: new Date(start.getTime() + (rules?.maxRentalDays ?? 30) * DAY_MS),
  };
}

/** Return slots on `day` for a period starting at `start` (12-hour package held to closing aside — the server takes it). */
export function periodEndSlots(day: Date, start: Date, opts: PeriodOpts, now: Date = new Date()): TimeSlot[] {
  const config = toScheduleConfig(opts.officeHours);
  const { min, max } = periodEndLimits(start, opts);
  let slots = slotsWithinHours(day, config, 'return', { after: start, before: max, now });
  // Keep the booking's own end on its day
  const own = new Date(opts.endAt);
  if (withTime(day, timeOf(own)).getTime() === own.getTime() && !slots.some((s) => s.value === timeOf(own))) {
    if (!hasOfficeHours(config) || isReturnTimeAllowed(config, own)) {
      slots = [...slots, { value: timeOf(own), label: timeLabel(timeOf(own)) }].sort((a, b) => a.value.localeCompare(b.value));
    }
  }
  const busy = busySpans(opts);
  const s0 = start.getTime();
  return slots.filter((s) => {
    const e = withTime(day, s.value).getTime();
    if (e < min.getTime() || e > max.getTime() || e <= s0) return false;
    return !busy.some((b) => s0 < b.end && b.start < e);
  });
}

/** "+₹500.00" / "−₹250.00" / "No change". */
export function differenceLabel(difference: string | number): string {
  const n = Number(difference);
  if (!n) return 'No change';
  return `${n > 0 ? '+' : '−'}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function rupees(v: string | number): string {
  return `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

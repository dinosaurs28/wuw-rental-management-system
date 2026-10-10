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
    (!hasOfficeHours(config) || isPickupTimeAllowed(config, ownAt))
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

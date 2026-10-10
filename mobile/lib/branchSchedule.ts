// Mirror of apps/backend/src/utils/booking/branchScheduleValidator.ts (and the
// web copy apps/frontend/src/utils/branchScheduleValidator.ts) — mobile is
// outside the pnpm workspace, so keep the three in sync: same rules, same
// verdicts, same messages.
//
// Branch-local time is IST (UTC+5:30, no DST). It is read with the fixed offset,
// so a Date instant gives the same answer whatever zone the device is set to.
// Below the mirror, a mobile-only section turns the rules into picker helpers
// (time slots, closed days, range fitting, hours labels).
import { halfDayPackageReturn, isClampedHalfDayReturn, validateBookingWindow, type HalfDayReturn } from './bookingWindow';
import { startOfDay, timeLabel, timeSlotsFor, withTime, type TimeSlot } from './dates';

/**
 * Hours that apply to any day a branch has no saved row for (including a branch
 * with no rows at all), unless the branch is switched to 24 hours.
 */
export const DEFAULT_BRANCH_HOURS = { openTime: '08:00', closeTime: '23:00' } as const;

/**
 * A booking's pickup time must be at least this many minutes before closing
 * (default hours → last pickup 10:30 PM). Returns keep [open, close + grace].
 */
export const PICKUP_CUTOFF_MINUTES = 30;

export interface BranchScheduleRow {
  dayOfWeek: number; // 0 = Sunday … 6 = Saturday
  isOpen: boolean;
  openTime: string; // "HH:mm" 24-hr
  closeTime: string; // "HH:mm" 24-hr
}

export interface BranchScheduleConfig {
  schedules: BranchScheduleRow[];
  graceMinutes: number;
  is24Hours: boolean;
  /**
   * Mobile only (set by toScheduleConfig): the server's `pickupCutoffMinutes`
   * when it sends one; PICKUP_CUTOFF_MINUTES otherwise.
   */
  pickupCutoffMinutes?: number;
}

/** Minutes before closing of the last pickup for this branch. */
export function pickupCutoffOf(config: BranchScheduleConfig): number {
  return config.pickupCutoffMinutes ?? PICKUP_CUTOFF_MINUTES;
}

export type ScheduleVerdictStatus =
  | 'OK'
  | 'PICKUP_CLOSED_DAY'
  | 'PICKUP_BEFORE_OPEN'
  | 'PICKUP_AT_OR_AFTER_CLOSE'
  | 'RETURN_GRACE'
  | 'RETURN_BUMPED'
  | 'NO_OPEN_DAY_IN_WINDOW'
  /** Extensions only (validateReturnTime): the new end is outside the return window. */
  | 'RETURN_OUTSIDE_HOURS';

/** Why a return was moved (RETURN_BUMPED) or refused (RETURN_OUTSIDE_HOURS). */
export type ReturnScheduleReason = 'CLOSED_DAY' | 'AFTER_CLOSE' | 'BEFORE_OPEN';

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
  /** Latest allowed pickup that day (closing − PICKUP_CUTOFF_MINUTES), e.g. "10:30 PM" — set on PICKUP_AT_OR_AFTER_CLOSE */
  lastPickupTime?: string;
}

/** A verdict as it arrives in a 400 body — dates are ISO strings on the wire. */
export type ServerScheduleVerdict = Omit<ScheduleVerdict, 'adjustedReturn'> & { adjustedReturn?: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const IST_OFFSET_MS = 330 * 60 * 1000;

/** Convert "HH:mm" to total minutes since midnight. */
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Convert total minutes since midnight to display string e.g. "10:00 PM". */
export function minutesToDisplay(mins: number): string {
  const normalised = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(normalised / 60);
  const m = normalised % 60;
  const period = h < 12 ? 'AM' : 'PM';
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayH}:${String(m).padStart(2, '0')} ${period}`;
}

function getScheduleForDay(
  config: BranchScheduleConfig,
  dayOfWeek: number,
): { isOpen: boolean; openMinutes: number; closeMinutes: number; openTime: string; closeTime: string } {
  const row = config.schedules.find((s) => s.dayOfWeek === dayOfWeek);
  if (!row) {
    // No saved row for this day (or no rows at all) → default hours, 8 AM – 11 PM
    return {
      isOpen: true,
      openMinutes: timeToMinutes(DEFAULT_BRANCH_HOURS.openTime),
      closeMinutes: timeToMinutes(DEFAULT_BRANCH_HOURS.closeTime),
      openTime: DEFAULT_BRANCH_HOURS.openTime,
      closeTime: DEFAULT_BRANCH_HOURS.closeTime,
    };
  }
  return {
    isOpen: row.isOpen,
    openMinutes: timeToMinutes(row.openTime),
    closeMinutes: timeToMinutes(row.closeTime),
    openTime: row.openTime,
    closeTime: row.closeTime,
  };
}

/** Hours, minutes and dayOfWeek of `date` in branch time (IST). */
export function getBranchLocalTime(date: Date): { hours: number; minutes: number; dayOfWeek: number } {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return { hours: ist.getUTCHours(), minutes: ist.getUTCMinutes(), dayOfWeek: ist.getUTCDay() };
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

    if (day.isOpen && pickupMins >= day.openMinutes && pickupMins <= day.closeMinutes + config.graceMinutes) {
      return candidate;
    }
    // That day is closed or the time is outside its hours — try the next day
  }
  return null;
}

/** "Tuesday 6:00 PM" — weekday and time-of-day of `date` in branch-local time. */
function formatDayTime(date: Date): string {
  const { dayOfWeek, hours, minutes } = getBranchLocalTime(date);
  return `${DAY_NAMES[dayOfWeek] ?? ''} ${minutesToDisplay(hours * 60 + minutes)}`;
}

function bumpVerdict(
  config: BranchScheduleConfig,
  pickupLocal: Date,
  returnLocal: Date,
  extra: Pick<ScheduleVerdict, 'reason' | 'closingTime' | 'openingTime' | 'closedDayName'>,
): ScheduleVerdict {
  const bumpTarget = findBumpTarget(config, pickupLocal, returnLocal);
  if (!bumpTarget) {
    return { status: 'NO_OPEN_DAY_IN_WINDOW' };
  }
  return {
    status: 'RETURN_BUMPED',
    adjustedReturn: bumpTarget,
    nextOpenLabel: formatDayTime(bumpTarget),
    ...extra,
  };
}

/**
 * Opening window of one branch-local day, for pickers and checks.
 * null = no restriction that day (24-hour branch only — a day without saved
 * hours uses DEFAULT_BRANCH_HOURS). Minutes are since local midnight; pickups
 * are allowed in [openMin, lastPickupMin], returns in [openMin, graceEndMin].
 */
export function getDayWindow(
  config: BranchScheduleConfig,
  date: Date,
): { isOpen: boolean; openMin: number; closeMin: number; graceEndMin: number; lastPickupMin: number } | null {
  if (config.is24Hours) return null;
  const { dayOfWeek } = getBranchLocalTime(date);
  const day = getScheduleForDay(config, dayOfWeek);
  return {
    isOpen: day.isOpen,
    openMin: day.openMinutes,
    closeMin: day.closeMinutes,
    graceEndMin: day.closeMinutes + config.graceMinutes,
    lastPickupMin: day.closeMinutes - pickupCutoffOf(config),
  };
}

export interface EffectiveScheduleRow extends BranchScheduleRow {
  /** True when the branch has no saved row for this day and DEFAULT_BRANCH_HOURS fill it. */
  isDefault: boolean;
  /** Latest pickup "HH:mm" (closeTime − PICKUP_CUTOFF_MINUTES); null on a closed day. */
  lastPickupTime: string | null;
}

/** "HH:mm" for minutes since midnight (wraps within the day). */
function minutesToHHmm(mins: number): string {
  const normalised = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalised / 60)).padStart(2, '0')}:${String(normalised % 60).padStart(2, '0')}`;
}

/**
 * The seven weekly rows (Sunday first) the rules actually use: saved rows as
 * they are, days without a row filled with DEFAULT_BRANCH_HOURS. A 24-hour
 * branch ignores these entirely (is24Hours wins).
 */
export function getEffectiveSchedules(schedules: BranchScheduleRow[]): EffectiveScheduleRow[] {
  return DAY_NAMES.map((_, dayOfWeek) => {
    const row = schedules.find((s) => s.dayOfWeek === dayOfWeek);
    const isOpen = row ? row.isOpen : true;
    const openTime = row ? row.openTime : DEFAULT_BRANCH_HOURS.openTime;
    const closeTime = row ? row.closeTime : DEFAULT_BRANCH_HOURS.closeTime;
    return {
      dayOfWeek,
      isOpen,
      openTime,
      closeTime,
      isDefault: !row,
      lastPickupTime: isOpen ? minutesToHHmm(timeToMinutes(closeTime) - PICKUP_CUTOFF_MINUTES) : null,
    };
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validate pickup and return times against branch operating schedule.
 * Returns a ScheduleVerdict describing what action (if any) is needed.
 */
export function validateBookingSchedule(
  config: BranchScheduleConfig,
  pickupLocal: Date,
  returnLocal: Date,
): ScheduleVerdict {
  // 24-hour branch — no restrictions (no saved rows = default hours, not 24/7)
  if (config.is24Hours) {
    return { status: 'OK' };
  }

  // ── Pickup checks ────────────────────────────────────────────────────────
  const { dayOfWeek: pickupDow, hours: pickupHours, minutes: pickupMinsVal } = getBranchLocalTime(pickupLocal);
  const pickupDay = getScheduleForDay(config, pickupDow);

  if (!pickupDay.isOpen) {
    return { status: 'PICKUP_CLOSED_DAY', closedDayName: DAY_NAMES[pickupDow] };
  }

  const pickupMins = pickupHours * 60 + pickupMinsVal;

  if (pickupMins < pickupDay.openMinutes) {
    return { status: 'PICKUP_BEFORE_OPEN', openingTime: minutesToDisplay(pickupDay.openMinutes) };
  }

  // Last pickup is PICKUP_CUTOFF_MINUTES before closing (status name kept for old clients)
  const lastPickupMins = pickupDay.closeMinutes - pickupCutoffOf(config);
  if (pickupMins > lastPickupMins) {
    return {
      status: 'PICKUP_AT_OR_AFTER_CLOSE',
      closingTime: minutesToDisplay(pickupDay.closeMinutes),
      lastPickupTime: minutesToDisplay(lastPickupMins),
    };
  }

  // ── Return checks ────────────────────────────────────────────────────────
  const { dayOfWeek: returnDow, hours: returnHours, minutes: returnMinsVal } = getBranchLocalTime(returnLocal);
  const returnDay = getScheduleForDay(config, returnDow);

  // Return on a closed day → bump
  if (!returnDay.isOpen) {
    return bumpVerdict(config, pickupLocal, returnLocal, {
      reason: 'CLOSED_DAY',
      closedDayName: DAY_NAMES[returnDow],
    });
  }

  const returnMins = returnHours * 60 + returnMinsVal;
  const closeMins = returnDay.closeMinutes;
  const graceEndMins = closeMins + config.graceMinutes;

  // Return before opening (e.g. an overnight 12 h trip) is treated like one after closing
  if (returnMins < returnDay.openMinutes) {
    return bumpVerdict(config, pickupLocal, returnLocal, {
      reason: 'BEFORE_OPEN',
      openingTime: minutesToDisplay(returnDay.openMinutes),
    });
  }

  if (returnMins <= closeMins) {
    return { status: 'OK' };
  }

  if (returnMins <= graceEndMins) {
    return {
      status: 'RETURN_GRACE',
      closingTime: minutesToDisplay(closeMins),
      gracePeriodEnd: minutesToDisplay(graceEndMins),
    };
  }

  // Outside grace — bump to the next in-hours pickup + k × 24 h
  return bumpVerdict(config, pickupLocal, returnLocal, {
    reason: 'AFTER_CLOSE',
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
  // 24-hour branch only — no saved rows means default hours apply
  if (config.is24Hours) {
    return { status: 'OK' };
  }
  const { dayOfWeek, hours, minutes } = getBranchLocalTime(returnLocal);
  const day = getScheduleForDay(config, dayOfWeek);

  if (!day.isOpen) {
    return { status: 'RETURN_OUTSIDE_HOURS', reason: 'CLOSED_DAY', closedDayName: DAY_NAMES[dayOfWeek] };
  }
  const returnMins = hours * 60 + minutes;
  const graceEndMins = day.closeMinutes + config.graceMinutes;
  if (returnMins < day.openMinutes) {
    return {
      status: 'RETURN_OUTSIDE_HOURS',
      reason: 'BEFORE_OPEN',
      openingTime: minutesToDisplay(day.openMinutes),
      closingTime: minutesToDisplay(day.closeMinutes),
    };
  }
  if (returnMins > graceEndMins) {
    return {
      status: 'RETURN_OUTSIDE_HOURS',
      reason: 'AFTER_CLOSE',
      openingTime: minutesToDisplay(day.openMinutes),
      closingTime: minutesToDisplay(day.closeMinutes),
      gracePeriodEnd: minutesToDisplay(graceEndMins),
    };
  }
  if (returnMins > day.closeMinutes) {
    return {
      status: 'RETURN_GRACE',
      closingTime: minutesToDisplay(day.closeMinutes),
      gracePeriodEnd: minutesToDisplay(graceEndMins),
    };
  }
  return { status: 'OK' };
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
    returnAllowed: (at) => validateReturnTime(config, at).status !== 'RETURN_OUTSIDE_HOURS',
    closingAt: closingOnDayOf(config, pickupLocal),
  });
}

/** Is pickup → return the 12-hour package held to closing on the pickup day? */
export function isClampedHalfDay(config: BranchScheduleConfig, pickupLocal: Date, returnLocal: Date): boolean {
  return isClampedHalfDayReturn(halfDayReturnFor(config, pickupLocal), returnLocal);
}

/** User-facing error message for each blocking verdict status. */
export function buildScheduleErrorMessage(verdict: Pick<ScheduleVerdict, Exclude<keyof ScheduleVerdict, 'adjustedReturn'>>): string {
  switch (verdict.status) {
    case 'PICKUP_CLOSED_DAY':
      return `Branch is closed on ${verdict.closedDayName ?? 'that day'}. Please select a different pickup date.`;
    case 'PICKUP_BEFORE_OPEN':
      return `Branch opens at ${verdict.openingTime ?? 'opening time'}. Please select a later pickup time.`;
    case 'PICKUP_AT_OR_AFTER_CLOSE':
      if (verdict.lastPickupTime) {
        return `Last pickup is ${verdict.lastPickupTime} (${PICKUP_CUTOFF_MINUTES} minutes before closing). Please select an earlier pickup time.`;
      }
      return `Pickup cannot be at or after closing time (${verdict.closingTime ?? 'closing time'}). Please select an earlier time.`;
    case 'NO_OPEN_DAY_IN_WINDOW':
      return 'No available return window in the next 7 days. Please contact the branch directly.';
    case 'RETURN_OUTSIDE_HOURS':
      if (verdict.reason === 'CLOSED_DAY') {
        return `Branch is closed on ${verdict.closedDayName ?? 'that day'}. Please choose a return on a day the branch is open.`;
      }
      if (verdict.reason === 'BEFORE_OPEN') {
        return `Branch opens at ${verdict.openingTime ?? 'opening time'} that day. Please choose a later return time.`;
      }
      return `Branch closes at ${verdict.closingTime ?? 'closing time'} that day${
        verdict.gracePeriodEnd && verdict.gracePeriodEnd !== verdict.closingTime
          ? ` (returns accepted until ${verdict.gracePeriodEnd})`
          : ''
      }. Please choose an earlier return time.`;
    case 'RETURN_BUMPED':
      return `Return time adjusted to ${verdict.nextOpenLabel ?? 'the next available time'} due to branch operating hours.`;
    default:
      return 'Selected times conflict with branch operating hours.';
  }
}

// ── Picker helpers (mobile only, not part of the mirror) ─────────────────────
// Booking screens build slots in device-local time (IST in practice); every
// check below reads the slot's instant in IST, exactly as the server will.

/**
 * Hours as the API sends them (public schedule, eligibility officeHours) → a
 * validator config. Newer servers add `effectiveSchedules` (all seven days,
 * DEFAULT_BRANCH_HOURS filled in) and `pickupCutoffMinutes`; they are used when
 * present. Without them the saved rows are taken as they are and the rules
 * above fill in the defaults — the same hours either way. (`defaultHours` only
 * says whether the branch saved hours of its own; nothing here needs it.)
 */
export function toScheduleConfig(raw: any): BranchScheduleConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const toRows = (rows: unknown): BranchScheduleRow[] =>
    Array.isArray(rows)
      ? rows.map((s: any) => ({
          dayOfWeek: Number(s.dayOfWeek),
          isOpen: s.isOpen === true,
          openTime: String(s.openTime ?? '00:00'),
          closeTime: String(s.closeTime ?? '23:59'),
        }))
      : [];
  const saved = toRows(raw.schedules);
  const effective = toRows(raw.effectiveSchedules);
  const cutoff = raw.pickupCutoffMinutes;
  return {
    schedules: effective.length > 0 ? effective : saved,
    graceMinutes: Number(raw.graceMinutes) || 0,
    is24Hours: raw.is24Hours === true,
    pickupCutoffMinutes: typeof cutoff === 'number' && Number.isFinite(cutoff) && cutoff >= 0 ? cutoff : undefined,
  };
}

/**
 * True when the branch limits times at all — every branch except one open 24
 * hours (a branch without saved hours keeps DEFAULT_BRANCH_HOURS).
 */
export function hasOfficeHours(config?: BranchScheduleConfig | null): config is BranchScheduleConfig {
  return !!config && !config.is24Hours;
}

function minutesOf(at: Date): number {
  const { hours, minutes } = getBranchLocalTime(at);
  return hours * 60 + minutes;
}

/** Pickup allowed at this instant: open day, open ≤ time ≤ close − PICKUP_CUTOFF_MINUTES. */
export function isPickupTimeAllowed(config: BranchScheduleConfig, at: Date): boolean {
  const w = getDayWindow(config, at);
  if (!w) return true;
  const m = minutesOf(at);
  return w.isOpen && m >= w.openMin && m <= w.lastPickupMin;
}

/** Return allowed at this instant: open day, open ≤ time ≤ close + grace. */
export function isReturnTimeAllowed(config: BranchScheduleConfig, at: Date): boolean {
  const w = getDayWindow(config, at);
  if (!w) return true;
  const m = minutesOf(at);
  return w.isOpen && m >= w.openMin && m <= w.graceEndMin;
}

/** The branch is closed all day on this calendar day (greyed out in calendars). */
export function isClosedDay(config: BranchScheduleConfig | null | undefined, day: Date): boolean {
  if (!config) return false;
  const w = getDayWindow(config, withTime(day, '12:00'));
  return !!w && !w.isOpen;
}

/** Empty-list text for a time picker on a closed day; undefined keeps the picker's default. */
export function closedDayText(config: BranchScheduleConfig | null | undefined, day: Date): string | undefined {
  if (!isClosedDay(config, day)) return undefined;
  return `The branch is closed on ${DAY_NAMES[getBranchLocalTime(withTime(day, '12:00')).dayOfWeek]}. Pick another date.`;
}

export type SlotKind = 'pickup' | 'return';

const pad2 = (n: number) => String(n).padStart(2, '0');
const hhmm = (mins: number) => `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;

/**
 * Time choices for `day` that the branch accepts: timeSlotsFor() (future
 * times, after `after`) plus the exact opening / last-pickup (pickups) or
 * opening / closing / grace-end (returns) times when they fall off the
 * 30-minute grid, minus anything outside office hours or later than `before`.
 * Pickup slots therefore end at closing − PICKUP_CUTOFF_MINUTES. Without hours
 * (24-hour branch, or hours not loaded yet) it is timeSlotsFor() capped at `before`.
 */
export function slotsWithinHours(
  day: Date,
  config: BranchScheduleConfig | null | undefined,
  kind: SlotKind,
  opts: { after?: Date; before?: Date | null; now?: Date } = {},
): TimeSlot[] {
  const now = opts.now ?? new Date();
  let slots = timeSlotsFor(day, { after: opts.after, now });
  const w = hasOfficeHours(config) ? getDayWindow(config, withTime(day, '12:00')) : null;
  if (w && w.isOpen) {
    const edges = kind === 'pickup' ? [w.openMin, w.lastPickupMin] : [w.openMin, w.closeMin, w.graceEndMin];
    for (const mins of edges) {
      if (mins < 0 || mins >= 1440) continue;
      const value = hhmm(mins);
      const at = withTime(day, value);
      if (at.getTime() <= now.getTime() || (opts.after && at.getTime() <= opts.after.getTime())) continue;
      if (!slots.some((s) => s.value === value)) slots = [...slots, { value, label: timeLabel(value) }];
    }
    slots = [...slots].sort((a, b) => a.value.localeCompare(b.value));
  }
  const before = opts.before ?? null;
  return slots.filter((s) => {
    const at = withTime(day, s.value);
    if (before && at.getTime() > before.getTime()) return false;
    if (!hasOfficeHours(config)) return true;
    return kind === 'pickup' ? isPickupTimeAllowed(config, at) : isReturnTimeAllowed(config, at);
  });
}

/**
 * An open day with no pickup time left — today after the last pickup (closing
 * − PICKUP_CUTOFF_MINUTES), or a day whose hours leave no pickup at all.
 * Calendars grey these out for pickup; closed days are isClosedDay's job.
 */
export function noPickupTimesLeft(config: BranchScheduleConfig | null | undefined, day: Date, now?: Date): boolean {
  if (!hasOfficeHours(config) || isClosedDay(config, day)) return false;
  return slotsWithinHours(day, config, 'pickup', { now }).length === 0;
}

const SEARCH_DAYS = 14;

/** First accepted pickup/return at or after `from` (up to two weeks ahead). */
export function firstAllowedFrom(
  config: BranchScheduleConfig | null | undefined,
  from: Date,
  kind: SlotKind,
  opts: { after?: Date; before?: Date | null; now?: Date } = {},
): Date | null {
  const first = startOfDay(from);
  for (let i = 0; i <= SEARCH_DAYS; i++) {
    const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
    if (opts.before && day.getTime() > opts.before.getTime()) return null;
    const hit = slotsWithinHours(day, config, kind, opts).find((s) => withTime(day, s.value).getTime() >= from.getTime());
    if (hit) return withTime(day, hit.value);
  }
  return null;
}

/** Last accepted return at or before `until` and strictly after `after`. */
export function lastAllowedUntil(
  config: BranchScheduleConfig | null | undefined,
  until: Date,
  kind: SlotKind,
  opts: { after: Date; now?: Date },
): Date | null {
  const last = startOfDay(until);
  for (let i = 0; i <= SEARCH_DAYS; i++) {
    const day = new Date(last.getFullYear(), last.getMonth(), last.getDate() - i);
    if (day.getTime() < startOfDay(opts.after).getTime()) return null;
    const slots = slotsWithinHours(day, config, kind, { after: opts.after, before: until, now: opts.now });
    const hit = slots[slots.length - 1];
    if (hit) return withTime(day, hit.value);
  }
  return null;
}

const floorToMinute = (d: Date) => new Date(Math.floor(d.getTime() / 60_000) * 60_000);

/**
 * Keeps a pickup/return pair bookable once the pickers move it:
 *  1. a pickup outside office hours moves to the next accepted pickup, and the
 *     return moves with it (the rental keeps its length);
 *  2. the return is held to the length limits — `maxEnd` (15-day rule, or 180
 *     days for a monthly plan) and `minEnd` (30 days for a monthly plan);
 *  3. a return outside the return window moves to the next accepted return
 *     within the limit, else back to the last accepted one before it.
 * Hands back the same object when nothing moved, so it can run in an effect.
 */
export function fitBookingRange<R extends { start: Date; end: Date }>(
  r: R,
  opts: {
    config?: BranchScheduleConfig | null;
    now?: Date;
    minEnd?: (start: Date) => Date;
    maxEnd?: (start: Date) => Date;
  },
): R | { start: Date; end: Date } {
  const now = opts.now ?? new Date();
  const config = hasOfficeHours(opts.config) ? opts.config : null;
  let start = r.start;
  let end = r.end;

  if (config && !isPickupTimeAllowed(config, start)) {
    const next = firstAllowedFrom(config, start, 'pickup', { now });
    if (next) {
      end = new Date(end.getTime() + (next.getTime() - start.getTime()));
      start = next;
    }
  }

  const min = opts.minEnd?.(start) ?? null;
  if (min && end.getTime() < min.getTime()) end = min;
  const max = opts.maxEnd?.(start) ?? null;
  // A pickup too late in the window to fit any return is left for the
  // screen's notice rather than turned into a zero-length rental.
  if (max && end.getTime() > max.getTime() && max.getTime() > start.getTime()) end = floorToMinute(max);

  if (config && !isReturnTimeAllowed(config, end) && end.getTime() > start.getTime()) {
    const after = min ? new Date(min.getTime() - 1) : start;
    const fitted =
      firstAllowedFrom(config, end, 'return', { after, before: max, now }) ??
      lastAllowedUntil(config, end, 'return', { after, now });
    if (fitted) end = fitted;
  }

  if (start.getTime() === r.start.getTime() && end.getTime() === r.end.getTime()) return r;
  return { start, end };
}

/**
 * The return an extension picker should hold: `at` when the branch accepts it
 * and it is within (after, before], else the next accepted return, else the
 * last accepted one before `before`. null when nothing fits.
 */
export function fitReturnTime(
  at: Date,
  config: BranchScheduleConfig | null | undefined,
  opts: { after: Date; before?: Date | null; now?: Date },
): Date | null {
  const before = opts.before ?? null;
  const within = at.getTime() > opts.after.getTime() && (!before || at.getTime() <= before.getTime());
  if (within && (!hasOfficeHours(config) || isReturnTimeAllowed(config, at))) return at;
  const from = before && at.getTime() > before.getTime() ? before : at;
  return (
    firstAllowedFrom(config, from, 'return', { after: opts.after, before, now: opts.now }) ??
    (before ? lastAllowedUntil(config, before, 'return', { after: opts.after, now: opts.now }) : null)
  );
}

/** Short reason a return time is refused, e.g. "the branch closes at 10:00 PM". */
export function returnRefusalReason(v: Pick<ScheduleVerdict, 'reason' | 'closingTime' | 'gracePeriodEnd' | 'openingTime' | 'closedDayName'>): string {
  if (v.reason === 'CLOSED_DAY') return `the branch is closed on ${v.closedDayName ?? 'that day'}`;
  if (v.reason === 'BEFORE_OPEN') return `the branch opens at ${v.openingTime ?? 'opening time'}`;
  return `the branch closes at ${v.closingTime ?? 'closing time'}${
    v.gracePeriodEnd && v.gracePeriodEnd !== v.closingTime ? ` (returns until ${v.gracePeriodEnd})` : ''
  }`;
}

/** Why a pickup → return pair can't be offered as a quick length, or null when it can. */
export function rangeScheduleIssue(
  config: BranchScheduleConfig | null | undefined,
  start: Date,
  end: Date,
): string | null {
  if (!hasOfficeHours(config)) return null;
  const v = validateBookingSchedule(config, start, end);
  if (v.status === 'OK' || v.status === 'RETURN_GRACE') return null;
  if (v.status === 'RETURN_BUMPED') return `the return would be outside branch hours (${returnRefusalReason(v)})`;
  return buildScheduleErrorMessage(v);
}

export interface BookingTimesNotice {
  tone: 'warn' | 'error';
  text: string;
}

/**
 * What a booking screen should say about its current times: the server's
 * 15-day / monthly-length message, a pickup outside hours, an after-hours
 * return, or the grace note. null when the times are fine.
 */
export function bookingTimesNotice(
  config: BranchScheduleConfig | null | undefined,
  start: Date,
  end: Date,
  opts: { monthly?: boolean; now?: Date } = {},
): BookingTimesNotice | null {
  const window = validateBookingWindow({ startAt: start, endAt: end, now: opts.now, monthly: opts.monthly });
  if (!window.ok) return { tone: 'error', text: window.message };
  if (!hasOfficeHours(config)) return null;
  const v = validateBookingSchedule(config, start, end);
  switch (v.status) {
    case 'OK':
      return null;
    case 'RETURN_GRACE':
      return {
        tone: 'warn',
        text: `The branch closes at ${v.closingTime} on the return day — returns are accepted until ${v.gracePeriodEnd}.`,
      };
    case 'RETURN_BUMPED':
      return {
        tone: 'warn',
        text: `This return is outside branch hours (${returnRefusalReason(v)}). It would move to ${v.nextOpenLabel}.`,
      };
    default:
      return { tone: 'error', text: buildScheduleErrorMessage(v) };
  }
}

/**
 * "9:00 AM – 10:00 PM", "Closed" or "Open 24 hours" for one calendar day (a day
 * without saved hours shows DEFAULT_BRANCH_HOURS); null while the hours are unknown.
 */
export function dayHoursLabel(config: BranchScheduleConfig | null | undefined, day: Date): string | null {
  if (!config) return null;
  if (config.is24Hours) return 'Open 24 hours';
  const w = getDayWindow(config, withTime(day, '12:00'));
  if (!w) return null;
  if (!w.isOpen) return 'Closed';
  if (w.openMin === 0 && w.closeMin >= 1440) return 'Open 24 hours';
  return `${minutesToDisplay(w.openMin)} – ${minutesToDisplay(w.closeMin)}`;
}

/** Last pickup time on this calendar day, e.g. "10:30 PM"; null when there is none (closed, 24 hours, unknown). */
export function lastPickupTimeLabel(config: BranchScheduleConfig | null | undefined, day: Date): string | null {
  if (!hasOfficeHours(config)) return null;
  const w = getDayWindow(config, withTime(day, '12:00'));
  if (!w || !w.isOpen || w.lastPickupMin < w.openMin) return null;
  return minutesToDisplay(w.lastPickupMin);
}

/** Latest accepted return on this calendar day when the branch gives grace after closing, e.g. "11:30 PM". */
function returnsUntilLabel(config: BranchScheduleConfig, day: Date): string | null {
  if (config.graceMinutes <= 0) return null;
  const w = getDayWindow(config, withTime(day, '12:00'));
  if (!w || !w.isOpen) return null;
  // The return window ends with the day (a grace past midnight isn't carried over).
  return minutesToDisplay(Math.min(w.graceEndMin, 1439));
}

/**
 * One line of branch hours for a pickup/return pair, e.g.
 * "Branch hours 8:00 AM – 11:00 PM · last pickup 10:30 PM · returns until 11:30 PM",
 * or one part per day when they differ. `returnOnly` (extension screens, which
 * pick only a return) leaves the pickup out. null while the hours are unknown.
 */
export function rangeHoursLine(
  config: BranchScheduleConfig | null | undefined,
  start: Date,
  end: Date,
  opts: { returnOnly?: boolean } = {},
): string | null {
  if (!config) return null;
  if (config.is24Hours) return 'Branch open 24 hours';
  const pickup = dayHoursLabel(config, start);
  const ret = dayHoursLabel(config, end);
  if (!pickup || !ret) return null;
  const lastPickup = lastPickupTimeLabel(config, start);
  const returnsUntil = returnsUntilLabel(config, end);
  const returnPart = returnsUntil ? ` · returns until ${returnsUntil}` : '';
  if (opts.returnOnly) return `Branch hours ${ret}${returnPart}`;
  if (pickup === ret) return `Branch hours ${pickup}${lastPickup ? ` · last pickup ${lastPickup}` : ''}${returnPart}`;
  return `Pickup day ${pickup}${lastPickup ? ` (last pickup ${lastPickup})` : ''} · Return day ${ret}${
    returnsUntil ? ` (returns until ${returnsUntil})` : ''
  }`;
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Weekly hours, Monday first, with neighbouring days that share hours grouped:
 * [{ days: 'Mon – Sat', hours: '9:00 AM – 10:00 PM' }, { days: 'Sun', hours: 'Closed' }].
 * Days without saved hours show DEFAULT_BRANCH_HOURS. Empty while the hours are unknown.
 */
export function weeklyHours(config: BranchScheduleConfig | null | undefined): { days: string; hours: string }[] {
  if (!config) return [];
  if (config.is24Hours) return [{ days: 'Every day', hours: 'Open 24 hours' }];
  const order = [1, 2, 3, 4, 5, 6, 0];
  const labelFor = (dow: number) => {
    const d = getScheduleForDay(config, dow);
    if (!d.isOpen) return 'Closed';
    if (d.openMinutes === 0 && d.closeMinutes >= 1440) return 'Open 24 hours';
    return `${minutesToDisplay(d.openMinutes)} – ${minutesToDisplay(d.closeMinutes)}`;
  };
  const out: { from: number; to: number; hours: string }[] = [];
  for (const dow of order) {
    const hours = labelFor(dow);
    const prev = out[out.length - 1];
    if (prev && prev.hours === hours) prev.to = dow;
    else out.push({ from: dow, to: dow, hours });
  }
  if (out.length === 1) return [{ days: 'Every day', hours: out[0]!.hours }];
  return out.map((g) => ({
    days: g.from === g.to ? SHORT_DAYS[g.from]! : `${SHORT_DAYS[g.from]} – ${SHORT_DAYS[g.to]}`,
    hours: g.hours,
  }));
}

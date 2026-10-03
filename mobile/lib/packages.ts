// Booking packages on the booking screens (BRIEF4 P1 / P3 / P4a), built on the
// shared rule in ./bookingWindow (CUSTOMER_PACKAGES, customerPackageEnd …).
//
// Customers pick a pickup and a PACKAGE — "12 hours" or "1 day" … "15 days" —
// and the return is computed from them (never picked freely), so customer
// booking create's BOOKING_PACKAGE_REQUIRED can't be hit from the app.
// Self-extensions add +12 hours or + N days. Fleet walk-ins use the same
// packages plus 0–11 extra hours (the server takes any length from staff).
import {
  CUSTOMER_PACKAGES,
  HALF_DAY_PACKAGE_HOURS,
  MAX_BOOKING_DAYS,
  bookingWindowEnd,
  customerPackageEnd,
  customerPackagesForPickup,
  extensionPackageOptions,
  matchPackageHours,
  packageLabel,
} from './bookingWindow';
import {
  bookingTimesNotice,
  firstAllowedFrom,
  getBranchLocalTime,
  hasOfficeHours,
  isPickupTimeAllowed,
  minutesToDisplay,
  validateReturnTime,
  type BookingTimesNotice,
  type BranchScheduleConfig,
} from './branchSchedule';
import { maxReturnFor, nextFiveMinuteMark } from './dates';

const HOUR_MS = 3_600_000;

/** The package a new booking screen starts on: 1 day. */
export const DEFAULT_PACKAGE_HOURS = 24;

/** Fleet walk-in only: hours that can be added on top of a package (0–11). */
export const WALKIN_EXTRA_HOURS = Array.from({ length: 12 }, (_, i) => i);

/** One package as a picker shows it: its return and why it can't be chosen (null = it can). */
export interface PackageChoice {
  hours: number;
  label: string;
  endAt: Date;
  issue: string | null;
}

/** A pickup and the package booked from it (the return is derived). */
export interface PackageRange {
  start: Date;
  hours: number;
}

export function packageRangeEnd(r: PackageRange, extraHours = 0): Date {
  return customerPackageEnd(r.start, r.hours + extraHours);
}

/**
 * The package hours a pickup → return asks for: the exact package when it is
 * one, else the shortest package at least that long (the server's office-hours
 * adjust lengthens too), capped at 15 days. 1 day when there is no return.
 */
export function packageHoursFor(start: Date, end?: Date | null): number {
  if (!end || isNaN(end.getTime())) return DEFAULT_PACKAGE_HOURS;
  const exact = matchPackageHours(start, end);
  if (exact !== null) return exact;
  const spanHours = (end.getTime() - start.getTime()) / HOUR_MS;
  if (!(spanHours > 0)) return DEFAULT_PACKAGE_HOURS;
  const longer = CUSTOMER_PACKAGES.find((p) => p.hours >= spanHours);
  return (longer ?? CUSTOMER_PACKAGES[CUSTOMER_PACKAGES.length - 1]!).hours;
}

/**
 * Opening pickup + package for a booking screen: the incoming ISO times when
 * valid (their length read as a package), else the next 5-minute mark and
 * 1 day. A pickup already in the past moves to the next 5-minute mark.
 */
export function initialPackageRange(startIso?: string | null, endIso?: string | null, now: Date = new Date()): PackageRange {
  const parse = (iso?: string | null) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d.getTime()) ? d : null;
  };
  const start = parse(startIso);
  const end = parse(endIso);
  const hours = start ? packageHoursFor(start, end) : DEFAULT_PACKAGE_HOURS;
  const pickup = start && start.getTime() > now.getTime() ? start : nextFiveMinuteMark(now);
  return { start: pickup, hours };
}

/**
 * A pickup that is no longer in the future (screen left open) moves to the
 * next 5-minute mark; the package — and so the return — follows it. Hands
 * back the same object when nothing moved (cheap for a periodic check).
 */
export function refreshPackageRange<R extends PackageRange>(r: R, now: Date = new Date()): R {
  return r.start.getTime() > now.getTime() ? r : { ...r, start: nextFiveMinuteMark(now) };
}

/** Latest pickup that still leaves the 12-hour package inside the 15-day window. */
export function latestPackagePickup(now: Date = new Date()): Date {
  return new Date(bookingWindowEnd(now).getTime() - HALF_DAY_PACKAGE_HOURS * HOUR_MS);
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function clockLabel(at: Date): string {
  const { hours, minutes } = getBranchLocalTime(at);
  return minutesToDisplay(hours * 60 + minutes);
}

/**
 * Why a return time is outside the branch's return window (open day,
 * opening … closing + grace), in words that read the same for every package
 * that hits it — e.g. "the return would be at 6:00 AM, before the branch opens
 * (8:00 AM)". null when the branch takes returns then.
 */
export function returnIssue(config: BranchScheduleConfig | null | undefined, at: Date): string | null {
  if (!hasOfficeHours(config)) return null;
  const v = validateReturnTime(config, at);
  if (v.status !== 'RETURN_OUTSIDE_HOURS') return null;
  if (v.reason === 'CLOSED_DAY') {
    return `the branch is closed on the return day (${v.closedDayName ?? SHORT_DAYS[getBranchLocalTime(at).dayOfWeek]})`;
  }
  if (v.reason === 'BEFORE_OPEN') {
    return `the return would be at ${clockLabel(at)}, before the branch opens (${v.openingTime ?? 'opening time'})`;
  }
  const until = v.gracePeriodEnd && v.gracePeriodEnd !== v.closingTime ? `, returns until ${v.gracePeriodEnd}` : '';
  return `the return would be at ${clockLabel(at)}, after the branch closes (${v.closingTime ?? 'closing time'}${until})`;
}

/**
 * Customer packages for a pickup: every package whose return is inside the
 * 15-day window, each with its return and, when the branch wouldn't take a
 * return then, why not (the 12-hour package overnight; a day package whose
 * return day is closed or shorter).
 */
export function customerPackageChoices(
  start: Date,
  config: BranchScheduleConfig | null | undefined,
  now: Date = new Date(),
): PackageChoice[] {
  return customerPackagesForPickup(start, now).map((p) => ({
    hours: p.hours,
    label: p.label,
    endAt: p.endAt,
    issue: returnIssue(config, p.endAt),
  }));
}

/** The usable package nearest to `hours`: itself, else the next longer one, else the longest shorter one. */
export function nearestUsablePackage(choices: PackageChoice[], hours: number): number | null {
  const usable = choices.filter((c) => !c.issue);
  if (usable.some((c) => c.hours === hours)) return hours;
  const longer = usable.find((c) => c.hours > hours);
  if (longer) return longer.hours;
  return usable.length ? usable[usable.length - 1]!.hours : null;
}

/**
 * Keeps a pickup + package bookable once the pickers (or the clock) move it:
 *  1. a pickup in the past moves to the next 5-minute mark;
 *  2. a pickup outside office hours moves to the next accepted pickup;
 *  3. a package that no longer fits (past the window, return outside hours)
 *     becomes the nearest one that does.
 * Hands back the same object when nothing moved, so it can run in an effect.
 */
export function fitPackageRange<R extends PackageRange>(
  r: R,
  opts: { config?: BranchScheduleConfig | null; now?: Date } = {},
): R {
  const now = opts.now ?? new Date();
  const config = hasOfficeHours(opts.config) ? opts.config : null;
  let start = r.start.getTime() > now.getTime() ? r.start : nextFiveMinuteMark(now);
  if (config && !isPickupTimeAllowed(config, start)) {
    const next = firstAllowedFrom(config, start, 'pickup', { now, before: latestPackagePickup(now) });
    if (next) start = next;
  }
  const hours = nearestUsablePackage(customerPackageChoices(start, config, now), r.hours) ?? r.hours;
  if (start.getTime() === r.start.getTime() && hours === r.hours) return r;
  return { ...r, start, hours };
}

function istDayLabel(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ist = new Date(d.getTime() + 330 * 60_000);
  return `${ist.getUTCDate()} ${months[ist.getUTCMonth()]}`;
}

/**
 * What a customer booking screen should say about its pickup + package: no
 * package left in the 15-day window, the pickup outside hours, the return in
 * the grace after closing, or a return the branch would move. null when fine.
 */
export function packageTimesNotice(
  config: BranchScheduleConfig | null | undefined,
  r: PackageRange,
  now: Date = new Date(),
): BookingTimesNotice | null {
  if (customerPackagesForPickup(r.start, now).length === 0) {
    return {
      tone: 'error',
      text: `Bookings can run up to ${MAX_BOOKING_DAYS} days from today (return by ${istDayLabel(
        bookingWindowEnd(now),
      )}), so even the 12-hour package from this pickup is too long. Choose an earlier pickup.`,
    };
  }
  return bookingTimesNotice(config, r.start, packageRangeEnd(r), { now });
}

// ── Fleet walk-in: package + extra hours (P4a) ─────────────────────────────

/** Why `extra` hours on top of a package can't be used; null when they can. */
export function walkinExtraIssue(
  config: BranchScheduleConfig | null | undefined,
  start: Date,
  packageHours: number,
  extra: number,
  now: Date = new Date(),
): string | null {
  const end = customerPackageEnd(start, packageHours + extra);
  if (end.getTime() > maxReturnFor(start, now).getTime()) return `past the ${MAX_BOOKING_DAYS}-day limit`;
  return returnIssue(config, end);
}

/** Packages for a walk-in pickup with `extra` hours on top, each checked with them. */
export function walkinPackageChoices(
  start: Date,
  extra: number,
  config: BranchScheduleConfig | null | undefined,
  now: Date = new Date(),
): PackageChoice[] {
  return customerPackagesForPickup(start, now).map((p) => ({
    hours: p.hours,
    label: p.label,
    endAt: customerPackageEnd(start, p.hours + extra),
    issue: walkinExtraIssue(config, start, p.hours, extra, now),
  }));
}

export interface WalkinPackage extends PackageRange {
  extra: number;
}

/**
 * fitPackageRange for the walk-in: the pickup as for customers; then the extra
 * hours closest to the chosen ones that work with the package, else the nearest
 * package with no extra hours.
 */
export function fitWalkinPackage(
  r: WalkinPackage,
  opts: { config?: BranchScheduleConfig | null; now?: Date } = {},
): WalkinPackage {
  const now = opts.now ?? new Date();
  const config = hasOfficeHours(opts.config) ? opts.config : null;
  let start = r.start.getTime() > now.getTime() ? r.start : nextFiveMinuteMark(now);
  if (config && !isPickupTimeAllowed(config, start)) {
    const next = firstAllowedFrom(config, start, 'pickup', { now, before: latestPackagePickup(now) });
    if (next) start = next;
  }
  let hours = r.hours;
  let extra = r.extra;
  const inWindow = customerPackagesForPickup(start, now).some((p) => p.hours === hours);
  if (!inWindow || walkinExtraIssue(config, start, hours, extra, now)) {
    const extras = inWindow
      ? WALKIN_EXTRA_HOURS.filter((e) => !walkinExtraIssue(config, start, hours, e, now)).sort(
          (a, b) => Math.abs(a - r.extra) - Math.abs(b - r.extra),
        )
      : [];
    if (extras.length) {
      extra = extras[0]!;
    } else {
      extra = 0;
      hours = nearestUsablePackage(walkinPackageChoices(start, 0, config, now), hours) ?? hours;
    }
  }
  if (start.getTime() === r.start.getTime() && hours === r.hours && extra === r.extra) return r;
  return { start, hours, extra };
}

/** "1 day + 2 hours", "12 hours" — a package with extra hours. */
export function walkinLengthLabel(packageHours: number, extra: number): string {
  const base = packageLabel(packageHours);
  if (extra <= 0) return base;
  return `${base} + ${extra} hour${extra === 1 ? '' : 's'}`;
}

// ── Customer self-extension (P3) ────────────────────────────────────────────

/** An extension package as the eligibility response sends it (packageOptions). */
export interface ServerExtensionPackage {
  hours: number;
  label: string;
  newEndAt: string;
  insideHours: boolean;
}

/**
 * The +12 hours / + N days choices for a trip ending at `currentEnd`: the
 * server's packageOptions when it sends them (its office-hours verdict wins),
 * else the same list built here up to `maxEnd` with the schedule mirror.
 */
export function extensionChoices(
  currentEnd: Date,
  opts: {
    serverOptions?: ServerExtensionPackage[] | null;
    maxEnd?: Date | null;
    config?: BranchScheduleConfig | null;
  },
): PackageChoice[] {
  const { serverOptions, maxEnd, config } = opts;
  if (Array.isArray(serverOptions)) {
    return serverOptions
      .map((o) => {
        const endAt = new Date(o.newEndAt);
        return {
          hours: Number(o.hours),
          label: `+${o.label}`,
          endAt,
          issue: o.insideHours ? null : returnIssue(config, endAt) ?? 'the return would be outside branch hours',
        };
      })
      .filter((c) => Number.isFinite(c.hours) && !isNaN(c.endAt.getTime()));
  }
  const limit = maxEnd ?? customerPackageEnd(currentEnd, MAX_BOOKING_DAYS * 24);
  return extensionPackageOptions(currentEnd, limit).map((o) => ({
    hours: o.hours,
    label: `+${o.label}`,
    endAt: o.newEndAt,
    issue: returnIssue(config, o.newEndAt),
  }));
}

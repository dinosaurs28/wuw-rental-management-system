// Booking packages for the date pickers (Oct 3 follow-up, P1 / P4a).
//
// Customers book PACKAGES only: a pickup date + time and "12 hours" or
// "1 day" … "15 days". The return is the pickup + 12 h / N × 24 h, computed
// here and shown read-only — there is no free return picker, so odd lengths
// (6 PM → 8 AM = 14 h) can't be asked for. The server refuses anything else
// with BOOKING_PACKAGE_REQUIRED.
//
// Fleet walk-ins use the same packages plus 0–11 extra hours (priced by the
// engine at the Extra Hour Rate); the server accepts any length there.
//
// Same model as bookingPickers.ts: a calendar day (local-midnight Date) plus
// an "HH:mm" IST wall-clock time.
import {
  CUSTOMER_PACKAGES,
  MAX_BOOKING_DAYS,
  PACKAGE_TOLERANCE_MS,
  packageLabel,
} from "@repo/schemas";
import type { BranchScheduleConfig } from "@/services/branch.service";
import {
  getBranchLocalTime,
  minutesToDisplay,
  validateReturnTime,
} from "@/utils/branchScheduleValidator";
import { istCalendarParts, istInstant, maxReturnFor } from "@/utils/bookingPickers";

const HOUR_MS = 60 * 60 * 1000;

/** Fleet walk-ins: most extra hours on top of a package (12 h + 11 h, 1 day + 11 h …). */
export const MAX_EXTRA_HOURS = 11;
/** Package used when a range has no return yet: 1 day. */
export const DEFAULT_PACKAGE_HOURS = 24;

export interface PackageOption {
  /** "12H" or "<N>D". */
  id: string;
  hours: number;
  /** "12 hours", "1 day", "2 days" … */
  label: string;
  /** pickup + the package (without extra hours). */
  returnAt: Date;
  /** Why it can't be picked (return outside office hours); null = can be picked. */
  disabledReason: string | null;
}

export interface ExtraHoursOption {
  hours: number;
  /** pickup + package + these hours. */
  returnAt: Date;
  disabledReason: string | null;
}

export interface PackageRangeInput {
  schedule?: BranchScheduleConfig;
  pickupDate: Date | null;
  pickupTime: string;
  returnDate: Date | null;
  returnTime: string;
  /** Fleet walk-in: 0–MAX_EXTRA_HOURS extra hours on top of the package. */
  allowExtraHours?: boolean;
  now?: Date;
}

export interface PackageChoice {
  packageHours: number;
  extraHours: number;
}

export interface PackageRangeState {
  /** Packages whose return is inside the 15-day window, shortest first. */
  options: PackageOption[];
  /** The package the range is (null when nothing can be booked for this pickup). */
  selected: PackageOption | null;
  /** Extra hours on top of `selected` (always 0 for customers). */
  extraHours: number;
  /** Fleet: 0–11 extra hours for `selected`, with the out-of-hours ones disabled. */
  extraOptions: ExtraHoursOption[];
  /** Computed return (pickup + package + extra hours). */
  returnAt: Date | null;
  /**
   * The return to write back when the picked range isn't a package that can be
   * booked (an old free-picker range, a pickup change, hours that just loaded);
   * null when it already is one.
   */
  correction: { returnDate: Date; returnTime: string } | null;
  /** No package fits this pickup (every return is outside office hours). */
  noneAvailable: boolean;
}

/** "6:00 AM" — the IST time of an instant. */
function istClock(at: Date): string {
  const { hours, minutes } = getBranchLocalTime(at);
  return minutesToDisplay(hours * 60 + minutes);
}

/**
 * Why a return can't be booked: past the window, or outside the branch's
 * return hours (open day, opening … closing + grace). null = fine.
 */
export function packageReturnProblem(
  schedule: BranchScheduleConfig | undefined,
  returnAt: Date,
  maxReturnAt: Date | null,
): string | null {
  if (maxReturnAt && returnAt.getTime() > maxReturnAt.getTime()) {
    return `Past the ${MAX_BOOKING_DAYS}-day booking limit`;
  }
  if (!schedule) return null;
  const verdict = validateReturnTime(schedule, returnAt);
  if (verdict.status !== "RETURN_OUTSIDE_HOURS") return null;
  if (verdict.reason === "CLOSED_DAY") {
    return `The return would fall on ${verdict.closedDayName ?? "a closed day"}, when the branch is closed`;
  }
  if (verdict.reason === "BEFORE_OPEN") {
    return `The return would be ${istClock(returnAt)}, before the branch opens (${verdict.openingTime})`;
  }
  const grace =
    verdict.gracePeriodEnd && verdict.gracePeriodEnd !== verdict.closingTime
      ? `, returns until ${verdict.gracePeriodEnd}`
      : "";
  return `The return would be ${istClock(returnAt)}, after the branch closes (${verdict.closingTime}${grace})`;
}

/**
 * A span as package + extra hours: exactly a package (±1 minute), or — with
 * maxExtraHours — a package plus 1…maxExtraHours whole hours. null otherwise.
 */
export function splitPackageSpan(
  startAt: Date,
  endAt: Date,
  maxExtraHours = 0,
): PackageChoice | null {
  const span = endAt.getTime() - startAt.getTime();
  if (!Number.isFinite(span) || span <= 0) return null;
  // Longest package first: extra hours are < 12, so at most one package fits
  for (let i = CUSTOMER_PACKAGES.length - 1; i >= 0; i--) {
    const pkg = CUSTOMER_PACKAGES[i]!;
    const rest = span - pkg.hours * HOUR_MS;
    if (rest < -PACKAGE_TOLERANCE_MS) continue;
    const extra = Math.round(rest / HOUR_MS);
    if (extra > maxExtraHours) return null;
    if (Math.abs(rest - extra * HOUR_MS) <= PACKAGE_TOLERANCE_MS) {
      return { packageHours: pkg.hours, extraHours: extra };
    }
    return null;
  }
  return null;
}

/** The package closest to a span that isn't one: ≤ 12 h → 12 hours, else the nearest whole days (1–15). */
export function nearestPackageHours(startAt: Date, endAt: Date): number {
  const hours = (endAt.getTime() - startAt.getTime()) / HOUR_MS;
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_PACKAGE_HOURS;
  if (hours <= 12) return 12;
  const days = Math.min(MAX_BOOKING_DAYS, Math.max(1, Math.round(hours / 24)));
  return days * 24;
}

interface Built {
  start: Date;
  maxReturnAt: Date;
  maxExtra: number;
  options: PackageOption[];
  extrasFor: (packageHours: number) => ExtraHoursOption[];
}

function build(input: PackageRangeInput & { pickupDate: Date }): Built {
  const now = input.now ?? new Date();
  const start = istInstant(input.pickupDate, input.pickupTime || "10:00");
  const maxReturnAt = maxReturnFor(start, { now });
  const maxExtra = input.allowExtraHours ? MAX_EXTRA_HOURS : 0;

  const extrasFor = (packageHours: number): ExtraHoursOption[] =>
    Array.from({ length: maxExtra + 1 }, (_, extra) => {
      const returnAt = new Date(start.getTime() + (packageHours + extra) * HOUR_MS);
      return {
        hours: extra,
        returnAt,
        disabledReason: packageReturnProblem(input.schedule, returnAt, maxReturnAt),
      };
    });

  const options = CUSTOMER_PACKAGES.map((pkg) => ({
    pkg,
    returnAt: new Date(start.getTime() + pkg.hours * HOUR_MS),
  }))
    // Capped by the 15-day window (from today) and the 15-day length
    .filter(({ returnAt }) => returnAt.getTime() <= maxReturnAt.getTime())
    .map(({ pkg, returnAt }) => {
      let disabledReason = packageReturnProblem(input.schedule, returnAt, null);
      // Fleet: a package is usable when some extra hours bring the return inside hours
      if (disabledReason && maxExtra > 0 && extrasFor(pkg.hours).some((e) => !e.disabledReason)) {
        disabledReason = null;
      }
      return { id: pkg.id, hours: pkg.hours, label: pkg.label, returnAt, disabledReason };
    });

  return { start, maxReturnAt, maxExtra, options, extrasFor };
}

function resolve(built: Built, preferred: PackageChoice): (PackageChoice & { option: PackageOption; extras: ExtraHoursOption[] }) | null {
  const enabled = built.options.filter((o) => !o.disabledReason);
  if (enabled.length === 0) return null;
  // The same package, else the next longer one that can be booked, else the longest
  const option =
    enabled.find((o) => o.hours === preferred.packageHours) ??
    enabled.find((o) => o.hours > preferred.packageHours) ??
    enabled[enabled.length - 1]!;
  const extras = built.extrasFor(option.hours);
  const usable = extras.filter((e) => !e.disabledReason);
  // Keep the extra hours when allowed there, else the nearest allowed count
  const extra = usable.reduce(
    (best, e) =>
      Math.abs(e.hours - preferred.extraHours) < Math.abs(best - preferred.extraHours) ? e.hours : best,
    usable[0]?.hours ?? 0,
  );
  return { packageHours: option.hours, extraHours: extra, option, extras };
}

const EMPTY: PackageRangeState = {
  options: [],
  selected: null,
  extraHours: 0,
  extraOptions: [],
  returnAt: null,
  correction: null,
  noneAvailable: false,
};

/**
 * The package picker for a pickup + the current return: the options, which
 * one the range is, the computed return, and the return to write back when
 * the range isn't a bookable package.
 */
export function packageRangeState(input: PackageRangeInput): PackageRangeState {
  if (!input.pickupDate) return EMPTY;
  const built = build({ ...input, pickupDate: input.pickupDate });
  const end = input.returnDate ? istInstant(input.returnDate, input.returnTime || "10:00") : null;
  const preferred: PackageChoice =
    (end && splitPackageSpan(built.start, end, built.maxExtra)) ?? {
      packageHours: end ? nearestPackageHours(built.start, end) : DEFAULT_PACKAGE_HOURS,
      extraHours: 0,
    };
  const choice = resolve(built, preferred);
  if (!choice) {
    return { ...EMPTY, options: built.options, noneAvailable: built.options.length > 0 };
  }
  const returnAt = new Date(built.start.getTime() + (choice.packageHours + choice.extraHours) * HOUR_MS);
  const parts = istCalendarParts(returnAt);
  const correction =
    end && Math.abs(end.getTime() - returnAt.getTime()) < 60_000
      ? null
      : { returnDate: parts.day, returnTime: parts.time };
  return {
    options: built.options,
    selected: choice.option,
    extraHours: choice.extraHours,
    extraOptions: built.maxExtra > 0 ? choice.extras : [],
    returnAt,
    correction,
    noneAvailable: false,
  };
}

/**
 * The return for a package (+ extra hours) at this pickup — or, when that one
 * can't be booked, the nearest one that can. null when no package fits.
 */
export function returnForPackage(
  input: Omit<PackageRangeInput, "returnDate" | "returnTime">,
  choice: PackageChoice,
): { returnDate: Date; returnTime: string } | null {
  if (!input.pickupDate) return null;
  const built = build({ ...input, pickupDate: input.pickupDate, returnDate: null, returnTime: "" });
  const resolved = resolve(built, choice);
  if (!resolved) return null;
  const parts = istCalendarParts(
    new Date(built.start.getTime() + (resolved.packageHours + resolved.extraHours) * HOUR_MS),
  );
  return { returnDate: parts.day, returnTime: parts.time };
}

/**
 * The pickup moved: keep the package (+ extra hours) the range had and return
 * the new return for the new pickup. Ranges that weren't a package take the
 * nearest one.
 */
export function returnForNewPickup(
  previous: PackageRangeInput,
  next: { pickupDate: Date | null; pickupTime: string },
): { returnDate: Date; returnTime: string } | null {
  let choice: PackageChoice = { packageHours: DEFAULT_PACKAGE_HOURS, extraHours: 0 };
  if (previous.pickupDate && previous.returnDate) {
    const start = istInstant(previous.pickupDate, previous.pickupTime || "10:00");
    const end = istInstant(previous.returnDate, previous.returnTime || "10:00");
    choice =
      splitPackageSpan(start, end, previous.allowExtraHours ? MAX_EXTRA_HOURS : 0) ??
      { packageHours: nearestPackageHours(start, end), extraHours: 0 };
  }
  return returnForPackage({ ...previous, ...next }, choice);
}

/** "1 day + 2 hours" / "12 hours" — the length a package + extra hours books. */
export function packageLengthLabel(packageHours: number, extraHours = 0): string {
  const base = packageLabel(packageHours);
  if (!extraHours) return base;
  return `${base} + ${extraHours} hour${extraHours === 1 ? "" : "s"}`;
}

import { DateTime } from "luxon";
import { SYSTEM_TIMEZONE } from "../../services/timezone/timezone.service.js";
import { parseIstDate } from "./istPeriod.js";

/**
 * Previous-period math for "vs previous period" comparisons (spec §9.3).
 *
 * All ranges are inclusive IST calendar days (yyyy-MM-dd). Rules:
 *  - day:    a single day                         -> the day before
 *  - week:   starts on a Monday, ≤ 7 days, inside one ISO week (full week or
 *            week-to-date)                        -> same offsets one week earlier
 *  - month:  starts on the 1st, inside one calendar month (full month or
 *            month-to-date)                       -> previous month, same day
 *            count clipped to that month's end; a full month maps to the full
 *            previous month
 *  - custom: anything else                        -> the same-length window
 *            immediately before
 * An explicit preset (today/yesterday/thisWeek/…) forces the kind.
 */

export type ReportPreset =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "custom";

export const REPORT_PRESETS: ReportPreset[] = [
  "today",
  "yesterday",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "lastMonth",
  "custom",
];

export type PeriodKind = "day" | "week" | "month" | "custom";

export interface PreviousPeriod {
  kind: PeriodKind;
  /** yyyy-MM-dd (IST), inclusive. */
  from: string;
  to: string;
  /** 00:00:00.000 IST of `from`. */
  start: Date;
  /** 23:59:59.999 IST of `to`. */
  end: Date;
  days: number;
  /** Comparison label, e.g. "vs yesterday", "vs 1–15 Sep". */
  label: string;
  /** Label of the current range, e.g. "Today", "1–15 Oct". */
  currentLabel: string;
}

const fmt = (dt: DateTime): string => dt.toFormat("yyyy-MM-dd");

/** "1–15 Oct", "29 Sep – 5 Oct", "5 Oct", "28 Dec 2025 – 3 Jan 2026". */
export const formatRangeLabel = (from: DateTime, to: DateTime): string => {
  if (from.hasSame(to, "day")) return from.toFormat("d MMM yyyy");
  if (from.hasSame(to, "month")) return `${from.toFormat("d")}–${to.toFormat("d MMM yyyy")}`;
  if (from.hasSame(to, "year")) return `${from.toFormat("d MMM")} – ${to.toFormat("d MMM yyyy")}`;
  return `${from.toFormat("d MMM yyyy")} – ${to.toFormat("d MMM yyyy")}`;
};

const toDay = (value: string | DateTime): DateTime => {
  if (typeof value !== "string") return value.setZone(SYSTEM_TIMEZONE).startOf("day");
  const parsed = parseIstDate(value);
  if (!parsed) throw new Error(`Invalid date '${value}' (expected YYYY-MM-DD)`);
  return parsed;
};

/** Classify a range (inclusive days) into a comparison kind. */
export const classifyPeriod = (
  from: DateTime,
  to: DateTime,
  preset?: ReportPreset | null,
): PeriodKind => {
  if (preset === "today" || preset === "yesterday") return "day";
  if (preset === "thisWeek" || preset === "lastWeek") return "week";
  if (preset === "thisMonth" || preset === "lastMonth") return "month";
  if (preset === "custom") return "custom";
  if (from.hasSame(to, "day")) return "day";
  if (from.weekday === 1 && from.hasSame(to, "week") && to >= from) return "week";
  if (from.day === 1 && from.hasSame(to, "month") && to >= from) return "month";
  return "custom";
};

/**
 * The immediately preceding equivalent range for [from, to] (IST days).
 */
export const previousPeriod = (opts: {
  from: string | DateTime;
  to: string | DateTime;
  preset?: ReportPreset | null;
  /** Reference "now" — only used for nicer labels ("Today", "vs yesterday"). */
  now?: DateTime;
}): PreviousPeriod => {
  const from = toDay(opts.from);
  const to = toDay(opts.to);
  if (to < from) throw new Error("'to' must be on or after 'from'");
  const days = Math.round(to.diff(from, "days").days) + 1;
  const kind = classifyPeriod(from, to, opts.preset ?? null);
  const today = (opts.now ?? DateTime.now()).setZone(SYSTEM_TIMEZONE).startOf("day");

  let pFrom: DateTime;
  let pTo: DateTime;
  let label: string;
  let currentLabel = formatRangeLabel(from, to);

  switch (kind) {
    case "day": {
      // A "day" preset with a multi-day range never happens; fall back safely.
      pTo = from.minus({ days: 1 });
      pFrom = pTo.minus({ days: days - 1 });
      if (days === 1 && from.hasSame(today, "day")) {
        currentLabel = "Today";
        label = "vs yesterday";
      } else if (days === 1 && from.hasSame(today.minus({ days: 1 }), "day")) {
        currentLabel = "Yesterday";
        label = `vs ${formatRangeLabel(pFrom, pTo)}`;
      } else {
        label = `vs ${formatRangeLabel(pFrom, pTo)}`;
      }
      break;
    }
    case "week": {
      pFrom = from.minus({ weeks: 1 });
      pTo = to.minus({ weeks: 1 });
      const full = days === 7;
      label = full
        ? `vs previous week (${formatRangeLabel(pFrom, pTo)})`
        : `vs same days last week (${formatRangeLabel(pFrom, pTo)})`;
      break;
    }
    case "month": {
      const prevMonthStart = from.minus({ months: 1 }).startOf("month");
      const prevMonthEnd = prevMonthStart.endOf("month").startOf("day");
      const fullMonth = from.day === 1 && to.hasSame(to.endOf("month"), "day") && from.hasSame(to, "month");
      pFrom = prevMonthStart;
      if (fullMonth) {
        pTo = prevMonthEnd;
        label = `vs ${prevMonthStart.toFormat("MMM yyyy")}`;
      } else {
        const candidate = prevMonthStart.plus({ days: days - 1 });
        pTo = candidate > prevMonthEnd ? prevMonthEnd : candidate;
        label = `vs same period last month (${formatRangeLabel(pFrom, pTo)})`;
      }
      if (fullMonth) currentLabel = from.toFormat("MMM yyyy");
      break;
    }
    default: {
      pTo = from.minus({ days: 1 });
      pFrom = pTo.minus({ days: days - 1 });
      label = `vs previous ${days} days (${formatRangeLabel(pFrom, pTo)})`;
      break;
    }
  }

  const pDays = Math.round(pTo.diff(pFrom, "days").days) + 1;
  return {
    kind,
    from: fmt(pFrom),
    to: fmt(pTo),
    start: pFrom.startOf("day").toJSDate(),
    end: pTo.endOf("day").toJSDate(),
    days: pDays,
    label,
    currentLabel,
  };
};

/**
 * Resolve a preset to concrete IST days relative to `now`.
 * Weeks are ISO (Monday–Sunday). "This week"/"This month" run to today.
 */
export const resolvePresetDays = (
  preset: Exclude<ReportPreset, "custom">,
  now?: DateTime,
): { from: string; to: string } => {
  const today = (now ?? DateTime.now()).setZone(SYSTEM_TIMEZONE).startOf("day");
  switch (preset) {
    case "today":
      return { from: fmt(today), to: fmt(today) };
    case "yesterday": {
      const y = today.minus({ days: 1 });
      return { from: fmt(y), to: fmt(y) };
    }
    case "thisWeek":
      return { from: fmt(today.startOf("week")), to: fmt(today) };
    case "lastWeek": {
      const s = today.startOf("week").minus({ weeks: 1 });
      return { from: fmt(s), to: fmt(s.plus({ days: 6 })) };
    }
    case "thisMonth":
      return { from: fmt(today.startOf("month")), to: fmt(today) };
    case "lastMonth": {
      const s = today.startOf("month").minus({ months: 1 });
      return { from: fmt(s), to: fmt(s.endOf("month").startOf("day")) };
    }
  }
};

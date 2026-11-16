import { DateTime } from "luxon";
import { SYSTEM_TIMEZONE } from "../../services/timezone/timezone.service.js";
import { parseIstDate } from "./istPeriod.js";

/**
 * Admin report date range. Every day boundary is cut at IST (Asia/Kolkata)
 * midnight regardless of the Node process timezone (UTC on the VPS), the same
 * way the finance reports do it (istPeriod.ts / previousPeriod.ts).
 */
export interface ReportRange {
  /** Inclusive start of selected range (00:00:00.000 IST). */
  start: Date;
  /** Inclusive end of selected range (23:59:59.999 IST). */
  end: Date;
  /** Start of the same-duration window immediately before the selected range. */
  prevStart: Date;
  /** End of the previous window. */
  prevEnd: Date;
  /** Number of calendar days in the selected range (inclusive). */
  days: number;
  /** First IST calendar day of the range, yyyy-MM-dd. */
  from: string;
  /** Last IST calendar day of the range, yyyy-MM-dd. */
  to: string;
}

export type DateRangePreset =
  | "today"
  | "last7"
  | "last30"
  | "thisMonth"
  | "lastMonth"
  | "custom";

/**
 * A query date as an IST calendar day. `yyyy-MM-dd` is taken as that IST day;
 * a full timestamp is converted to the IST day containing that instant.
 */
const parseDay = (value: unknown): DateTime | null => {
  if (!value) return null;
  const str = String(value);
  if (str.length <= 10) return parseIstDate(str);
  const dt = DateTime.fromISO(str, { setZone: true });
  const parsed = dt.isValid ? dt : DateTime.fromJSDate(new Date(str));
  return parsed.isValid ? parsed.setZone(SYSTEM_TIMEZONE).startOf("day") : null;
};

/**
 * Resolve the canonical date-range context shared by every widget on a report
 * page. Honors an explicit preset, then explicit start/end, then defaults to
 * Last 30 Days (spec §0.3). The previous period is always the same-duration
 * window immediately before the selected range, computed server-side (spec §0.2).
 */
export const resolveReportRange = (query: {
  preset?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  from?: unknown;
  to?: unknown;
  now?: Date;
}): ReportRange => {
  const today = DateTime.fromJSDate(query.now ?? new Date())
    .setZone(SYSTEM_TIMEZONE)
    .startOf("day");
  const preset = query.preset
    ? (String(query.preset) as DateRangePreset)
    : undefined;

  let fromDay: DateTime;
  let toDay: DateTime;

  const explicitStart = parseDay(query.startDate ?? query.from);
  const explicitEnd = parseDay(query.endDate ?? query.to);

  switch (preset) {
    case "today":
      fromDay = today;
      toDay = today;
      break;
    case "last7":
      fromDay = today.minus({ days: 6 });
      toDay = today;
      break;
    case "thisMonth":
      fromDay = today.startOf("month");
      toDay = today;
      break;
    case "lastMonth": {
      fromDay = today.startOf("month").minus({ months: 1 });
      toDay = fromDay.endOf("month").startOf("day");
      break;
    }
    case "last30":
      fromDay = today.minus({ days: 29 });
      toDay = today;
      break;
    case "custom":
    default:
      if (explicitStart && explicitEnd) {
        fromDay = explicitStart;
        toDay = explicitEnd;
      } else {
        // Default: Last 30 Days
        fromDay = today.minus({ days: 29 });
        toDay = today;
      }
      break;
  }

  // IST has no DST, so the day difference is always a whole number.
  const days = Math.round(toDay.diff(fromDay, "days").days) + 1;
  const prevToDay = fromDay.minus({ days: 1 });
  const prevFromDay = prevToDay.minus({ days: days - 1 });

  return {
    start: fromDay.startOf("day").toJSDate(),
    end: toDay.endOf("day").toJSDate(),
    prevStart: prevFromDay.startOf("day").toJSDate(),
    prevEnd: prevToDay.endOf("day").toJSDate(),
    days,
    from: fromDay.toFormat("yyyy-MM-dd"),
    to: toDay.toFormat("yyyy-MM-dd"),
  };
};

/** IST calendar-day index of `d` relative to the range start (may be <0 or ≥days). */
export const istDayIndex = (d: Date, rangeStart: Date): number => {
  const a = DateTime.fromJSDate(d, { zone: SYSTEM_TIMEZONE }).startOf("day");
  const b = DateTime.fromJSDate(rangeStart, { zone: SYSTEM_TIMEZONE }).startOf("day");
  return Math.round(a.diff(b, "days").days);
};

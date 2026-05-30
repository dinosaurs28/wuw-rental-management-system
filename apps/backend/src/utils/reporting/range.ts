import {
  startOfDay,
  endOfDay,
  subDays,
  startOfMonth,
  endOfMonth,
  subMonths,
  differenceInCalendarDays,
  isValid,
  parseISO,
} from "date-fns";

export interface ReportRange {
  /** Inclusive start of selected range (00:00:00.000). */
  start: Date;
  /** Inclusive end of selected range (23:59:59.999). */
  end: Date;
  /** Start of the same-duration window immediately before the selected range. */
  prevStart: Date;
  /** End of the previous window. */
  prevEnd: Date;
  /** Number of calendar days in the selected range (inclusive). */
  days: number;
}

export type DateRangePreset =
  | "today"
  | "last7"
  | "last30"
  | "thisMonth"
  | "lastMonth"
  | "custom";

const parseDate = (value: unknown): Date | null => {
  if (!value) return null;
  const str = String(value);
  const d = str.length <= 10 ? parseISO(str) : new Date(str);
  return isValid(d) ? d : null;
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
  const now = query.now ?? new Date();
  const preset = query.preset
    ? (String(query.preset) as DateRangePreset)
    : undefined;

  let start: Date;
  let end: Date;

  const explicitStart = parseDate(query.startDate ?? query.from);
  const explicitEnd = parseDate(query.endDate ?? query.to);

  switch (preset) {
    case "today":
      start = startOfDay(now);
      end = endOfDay(now);
      break;
    case "last7":
      end = endOfDay(now);
      start = startOfDay(subDays(now, 6));
      break;
    case "thisMonth":
      start = startOfMonth(now);
      end = endOfDay(now);
      break;
    case "lastMonth": {
      const lastMonth = subMonths(now, 1);
      start = startOfMonth(lastMonth);
      end = endOfMonth(lastMonth);
      break;
    }
    case "last30":
      end = endOfDay(now);
      start = startOfDay(subDays(now, 29));
      break;
    case "custom":
    default:
      if (explicitStart && explicitEnd) {
        start = startOfDay(explicitStart);
        end = endOfDay(explicitEnd);
      } else {
        // Default: Last 30 Days
        end = endOfDay(now);
        start = startOfDay(subDays(now, 29));
      }
      break;
  }

  const days = differenceInCalendarDays(end, start) + 1;
  const prevEnd = endOfDay(subDays(start, 1));
  const prevStart = startOfDay(subDays(prevEnd, days - 1));

  return { start, end, prevStart, prevEnd, days };
};

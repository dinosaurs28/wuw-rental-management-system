import { DateTime } from "luxon";
import { SYSTEM_TIMEZONE } from "../../services/timezone/timezone.service.js";

/**
 * IST (Asia/Kolkata) date ranges and trend buckets for branch reports.
 *
 * The admin `resolveReportRange` (range.ts) builds day boundaries in the Node
 * process timezone, which is UTC on the VPS. Branch-facing reports must cut
 * days at IST midnight regardless of where the server runs, so every boundary
 * here is computed with Luxon in SYSTEM_TIMEZONE.
 */

/** Longest selectable range, inclusive of both end dates. */
export const MAX_PERIOD_DAYS = 366;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type PeriodGroupBy = "day" | "week" | "month";
export type PeriodGroupByRequest = PeriodGroupBy | "auto";

export interface IstPeriod {
  /** Inclusive start: 00:00:00.000 IST of `from`. */
  start: Date;
  /** Inclusive end: 23:59:59.999 IST of `to`. */
  end: Date;
  /** yyyy-MM-dd (IST). */
  from: string;
  /** yyyy-MM-dd (IST). */
  to: string;
  /** Calendar days in the range, inclusive. */
  days: number;
  /** Same-length window immediately before the range. */
  prevStart: Date;
  prevEnd: Date;
  prevFrom: string;
  prevTo: string;
}

/** Raised for a range the caller asked for but that cannot be served. */
export class PeriodRangeError extends Error {
  constructor(
    public readonly code: "INVALID_PERIOD_RANGE" | "PERIOD_RANGE_TOO_LONG",
    message: string,
  ) {
    super(message);
    this.name = "PeriodRangeError";
  }
}

/** Parse a `yyyy-MM-dd` calendar date as IST midnight, or null when invalid. */
export const parseIstDate = (value: string): DateTime | null => {
  if (!DATE_RE.test(value)) return null;
  const dt = DateTime.fromISO(value, { zone: SYSTEM_TIMEZONE });
  return dt.isValid ? dt.startOf("day") : null;
};

const fmtDate = (dt: DateTime): string => dt.toFormat("yyyy-MM-dd");

/**
 * Resolve `from`/`to` (yyyy-MM-dd, IST) into an inclusive IST range plus the
 * previous same-length window. Both omitted ⇒ this month so far (1st → today).
 * Presets (today, last 7 days, …) are resolved by the client into from/to.
 */
export const resolveIstPeriod = (opts: {
  from?: string;
  to?: string;
  now?: DateTime;
}): IstPeriod => {
  const now = (opts.now ?? DateTime.now()).setZone(SYSTEM_TIMEZONE);

  let fromDay: DateTime;
  let toDay: DateTime;

  if (!opts.from && !opts.to) {
    fromDay = now.startOf("month");
    toDay = now.startOf("day");
  } else if (!opts.from || !opts.to) {
    throw new PeriodRangeError(
      "INVALID_PERIOD_RANGE",
      "Send both 'from' and 'to' (YYYY-MM-DD), or neither for this month.",
    );
  } else {
    const parsedFrom = parseIstDate(opts.from);
    const parsedTo = parseIstDate(opts.to);
    if (!parsedFrom) {
      throw new PeriodRangeError(
        "INVALID_PERIOD_RANGE",
        `'${opts.from}' is not a valid date. Use YYYY-MM-DD.`,
      );
    }
    if (!parsedTo) {
      throw new PeriodRangeError(
        "INVALID_PERIOD_RANGE",
        `'${opts.to}' is not a valid date. Use YYYY-MM-DD.`,
      );
    }
    fromDay = parsedFrom;
    toDay = parsedTo;
  }

  if (toDay < fromDay) {
    throw new PeriodRangeError(
      "INVALID_PERIOD_RANGE",
      "The start date must be on or before the end date.",
    );
  }

  // IST has no DST, so the day difference is always a whole number.
  const days = Math.round(toDay.diff(fromDay, "days").days) + 1;
  if (days > MAX_PERIOD_DAYS) {
    throw new PeriodRangeError(
      "PERIOD_RANGE_TOO_LONG",
      `Pick a range of at most ${MAX_PERIOD_DAYS} days (this one is ${days}).`,
    );
  }

  const prevToDay = fromDay.minus({ days: 1 });
  const prevFromDay = fromDay.minus({ days });

  return {
    start: fromDay.startOf("day").toJSDate(),
    end: toDay.endOf("day").toJSDate(),
    from: fmtDate(fromDay),
    to: fmtDate(toDay),
    days,
    prevStart: prevFromDay.startOf("day").toJSDate(),
    prevEnd: prevToDay.endOf("day").toJSDate(),
    prevFrom: fmtDate(prevFromDay),
    prevTo: fmtDate(prevToDay),
  };
};

/** 'auto' ⇒ day up to 31 days, week up to 92 days, month beyond. */
export const resolveGroupBy = (
  requested: PeriodGroupByRequest,
  days: number,
): PeriodGroupBy => {
  if (requested !== "auto") return requested;
  if (days <= 31) return "day";
  if (days <= 92) return "week";
  return "month";
};

export interface IstBucket {
  /** day 'yyyy-MM-dd' | ISO week 'kkkk-Www' | month 'yyyy-MM' (IST). */
  key: string;
  /** Short human label, e.g. '05 Oct', '29 Sep – 05 Oct', 'Oct 2026'. */
  label: string;
  /** First calendar day covered (clipped to the range), yyyy-MM-dd. */
  from: string;
  /** Last calendar day covered (clipped to the range), yyyy-MM-dd. */
  to: string;
}

const bucketKey = (dt: DateTime, groupBy: PeriodGroupBy): string => {
  switch (groupBy) {
    case "day":
      return dt.toFormat("yyyy-MM-dd");
    case "week":
      return dt.toFormat("kkkk-'W'WW");
    case "month":
      return dt.toFormat("yyyy-MM");
  }
};

/**
 * Zero-fillable buckets covering the range in order. Weeks are ISO weeks
 * (Monday–Sunday) and months are calendar months, both clipped to the range.
 */
export const enumerateIstBuckets = (
  period: Pick<IstPeriod, "start" | "end">,
  groupBy: PeriodGroupBy,
): IstBucket[] => {
  const rangeStart = DateTime.fromJSDate(period.start, { zone: SYSTEM_TIMEZONE });
  const rangeEnd = DateTime.fromJSDate(period.end, { zone: SYSTEM_TIMEZONE });
  const multiYear = rangeStart.year !== rangeEnd.year;
  const dayFmt = multiYear ? "dd MMM yy" : "dd MMM";

  const buckets: IstBucket[] = [];
  let cursor = rangeStart.startOf("day");
  while (cursor <= rangeEnd) {
    const unitEnd =
      groupBy === "day"
        ? cursor.endOf("day")
        : groupBy === "week"
          ? cursor.endOf("week")
          : cursor.endOf("month");
    const bucketEnd = unitEnd > rangeEnd ? rangeEnd : unitEnd;
    const lastDay = bucketEnd.startOf("day");

    let label: string;
    if (groupBy === "day") label = cursor.toFormat(dayFmt);
    else if (groupBy === "month") label = cursor.toFormat("MMM yyyy");
    else
      label = lastDay.hasSame(cursor, "day")
        ? cursor.toFormat(dayFmt)
        : `${cursor.toFormat(dayFmt)} – ${lastDay.toFormat(dayFmt)}`;

    buckets.push({
      key: bucketKey(cursor, groupBy),
      label,
      from: cursor.toFormat("yyyy-MM-dd"),
      to: lastDay.toFormat("yyyy-MM-dd"),
    });
    cursor = lastDay.plus({ days: 1 }).startOf("day");
  }
  return buckets;
};

/**
 * Returns a function mapping an instant to its bucket index, or -1 when the
 * instant is missing or outside [start, end].
 */
export const istBucketIndexer = (
  period: Pick<IstPeriod, "start" | "end">,
  groupBy: PeriodGroupBy,
  buckets: IstBucket[],
): ((date: Date | null | undefined) => number) => {
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  const startMs = period.start.getTime();
  const endMs = period.end.getTime();
  return (date) => {
    if (!date) return -1;
    const ms = date.getTime();
    if (ms < startMs || ms > endMs) return -1;
    const key = bucketKey(DateTime.fromMillis(ms, { zone: SYSTEM_TIMEZONE }), groupBy);
    return index.get(key) ?? -1;
  };
};

/** Format an instant as IST wall-clock text (default 'dd-MM-yyyy HH:mm'). */
export const formatIst = (
  date: Date | null | undefined,
  format = "dd-MM-yyyy HH:mm",
): string =>
  date ? DateTime.fromJSDate(date, { zone: SYSTEM_TIMEZONE }).toFormat(format) : "";

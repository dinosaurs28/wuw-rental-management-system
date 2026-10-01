// IST calendar helpers for the Branch Manager "Period" page (#14).
//
// The API takes IST calendar days as YYYY-MM-DD and leaves presets to the client.
// "Today" is resolved in Asia/Kolkata whatever the browser's timezone is, and all
// date arithmetic runs on UTC-midnight Date objects so it never shifts a day
// (never `toISOString().split("T")[0]` on a local-midnight date).

export const IST_TIMEZONE = "Asia/Kolkata";
export const MAX_PERIOD_DAYS = 366;
const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type PeriodPreset =
  | "today"
  | "yesterday"
  | "last7"
  | "thisWeek"
  | "thisMonth"
  | "lastMonth"
  | "custom";

export const PERIOD_PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 days" },
  { value: "thisWeek", label: "This week" },
  { value: "thisMonth", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "custom", label: "Custom" },
];

export const DEFAULT_PRESET: Exclude<PeriodPreset, "custom"> = "thisMonth";

export const isPeriodPreset = (v: string | null): v is PeriodPreset =>
  !!v && PERIOD_PRESETS.some((p) => p.value === v);

const utcDate = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const toYmd = (date: Date) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

/** Today's IST calendar day as a UTC-midnight Date. */
export const istToday = (now: Date = new Date()): Date => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: "year" | "month" | "day") =>
    Number(parts.find((p) => p.type === type)?.value);
  return utcDate(get("year"), get("month"), get("day"));
};

export const istTodayYmd = () => toYmd(istToday());

/** Parses YYYY-MM-DD into a UTC-midnight Date; null when malformed or impossible. */
export const parseYmd = (value: string | null | undefined): Date | null => {
  if (!value || !DATE_RE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = utcDate(y, m, d);
  return toYmd(date) === value ? date : null;
};

/** Resolves a non-custom preset to an inclusive IST from/to pair. */
export const resolvePreset = (
  preset: Exclude<PeriodPreset, "custom">,
  now: Date = new Date(),
): { from: string; to: string } => {
  const today = istToday(now);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  switch (preset) {
    case "today":
      return { from: toYmd(today), to: toYmd(today) };
    case "yesterday": {
      const d = addDays(today, -1);
      return { from: toYmd(d), to: toYmd(d) };
    }
    case "last7":
      return { from: toYmd(addDays(today, -6)), to: toYmd(today) };
    case "thisWeek": {
      // ISO week: Monday → today.
      const sinceMonday = (today.getUTCDay() + 6) % 7;
      return { from: toYmd(addDays(today, -sinceMonday)), to: toYmd(today) };
    }
    case "thisMonth":
      return { from: toYmd(utcDate(y, m, 1)), to: toYmd(today) };
    case "lastMonth":
      // Day 0 of this month = last day of the previous one (Date.UTC rolls the year).
      return { from: toYmd(utcDate(y, m - 1, 1)), to: toYmd(utcDate(y, m, 0)) };
  }
};

/** Inclusive day count between two YYYY-MM-DD days (null when either is invalid). */
export const daysInclusive = (from: string, to: string): number | null => {
  const a = parseYmd(from);
  const b = parseYmd(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / DAY_MS) + 1;
};

/** Client-side check of a custom range; returns the message to show, or null if fine. */
export const validateCustomRange = (from: string, to: string): string | null => {
  if (!from || !to) return "Pick both a start and an end date.";
  if (!parseYmd(from) || !parseYmd(to)) return "Enter valid dates.";
  const days = daysInclusive(from, to)!;
  if (days < 1) return "The start date must be on or before the end date.";
  if (days > MAX_PERIOD_DAYS)
    return `Pick a range of at most ${MAX_PERIOD_DAYS} days (this one is ${days}).`;
  return null;
};

const dayFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-10-01" → "01 Oct 2026". */
export const formatYmd = (value: string): string => {
  const d = parseYmd(value);
  return d ? dayFormatter.format(d) : value;
};

/** "01 Oct 2026 – 31 Oct 2026", or a single day when from === to. */
export const formatYmdRange = (from: string, to: string): string =>
  from === to ? formatYmd(from) : `${formatYmd(from)} – ${formatYmd(to)}`;

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TIMEZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

/** ISO instant → IST wall time, e.g. "05 Oct 2026, 09:30 am". */
export const formatIstDateTime = (iso: string): string => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : dateTimeFormatter.format(d);
};

/** Rupees with grouping; paise only when present. */
export const formatInr = (amount: number): string =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);

/** Compact rupees for chart axes: ₹950, ₹12.5K, ₹3.2L, ₹1.1Cr. */
export const formatInrCompact = (amount: number): string => {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  const trim = (n: number) => String(Number(n.toFixed(1)));
  if (abs >= 10_000_000) return `${sign}₹${trim(abs / 10_000_000)}Cr`;
  if (abs >= 100_000) return `${sign}₹${trim(abs / 100_000)}L`;
  if (abs >= 1_000) return `${sign}₹${trim(abs / 1_000)}K`;
  return `${sign}₹${Math.round(abs)}`;
};

export const formatCount = (n: number): string => new Intl.NumberFormat("en-IN").format(n || 0);

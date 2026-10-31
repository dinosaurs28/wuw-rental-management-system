import type { Response } from "express";
import { Parser } from "json2csv";

/** Currency for CSV: plain number, no ₹ symbol (spec §0.4). */
export const csvCurrency = (amount: number | null | undefined): string => {
  if (amount === null || amount === undefined || isNaN(Number(amount))) return "0";
  return Number(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
};

/** Date for CSV: DD-MM-YYYY (spec §0.4). */
export const csvDate = (date: Date | string | null | undefined): string => {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  const day = d.getDate().toString().padStart(2, "0");
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  return `${day}-${month}-${d.getFullYear()}`;
};

export const sendCSV = (res: Response, csv: string, filename: string): void => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
  res.send(csv);
};

/**
 * Render rows to CSV with an exact, ordered column list and optional trailing
 * summary/total rows, then stream as a file download.
 *
 * `columns` is the ordered list of headers (first row = headers, spec §0.4).
 * Each row object is keyed by those exact headers. `summaryRows` are appended
 * verbatim (already keyed by the same headers) — use for Total / Net rows.
 */
export const exportRowsToCSV = (
  res: Response,
  opts: {
    columns: string[];
    rows: Record<string, string | number>[];
    summaryRows?: Record<string, string | number>[];
    filename: string;
  },
): void => {
  const { columns, rows, summaryRows = [], filename } = opts;
  const all = [...rows, ...summaryRows];
  const parser = new Parser({ fields: columns });
  // json2csv emits headers even for an empty data array when fields are given.
  const csv = parser.parse(all);
  sendCSV(res, csv, filename);
};

/** Build a summary row keyed to `columns`, with a label in the first column. */
export const summaryRow = (
  columns: string[],
  labelColumnValue: string,
  values: Record<string, string | number>,
): Record<string, string | number> => {
  const row: Record<string, string | number> = {};
  for (const c of columns) row[c] = "";
  const first = columns[0];
  if (first !== undefined) row[first] = labelColumnValue;
  return { ...row, ...values };
};

// ---------------------------------------------------------------------------
// Streaming CSV (spec §9.2) — row-level exports, Excel-friendly.
//   * UTF-8 BOM so Excel opens ₹-free UTF-8 text with correct encoding
//   * CRLF line endings, RFC 4180 quoting
//   * money/number columns as plain numbers (no ₹, no thousands separators)
//   * dates in IST (dd-MM-yyyy / dd-MM-yyyy HH:mm) or ISO (yyyy-MM-dd / ISO 8601)
// ---------------------------------------------------------------------------

export type CsvColumnType =
  | "text"
  | "number"
  | "money"
  | "date"
  | "datetime"
  | "isoDate"
  | "isoDateTime"
  | "bool";

export interface CsvColumn<R> {
  header: string;
  value: (row: R) => unknown;
  type?: CsvColumnType;
}

const CSV_TZ = "Asia/Kolkata";

const toDate = (v: unknown): Date | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
};

const istParts = (d: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CSV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), mi: get("minute") };
};

/** Plain number for spreadsheets: 1234.5 (max 2 dp), "" for null. */
export const csvMoney = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return String(Math.round((n + Number.EPSILON) * 100) / 100);
};

/** IST calendar date dd-MM-yyyy. */
export const csvIstDate = (v: unknown): string => {
  const d = toDate(v);
  if (!d) return "";
  const p = istParts(d);
  return `${p.d}-${p.m}-${p.y}`;
};

/** IST wall clock dd-MM-yyyy HH:mm. */
export const csvIstDateTime = (v: unknown): string => {
  const d = toDate(v);
  if (!d) return "";
  const p = istParts(d);
  return `${p.d}-${p.m}-${p.y} ${p.h}:${p.mi}`;
};

/** IST calendar date yyyy-MM-dd (sorts correctly as text). */
export const csvIsoDate = (v: unknown): string => {
  const d = toDate(v);
  if (!d) return "";
  const p = istParts(d);
  return `${p.y}-${p.m}-${p.d}`;
};

export const formatCsvCell = (v: unknown, type: CsvColumnType = "text"): string => {
  switch (type) {
    case "money":
    case "number":
      return csvMoney(v);
    case "date":
      return csvIstDate(v);
    case "datetime":
      return csvIstDateTime(v);
    case "isoDate":
      return csvIsoDate(v);
    case "isoDateTime": {
      const d = toDate(v);
      return d ? d.toISOString() : "";
    }
    case "bool":
      return v === null || v === undefined ? "" : v ? "Yes" : "No";
    default:
      if (v === null || v === undefined) return "";
      if (v instanceof Date) return csvIstDateTime(v);
      return String(v);
  }
};

/** RFC 4180 quoting; also neutralises spreadsheet formula injection. */
export const escapeCsvCell = (s: string): string => {
  let out = s;
  if (/^[=+\-@\t\r]/.test(out) && !/^-?\d+(\.\d+)?$/.test(out)) out = `'${out}`;
  return /[",\r\n]/.test(out) ? `"${out.replace(/"/g, '""')}"` : out;
};

export const csvLine = (cells: string[]): string => cells.map(escapeCsvCell).join(",") + "\r\n";

/** Build the whole CSV text (BOM included) — handy for tests and small exports. */
export const buildCsv = <R>(
  columns: CsvColumn<R>[],
  rows: Iterable<R>,
  summaryRows: Record<string, unknown>[] = [],
): string => {
  let out = "﻿" + csvLine(columns.map((c) => c.header));
  for (const row of rows) out += csvLine(columns.map((c) => formatCsvCell(c.value(row), c.type)));
  for (const s of summaryRows) {
    out += csvLine(columns.map((c) => formatCsvCell(s[c.header], c.type === "money" || c.type === "number" ? c.type : "text")));
  }
  return out;
};

const csvFilename = (name: string): string => {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "report";
  if (safe.toLowerCase().endsWith(".csv")) return safe;
  return `${safe}-${csvIsoDate(new Date())}.csv`;
};

/**
 * Stream a row-level CSV download. `rows` may be an array, any iterable or an
 * async iterable (e.g. a generator paging through Prisma), so large exports
 * never build one giant string. `summaryRows` are keyed by header.
 */
export const streamCsv = async <R>(
  res: Response,
  opts: {
    filename: string;
    columns: CsvColumn<R>[];
    rows: Iterable<R> | AsyncIterable<R>;
    summaryRows?: Record<string, unknown>[];
  },
): Promise<void> => {
  const { columns, rows, summaryRows = [] } = opts;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${csvFilename(opts.filename)}"`);
  res.setHeader("Cache-Control", "no-store");
  res.write("﻿" + csvLine(columns.map((c) => c.header)));
  let buffer = "";
  for await (const row of rows as AsyncIterable<R>) {
    buffer += csvLine(columns.map((c) => formatCsvCell(c.value(row), c.type)));
    if (buffer.length > 64 * 1024) {
      res.write(buffer);
      buffer = "";
    }
  }
  for (const s of summaryRows) {
    buffer += csvLine(
      columns.map((c) =>
        formatCsvCell(s[c.header], c.type === "money" || c.type === "number" ? c.type : "text"),
      ),
    );
  }
  res.end(buffer);
};

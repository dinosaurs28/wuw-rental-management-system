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

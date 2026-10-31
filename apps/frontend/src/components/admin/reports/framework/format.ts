import type { ValueFormat } from "./types";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

export const formatINR = (v: number | null | undefined): string =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? "–" : inr.format(Number(v));

export const formatNumber = (v: number | null | undefined): string =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? "–" : num.format(Number(v));

export const formatPct = (v: number | null | undefined, dp = 1): string =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? "–" : `${Number(v).toFixed(dp)}%`;

export const formatValue = (v: number | string | null | undefined, format: ValueFormat = "number"): string => {
  if (typeof v === "string") return v;
  switch (format) {
    case "money":
      return formatINR(v);
    case "percent":
      return formatPct(v);
    case "days":
      return v === null || v === undefined ? "–" : `${formatNumber(v)} d`;
    case "text":
      return v === null || v === undefined ? "–" : String(v);
    default:
      return formatNumber(v);
  }
};

/** Today's date in IST as yyyy-MM-dd. */
export const istToday = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

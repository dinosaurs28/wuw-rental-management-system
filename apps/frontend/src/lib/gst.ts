/**
 * Display helpers for GST figures the server sends. The web app never computes
 * GST itself and never assumes a rate: if the server gives no rate, the label
 * goes without one (or the screen says GST is not configured).
 * The one exception is the BM damage-review preview, which uses
 * `computeGst` from @repo/schemas with the server's rates.
 */

import { computeGst } from "@repo/schemas";

type ApiErrorLike = { response?: { data?: { code?: unknown; message?: unknown } } };

export const GST_RULE_MISSING_MESSAGE =
  "GST is not configured for this branch. Ask the branch manager to set the GST rule before continuing.";

/** True when the backend refused because the branch has no GST rule (409 GST_RULE_MISSING). */
export function isGstRuleMissing(err: unknown): boolean {
  return (err as ApiErrorLike | undefined)?.response?.data?.code === "GST_RULE_MISSING";
}

/** A usable numeric value from a server number or 2-dp Decimal string; null when absent. */
export function gstNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * ₹ amount with paise only when there are any ("₹1,180", "₹1,180.45").
 * GST is rounded to the paisa, so whole-rupee formatting would hide it.
 */
export function formatInrExact(value: number | string | null | undefined): string {
  const n = gstNumber(value) ?? 0;
  const hasPaise = Math.round(Math.abs(n) * 100) % 100 !== 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: hasPaise ? 2 : 0,
  }).format(n);
}

/** "9%" / "2.5%" — null when the server sent no rate. */
export function formatGstRate(rate: number | string | null | undefined): string | null {
  const n = gstNumber(rate);
  if (n === null) return null;
  return `${Number(n.toFixed(2))}%`;
}

/** "CGST (9%)", or just "CGST" when the rate is unknown. */
export function gstLabel(name: string, rate: number | string | null | undefined): string {
  const r = formatGstRate(rate);
  return r ? `${name} (${r})` : name;
}

/** The GST part of a server `pricingDetails` (vehicle / group endpoints), for the booking store. */
export function gstSplitFromPricing(pd: {
  taxRate?: number | null;
  cgstAmount?: number | null;
  sgstAmount?: number | null;
  cgstRate?: number | null;
  sgstRate?: number | null;
}): {
  taxRate: number;
  cgstAmount: number;
  sgstAmount: number;
  cgstRate: number | null;
  sgstRate: number | null;
} {
  return {
    taxRate: gstNumber(pd.taxRate) ?? 0,
    cgstAmount: gstNumber(pd.cgstAmount) ?? 0,
    sgstAmount: gstNumber(pd.sgstAmount) ?? 0,
    cgstRate: gstNumber(pd.cgstRate),
    sgstRate: gstNumber(pd.sgstRate),
  };
}

/** "CGST 9% ₹63 · SGST 9% ₹63" from server amounts (rates optional). */
export function gstSplitText(
  cgstAmount: number | string | null | undefined,
  sgstAmount: number | string | null | undefined,
  cgstRate?: number | string | null,
  sgstRate?: number | string | null,
): string {
  const c = formatGstRate(cgstRate);
  const s = formatGstRate(sgstRate);
  return `CGST${c ? ` ${c}` : ""} ${formatInrExact(cgstAmount)} · SGST${s ? ` ${s}` : ""} ${formatInrExact(sgstAmount)}`;
}

/**
 * Live preview of the GST a BM damage review will charge: only a PENALTY is
 * taxed, CGST + SGST at the server's rates, each rounded half-up (the same rule
 * the close endpoint applies). Compensation — or no GST rule — gives zero.
 */
export function previewPenaltyGst(
  chargeType: string,
  amount: number,
  cgstRate: number | null | undefined,
  sgstRate: number | null | undefined,
): { cgst: number; sgst: number; gst: number } {
  const c = gstNumber(cgstRate);
  const s = gstNumber(sgstRate);
  if (chargeType !== "PENALTY" || c === null || s === null || !(amount > 0)) {
    return { cgst: 0, sgst: 0, gst: 0 };
  }
  const g = computeGst(amount, { cgstRate: c, sgstRate: s });
  return { cgst: g.cgst, sgst: g.sgst, gst: g.gst };
}

/** Extra time added by an extension: "+4 hr", "+1 day", "+1 day 4 hr", "+30 min". */
export function formatExtensionHours(hours: number | null | undefined): string | null {
  if (hours === null || hours === undefined || !Number.isFinite(hours) || hours <= 0) return null;
  const totalMinutes = Math.round(hours * 60);
  const days = Math.floor(totalMinutes / (24 * 60));
  const remHours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (remHours > 0) parts.push(`${remHours} hr`);
  if (minutes > 0) parts.push(`${minutes} min`);
  return `+${parts.join(" ")}`;
}

/** "1 day 4 hr" (no sign) for a rental length in hours. */
export function formatRentalHours(hours: number | null | undefined): string | null {
  const s = formatExtensionHours(hours);
  return s ? s.slice(1) : null;
}

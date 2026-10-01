// Display helpers for the GST figures the server sends (#23 canonical rule).
// Keep in sync with apps/frontend/src/lib/gst.ts.
//
// The app never computes GST and never assumes a rate: CGST and SGST are
// rounded per line on the server, so the amounts shown here are always the
// server's. Without a rate the label goes without one; without any GST data
// the screen says GST is not available instead of guessing 18%.

export const GST_RULE_MISSING = 'GST_RULE_MISSING';

export const GST_RULE_MISSING_MESSAGE =
  'GST is not configured for this branch. Ask the branch manager to set the GST rule before continuing.';

/** True when the backend refused because the branch has no GST rule (409 GST_RULE_MISSING). */
export function isGstRuleMissing(err: any): boolean {
  return err?.response?.data?.code === GST_RULE_MISSING;
}

/** A usable number from a server number or 2-dp Decimal string; null when absent. */
export function gstNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Rounds away float noise from subtracting two server amounts (e.g. base − discount). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * "₹1,180" / "₹1,180.45" — paise only when there are any. GST is rounded to
 * the paisa, so whole-rupee formatting would hide it. Sign is not printed.
 */
export function inrExact(value: number | string | null | undefined): string {
  const n = Math.abs(gstNumber(value) ?? 0);
  const hasPaise = Math.round(n * 100) % 100 !== 0;
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: hasPaise ? 2 : 0,
  })}`;
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

/** "CGST ₹63 · SGST ₹63" from server amounts. */
export function gstSplitText(
  cgstAmount: number | string | null | undefined,
  sgstAmount: number | string | null | undefined,
): string {
  return `CGST ${inrExact(cgstAmount)} · SGST ${inrExact(sgstAmount)}`;
}

/** Extra time added by an extension: "+4 hr", "+1 day", "+1 day 4 hr", "+30 min". */
export function formatExtensionHours(hours: number | null | undefined): string | null {
  if (hours === null || hours === undefined || !Number.isFinite(hours) || hours <= 0) return null;
  const totalMinutes = Math.round(hours * 60);
  const days = Math.floor(totalMinutes / (24 * 60));
  const remHours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (remHours > 0) parts.push(`${remHours} hr`);
  if (minutes > 0) parts.push(`${minutes} min`);
  return parts.length ? `+${parts.join(' ')}` : null;
}

/**
 * The GST split the extension endpoints send next to `additionalAmount`
 * (2-dp strings): additionalAmount = taxableAmount + taxAmount,
 * taxAmount = cgstAmount + sgstAmount, taxRate = CGST% + SGST%.
 */
export interface ExtensionGstFields {
  baseAmount?: string;
  discountAmount?: string;
  taxableAmount?: string;
  taxAmount?: string;
  cgstAmount?: string;
  sgstAmount?: string;
  taxRate?: string;
}

export interface ExtensionGstSplit {
  base: number;
  discount: number;
  taxable: number;
  tax: number;
  cgst: number;
  sgst: number;
  /** CGST% + SGST%, null when not sent */
  rate: number | null;
}

/** Parses the split; null when the server didn't send one (older backend). */
export function extensionGstSplit(p: ExtensionGstFields | null | undefined): ExtensionGstSplit | null {
  if (!p) return null;
  const taxable = gstNumber(p.taxableAmount);
  const tax = gstNumber(p.taxAmount);
  if (taxable === null || tax === null) return null;
  return {
    base: gstNumber(p.baseAmount) ?? taxable,
    discount: gstNumber(p.discountAmount) ?? 0,
    taxable,
    tax,
    cgst: gstNumber(p.cgstAmount) ?? 0,
    sgst: gstNumber(p.sgstAmount) ?? 0,
    rate: gstNumber(p.taxRate),
  };
}

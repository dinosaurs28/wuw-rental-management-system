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

// ── GST-inclusive rent (item 17) ────────────────────────────────────────────
// Every configured rent is the total the customer pays; GST is split OUT of the
// rent after discounts, never added on top. Pricing responses carry these
// numbers next to the classic taxable-terms fields (basePrice / discountAmount /
// taxAmount = rent without GST, its discount and the GST; finalTotal = rent
// incl. GST after discounts). Mirrors apps/frontend/src/lib/gst.ts.

export interface RentInclGstFields {
  rentInclGst?: number | null;
  durationDiscountInclGst?: number | null;
  couponDiscountInclGst?: number | null;
  manualDiscountInclGst?: number | null;
  discountInclGst?: number | null;
  rentAfterDiscountInclGst?: number | null;
  rentWithoutGst?: number | null;
  gst?: number | null;
  cgst?: number | null;
  sgst?: number | null;
}

/** The classic fields a pricing response always has (fallback for quotes cached before item 17). */
export interface ClassicRentFields {
  basePrice?: number | string | null;
  discountAmount?: number | string | null;
  durationDiscountAmount?: number | string | null;
  couponDiscountAmount?: number | string | null;
  manualDiscountAmount?: number | string | null;
  taxAmount?: number | string | null;
  cgstAmount?: number | string | null;
  sgstAmount?: number | string | null;
  finalTotal?: number | string | null;
}

/** One rent, GST-inclusive: the price, its discounts and the GST inside what is left. */
export interface RentInclGstView {
  /** Rent incl. GST before discounts — the price. */
  rent: number;
  durationDiscount: number;
  couponDiscount: number;
  manualDiscount: number;
  /** All discounts, off the inclusive rent. */
  discount: number;
  /** Rent incl. GST after discounts (what the rent costs). */
  rentAfterDiscount: number;
  rentWithoutGst: number;
  gst: number;
  cgst: number;
  sgst: number;
}

const money = (v: number | string | null | undefined): number => gstNumber(v) ?? 0;

/**
 * The inclusive view of a server pricing result. Uses the server's inclusive
 * fields when present; a quote cached before they existed falls back to the
 * classic fields (rent after discounts = base − discount + GST), which is what
 * that quote costs too.
 */
export function rentInclGstView(pd: RentInclGstFields & ClassicRentFields): RentInclGstView {
  if (pd.rentInclGst != null && pd.rentAfterDiscountInclGst != null) {
    return {
      rent: money(pd.rentInclGst),
      durationDiscount: money(pd.durationDiscountInclGst),
      couponDiscount: money(pd.couponDiscountInclGst),
      manualDiscount: money(pd.manualDiscountInclGst),
      discount: money(pd.discountInclGst),
      rentAfterDiscount: money(pd.rentAfterDiscountInclGst),
      rentWithoutGst: money(pd.rentWithoutGst),
      gst: money(pd.gst),
      cgst: money(pd.cgst),
      sgst: money(pd.sgst),
    };
  }
  const discount = money(pd.discountAmount);
  const rentWithoutGst = round2(money(pd.basePrice) - discount);
  const gst = money(pd.taxAmount);
  const rentAfterDiscount = pd.finalTotal != null ? money(pd.finalTotal) : round2(rentWithoutGst + gst);
  return {
    rent: round2(rentAfterDiscount + discount),
    durationDiscount: money(pd.durationDiscountAmount),
    couponDiscount: money(pd.couponDiscountAmount),
    manualDiscount: money(pd.manualDiscountAmount),
    discount,
    rentAfterDiscount,
    rentWithoutGst,
    gst,
    cgst: money(pd.cgstAmount),
    sgst: money(pd.sgstAmount),
  };
}

/** "Rent without GST ₹1,066 + GST ₹234 = ₹1,300". */
export function rentGstSplitText(view: Pick<RentInclGstView, 'rentWithoutGst' | 'gst' | 'rentAfterDiscount'>): string {
  return `Rent without GST ${inrExact(view.rentWithoutGst)} + GST ${inrExact(view.gst)} = ${inrExact(view.rentAfterDiscount)}`;
}

/** "CGST 9% ₹117 + SGST 9% ₹117" (rates optional) — the parts of the GST inside a rent. */
export function rentGstPartsText(
  cgst: number | string | null | undefined,
  sgst: number | string | null | undefined,
  cgstRate?: number | string | null,
  sgstRate?: number | string | null,
): string {
  const c = formatGstRate(cgstRate);
  const s = formatGstRate(sgstRate);
  return `CGST${c ? ` ${c}` : ''} ${inrExact(cgst)} + SGST${s ? ` ${s}` : ''} ${inrExact(sgst)}`;
}

/**
 * The GST lines of a rent, for a muted note under its amount: the split, then
 * CGST + SGST when the server sent them. Empty when there is no GST.
 */
export function rentGstNoteLines(
  view: RentInclGstView,
  rates?: { cgstRate?: number | string | null; sgstRate?: number | string | null } | null,
): string[] {
  if (view.gst <= 0) return [];
  const lines = [rentGstSplitText(view)];
  if (view.cgst > 0 || view.sgst > 0) {
    lines.push(`GST: ${rentGstPartsText(view.cgst, view.sgst, rates?.cgstRate, rates?.sgstRate)}`);
  }
  return lines;
}

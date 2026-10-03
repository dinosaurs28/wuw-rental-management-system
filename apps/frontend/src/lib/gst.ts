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

/**
 * GST-inclusive rent (item 17): every configured rent is the total the customer
 * pays, and GST is split out of the rent after discounts. Pricing responses
 * carry these numbers next to the classic taxable-terms fields
 * (basePrice / discountAmount / taxAmount = rent without GST, its discount and
 * the GST; finalTotal = rent incl. GST after discounts).
 */
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
const cents = (n: number): number => Math.round(n * 100) / 100;

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
  const rentWithoutGst = cents(money(pd.basePrice) - discount);
  const gst = money(pd.taxAmount);
  const rentAfterDiscount =
    pd.finalTotal != null ? money(pd.finalTotal) : cents(rentWithoutGst + gst);
  return {
    rent: cents(rentAfterDiscount + discount),
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
export function rentGstSplitText(view: Pick<RentInclGstView, "rentWithoutGst" | "gst" | "rentAfterDiscount">): string {
  return `Rent without GST ${formatInrExact(view.rentWithoutGst)} + GST ${formatInrExact(view.gst)} = ${formatInrExact(view.rentAfterDiscount)}`;
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
  return `CGST${c ? ` ${c}` : ""} ${formatInrExact(cgst)} + SGST${s ? ` ${s}` : ""} ${formatInrExact(sgst)}`;
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

/**
 * The GST part of a server `pricingDetails` (vehicle / group endpoints), for the booking store,
 * with the GST-inclusive rent view (item 17) the review page shows.
 */
export function gstSplitFromPricing(
  pd: RentInclGstFields &
    ClassicRentFields & {
      taxRate?: number | null;
      cgstAmount?: number | null;
      sgstAmount?: number | null;
      cgstRate?: number | null;
      sgstRate?: number | null;
    },
): {
  taxRate: number;
  cgstAmount: number;
  sgstAmount: number;
  cgstRate: number | null;
  sgstRate: number | null;
  rent: RentInclGstView;
} {
  return {
    taxRate: gstNumber(pd.taxRate) ?? 0,
    cgstAmount: gstNumber(pd.cgstAmount) ?? 0,
    sgstAmount: gstNumber(pd.sgstAmount) ?? 0,
    cgstRate: gstNumber(pd.cgstRate),
    sgstRate: gstNumber(pd.sgstRate),
    rent: rentInclGstView(pd),
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

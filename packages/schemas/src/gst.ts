/**
 * Canonical GST arithmetic, shared by the backend and the web app.
 *
 * Rule (self-drive rental, intra-state supply) — as of the Oct 3 2026 client
 * instructions:
 *   - Only RENT is taxed: the booking rent and extension rent.
 *   - Rent prices are GST-INCLUSIVE totals (what the customer pays). GST is
 *     split out of the total with splitRentTotal(); see RENT_GST_METHOD.
 *   - Drop / recovery charges carry NO GST: extra km, late return (extra
 *     time), fuel, FASTag, damage, vehicle-swap difference, other charges.
 *   - Refundable deposits (category + safety) are never taxed.
 *   - Always CGST + SGST; IGST is never added.
 *
 * Rounding: CGST and SGST are each rounded half-up to 2 dp per line, and
 * GST = CGST + SGST, so the parts always add up. Compute once when the line
 * is created, store it, and read the stored value everywhere else.
 */

export interface GstRates {
  cgstRate: number;
  sgstRate: number;
}

export interface GstBreakdown {
  taxable: number;
  cgst: number;
  sgst: number;
  gst: number;
  total: number;
  rate: number;
}

/** Ledger / charge types whose amount is a taxable supply: rent only. */
export const TAXABLE_CHARGE_TYPES = [
  "BOOKING_BASE",
  "EXTENSION",
] as const;

/** Ledger / charge types that are never taxed (drop / recovery charges too). */
export const NON_TAXABLE_CHARGE_TYPES = [
  "EXTRA_KM",
  "EXTRA_TIME",
  "FUEL",
  "VEHICLE_SWAP",
  "OTHER",
  "DEPOSIT",
  "SAFETY_DEPOSIT",
  "FASTAG",
  "DAMAGE",
  "GRACE_ADJUSTMENT",
] as const;

export function isTaxableChargeType(type: string): boolean {
  return (TAXABLE_CHARGE_TYPES as readonly string[]).includes(type);
}

/** Rupees → integer paise, half-up, tolerant of float noise (1.005 → 101). */
const toPaise = (rupees: number): number => {
  const n = Number(rupees);
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(n) * 100 + 1e-6);
};

/** Round half-up to 2 decimal places (rupees). */
export function round2(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(n) * 100 + 1e-7)) / 100;
}

/** Tax a GST-exclusive amount. */
export function computeGst(taxable: number, rates: GstRates): GstBreakdown {
  const taxablePaise = toPaise(taxable);
  const sign = taxablePaise < 0 ? -1 : 1;
  const abs = Math.abs(taxablePaise);
  const cgstPaise = sign * Math.round((abs * Number(rates.cgstRate)) / 100 + 1e-7);
  const sgstPaise = sign * Math.round((abs * Number(rates.sgstRate)) / 100 + 1e-7);
  const gstPaise = cgstPaise + sgstPaise;
  return {
    taxable: taxablePaise / 100,
    cgst: cgstPaise / 100,
    sgst: sgstPaise / 100,
    gst: gstPaise / 100,
    total: (taxablePaise + gstPaise) / 100,
    rate: Number(rates.cgstRate) + Number(rates.sgstRate),
  };
}

/**
 * Split a GST-inclusive amount into taxable + GST. The parts add up to the
 * gross exactly; any paise left by rounding goes to the taxable value.
 */
export function splitGstInclusive(gross: number, rates: GstRates): GstBreakdown {
  const rate = Number(rates.cgstRate) + Number(rates.sgstRate);
  const grossPaise = toPaise(gross);
  if (rate <= 0) {
    return { taxable: grossPaise / 100, cgst: 0, sgst: 0, gst: 0, total: grossPaise / 100, rate: 0 };
  }
  const sign = grossPaise < 0 ? -1 : 1;
  const abs = Math.abs(grossPaise);
  const taxablePaise = Math.round(abs / (1 + rate / 100) + 1e-7);
  const gstPaise = abs - taxablePaise;
  const cgstPaise = Math.round((gstPaise * Number(rates.cgstRate)) / rate + 1e-7);
  const sgstPaise = gstPaise - cgstPaise;
  return {
    taxable: (sign * taxablePaise) / 100,
    cgst: (sign * cgstPaise) / 100,
    sgst: (sign * sgstPaise) / 100,
    gst: (sign * gstPaise) / 100,
    total: (sign * abs) / 100,
    rate,
  };
}

/**
 * How GST is taken out of a GST-inclusive rent total.
 *
 * PERCENT_OF_TOTAL (client instruction, Oct 3 2026): GST = rate% OF THE TOTAL.
 *   Rs 1,300 at 18% -> GST Rs 234, rent without GST Rs 1,066.
 * BACK_CALCULATE (standard GST arithmetic): taxable = total / (1 + rate%).
 *   Rs 1,300 at 18% -> taxable Rs 1,101.69, GST Rs 198.31.
 *
 * Switch here if the client's accountant asks for the standard method; every
 * caller goes through splitRentTotal().
 */
export type RentGstMethod = "PERCENT_OF_TOTAL" | "BACK_CALCULATE";
export const RENT_GST_METHOD: RentGstMethod = "PERCENT_OF_TOTAL";

/**
 * Split a GST-inclusive rent total (after discounts) into rent without GST +
 * CGST + SGST. The parts always add back to the total exactly.
 */
export function splitRentTotal(
  total: number,
  rates: GstRates,
  method: RentGstMethod = RENT_GST_METHOD,
): GstBreakdown {
  if (method === "BACK_CALCULATE") return splitGstInclusive(total, rates);
  const totalPaise = toPaise(total);
  const sign = totalPaise < 0 ? -1 : 1;
  const abs = Math.abs(totalPaise);
  const cgstPaise = Math.round((abs * Number(rates.cgstRate)) / 100 + 1e-7);
  const sgstPaise = Math.round((abs * Number(rates.sgstRate)) / 100 + 1e-7);
  const gstPaise = cgstPaise + sgstPaise;
  return {
    taxable: (sign * (abs - gstPaise)) / 100,
    cgst: (sign * cgstPaise) / 100,
    sgst: (sign * sgstPaise) / 100,
    gst: (sign * gstPaise) / 100,
    total: (sign * abs) / 100,
    rate: Number(rates.cgstRate) + Number(rates.sgstRate),
  };
}

/** Rent without GST for a GST-inclusive total (e.g. the vehicle form preview). */
export function rentWithoutGst(total: number, rates: GstRates, method: RentGstMethod = RENT_GST_METHOD): number {
  return splitRentTotal(total, rates, method).taxable;
}

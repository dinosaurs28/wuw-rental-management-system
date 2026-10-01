/**
 * Drop bill GST — classifies each drop charge line under the canonical GST rule
 * and works out its CGST/SGST once, when the line is created.
 *
 *   Taxable     : extra km, late return (EXTRA_TIME), fuel, vehicle-swap
 *                 difference, free-form "other charges"
 *   Not taxable : damage compensation, FASTag/tolls, deposits, grace
 *
 * Taxable lines are billed GST-exclusive: the ledger amount is the taxable value
 * and the GST sits in gstAmount on top. The drop discount is a pre-tax trade
 * discount: it is split pro-rata between the taxable and non-taxable charges,
 * and the taxable share takes its GST off with it (a negative-GST discount line).
 */
import Decimal from "decimal.js";
import type { LedgerEntryType } from "@repo/database/client";
import { isTaxableChargeType } from "@repo/schemas";
import { computeLineGst, type BranchGstRates } from "../tax/gst.service.js";
import { DROP_DAMAGE_REF } from "../damage/drop-damage.service.js";

/** LedgerEntry.referenceType of a free-form "other charge" typed by staff at drop. */
export const OTHER_CHARGE_REF = "OTHER_CHARGE";
/** LedgerEntry.referenceType of the automatic late-return line. */
export const LATE_RETURN_REF = "LATE_RETURN";
/** LedgerEntry.referenceType of a vehicle-swap difference line (referenceId = VehicleSwap.publicId). */
export const VEHICLE_SWAP_REF = "VEHICLE_SWAP";

export interface DropChargeLine {
  type: LedgerEntryType;
  label: string;
  /** Taxable value for a taxable line, the full amount otherwise. */
  amount: Decimal;
  referenceType: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
}

export interface TaxedDropLine extends DropChargeLine {
  taxable: boolean;
  cgst: Decimal;
  sgst: Decimal;
  gst: Decimal;
  /** amount + gst */
  total: Decimal;
}

export interface DropDiscountSplit {
  amount: Decimal;
  taxableShare: Decimal;
  nonTaxableShare: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  gst: Decimal;
}

export interface DropBill {
  lines: TaxedDropLine[];
  /** Σ line amounts before discount and GST */
  subtotal: Decimal;
  taxableTotal: Decimal;
  nonTaxableTotal: Decimal;
  discount: DropDiscountSplit | null;
  /** taxableTotal − discount.taxableShare */
  taxableValue: Decimal;
  /** nonTaxableTotal − discount.nonTaxableShare */
  nonTaxableValue: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  gst: Decimal;
  /** taxableValue + gst + nonTaxableValue — what the drop charges come to */
  total: Decimal;
  rates: BranchGstRates | null;
}

const ZERO = new Decimal(0);

/** Canonical GST classification of a drop line. */
export function isTaxableDropLine(line: Pick<DropChargeLine, "type" | "referenceType">): boolean {
  if (line.referenceType === DROP_DAMAGE_REF) return false; // damage compensation
  if (line.referenceType === OTHER_CHARGE_REF) return true; // free-form service charge
  return isTaxableChargeType(String(line.type));
}

/** Pre-tax split of the drop discount between taxable and non-taxable charges. */
export function splitDropDiscount(
  discount: Decimal,
  taxableTotal: Decimal,
  nonTaxableTotal: Decimal,
): { taxableShare: Decimal; nonTaxableShare: Decimal } {
  const total = taxableTotal.plus(nonTaxableTotal);
  if (discount.lte(0) || total.lte(0)) return { taxableShare: ZERO, nonTaxableShare: ZERO };
  const taxableShare = taxableTotal.eq(total)
    ? discount
    : discount.mul(taxableTotal).div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { taxableShare, nonTaxableShare: discount.minus(taxableShare) };
}

/**
 * Taxes the lines and applies the discount. `rates` may be null only when no
 * line is taxable (the caller loads them otherwise — a branch without a GST rule
 * must fail with GST_RULE_MISSING, never fall back to a guessed rate).
 */
export function buildDropBill(
  lines: DropChargeLine[],
  discountAmount: Decimal,
  rates: BranchGstRates | null,
): DropBill {
  const taxed: TaxedDropLine[] = lines.map((line) => {
    const taxable = isTaxableDropLine(line);
    if (!taxable) {
      return { ...line, taxable, cgst: ZERO, sgst: ZERO, gst: ZERO, total: line.amount };
    }
    if (!rates) throw new Error("GST rates are required for a taxable drop line");
    const g = computeLineGst(line.amount, rates);
    return { ...line, taxable, cgst: g.cgst, sgst: g.sgst, gst: g.gst, total: line.amount.plus(g.gst) };
  });

  const taxableTotal = taxed.filter((l) => l.taxable).reduce((s, l) => s.plus(l.amount), ZERO);
  const nonTaxableTotal = taxed.filter((l) => !l.taxable).reduce((s, l) => s.plus(l.amount), ZERO);
  const lineCgst = taxed.reduce((s, l) => s.plus(l.cgst), ZERO);
  const lineSgst = taxed.reduce((s, l) => s.plus(l.sgst), ZERO);

  let discount: DropDiscountSplit | null = null;
  if (discountAmount.gt(0)) {
    const { taxableShare, nonTaxableShare } = splitDropDiscount(discountAmount, taxableTotal, nonTaxableTotal);
    let cgst = ZERO;
    let sgst = ZERO;
    if (taxableShare.gt(0) && rates) {
      if (taxableShare.eq(taxableTotal)) {
        // The whole taxable value is discounted — reverse exactly the GST charged
        cgst = lineCgst;
        sgst = lineSgst;
      } else {
        const g = computeLineGst(taxableShare, rates);
        cgst = Decimal.min(g.cgst, lineCgst);
        sgst = Decimal.min(g.sgst, lineSgst);
      }
    }
    discount = { amount: discountAmount, taxableShare, nonTaxableShare, cgst, sgst, gst: cgst.plus(sgst) };
  }

  const taxableValue = taxableTotal.minus(discount?.taxableShare ?? 0);
  const nonTaxableValue = nonTaxableTotal.minus(discount?.nonTaxableShare ?? 0);
  const cgst = lineCgst.minus(discount?.cgst ?? 0);
  const sgst = lineSgst.minus(discount?.sgst ?? 0);
  const gst = cgst.plus(sgst);

  return {
    lines: taxed,
    subtotal: taxableTotal.plus(nonTaxableTotal),
    taxableTotal,
    nonTaxableTotal,
    discount,
    taxableValue,
    nonTaxableValue,
    cgst,
    sgst,
    gst,
    total: taxableValue.plus(gst).plus(nonTaxableValue),
    rates,
  };
}

/** JSON shape of a drop bill for clients and RETURN session metadata (Decimals as strings). */
export function serializeDropBill(bill: DropBill) {
  return {
    gstRates: bill.rates
      ? { cgstRate: bill.rates.cgstRate, sgstRate: bill.rates.sgstRate, rate: bill.rates.rate }
      : null,
    lines: bill.lines.map((l) => ({
      type: String(l.type),
      label: l.label,
      referenceType: l.referenceType,
      referenceId: l.referenceId ?? null,
      taxable: l.taxable,
      amount: l.amount.toFixed(2),
      cgst: l.cgst.toFixed(2),
      sgst: l.sgst.toFixed(2),
      gst: l.gst.toFixed(2),
      total: l.total.toFixed(2),
    })),
    subtotal: bill.subtotal.toFixed(2),
    taxableTotal: bill.taxableTotal.toFixed(2),
    nonTaxableTotal: bill.nonTaxableTotal.toFixed(2),
    discount: bill.discount
      ? {
          amount: bill.discount.amount.toFixed(2),
          taxableShare: bill.discount.taxableShare.toFixed(2),
          nonTaxableShare: bill.discount.nonTaxableShare.toFixed(2),
          cgst: bill.discount.cgst.toFixed(2),
          sgst: bill.discount.sgst.toFixed(2),
          gst: bill.discount.gst.toFixed(2),
        }
      : null,
    taxableValue: bill.taxableValue.toFixed(2),
    nonTaxableValue: bill.nonTaxableValue.toFixed(2),
    cgst: bill.cgst.toFixed(2),
    sgst: bill.sgst.toFixed(2),
    gst: bill.gst.toFixed(2),
    total: bill.total.toFixed(2),
  };
}

export type SerializedDropBill = ReturnType<typeof serializeDropBill>;

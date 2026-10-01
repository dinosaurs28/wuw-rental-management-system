import Decimal from "decimal.js";
import { prisma } from "@repo/database/client";
import type { Prisma } from "@repo/database/client";
import { queueInvoiceGeneration } from "../utils/invoice-generation.queue.js";
import {
  getBranchGstRates,
  computeLineGst,
  splitInclusiveGst,
  type BranchGstRates,
} from "./tax/gst.service.js";

/**
 * Invoice GST totals under the canonical rule (#23).
 *
 * Built only from GST that was computed and stored when each line was created:
 *   rental      → BookingItem (base, discount, CGST, SGST frozen at booking)
 *   extensions  → CONFIRMED BookingExtension split (taxable, CGST, SGST)
 *   other lines → InvoiceItem.amount / isTaxable / taxAmount (return charges,
 *                 drop discount, damage penalty from the manager's review)
 * Nothing here re-taxes an amount. The refundable deposit is not a taxable
 * supply: it is reported as depositAmount, and Invoice.total still includes it.
 *
 * Invoice.total keeps its meaning: booking.totalFinal (rental + deposit +
 * confirmed extensions + damage charged in review) plus the return charges
 * (with their GST) that live only on the invoice.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const ZERO = new Decimal(0);
const D = (v: { toString(): string } | null | undefined) => new Decimal(v == null ? "0" : v.toString());
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** InvoiceItem.sourceRef prefixes */
export const INVOICE_SOURCE = {
  LEDGER: "LEDGER:",
  CHARGE_ENTRY: "CHARGE_ENTRY:",
  DAMAGE_REVIEW: "DAMAGE_REVIEW:",
} as const;

/** Label the manager's damage review used before sourceRef existed. */
const LEGACY_DAMAGE_REVIEW_LABEL = "Damage Charge: ";

interface ItemLike {
  label: string;
  amount: { toString(): string };
  isTaxable: boolean;
  taxAmount: { toString(): string };
  chargeType: string | null;
  sourceRef: string | null;
}

/**
 * A damage charged in the manager's review is already inside booking.totalFinal
 * (damage.controller increments it); return charges are not.
 */
export function isDamageReviewItem(item: Pick<ItemLike, "label" | "sourceRef">): boolean {
  if (item.sourceRef) return item.sourceRef.startsWith(INVOICE_SOURCE.DAMAGE_REVIEW);
  return item.label.startsWith(LEGACY_DAMAGE_REVIEW_LABEL);
}

/**
 * The CGST/SGST rates frozen on the booking: the pricing snapshot (new
 * bookings), else the BookingItem taxRate split evenly (CGST = SGST), else the
 * branch's current rule (throws GST_RULE_MISSING when the branch has none).
 */
export async function bookingGstRates(
  booking: { branchId: number; pricingSnapshot: unknown; items: Array<{ taxRate: { toString(): string } }> },
  db: Db = prisma,
): Promise<BranchGstRates> {
  const totals = (booking.pricingSnapshot as { totals?: { cgstRate?: unknown; sgstRate?: unknown } } | null)?.totals;
  const snapCgst = Number(totals?.cgstRate);
  const snapSgst = Number(totals?.sgstRate);
  if (Number.isFinite(snapCgst) && Number.isFinite(snapSgst) && snapCgst + snapSgst > 0) {
    return { cgstRate: snapCgst, sgstRate: snapSgst, rate: snapCgst + snapSgst };
  }
  const itemRate = booking.items.map((i) => Number(i.taxRate.toString())).find((r) => r > 0);
  if (itemRate) {
    const half = itemRate / 2;
    return { cgstRate: half, sgstRate: half, rate: itemRate };
  }
  return getBranchGstRates(booking.branchId, db);
}

/**
 * CGST / SGST of the original booking (rental only — Booking.totalTax) for the
 * customer's booking screens: the split stored on its items; items written
 * without one share the booking's stored GST at its frozen rates. Rates come
 * only from what the booking froze (pricing snapshot, else BookingItem taxRate
 * split evenly) — never from the branch's current rule; null when unknown.
 */
export function rentalGstSplitView(booking: {
  totalTax: { toString(): string };
  pricingSnapshot: unknown;
  items: Array<{
    cgstAmount: { toString(): string };
    sgstAmount: { toString(): string };
    taxRate: { toString(): string };
  }>;
}): { totalCgst: number | null; totalSgst: number | null; cgstRate: number | null; sgstRate: number | null } {
  const totals = (booking.pricingSnapshot as { totals?: { cgstRate?: unknown; sgstRate?: unknown } } | null)?.totals;
  const snapCgst = Number(totals?.cgstRate);
  const snapSgst = Number(totals?.sgstRate);
  const itemRate = booking.items.map((i) => Number(i.taxRate.toString())).find((r) => r > 0);
  const rates: BranchGstRates | null =
    Number.isFinite(snapCgst) && Number.isFinite(snapSgst) && snapCgst + snapSgst > 0
      ? { cgstRate: snapCgst, sgstRate: snapSgst, rate: snapCgst + snapSgst }
      : itemRate
        ? { cgstRate: itemRate / 2, sgstRate: itemRate / 2, rate: itemRate }
        : null;

  let cgst = r2(booking.items.reduce((s, i) => s.add(D(i.cgstAmount)), ZERO));
  let sgst = r2(booking.items.reduce((s, i) => s.add(D(i.sgstAmount)), ZERO));
  const totalTax = r2(D(booking.totalTax));
  if (cgst.add(sgst).isZero() && totalTax.gt(0)) {
    if (!rates) return { totalCgst: null, totalSgst: null, cgstRate: null, sgstRate: null };
    ({ cgst, sgst } = splitTax(totalTax, rates));
  }
  return {
    totalCgst: Number(cgst.toFixed(2)),
    totalSgst: Number(sgst.toFixed(2)),
    cgstRate: rates?.cgstRate ?? null,
    sgstRate: rates?.sgstRate ?? null,
  };
}

/** Split a stored GST amount into CGST/SGST in the ratio of the frozen rates. */
function splitTax(tax: Decimal, rates: BranchGstRates): { cgst: Decimal; sgst: Decimal } {
  if (tax.isZero() || rates.rate <= 0) return { cgst: ZERO, sgst: ZERO };
  const cgst = r2(tax.mul(rates.cgstRate).div(rates.rate));
  return { cgst, sgst: tax.sub(cgst) };
}

export interface ExtensionGstLine {
  publicId: string;
  base: Decimal;
  discount: Decimal;
  taxable: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  tax: Decimal;
  total: Decimal;
  taxRate: Decimal;
}

/**
 * Stored GST split of a confirmed extension. Rows priced before the split
 * existed were backfilled by the migration; a row that still has no split is
 * read as a GST-inclusive amount at the booking's frozen rate.
 */
export function extensionGstLine(
  ext: {
    publicId: string;
    additionalAmount: { toString(): string };
    baseAmount: { toString(): string };
    discountAmount: { toString(): string };
    taxableAmount: { toString(): string };
    taxAmount: { toString(): string };
    cgstAmount: { toString(): string };
    sgstAmount: { toString(): string };
    taxRate: { toString(): string };
  },
  fallbackRates: BranchGstRates,
): ExtensionGstLine {
  const total = D(ext.additionalAmount);
  const taxable = D(ext.taxableAmount);
  const tax = D(ext.taxAmount);
  if (total.gt(0) && !taxable.add(tax).eq(total)) {
    const s = splitInclusiveGst(total, fallbackRates);
    return {
      publicId: ext.publicId,
      base: s.taxable,
      discount: ZERO,
      taxable: s.taxable,
      cgst: s.cgst,
      sgst: s.sgst,
      tax: s.gst,
      total,
      taxRate: s.rate,
    };
  }
  const discount = D(ext.discountAmount);
  const base = D(ext.baseAmount).gt(0) ? D(ext.baseAmount) : taxable.add(discount);
  return {
    publicId: ext.publicId,
    base,
    discount,
    taxable,
    cgst: D(ext.cgstAmount),
    sgst: D(ext.sgstAmount),
    tax,
    total,
    taxRate: D(ext.taxRate),
  };
}

export interface InvoiceItemGst {
  amount: Decimal;
  taxable: boolean;
  tax: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  /** Already inside booking.totalFinal (damage charged in review) */
  inBookingTotal: boolean;
}

/**
 * GST of an invoice line, as stored. A taxable damage-penalty line written
 * before InvoiceItem.taxAmount existed was charged with GST at the branch rate
 * of the time; it is read back at the booking's frozen rate.
 */
export function invoiceItemGst(item: ItemLike, rates: BranchGstRates): InvoiceItemGst {
  const amount = D(item.amount);
  let tax = item.isTaxable ? D(item.taxAmount) : ZERO;
  if (item.isTaxable && tax.isZero() && amount.gt(0) && item.chargeType === "DAMAGE_PENALTY" && !item.sourceRef) {
    tax = computeLineGst(amount, rates).gst;
  }
  const { cgst, sgst } = splitTax(tax, rates);
  return { amount, taxable: item.isTaxable, tax, cgst, sgst, inBookingTotal: isDamageReviewItem(item) };
}

export interface InvoiceGstTotals {
  /** Gross of every line before discounts (deposit excluded) */
  subtotal: Decimal;
  discount: Decimal;
  taxableAmount: Decimal;
  /** Non-taxable lines after their discounts (FASTag, damage compensation …) */
  nonTaxableAmount: Decimal;
  cgstAmount: Decimal;
  sgstAmount: Decimal;
  tax: Decimal;
  depositAmount: Decimal;
  damageCharges: Decimal;
  total: Decimal;
  /** total − (taxable + GST + non-taxable + deposit); paise from legacy unrounded taxes */
  roundingAdjustment: Decimal;
  rates: BranchGstRates;
  rental: { base: Decimal; discount: Decimal; taxable: Decimal; cgst: Decimal; sgst: Decimal };
  extensions: ExtensionGstLine[];
}

/**
 * Invoice totals for a booking from stored values. `items` defaults to the
 * invoice's current InvoiceItem rows; finalization passes the rows it is
 * about to write.
 */
export async function computeInvoiceGstTotals(
  bookingId: number,
  db: Db = prisma,
  items?: ItemLike[],
): Promise<InvoiceGstTotals> {
  const booking = await db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      branchId: true,
      totalBase: true,
      totalDiscount: true,
      totalTax: true,
      totalDeposit: true,
      totalFinal: true,
      pricingSnapshot: true,
      items: {
        select: { baseTotal: true, discountAmount: true, cgstAmount: true, sgstAmount: true, taxRate: true },
      },
      invoice: {
        select: {
          items: {
            select: {
              label: true,
              amount: true,
              isTaxable: true,
              taxAmount: true,
              chargeType: true,
              sourceRef: true,
            },
          },
        },
      },
    },
  });

  const rates = await bookingGstRates(booking, db);

  // ── Rental (frozen at booking) ────────────────────────────────────────────
  const hasItems = booking.items.length > 0;
  const rentalBase = hasItems ? booking.items.reduce((s, i) => s.add(D(i.baseTotal)), ZERO) : D(booking.totalBase);
  const rentalDiscount = hasItems
    ? booking.items.reduce((s, i) => s.add(D(i.discountAmount)), ZERO)
    : D(booking.totalDiscount);
  let rentalCgst = r2(booking.items.reduce((s, i) => s.add(D(i.cgstAmount)), ZERO));
  let rentalSgst = r2(booking.items.reduce((s, i) => s.add(D(i.sgstAmount)), ZERO));
  if (rentalCgst.add(rentalSgst).isZero() && D(booking.totalTax).gt(0)) {
    // Items without a per-line split: use the booking's stored GST total
    ({ cgst: rentalCgst, sgst: rentalSgst } = splitTax(r2(D(booking.totalTax)), rates));
  }
  const rental = {
    base: r2(rentalBase),
    discount: r2(rentalDiscount),
    taxable: r2(rentalBase.sub(rentalDiscount)),
    cgst: rentalCgst,
    sgst: rentalSgst,
  };

  // ── Confirmed extensions (split stored when each was priced) ──────────────
  const confirmed = await db.bookingExtension.findMany({
    where: { bookingId, extensionStatus: "CONFIRMED" },
    orderBy: { createdAt: "asc" },
    select: {
      publicId: true,
      additionalAmount: true,
      baseAmount: true,
      discountAmount: true,
      taxableAmount: true,
      taxAmount: true,
      cgstAmount: true,
      sgstAmount: true,
      taxRate: true,
    },
  });
  const extensions = confirmed.map((e) => extensionGstLine(e, rates));

  // ── Invoice lines ─────────────────────────────────────────────────────────
  let subtotal = rental.base;
  let discount = rental.discount;
  let taxable = rental.taxable;
  let cgst = rental.cgst;
  let sgst = rental.sgst;
  let nonTaxable = ZERO;
  let damageCharges = ZERO;
  let outsideBookingTotal = ZERO;

  for (const e of extensions) {
    subtotal = subtotal.add(e.base);
    discount = discount.add(e.discount);
    taxable = taxable.add(e.taxable);
    cgst = cgst.add(e.cgst);
    sgst = sgst.add(e.sgst);
  }

  for (const raw of items ?? booking.invoice?.items ?? []) {
    const line = invoiceItemGst(raw, rates);
    if (line.amount.lt(0)) discount = discount.add(line.amount.abs());
    else subtotal = subtotal.add(line.amount);
    if (line.taxable) {
      taxable = taxable.add(line.amount);
      cgst = cgst.add(line.cgst);
      sgst = sgst.add(line.sgst);
    } else {
      nonTaxable = nonTaxable.add(line.amount);
    }
    if (raw.chargeType === "DAMAGE_PENALTY" || raw.chargeType === "DAMAGE_COMPENSATION") {
      damageCharges = damageCharges.add(line.amount);
    }
    if (!line.inBookingTotal) outsideBookingTotal = outsideBookingTotal.add(line.amount).add(line.tax);
  }

  const tax = cgst.add(sgst);
  const depositAmount = r2(D(booking.totalDeposit));
  const total = r2(D(booking.totalFinal).add(outsideBookingTotal));
  const roundingAdjustment = total.sub(taxable).sub(tax).sub(nonTaxable).sub(depositAmount);

  return {
    subtotal: r2(subtotal),
    discount: r2(discount),
    taxableAmount: r2(taxable),
    nonTaxableAmount: r2(nonTaxable),
    cgstAmount: r2(cgst),
    sgstAmount: r2(sgst),
    tax: r2(tax),
    depositAmount,
    damageCharges: r2(damageCharges),
    total,
    roundingAdjustment: r2(roundingAdjustment),
    rates,
    rental,
    extensions,
  };
}

/** Invoice column values for a set of totals (Decimals as 2-dp strings). */
export function invoiceTotalsData(t: InvoiceGstTotals) {
  return {
    subtotal: t.subtotal.toFixed(2),
    discount: t.discount.toFixed(2),
    tax: t.tax.toFixed(2),
    taxableAmount: t.taxableAmount.toFixed(2),
    cgstAmount: t.cgstAmount.toFixed(2),
    sgstAmount: t.sgstAmount.toFixed(2),
    depositAmount: t.depositAmount.toFixed(2),
    damageCharges: t.damageCharges.toFixed(2),
    total: t.total.toFixed(2),
  };
}

/**
 * GST columns for a brand-new invoice (booking confirmation): the rental GST
 * stored on the booking items and the refundable deposit. Callers keep setting
 * subtotal/discount/total from the booking as before.
 */
export async function initialInvoiceGstData(bookingId: number, db: Db = prisma) {
  const t = await computeInvoiceGstTotals(bookingId, db, []);
  return {
    tax: t.tax.toFixed(2),
    taxableAmount: t.taxableAmount.toFixed(2),
    cgstAmount: t.cgstAmount.toFixed(2),
    sgstAmount: t.sgstAmount.toFixed(2),
    depositAmount: t.depositAmount.toFixed(2),
  };
}

/**
 * Re-syncs an invoice's totals with the booking mid-rental — after an
 * extension is confirmed, a pickup session completes, or a regenerate is asked
 * for before the drop. Keeps the invoice status (advance bookings stay PENDING
 * until the balance is paid). When any amount changed, the cached PDF is
 * dropped and a fresh one queued (`queue: false` when the caller queues the
 * PDF itself). Returns whether anything changed.
 */
export async function refreshInvoiceTotals(
  bookingId: number,
  opts: { forceRegenerate?: boolean; queue?: boolean } = {},
): Promise<boolean> {
  const invoice = await prisma.invoice.findUnique({
    where: { bookingId },
    select: {
      id: true,
      subtotal: true,
      discount: true,
      tax: true,
      taxableAmount: true,
      cgstAmount: true,
      sgstAmount: true,
      depositAmount: true,
      damageCharges: true,
      total: true,
      invoicePdfFileId: true,
    },
  });
  if (!invoice) return false;

  const data = invoiceTotalsData(await computeInvoiceGstTotals(bookingId));
  const changed = (Object.keys(data) as Array<keyof typeof data>).some(
    (k) => !D(invoice[k]).eq(new Decimal(data[k])),
  );
  if (!changed && !opts.forceRegenerate) return false;

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { ...data, invoicePdfFileId: null, generatedAt: null },
  });
  if (opts.queue !== false) {
    await queueInvoiceGeneration(bookingId, invoice.id, true, invoice.invoicePdfFileId ?? undefined);
  }
  console.log(`[refreshInvoiceTotals] booking ${bookingId}: total ₹${data.total}, GST ₹${data.tax}`);
  return true;
}

import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import {
  bookingGstRates,
  extensionGstLine,
  invoiceItemGst,
} from "../../services/invoice-totals.service.js";

/**
 * Output GST a booking carries beyond its original rental (canonical GST rule
 * #23). Booking.totalBase / totalTax / BookingItem describe the original
 * rental only, so reports add these separately:
 *   - CONFIRMED extensions: the split stored on BookingExtension when priced
 *   - taxable invoice lines: return charges (extra km, late return, fuel, swap,
 *     other), the drop discount's taxable share, damage penalties — the GST
 *     stored on each InvoiceItem
 * Bookings are still selected by the caller (startAt anchor); nothing here is
 * re-taxed.
 */
export interface ExtraOutputGst {
  extensionCount: number;
  /** Σ additionalAmount (taxable + GST) — already inside booking.totalFinal */
  extensionTotal: number;
  extensionBase: number;
  extensionDiscount: number;
  extensionTaxable: number;
  extensionCgst: number;
  extensionSgst: number;
  /** Taxable invoice lines (net of a taxable drop discount) */
  chargesTaxable: number;
  chargesCgst: number;
  chargesSgst: number;
}

const ZERO_EXTRA: ExtraOutputGst = {
  extensionCount: 0,
  extensionTotal: 0,
  extensionBase: 0,
  extensionDiscount: 0,
  extensionTaxable: 0,
  extensionCgst: 0,
  extensionSgst: 0,
  chargesTaxable: 0,
  chargesCgst: 0,
  chargesSgst: 0,
};

export const emptyExtraOutputGst = (): ExtraOutputGst => ({ ...ZERO_EXTRA });

const n2 = (d: Decimal) => Number(d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2));

export async function getExtraOutputGstByBooking(
  bookingIds: number[],
  opts: { includeInvoiceLines?: boolean } = {},
): Promise<Map<number, ExtraOutputGst>> {
  const out = new Map<number, ExtraOutputGst>();
  if (bookingIds.length === 0) return out;

  const [bookings, extensions, invoiceItems] = await Promise.all([
    prisma.booking.findMany({
      where: { id: { in: bookingIds } },
      select: { id: true, branchId: true, pricingSnapshot: true, items: { select: { taxRate: true } } },
    }),
    prisma.bookingExtension.findMany({
      where: { bookingId: { in: bookingIds }, extensionStatus: "CONFIRMED" },
      select: {
        bookingId: true,
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
    }),
    opts.includeInvoiceLines
      ? prisma.invoiceItem.findMany({
          where: { invoice: { bookingId: { in: bookingIds } }, isTaxable: true },
          select: {
            label: true,
            amount: true,
            isTaxable: true,
            taxAmount: true,
            chargeType: true,
            sourceRef: true,
            invoice: { select: { bookingId: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const extByBooking = new Map<number, typeof extensions>();
  for (const e of extensions) {
    const list = extByBooking.get(e.bookingId) ?? [];
    list.push(e);
    extByBooking.set(e.bookingId, list);
  }
  const itemsByBooking = new Map<number, typeof invoiceItems>();
  for (const it of invoiceItems) {
    const list = itemsByBooking.get(it.invoice.bookingId) ?? [];
    list.push(it);
    itemsByBooking.set(it.invoice.bookingId, list);
  }

  for (const b of bookings) {
    const exts = extByBooking.get(b.id) ?? [];
    const items = itemsByBooking.get(b.id) ?? [];
    if (exts.length === 0 && items.length === 0) continue;

    let rates;
    try {
      rates = await bookingGstRates(b);
    } catch (err) {
      console.warn(`[reports] No GST rate for booking ${b.id} — extension/charge GST skipped:`, err);
      continue;
    }

    let extTotal = new Decimal(0);
    let extBase = new Decimal(0);
    let extDiscount = new Decimal(0);
    let extTaxable = new Decimal(0);
    let extCgst = new Decimal(0);
    let extSgst = new Decimal(0);
    for (const e of exts) {
      const line = extensionGstLine(e, rates);
      extTotal = extTotal.add(line.total);
      extBase = extBase.add(line.base);
      extDiscount = extDiscount.add(line.discount);
      extTaxable = extTaxable.add(line.taxable);
      extCgst = extCgst.add(line.cgst);
      extSgst = extSgst.add(line.sgst);
    }

    let chTaxable = new Decimal(0);
    let chCgst = new Decimal(0);
    let chSgst = new Decimal(0);
    for (const it of items) {
      const line = invoiceItemGst(it, rates);
      chTaxable = chTaxable.add(line.amount);
      chCgst = chCgst.add(line.cgst);
      chSgst = chSgst.add(line.sgst);
    }

    out.set(b.id, {
      extensionCount: exts.length,
      extensionTotal: n2(extTotal),
      extensionBase: n2(extBase),
      extensionDiscount: n2(extDiscount),
      extensionTaxable: n2(extTaxable),
      extensionCgst: n2(extCgst),
      extensionSgst: n2(extSgst),
      chargesTaxable: n2(chTaxable),
      chargesCgst: n2(chCgst),
      chargesSgst: n2(chSgst),
    });
  }

  return out;
}

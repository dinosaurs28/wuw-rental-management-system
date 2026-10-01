import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { PricingEngineService, type PricingResult } from "../pricing/pricing-engine.service.js";
import { getBranchGstRates, computeLineGst } from "../tax/gst.service.js";

export interface ExtensionPricingResult {
  newDays: number;
  newTotalBase: Decimal;
  newTotalDiscount: Decimal;
  newTotalTax: Decimal;
  newTotalFinal: Decimal;
  additionalAmount: Decimal;
  pricingResult: PricingResult;
  /**
   * GST split of additionalAmount (canonical rule #23):
   * taxableAmount = baseAmount − discountAmount, taxAmount = cgst + sgst,
   * additionalAmount = taxableAmount + taxAmount. taxRate = cgst% + sgst%.
   */
  baseAmount: Decimal;
  discountAmount: Decimal;
  taxableAmount: Decimal;
  taxAmount: Decimal;
  cgstAmount: Decimal;
  sgstAmount: Decimal;
  taxRate: Decimal;
  /** Rental length before and after the extension, in hours */
  originalHours: number;
  extensionHours: number;
}

/** The BookingExtension columns that hold an extension's GST split. */
export function extensionSplitData(p: ExtensionPricingResult) {
  return {
    baseAmount: p.baseAmount.toFixed(2),
    discountAmount: p.discountAmount.toFixed(2),
    taxableAmount: p.taxableAmount.toFixed(2),
    taxAmount: p.taxAmount.toFixed(2),
    cgstAmount: p.cgstAmount.toFixed(2),
    sgstAmount: p.sgstAmount.toFixed(2),
    taxRate: p.taxRate.toFixed(2),
  };
}

/** The GST split as response strings (quote / evaluate / commit payloads). */
export function extensionSplitView(p: {
  baseAmount: { toString(): string };
  discountAmount: { toString(): string };
  taxableAmount: { toString(): string };
  taxAmount: { toString(): string };
  cgstAmount: { toString(): string };
  sgstAmount: { toString(): string };
  taxRate: { toString(): string };
}) {
  const s = (v: { toString(): string }) => new Decimal(v.toString()).toFixed(2);
  return {
    baseAmount: s(p.baseAmount),
    discountAmount: s(p.discountAmount),
    taxableAmount: s(p.taxableAmount),
    taxAmount: s(p.taxAmount),
    cgstAmount: s(p.cgstAmount),
    sgstAmount: s(p.sgstAmount),
    taxRate: s(p.taxRate),
  };
}

const pricingEngine = new PricingEngineService();

const sumOf = (results: PricingResult[], pick: (r: PricingResult) => Decimal) =>
  results.reduce((total, r) => total.add(pick(r)), new Decimal(0));

/** basePrice − discountAmount, the engine's pre-GST taxable value for one vehicle */
const taxableOf = (r: PricingResult) => r.basePrice.sub(r.discountAmount);

const hoursBetween = (from: DateTime, to: DateTime) =>
  Math.round(to.diff(from, "hours").hours * 100) / 100;

class ExtensionPricingService {
  /**
   * Recalculate the booking price for a new end date.
   *
   * taxableAmount = post-discount engine price over [startAt, newEndAt] minus
   * the same over the current [startAt, endAt], summed across every vehicle on
   * the booking; additionalAmount = taxableAmount + CGST + SGST on it.
   * newTotalFinal = booking.totalFinal + additionalAmount.
   *
   * The engine's finalTotal excludes the refundable deposit, while
   * booking.totalFinal includes it (plus manual discounts and earlier
   * extensions), so only the delta is priced and the frozen totals are carried
   * forward. The charge also doesn't depend on what has been paid so far: an
   * advance booking's unpaid remaining balance is collected on its own and must
   * not be billed again as extension.
   */
  async recalculate(bookingId: number, newEndAt: Date): Promise<ExtensionPricingResult> {
    // Load booking with items and customer
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        items: { select: { vehicleId: true, vehicle: { select: { categoryId: true } } } },
        customer: { select: { id: true } },
      },
    });

    if (!booking) throw new Error("Booking not found");
    if (booking.items.length === 0) throw new Error("Booking has no vehicle items");

    const customerId = booking.customer.id;

    const startAt = DateTime.fromJSDate(booking.startAt);
    const currentEndAt = DateTime.fromJSDate(booking.endAt);
    const endAt = DateTime.fromJSDate(newEndAt);

    // Price every vehicle with the existing coupon code (revalidated inside the
    // engine — identically for both windows, so the delta stays consistent)
    // The booking's own coupon is locked in: its use isn't counted against it and
    // its validity window / usage limits aren't re-checked, so an expired or
    // used-up coupon still prices both windows the same way. It applies once per
    // booking (first vehicle), as at booking creation.
    const priceAllItems = (to: DateTime) =>
      Promise.all(
        booking.items.map((item, index) =>
          pricingEngine.calculateBookingPrice(
            item.vehicleId,
            startAt,
            to,
            booking.branchId,
            customerId,
            index === 0 ? booking.couponCode ?? undefined : undefined,
            undefined,
            undefined,
            item.vehicle.categoryId,
            undefined,
            {
              paymentPlan: booking.isAdvancePayment ? "ADVANCE" : "FULL",
              excludeBookingId: booking.id,
              couponLockedIn: Boolean(booking.couponCode),
            },
          ),
        ),
      );

    const [newPrices, currentPrices] = await Promise.all([
      priceAllItems(endAt),
      priceAllItems(currentEndAt),
    ]);

    // Compute days for the new full duration
    const newDays = Math.max(1, Math.ceil(endAt.diff(startAt, "days").days));

    // Canonical GST rule: the extension is one taxable line. Its taxable value
    // is the post-discount engine delta; CGST/SGST are computed once on that
    // delta (rounded half-up per tax) and frozen on the extension. Clamped at
    // ₹0 — a longer rental that comes out cheaper is never refunded here.
    const rates = await getBranchGstRates(booking.branchId);
    const rawTaxable = sumOf(newPrices, taxableOf).sub(sumOf(currentPrices, taxableOf)).toDecimalPlaces(2);
    const ZERO = new Decimal(0);
    let baseAmount = ZERO;
    let discountAmount = ZERO;
    let line = computeLineGst(0, rates);
    if (rawTaxable.gt(0)) {
      line = computeLineGst(rawTaxable, rates);
      const rawBase = sumOf(newPrices, (r) => r.basePrice).sub(sumOf(currentPrices, (r) => r.basePrice)).toDecimalPlaces(2);
      // discount = base − taxable, never negative (the base absorbs it)
      discountAmount = Decimal.max(ZERO, rawBase.sub(line.taxable));
      baseAmount = line.taxable.add(discountAmount);
    }
    const additionalAmount = line.taxable.add(line.gst).toDecimalPlaces(2);

    return {
      newDays,
      newTotalBase: sumOf(newPrices, (r) => r.basePrice),
      newTotalDiscount: sumOf(newPrices, (r) => r.discountAmount),
      newTotalTax: sumOf(newPrices, (r) => r.taxAmount),
      newTotalFinal: new Decimal(booking.totalFinal.toString()).add(additionalAmount),
      additionalAmount,
      pricingResult: newPrices[0]!,
      baseAmount,
      discountAmount,
      taxableAmount: line.taxable,
      taxAmount: line.gst,
      cgstAmount: line.cgst,
      sgstAmount: line.sgst,
      taxRate: new Decimal(rates.rate),
      originalHours: hoursBetween(startAt, currentEndAt),
      extensionHours: hoursBetween(currentEndAt, endAt),
    };
  }
}

export const extensionPricingService = new ExtensionPricingService();

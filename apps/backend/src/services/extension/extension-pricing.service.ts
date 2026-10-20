import { prisma, RentalPeriodType } from "@repo/database/client";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { PricingEngineService, heldToClosingOf, weekendDaysOf, type PricingResult } from "../pricing/pricing-engine.service.js";
import { getBranchGstRates } from "../tax/gst.service.js";
import { bookingCouponCode } from "../discount/coupon-validation.service.js";
import {
  extensionCharge,
  extensionSpecialShare,
  extensionWindows,
  type ExtensionChargeTerm,
  type ExtensionPricingMode,
  type ExtensionSpecialShare,
} from "./extension-charge.js";

export interface ExtensionPricingResult {
  newDays: number;
  newTotalBase: Decimal;
  newTotalDiscount: Decimal;
  newTotalTax: Decimal;
  newTotalFinal: Decimal;
  additionalAmount: Decimal;
  /** The engine result of the first vehicle's priced window (absent when nothing is charged: held-to-closing time already paid) */
  pricingResult?: PricingResult;
  /**
   * GST split of additionalAmount (canonical rule #23, item 17):
   * additionalAmount = the post-discount GST-inclusive extension rent (extension-charge.ts);
   * taxableAmount + taxAmount = additionalAmount (splitRentGross),
   * taxableAmount = baseAmount − discountAmount, taxAmount = cgst + sgst,
   * taxRate = cgst% + sgst%.
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
  /** ADDED_TIME: the added window on its own; DELTA: monthly bookings (extension-charge.ts) */
  pricingMode: ExtensionPricingMode;
  /** Festival / weekend parts of additionalAmount (staff only — never sent to customers) */
  specialShare: ExtensionSpecialShare[];
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

const hoursBetween = (from: DateTime, to: DateTime) =>
  Math.round(to.diff(from, "hours").hours * 100) / 100;

/**
 * The booking's coupon as the extension applies it (extension-charge.ts): any
 * coupon for a MONTHLY booking (DELTA — both windows, so a flat coupon cancels
 * out), a PERCENTAGE coupon only for the added window (a flat coupon gave its
 * amount once, on the booking). Found by its rule id, else by its code.
 */
async function extensionCouponCode(
  booking: { couponCode: string | null; discountRuleId: number | null },
  mode: ExtensionPricingMode,
): Promise<string | undefined> {
  const code = await bookingCouponCode(booking);
  if (!code || mode === "DELTA") return code;
  const rule = booking.discountRuleId != null
    ? await prisma.discountRule.findUnique({ where: { id: booking.discountRuleId }, select: { discountType: true } })
    : await prisma.discountRule.findUnique({ where: { code }, select: { discountType: true } });
  return rule?.discountType === "PERCENTAGE" ? code : undefined;
}

class ExtensionPricingService {
  /**
   * Price an extension of a booking to `newEndAt` (extension-charge.ts):
   * ADDED_TIME — the engine's GST-inclusive rent for [current return,
   * newEndAt] on its own; DELTA (monthly bookings) — the rent over [pickup,
   * newEndAt] less the same over [pickup, current return]. Summed across every
   * vehicle on the booking, clamped at ₹0, and split into taxableAmount + CGST
   * + SGST (splitRentTotal). newTotalFinal = booking.totalFinal +
   * additionalAmount.
   *
   * `fromEndAt` is the current return — booking.endAt unless given (a
   * committed extension already holds its end on the booking, so its own
   * charge is re-read from its oldEndAt).
   *
   * The charge doesn't depend on what has been paid so far: an advance
   * booking's unpaid remaining balance is collected on its own and must not be
   * billed again as extension. Every place that prices an extension —
   * staff / BM / customer evaluate, the partial option, the commit's partial
   * re-price and the customer's narrowed quote — comes through here, so an
   * offer and its commit agree.
   */
  async recalculate(bookingId: number, newEndAt: Date, fromEndAt?: Date): Promise<ExtensionPricingResult> {
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
    const currentEnd = fromEndAt ?? booking.endAt;

    const startAt = DateTime.fromJSDate(booking.startAt);
    const currentEndAt = DateTime.fromJSDate(currentEnd);
    const endAt = DateTime.fromJSDate(newEndAt);

    const { mode, terms } = extensionWindows(
      {
        startAt: booking.startAt,
        monthly: booking.rentalPeriodType === RentalPeriodType.MONTHLY,
        // Made as the 12-hour package held to closing: paid to pickup + 12 h already
        heldToClosing: heldToClosingOf(booking.pricingSnapshot),
      },
      currentEnd,
      newEndAt,
    );

    // The booking's own coupon is locked in: its use isn't counted against it and
    // its validity window / usage limits aren't re-checked. It applies once per
    // booking (first vehicle), as at booking creation. Found by its rule id, so a
    // code changed since the booking was made still resolves.
    const couponCode = await extensionCouponCode(booking, mode);
    const priceAllItems = (from: Date, to: Date) =>
      Promise.all(
        booking.items.map((item, index) =>
          pricingEngine.calculateBookingPrice(
            item.vehicleId,
            DateTime.fromJSDate(from),
            DateTime.fromJSDate(to),
            booking.branchId,
            customerId,
            index === 0 ? couponCode : undefined,
            undefined,
            undefined,
            item.vehicle.categoryId,
            undefined,
            {
              paymentPlan: booking.isAdvancePayment ? "ADVANCE" : "FULL",
              excludeBookingId: booking.id,
              couponLockedIn: Boolean(couponCode),
              // DELTA: booked as 12 hours held to closing (item 6) — both windows bill
              // at least 12 h. The added window is billed by its clock length (never
              // the 12-hour package: a short evening extension goes by the hour)
              heldToClosing: mode === "DELTA" ? heldToClosingOf(booking.pricingSnapshot) : false,
              // Weekend blocks by the weekend days it was booked with (none before weekend rates)
              weekendDays: weekendDaysOf(booking.pricingSnapshot),
              // Festival rules: today's (no specialRules) — the added time picks up a
              // festival, even one created after the booking (DELTA: both windows, so
              // the booked period cancels). Confirming the extension stores the rules
              // touching the added time (recordBookingSpecialRules)
            },
          ),
        ),
      );

    const priced = await Promise.all(
      terms.map(async (t) => ({ sign: t.sign, results: await priceAllItems(t.from, t.to) })),
    );
    const chargeTerms: ExtensionChargeTerm[] = priced.flatMap(({ sign, results }) =>
      results.map((r) => ({
        sign,
        grossPrice: r.gross.price,
        grossTotal: r.gross.total,
        weekend: r.pricingBreakdown.weekend,
        festival: r.pricingBreakdown.festival,
      })),
    );
    // The priced window to the new end: the added window, or (DELTA) the whole new one
    const newPrices = priced[0]?.results ?? [];

    // Compute days for the new full duration
    const newDays = Math.max(1, Math.ceil(endAt.diff(startAt, "days").days));

    // Canonical GST rule: the extension is one rent line. Rents are GST-inclusive
    // (item 17): GST is split out of the post-discount inclusive charge once
    // (CGST/SGST rounded half-up per tax) and frozen on the extension. Clamped at
    // ₹0 — a longer rental that comes out cheaper is never refunded here.
    const rates = await getBranchGstRates(booking.branchId);
    const charge = extensionCharge(chargeTerms, rates);

    return {
      newDays,
      newTotalBase: sumOf(newPrices, (r) => r.basePrice),
      newTotalDiscount: sumOf(newPrices, (r) => r.discountAmount),
      newTotalTax: sumOf(newPrices, (r) => r.taxAmount),
      newTotalFinal: new Decimal(booking.totalFinal.toString()).add(charge.additionalAmount),
      additionalAmount: charge.additionalAmount,
      pricingResult: newPrices[0],
      baseAmount: charge.baseAmount,
      discountAmount: charge.discountAmount,
      taxableAmount: charge.taxableAmount,
      taxAmount: charge.taxAmount,
      cgstAmount: charge.cgstAmount,
      sgstAmount: charge.sgstAmount,
      taxRate: new Decimal(rates.rate),
      originalHours: hoursBetween(startAt, currentEndAt),
      extensionHours: hoursBetween(currentEndAt, endAt),
      pricingMode: mode,
      specialShare: extensionSpecialShare(chargeTerms),
    };
  }

  /**
   * The festival / weekend parts of an extension's charge (staff responses
   * only), re-priced for [fromEndAt, toEndAt]; [] when it can't be worked out
   * (the response then just shows no part).
   */
  async specialShareFor(bookingId: number, fromEndAt: Date, toEndAt: Date): Promise<ExtensionSpecialShare[]> {
    try {
      return (await this.recalculate(bookingId, toEndAt, fromEndAt)).specialShare;
    } catch (err) {
      console.warn(`[extension-pricing] Special share unavailable for booking ${bookingId}:`, err);
      return [];
    }
  }
}

export const extensionPricingService = new ExtensionPricingService();

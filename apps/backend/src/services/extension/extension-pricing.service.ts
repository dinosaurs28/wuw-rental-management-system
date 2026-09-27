import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { PricingEngineService, type PricingResult } from "../pricing/pricing-engine.service.js";

export interface ExtensionPricingResult {
  newDays: number;
  newTotalBase: Decimal;
  newTotalDiscount: Decimal;
  newTotalTax: Decimal;
  newTotalFinal: Decimal;
  additionalAmount: Decimal;
  pricingResult: PricingResult;
}

const pricingEngine = new PricingEngineService();

const sumOf = (results: PricingResult[], pick: (r: PricingResult) => Decimal) =>
  results.reduce((total, r) => total.add(pick(r)), new Decimal(0));

class ExtensionPricingService {
  /**
   * Recalculate the booking price for a new end date.
   *
   * additionalAmount = engine price over [startAt, newEndAt] minus engine price
   * over the current [startAt, endAt], summed across every vehicle on the
   * booking. newTotalFinal = booking.totalFinal + additionalAmount.
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
    const priceAllItems = (to: DateTime) =>
      Promise.all(
        booking.items.map((item) =>
          pricingEngine.calculateBookingPrice(
            item.vehicleId,
            startAt,
            to,
            booking.branchId,
            customerId,
            booking.couponCode ?? undefined,
            undefined,
            undefined,
            item.vehicle.categoryId,
          ),
        ),
      );

    const [newPrices, currentPrices] = await Promise.all([
      priceAllItems(endAt),
      priceAllItems(currentEndAt),
    ]);

    // Compute days for the new full duration
    const newDays = Math.max(1, Math.ceil(endAt.diff(startAt, "days").days));

    const additionalAmount = Decimal.max(
      new Decimal(0),
      sumOf(newPrices, (r) => r.finalTotal).sub(sumOf(currentPrices, (r) => r.finalTotal)),
    ).toDecimalPlaces(2);

    return {
      newDays,
      newTotalBase: sumOf(newPrices, (r) => r.basePrice),
      newTotalDiscount: sumOf(newPrices, (r) => r.discountAmount),
      newTotalTax: sumOf(newPrices, (r) => r.taxAmount),
      newTotalFinal: new Decimal(booking.totalFinal.toString()).add(additionalAmount),
      additionalAmount,
      pricingResult: newPrices[0]!,
    };
  }
}

export const extensionPricingService = new ExtensionPricingService();

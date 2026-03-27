import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { PricingEngineService, type PricingResult } from "../pricing/pricing-engine.service.js";
import { financialStateService } from "../payment/index.js";

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

class ExtensionPricingService {
  /**
   * Recalculate the full booking price for a new end date.
   * Returns the pricing delta (additionalAmount) the customer must pay.
   */
  async recalculate(bookingId: number, newEndAt: Date): Promise<ExtensionPricingResult> {
    // Load booking with items and customer
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        items: { select: { vehicleId: true } },
        customer: { select: { id: true } },
      },
    });

    if (!booking) throw new Error("Booking not found");

    const firstItem = booking.items[0];
    if (!firstItem) throw new Error("Booking has no vehicle items");

    const vehicleId = firstItem.vehicleId;
    const customerId = booking.customer.id;

    const startAt = DateTime.fromJSDate(booking.startAt);
    const endAt = DateTime.fromJSDate(newEndAt);

    // Recalculate with existing coupon code (will be revalidated inside the engine)
    const pricingResult = await pricingEngine.calculateBookingPrice(
      vehicleId,
      startAt,
      endAt,
      booking.branchId,
      customerId,
      booking.couponCode ?? undefined,
    );

    // Compute days for the new full duration
    const newDays = Math.max(1, Math.ceil(endAt.diff(startAt, "days").days));

    // Additional amount = what the customer still owes on top of what has been collected
    // Include COLLECTED (pending confirmation) payments — cash was physically received
    const financialState = await financialStateService.getState(bookingId);
    const alreadyPaid = financialState.totalCollectedConfirmed.add(financialState.totalCollectedPending);
    const additionalAmount = Decimal.max(
      new Decimal(0),
      pricingResult.finalTotal.sub(alreadyPaid),
    );

    return {
      newDays,
      newTotalBase: pricingResult.basePrice,
      newTotalDiscount: pricingResult.discountAmount,
      newTotalTax: pricingResult.taxAmount,
      newTotalFinal: pricingResult.finalTotal,
      additionalAmount,
      pricingResult,
    };
  }
}

export const extensionPricingService = new ExtensionPricingService();

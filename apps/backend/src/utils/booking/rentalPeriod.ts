/**
 * Booking period columns (Booking.days / rentalPeriodType / actualHours /
 * billableHours) — written the same way on every path: customer create,
 * walk-in create and every place a confirmed extension moves endAt.
 *
 * rentalPeriodType MONTHLY marks a monthly-plan booking (#15/#17) and is kept
 * once set; every other booking is classified from its length by
 * DurationCalculatorService (HOURLY / HALF_DAY / FULL_DAY / MULTI_DAY — never
 * MONTHLY, see standardRentalPeriodType).
 */
import { prisma, RentalPeriodType } from "@repo/database/client";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { DurationCalculatorService } from "../../services/pricing/duration-calculator.service.js";
import type { TxClient } from "../../services/payment/paymentSession.service.js";

export interface BookingPeriodFields {
  days: number;
  rentalPeriodType: RentalPeriodType;
  actualHours: Decimal;
  billableHours: Decimal;
}

/**
 * Stored period type of a booking that isn't on the monthly plan. A standard
 * booking runs up to MAX_RENTAL_DAYS (30), and the pricing engine classifies
 * 720 billable hours as MONTHLY (priced at the monthly rate when one is set,
 * else per day). It is still a standard booking, so it is stored as MULTI_DAY:
 * MONTHLY stays reserved for the counter monthly plan (180-day extension cap,
 * Monthly booking lists).
 */
export function standardRentalPeriodType(periodType: string): RentalPeriodType {
  return periodType === RentalPeriodType.MONTHLY
    ? RentalPeriodType.MULTI_DAY
    : (periodType as RentalPeriodType);
}

export function bookingPeriodFields(
  startAt: Date,
  endAt: Date,
  opts: { monthly?: boolean } = {},
): BookingPeriodFields {
  const duration = DurationCalculatorService.calculate(
    DateTime.fromJSDate(startAt, { zone: "Asia/Kolkata" }),
    DateTime.fromJSDate(endAt, { zone: "Asia/Kolkata" }),
  );
  return {
    days: duration.days,
    rentalPeriodType: opts.monthly
      ? RentalPeriodType.MONTHLY
      : standardRentalPeriodType(duration.periodType),
    actualHours: new Decimal(duration.actualDuration.toFixed(2)),
    billableHours: new Decimal(duration.billableDuration),
  };
}

/**
 * Re-derive the period columns from the booking's current startAt/endAt.
 * Call it right after an extension is applied (endAt moved), inside the same
 * transaction when there is one. A no-op for a booking that can't be measured.
 */
export async function refreshBookingPeriodFields(bookingId: number, tx?: TxClient): Promise<void> {
  const db = tx ?? prisma;
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { startAt: true, endAt: true, rentalPeriodType: true },
  });
  if (!booking || booking.endAt <= booking.startAt) return;
  await db.booking.update({
    where: { id: bookingId },
    data: bookingPeriodFields(booking.startAt, booking.endAt, {
      monthly: booking.rentalPeriodType === RentalPeriodType.MONTHLY,
    }),
  });
}

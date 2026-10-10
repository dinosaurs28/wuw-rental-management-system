/**
 * The 12-hour package held to closing (client item 6) on EXISTING bookings.
 *
 * Booking create / walk-in create store pricingSnapshot.heldToClosing when the
 * window they priced was the 12-hour package held to the branch's closing.
 * Every path that re-prices an existing booking (extension, BM coupon, km
 * allowance, vehicle swap) bills by that flag — at least pickup + 12 h — and
 * never re-detects it from today's branch hours. Only new quotes / bookings
 * recognise it from the window (branchScheduleValidator isClampedHalfDay).
 *
 * A reschedule moves a 12-hour package (held, or exactly 12 h, not extended)
 * to the package's return for the new pickup and keeps the flag in step.
 */
import { RentalPeriodType, type Prisma } from "@repo/database/client";
import { HALF_DAY_PACKAGE_HOURS, matchPackageHours } from "@repo/schemas";
import { halfDayReturnFor, type BranchScheduleConfig } from "./branchScheduleValidator.js";

const HALF_DAY_MS = HALF_DAY_PACKAGE_HOURS * 60 * 60 * 1000;

/** Whether a booking was created (or rescheduled) as the 12-hour package held to closing. */
export function heldToClosingOf(pricingSnapshot: unknown): boolean {
  return (pricingSnapshot as { heldToClosing?: unknown } | null)?.heldToClosing === true;
}

/** The snapshot with heldToClosing set (true) or removed (false). */
export function withHeldToClosing(pricingSnapshot: unknown, held: boolean): Prisma.InputJsonValue {
  const { heldToClosing: _previous, ...rest } = (pricingSnapshot ?? {}) as Record<string, unknown>;
  return (held ? { ...rest, heldToClosing: true } : rest) as Prisma.InputJsonValue;
}

/** The end a held booking's window is billed to: never less than pickup + 12 h. */
export function heldBillingEnd(startAt: Date, endAt: Date): Date {
  const halfDayEnd = startAt.getTime() + HALF_DAY_MS;
  return endAt.getTime() < halfDayEnd ? new Date(halfDayEnd) : endAt;
}

export interface HalfDayBookingFields {
  startAt: Date;
  endAt: Date;
  /** Set on the first extension. */
  originalEndAt: Date | null;
  rentalPeriodType: RentalPeriodType | null;
  pricingSnapshot: unknown;
}

/**
 * A 12-hour package that hasn't been extended: booked as 12 hours held to
 * closing, or exactly 12 h long. Its return for a new pickup follows the
 * package rule (halfDayReturnFor), not the clock length.
 */
export function isHalfDayPackageBooking(booking: HalfDayBookingFields): boolean {
  if (booking.rentalPeriodType === RentalPeriodType.MONTHLY || booking.originalEndAt) return false;
  return (
    heldToClosingOf(booking.pricingSnapshot) ||
    matchPackageHours(booking.startAt, booking.endAt) === HALF_DAY_PACKAGE_HOURS
  );
}

/**
 * Where a reschedule to `newStart` puts the return. Any booking: shifted by the
 * same amount (its length is kept). A 12-hour package with known branch hours:
 * the package's return for the new pickup — pickup + 12 h, or closing that day
 * when 12 h would end outside hours — and heldToClosing follows. null = a
 * 12-hour package no 12-hour return fits from that pickup (only whole days).
 */
export function rescheduledReturn(
  booking: HalfDayBookingFields,
  newStart: Date,
  schedule: BranchScheduleConfig | null,
): { endAt: Date; halfDayPackage: boolean; heldToClosing: boolean } | null {
  if (schedule && isHalfDayPackageBooking(booking)) {
    const half = halfDayReturnFor(schedule, newStart);
    if (!half) return null;
    return { endAt: half.endAt, halfDayPackage: true, heldToClosing: half.clamped };
  }
  return {
    endAt: new Date(booking.endAt.getTime() + (newStart.getTime() - booking.startAt.getTime())),
    halfDayPackage: false,
    heldToClosing: heldToClosingOf(booking.pricingSnapshot),
  };
}

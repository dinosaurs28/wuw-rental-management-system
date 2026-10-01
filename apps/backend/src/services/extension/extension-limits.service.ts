/**
 * How far a booking may be extended (#15) and when the branch accepts returns
 * (#2) — returned by the extension-eligibility endpoints so web and mobile
 * pickers can stop at the cap and offer only in-hours return times.
 * ExtensionService.evaluate enforces the same rules server-side.
 */
import { prisma, BookingStatus, RentalPeriodType } from "@repo/database/client";
import { MAX_BOOKING_DAYS, MONTHLY_MAX_DAYS } from "@repo/schemas";
import { extensionMaxEndAt } from "../../utils/booking/bookingWindow.js";
import type { BranchScheduleRow } from "../../utils/booking/branchScheduleValidator.js";

export interface ExtensionLimits {
  /** Latest end an extension may request (ISO). */
  maxEndAt: string;
  /** True when the booking already ends at/after maxEndAt — nothing left to extend. */
  atCap: boolean;
  /** 15 for standard bookings, 180 for monthly-plan bookings. */
  maxBookingDays: number;
  isMonthly: boolean;
  rentalPeriodType: RentalPeriodType | null;
  bookingStartAt: string;
  currentEndAt: string;
  branchPublicId: string;
  /** Branch office hours — same shape as GET /api/public/branch/:branchPublicId/schedule. */
  officeHours: { schedules: BranchScheduleRow[]; graceMinutes: number; is24Hours: boolean };
}

export const EXTENDABLE_BOOKING_STATUSES: BookingStatus[] = [BookingStatus.CONFIRMED, BookingStatus.PICKED_UP];

export function maxPeriodReachedMessage(limits: Pick<ExtensionLimits, "maxBookingDays">): string {
  return `This booking has reached the maximum rental period of ${limits.maxBookingDays} days.`;
}

export async function buildExtensionLimits(
  booking: { startAt: Date; endAt: Date; rentalPeriodType: RentalPeriodType | null; branchId: number },
  now: Date = new Date(),
): Promise<ExtensionLimits> {
  const isMonthly = booking.rentalPeriodType === RentalPeriodType.MONTHLY;
  const maxEndAt = extensionMaxEndAt(booking.startAt, { monthly: isMonthly, now });

  const branch = await prisma.branch.findUnique({
    where: { id: booking.branchId },
    select: {
      publicId: true,
      graceMinutes: true,
      is24Hours: true,
      schedules: {
        select: { dayOfWeek: true, isOpen: true, openTime: true, closeTime: true },
        orderBy: { dayOfWeek: "asc" },
      },
    },
  });

  return {
    maxEndAt: maxEndAt.toISOString(),
    atCap: booking.endAt.getTime() >= maxEndAt.getTime(),
    maxBookingDays: isMonthly ? MONTHLY_MAX_DAYS : MAX_BOOKING_DAYS,
    isMonthly,
    rentalPeriodType: booking.rentalPeriodType,
    bookingStartAt: booking.startAt.toISOString(),
    currentEndAt: booking.endAt.toISOString(),
    branchPublicId: branch?.publicId ?? "",
    officeHours: {
      schedules: branch?.schedules ?? [],
      graceMinutes: branch?.graceMinutes ?? 0,
      is24Hours: branch?.is24Hours ?? false,
    },
  };
}

/**
 * How far a booking may be extended (#15) and when the branch accepts returns
 * (#2) — returned by the extension-eligibility endpoints so web and mobile
 * pickers can stop at the cap and offer only in-hours return times.
 * ExtensionService.evaluate enforces the same rules server-side.
 */
import { prisma, BookingStatus, RentalPeriodType } from "@repo/database/client";
import {
  EXTENSION_BUFFER_HOURS,
  MAX_RENTAL_DAYS,
  MONTHLY_MAX_DAYS,
  type ExtensionLimitReason,
} from "@repo/schemas";
import { extensionMaxEndAt } from "../../utils/booking/bookingWindow.js";
import { buildScheduleResponse } from "../../utils/booking/branchScheduleValidator.js";
import { extensionAvailabilityService } from "./extension-availability.service.js";
import { extensionAvailableUntil } from "./partial-extension.js";

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
  /**
   * Branch office hours — same shape as GET /api/public/branch/:branchPublicId/schedule
   * (incl. defaultHours, pickupCutoffMinutes and effectiveSchedules).
   */
  officeHours: ReturnType<typeof buildScheduleResponse>;
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
    maxBookingDays: isMonthly ? MONTHLY_MAX_DAYS : MAX_RENTAL_DAYS,
    isMonthly,
    rentalPeriodType: booking.rentalPeriodType,
    bookingStartAt: booking.startAt.toISOString(),
    currentEndAt: booking.endAt.toISOString(),
    branchPublicId: branch?.publicId ?? "",
    officeHours: buildScheduleResponse({
      schedules: branch?.schedules ?? [],
      graceMinutes: branch?.graceMinutes ?? 0,
      is24Hours: branch?.is24Hours ?? false,
    }),
  };
}

/**
 * How far the booking's current car can be extended, for the staff extension
 * screens (eligibility and evaluate): its next booking and "available until"
 * — EXTENSION_BUFFER_HOURS before that booking's pickup (rounded down to the
 * picker grid), or the rental-length cap when that comes first. Worked out
 * here so web and mobile only display it. Past availableUntil the car itself
 * can't be extended; a swap to another car may still be offered.
 *
 * Staff only: it names the next booking. Customers get availableUntil alone.
 */
export interface ExtensionAvailabilityInfo {
  /** The booking's current car. */
  vehicleRegNo: string | null;
  /** Pickup of the car's next booking or checkout in progress (ISO), or null when none. */
  nextBookingStartAt: string | null;
  /** Its booking id (publicId), or null. */
  nextBookingRef: string | null;
  /**
   * BOOKING = a confirmed booking; HOLD = a customer checkout in progress;
   * LOCK = a branch manager's booking lock (nextBookingRef is the lock's id;
   * the return may be right up to its start — no buffer).
   */
  nextBookingKind: "BOOKING" | "HOLD" | "LOCK" | null;
  /** The lock's reason, for kind LOCK (staff only — customerSafeAvailability drops it). */
  nextLockReason?: string | null;
  /** When the lock ends (ISO), for kind LOCK. */
  nextLockEndAt?: string | null;
  /** Latest return this car can be extended to (ISO); the current return when none is left. */
  availableUntil: string;
  /** NEXT_BOOKING = 2 h before the next pickup; MAX_RENTAL_PERIOD = the rental-length cap. */
  limitReason: ExtensionLimitReason;
  /** False when no time is left on this car. */
  canExtend: boolean;
  /** EXTENSION_BUFFER_HOURS (2). */
  extensionBufferHours: number;
}

/** How far ahead the next booking is looked for (any booking past the cap is still shown). */
const NEXT_BOOKING_HORIZON_MS = 400 * 24 * 60 * 60 * 1000;

export async function buildExtensionAvailability(
  booking: { id: number; endAt: Date },
  maxEndAt: Date,
): Promise<ExtensionAvailabilityInfo | null> {
  const item = await prisma.bookingItem.findFirst({
    where: { bookingId: booking.id },
    orderBy: { id: "asc" },
    select: { vehicleId: true, vehicle: { select: { regNo: true } } },
  });
  if (!item) return null;

  const next = await extensionAvailabilityService.nextConflict(
    item.vehicleId,
    booking.endAt,
    new Date(Math.max(booking.endAt.getTime(), maxEndAt.getTime()) + NEXT_BOOKING_HORIZON_MS),
    booking.id,
  );
  const until = extensionAvailableUntil({
    currentEndAt: booking.endAt,
    maxEndAt,
    nextPickupAt: next?.startAt ?? null,
    nextKind: next?.kind ?? null,
  });
  return {
    vehicleRegNo: item.vehicle.regNo,
    nextBookingStartAt: next ? next.startAt.toISOString() : null,
    nextBookingRef: next ? next.bookingPublicId : null,
    nextBookingKind: next ? (next.kind ?? "BOOKING") : null,
    ...(next?.kind === "LOCK" && { nextLockReason: next.lockReason ?? null, nextLockEndAt: next.endAt.toISOString() }),
    availableUntil: until.availableUntil.toISOString(),
    limitReason: until.limitReason,
    canExtend: until.canExtend,
    extensionBufferHours: EXTENSION_BUFFER_HOURS,
  };
}

/**
 * The availability info as a customer may see it: a booking lock reads as the
 * car's next booking (no reason, no lock id) — customers never learn why a car
 * is unavailable.
 */
export function customerSafeAvailability(info: ExtensionAvailabilityInfo | null): ExtensionAvailabilityInfo | null {
  if (!info || info.nextBookingKind !== "LOCK") return info;
  const { nextLockReason: _reason, nextLockEndAt: _end, ...rest } = info;
  return { ...rest, nextBookingKind: "BOOKING", nextBookingRef: null };
}

/** buildExtensionAvailability that never fails the request it decorates (null on error). */
export async function safeExtensionAvailability(
  booking: { id: number; endAt: Date },
  maxEndAt: Date,
): Promise<ExtensionAvailabilityInfo | null> {
  try {
    return await buildExtensionAvailability(booking, maxEndAt);
  } catch (err) {
    console.warn(`[extension] Availability info unavailable for booking ${booking.id}:`, err);
    return null;
  }
}

/**
 * safeExtensionAvailability for a booking as it is now (e.g. right after a
 * commit moved its return, and maybe its car): the car's next booking and how
 * much further it could still go — what staff see while collecting.
 */
export async function currentExtensionAvailability(bookingId: number): Promise<ExtensionAvailabilityInfo | null> {
  // Never fails the response it decorates (a committed extension stays committed)
  const booking = await prisma.booking
    .findUnique({
      where: { id: bookingId },
      select: { id: true, startAt: true, endAt: true, rentalPeriodType: true },
    })
    .catch(() => null);
  if (!booking) return null;
  const maxEndAt = extensionMaxEndAt(booking.startAt, { monthly: booking.rentalPeriodType === RentalPeriodType.MONTHLY });
  return safeExtensionAvailability(booking, maxEndAt);
}

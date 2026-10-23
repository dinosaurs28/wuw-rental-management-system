/**
 * Monthly rental expiry reminder (client TODO item 6, Oct 2026).
 *
 * Every monthly booking (isMonthlyBooking: rentalPeriodType MONTHLY) that is
 * CONFIRMED or out on the road (PICKED_UP) gets one reminder once its endAt is
 * at most MONTHLY_EXPIRY_NOTICE_DAYS (5) days away and still in the future. The
 * window is "endAt − now ≤ 5 days and endAt > now" rather than "the 5th day
 * ahead" so a scan running at any interval, or after downtime, still sends it.
 *
 * Recipients: the Fleet Members (STAFF, push + inbox) and Branch Managers
 * (inbox, bell in the BM portal) of the booking's own branch only.
 *
 * Dedupe: the sent marker is the Notification row itself, keyed by
 * monthlyExpiryDedupeKey(publicId, endAt) under the (userId, dedupeKey) unique
 * constraint — a second scan, a restart or a second backend instance never
 * creates a second row or push. The key holds the endAt the reminder was for,
 * so a renewal / extension that moves endAt re-arms the reminder for the new end.
 *
 * Pure helpers + an injectable scan loop (monthlyExpiry.test.ts); the worker
 * (jobs/notification.worker.ts) wires them to Prisma and notifyEvents.
 */
import { BookingStatus, type Prisma, type RentalPeriodType } from "@repo/database/client";
import { bookingTypeWhere, isMonthlyBooking } from "./bookingTypeFilter.js";

export const MONTHLY_EXPIRY_NOTICE_DAYS = 5;
export const MONTHLY_EXPIRY_NOTICE_MS = MONTHLY_EXPIRY_NOTICE_DAYS * 24 * 60 * 60 * 1000;

/** True while endAt is in the future and at most 5 days away. */
export function isMonthlyExpiryDue(endAt: Date, now: Date): boolean {
  const left = endAt.getTime() - now.getTime();
  return left > 0 && left <= MONTHLY_EXPIRY_NOTICE_MS;
}

/** One reminder per booking per end time: a moved endAt gives a new key. */
export function monthlyExpiryDedupeKey(bookingPublicId: string, endAt: Date): string {
  return `monthly-expiry:${bookingPublicId}:${endAt.toISOString()}`;
}

/**
 * A live monthly rental: CONFIRMED (incl. a pickup waiting on the manager), or
 * PICKED_UP with the car not yet handed back (a drop waiting on the manager is
 * excluded, as on the overdue list).
 */
export function isMonthlyExpiryStatus(status: string, requiresManagerConfirmation: boolean): boolean {
  if (status === BookingStatus.CONFIRMED) return true;
  return status === BookingStatus.PICKED_UP && !requiresManagerConfirmation;
}

/** Prisma filter for the scan; mirrors isMonthlyBooking + isMonthlyExpiryStatus + isMonthlyExpiryDue. */
export function monthlyExpiryCandidateWhere(now: Date): Prisma.BookingWhereInput {
  return {
    ...bookingTypeWhere("MONTHLY"),
    deletedAt: null,
    endAt: { gt: now, lte: new Date(now.getTime() + MONTHLY_EXPIRY_NOTICE_MS) },
    OR: [
      { status: BookingStatus.CONFIRMED },
      { status: BookingStatus.PICKED_UP, requiresManagerConfirmation: false },
    ],
  };
}

export interface MonthlyExpiryBooking {
  id: number;
  publicId: string;
  endAt: Date;
  status: string;
  rentalPeriodType: RentalPeriodType | string | null;
  requiresManagerConfirmation: boolean;
}

/** Whether this booking should get a reminder now (before dedupe). */
export function needsMonthlyExpiryReminder(booking: MonthlyExpiryBooking, now: Date): boolean {
  return (
    isMonthlyBooking(booking.rentalPeriodType) &&
    isMonthlyExpiryStatus(booking.status, booking.requiresManagerConfirmation) &&
    isMonthlyExpiryDue(booking.endAt, now)
  );
}

/** "Make Model (REGNO)", or "the vehicle" when the booking has none. */
export function monthlyExpiryVehicleLabel(
  v: { make: string; model: string; regNo: string } | null | undefined,
): string {
  return v ? `${v.make} ${v.model} (${v.regNo})` : "the vehicle";
}

/** Title + body of the reminder. `endAtLabel` is the IST display time. */
export function monthlyExpiryMessage(args: {
  vehicleLabel: string;
  customerName: string;
  endAtLabel: string;
}): { title: string; body: string } {
  return {
    title: "Monthly rental expiring soon",
    body: `The monthly rental for ${args.vehicleLabel} booked by ${args.customerName} expires on ${args.endAtLabel}. Please contact the customer regarding renewal.`,
  };
}

export interface MonthlyExpiryScanDeps {
  findCandidates(now: Date): Promise<MonthlyExpiryBooking[]>;
  /** A reminder row with this key already exists for the booking. */
  alreadyNotified(bookingId: number, dedupeKey: string): Promise<boolean>;
  /** Sends the reminder; resolves to the number of notification rows created. */
  send(booking: MonthlyExpiryBooking): Promise<number>;
}

export interface MonthlyExpiryScanResult {
  candidates: number;
  /** Bookings for which at least one new notification row was created. */
  notified: string[];
  /** Bookings skipped because this endAt was already reminded. */
  alreadySent: number;
}

/** One pass over the due monthly bookings. Safe to run as often as wanted. */
export async function scanMonthlyExpiry(
  now: Date,
  deps: MonthlyExpiryScanDeps,
): Promise<MonthlyExpiryScanResult> {
  const candidates = await deps.findCandidates(now);
  const result: MonthlyExpiryScanResult = { candidates: candidates.length, notified: [], alreadySent: 0 };
  for (const booking of candidates) {
    if (!needsMonthlyExpiryReminder(booking, now)) continue;
    if (await deps.alreadyNotified(booking.id, monthlyExpiryDedupeKey(booking.publicId, booking.endAt))) {
      result.alreadySent++;
      continue;
    }
    const created = await deps.send(booking);
    if (created > 0) result.notified.push(booking.publicId);
  }
  return result;
}

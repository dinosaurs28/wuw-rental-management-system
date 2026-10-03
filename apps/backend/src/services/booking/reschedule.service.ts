/**
 * Reschedule a confirmed booking (12 h / 24 h packages, Fleet / BM flexibility).
 *
 * Customers book packages only; when one asks to come earlier or later, Fleet
 * (STAFF, own branch) or the Branch Manager moves the booking: a new pickup
 * time, the return shifted by the same amount. Length, price, GST, discounts,
 * free km and payments are unchanged — nothing is re-priced.
 *
 *   GET  …/bookings/:publicId/reschedule   what the picker needs (hours, limits,
 *                                           busy windows) and whether it can move
 *   POST …/bookings/:publicId/reschedule   { newStartAt, reason? }
 *
 * Only a CONFIRMED booking that hasn't been handed over: no pickup waiting for
 * the manager's confirmation, no open counter payment session, no committed or
 * paid-but-unconfirmed extension (an uncommitted customer quote is released),
 * no open UPI QR. The new window must keep the vehicle(s) free (other bookings,
 * unexpired holds — DB and Redis), keep the pickup and the return inside office
 * hours (no auto-adjust: the length is fixed), stay inside the 15-day window
 * (a monthly booking: its pickup inside the window), keep the driving licence
 * free (one vehicle per DL) and the customer's type-class limit.
 *
 * Confirmed extensions move with the booking (their old / new ends shift by the
 * same amount), so the drop's original-vs-extended split and the km allowance
 * stay right. Writes an audit log + staff activity and notifies the customer.
 *
 * Errors: HTTP 4xx { success:false, code, message, ...extra } (RescheduleError,
 * or the shared BookingWindowError / DlInUseError bodies).
 */
import type { Request } from "express";
import {
  prisma,
  BookingStatus,
  ExtensionStatus,
  PaymentSessionStatus,
  RentalPeriodType,
} from "@repo/database/client";
import type { Prisma } from "@repo/database/client";
import { DateTime } from "luxon";
import { bookingWindowEnd, MAX_BOOKING_DAYS } from "@repo/schemas";
import { StatusCode } from "../../types/statusCode.js";
import { TimezoneService } from "../timezone/timezone.service.js";
import { redis } from "../../lib/redisconfig.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../staffActivity/staffActivity.service.js";
import { notifyEvents } from "../notification/notification.events.js";
import { assertBookingWindow, BookingWindowError } from "../../utils/booking/bookingWindow.js";
import {
  buildScheduleErrorMessage,
  buildScheduleResponse,
  loadBranchScheduleConfig,
  validateBookingSchedule,
  validateReturnTime,
  type ScheduleVerdict,
} from "../../utils/booking/branchScheduleValidator.js";
import { checkCustomerTypeClassLimits } from "../../utils/booking/customerTypeClassLimits.js";
import { listOverlappingHolds } from "../../utils/availability/availabilityBatch.js";
import { invalidateGroupListingCache, invalidateVehicleAvailability } from "../../utils/cache/vehicleCacheKeys.js";
import { extensionLockService } from "../extension/extension-lock.service.js";
import { assertDlFree, cleanDl, lockAndAssertDlFree } from "./dl-in-use.service.js";

type Db = Prisma.TransactionClient | typeof prisma;
export type RescheduleActorRole = "STAFF" | "MANAGER";

const MINUTE_MS = 60 * 1000;
/** A picker's "now" slot may start a little before the request arrives. */
export const RESCHEDULE_PAST_TOLERANCE_MINUTES = 30;
export const RESCHEDULE_REASON_MAX = 500;

const OPEN_SESSION_STATUSES: PaymentSessionStatus[] = [
  PaymentSessionStatus.OPEN,
  PaymentSessionStatus.COMPUTING,
  PaymentSessionStatus.AWAITING_PAYMENT,
  PaymentSessionStatus.PAYMENT_INITIATED,
];

export type RescheduleErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "BOOKING_NOT_FOUND"
  | "BOOKING_NOT_RESCHEDULABLE"
  | "PICKUP_PENDING_CONFIRMATION"
  | "PAYMENT_SESSION_OPEN"
  | "PAYMENT_IN_PROGRESS"
  | "EXTENSION_PENDING"
  | "RESCHEDULE_NO_CHANGE"
  | "RESCHEDULE_IN_PAST"
  | "BRANCH_SCHEDULE_VIOLATION"
  | "VEHICLE_UNAVAILABLE"
  | "VEHICLE_TYPE_LIMIT_EXCEEDED"
  | "RESCHEDULE_BUSY"
  | "RESCHEDULE_CONFLICT";

export class RescheduleError extends Error {
  constructor(
    public readonly status: StatusCode,
    public readonly code: RescheduleErrorCode,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "RescheduleError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message, ...this.extra };
  }
}

// ── Formatting ──────────────────────────────────────────────────────────────

const ist = (d: Date) => DateTime.fromJSDate(d).setZone("Asia/Kolkata");
/** "5 Oct 2026, 6:00 PM" */
const formatIst = (d: Date) => ist(d).toFormat("d LLL yyyy, h:mm a");
/** "Mon 5 Oct, 6:00 PM" */
const formatIstShort = (d: Date) => ist(d).toFormat("ccc d LLL, h:mm a");

/** "1 day", "12 hours", "2 days 3 hours", "1 hour 30 minutes". */
export function durationLabel(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  const parts: string[] = [];
  if (days) parts.push(days === 1 ? "1 day" : `${days} days`);
  if (hours) parts.push(hours === 1 ? "1 hour" : `${hours} hours`);
  if (mins) parts.push(mins === 1 ? "1 minute" : `${mins} minutes`);
  return parts.length > 0 ? parts.join(" ") : "0 minutes";
}

function vehicleLabel(v: { make: string; model: string; regNo: string }): string {
  return `${v.make} ${v.model} (${v.regNo})`;
}

// ── Loading + blockers ──────────────────────────────────────────────────────

async function loadBooking(bookingPublicId: string, branchId: number) {
  return prisma.booking.findFirst({
    where: { publicId: bookingPublicId, branchId, deletedAt: null },
    select: {
      id: true,
      publicId: true,
      status: true,
      startAt: true,
      endAt: true,
      originalEndAt: true,
      branchId: true,
      customerId: true,
      rentalPeriodType: true,
      requiresManagerConfirmation: true,
      activeExtensionId: true,
      branch: { select: { publicId: true, bookingRestrictionMode: true } },
      customer: { select: { drivingLicenceNumber: true, user: { select: { name: true } } } },
      items: {
        orderBy: { id: "asc" },
        select: {
          vehicle: {
            select: {
              id: true,
              publicId: true,
              make: true,
              model: true,
              regNo: true,
              category: { select: { typeClass: true } },
            },
          },
        },
      },
    },
  });
}

type RescheduleBooking = NonNullable<Awaited<ReturnType<typeof loadBooking>>>;

const STATUS_MESSAGES: Partial<Record<BookingStatus, string>> = {
  [BookingStatus.PICKED_UP]:
    "This booking has already been picked up, so it can't be rescheduled. Extend it instead if the customer needs more time.",
  [BookingStatus.HOLD]: "This booking isn't confirmed yet (its payment is pending), so it can't be rescheduled.",
  [BookingStatus.RETURNED]: "This booking has been returned, so it can't be rescheduled.",
  [BookingStatus.CANCELLED]: "This booking was cancelled, so it can't be rescheduled.",
  [BookingStatus.HOLD_EXPIRED]: "This booking expired before it was paid, so it can't be rescheduled.",
};

/**
 * Why this booking can't be moved at all (whatever the new time), or null.
 * `releasableQuoteId` is an uncommitted customer extension quote — it holds no
 * slot and no money, and is released by the reschedule.
 */
async function findBlocker(
  booking: RescheduleBooking,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<{ blocker: RescheduleError | null; releasableQuoteId: number | null }> {
  if (booking.status !== BookingStatus.CONFIRMED) {
    return {
      blocker: new RescheduleError(
        StatusCode.CONFLICT,
        "BOOKING_NOT_RESCHEDULABLE",
        STATUS_MESSAGES[booking.status] ?? "This booking can't be rescheduled.",
        { bookingStatus: booking.status },
      ),
      releasableQuoteId: null,
    };
  }
  if (booking.requiresManagerConfirmation) {
    return {
      blocker: new RescheduleError(
        StatusCode.CONFLICT,
        "PICKUP_PENDING_CONFIRMATION",
        "This booking's pickup is waiting for the branch manager's confirmation, so it can't be rescheduled.",
      ),
      releasableQuoteId: null,
    };
  }

  const session = await db.paymentSession.findFirst({
    where: { bookingId: booking.id, status: { in: OPEN_SESSION_STATUSES } },
    select: { publicId: true, sessionType: true },
  });
  if (session) {
    return {
      blocker: new RescheduleError(
        StatusCode.CONFLICT,
        "PAYMENT_SESSION_OPEN",
        "A counter payment is in progress for this booking. Finish or cancel it before rescheduling.",
        { paymentSessionPublicId: session.publicId, sessionType: session.sessionType },
      ),
      releasableQuoteId: null,
    };
  }

  const openQr = await db.upiQrPayment.findFirst({
    where: { bookingId: booking.id, status: "ACTIVE", closeBy: { gt: now } },
    select: { publicId: true },
  });
  if (openQr) {
    return {
      blocker: new RescheduleError(
        StatusCode.CONFLICT,
        "PAYMENT_IN_PROGRESS",
        "The customer has an open UPI QR payment for this booking. Try again once it's paid or has expired.",
      ),
      releasableQuoteId: null,
    };
  }

  let releasableQuoteId: number | null = null;
  if (booking.activeExtensionId !== null) {
    const active = await db.bookingExtension.findUnique({
      where: { id: booking.activeExtensionId },
      select: {
        id: true,
        publicId: true,
        extensionStatus: true,
        resolutionType: true,
        gatewayTransactionId: true,
        paymentTransactionId: true,
      },
    });
    const isOpen =
      active?.extensionStatus === ExtensionStatus.PENDING_PAYMENT ||
      active?.extensionStatus === ExtensionStatus.PAYMENT_COLLECTED;
    const isUncommittedQuote =
      active?.extensionStatus === ExtensionStatus.PENDING_PAYMENT &&
      active.resolutionType === null &&
      active.gatewayTransactionId === null &&
      active.paymentTransactionId === null;
    if (active && isOpen && !isUncommittedQuote) {
      return {
        blocker: new RescheduleError(
          StatusCode.CONFLICT,
          "EXTENSION_PENDING",
          active.extensionStatus === ExtensionStatus.PAYMENT_COLLECTED
            ? "This booking has an extension whose payment is awaiting the branch manager's confirmation. Confirm or reject it before rescheduling."
            : "This booking has a pending extension. Complete or cancel it before rescheduling.",
          { pendingExtensionPublicId: active.publicId, pendingExtensionStatus: active.extensionStatus },
        ),
        releasableQuoteId: null,
      };
    }
    if (active && isUncommittedQuote) releasableQuoteId = active.id;
  }

  return { blocker: null, releasableQuoteId };
}

// ── Window rules ─────────────────────────────────────────────────────────────

/** Latest pickup this booking can move to: its return within the 15-day window (monthly: the pickup). */
function latestStartFor(booking: RescheduleBooking, durationMs: number, now: Date): Date {
  const windowEnd = bookingWindowEnd(now);
  return booking.rentalPeriodType === RentalPeriodType.MONTHLY
    ? windowEnd
    : new Date(windowEnd.getTime() - durationMs);
}

function windowError(
  err: BookingWindowError,
  latestStartAt: Date,
  durationMinutes: number,
): BookingWindowError {
  if (err.reason !== "WINDOW") return err;
  const body = err.toJSON();
  return new RescheduleWindowError(
    `Bookings can run up to ${MAX_BOOKING_DAYS} days from today, so with its length of ${durationLabel(durationMinutes)} this booking must start by ${formatIst(latestStartAt)}.`,
    body,
    latestStartAt,
  );
}

/** BOOKING_MAX_PERIOD_EXCEEDED with a reschedule-specific message and latestStartAt. */
class RescheduleWindowError extends BookingWindowError {
  constructor(
    message: string,
    body: ReturnType<BookingWindowError["toJSON"]>,
    public readonly latestStartAt: Date,
  ) {
    super(message, body.reason, new Date(body.maxEndAt));
  }

  override toJSON() {
    return { ...super.toJSON(), latestStartAt: this.latestStartAt.toISOString() };
  }
}

/** Office hours for the new pickup and the shifted return (no auto-adjust — the length is fixed). */
function hoursError(
  schedule: Awaited<ReturnType<typeof loadBranchScheduleConfig>>,
  newStart: Date,
  newEnd: Date,
): RescheduleError | null {
  if (!schedule) return null;
  const pickupVerdict = validateBookingSchedule(schedule, newStart, newEnd);
  if (pickupVerdict.status.startsWith("PICKUP_")) {
    return new RescheduleError(StatusCode.BAD_REQUEST, "BRANCH_SCHEDULE_VIOLATION", buildScheduleErrorMessage(pickupVerdict), {
      verdict: pickupVerdict,
    });
  }
  const returnVerdict: ScheduleVerdict = validateReturnTime(schedule, newEnd);
  if (returnVerdict.status !== "RETURN_OUTSIDE_HOURS") return null;
  const at = `The booking keeps its length, so the return would move to ${formatIstShort(newEnd)}`;
  let message: string;
  if (returnVerdict.reason === "CLOSED_DAY") {
    message = `${at}, and the branch is closed on ${returnVerdict.closedDayName ?? "that day"}. Choose a pickup time whose return falls on an open day.`;
  } else if (returnVerdict.reason === "BEFORE_OPEN") {
    message = `${at}, before the branch opens (${returnVerdict.openingTime ?? "opening time"}). Choose a later pickup time.`;
  } else {
    const grace =
      returnVerdict.gracePeriodEnd && returnVerdict.gracePeriodEnd !== returnVerdict.closingTime
        ? `, returns accepted until ${returnVerdict.gracePeriodEnd}`
        : "";
    message = `${at}, after the branch closes (${returnVerdict.closingTime ?? "closing time"}${grace}). Choose an earlier pickup time.`;
  }
  return new RescheduleError(StatusCode.BAD_REQUEST, "BRANCH_SCHEDULE_VIOLATION", message, {
    verdict: { ...returnVerdict, returnAt: newEnd.toISOString() },
  });
}

// ── Vehicle conflicts ─────────────────────────────────────────────────────────

interface VehicleConflict {
  vehiclePublicId: string;
  kind: "BOOKING" | "HOLD";
  bookingPublicId: string | null;
  bookingStatus: BookingStatus | null;
  startAt: Date;
  endAt: Date;
}

/**
 * Other bookings on these vehicles overlapping [start, end): CONFIRMED, unexpired
 * HOLD, and PICKED_UP (an overdue one is still out now, so it blocks a start
 * that has already come).
 */
async function findBookingConflicts(
  db: Db,
  booking: RescheduleBooking,
  start: Date,
  end: Date,
  now: Date,
): Promise<VehicleConflict[]> {
  const vehicleIds = booking.items.map((i) => i.vehicle.id);
  const overlaps = { startAt: { lt: end }, endAt: { gt: start } };
  const rows = await db.bookingItem.findMany({
    where: {
      vehicleId: { in: vehicleIds },
      booking: {
        id: { not: booking.id },
        deletedAt: null,
        OR: [
          { status: BookingStatus.CONFIRMED, ...overlaps },
          { status: BookingStatus.HOLD, holdExpiresAt: { gt: now }, ...overlaps },
          now > start
            ? { status: BookingStatus.PICKED_UP, startAt: { lt: end } }
            : { status: BookingStatus.PICKED_UP, ...overlaps },
        ],
      },
    },
    orderBy: { booking: { startAt: "asc" } },
    select: {
      vehicle: { select: { publicId: true } },
      booking: { select: { publicId: true, status: true, startAt: true, endAt: true } },
    },
  });
  return rows.map((r) => ({
    vehiclePublicId: r.vehicle.publicId,
    kind: r.booking.status === BookingStatus.HOLD ? "HOLD" : "BOOKING",
    bookingPublicId: r.booking.publicId,
    bookingStatus: r.booking.status,
    startAt: r.booking.startAt,
    endAt: r.booking.endAt,
  }));
}

/** Customer checkouts in progress (Redis holds) on these vehicles — never this booking's own. */
async function findHoldConflicts(booking: RescheduleBooking, start: Date, end: Date): Promise<VehicleConflict[]> {
  const idMap = new Map(booking.items.map((i) => [i.vehicle.id, i.vehicle.publicId]));
  const holds = await listOverlappingHolds(idMap, start, end, new Set([booking.publicId]));
  return holds.map((h) => ({
    vehiclePublicId: idMap.get(h.vehicleId)!,
    kind: "HOLD",
    bookingPublicId: h.holdId,
    bookingStatus: null,
    startAt: h.startAt,
    endAt: h.endAt,
  }));
}

function vehicleUnavailable(booking: RescheduleBooking, conflicts: VehicleConflict[]): RescheduleError {
  const first = conflicts[0]!;
  const vehicle = booking.items.find((i) => i.vehicle.publicId === first.vehiclePublicId)?.vehicle;
  const name = vehicle ? vehicleLabel(vehicle) : "The vehicle";
  const when = `${formatIst(first.startAt)} – ${formatIst(first.endAt)}`;
  const message =
    first.kind === "HOLD"
      ? `${name} is being booked by another customer for ${when}, which overlaps the new dates. Choose another time, or try again in a few minutes.`
      : `${name} is booked for ${when} (booking ${first.bookingPublicId}), which overlaps the new dates. Choose another time, or swap the vehicle first.`;
  return new RescheduleError(StatusCode.CONFLICT, "VEHICLE_UNAVAILABLE", message, {
    conflicts: conflicts.map((c) => ({
      vehiclePublicId: c.vehiclePublicId,
      kind: c.kind,
      bookingPublicId: c.bookingPublicId,
      bookingStatus: c.bookingStatus,
      startAt: c.startAt.toISOString(),
      endAt: c.endAt.toISOString(),
    })),
  });
}

// ── Request parsing ───────────────────────────────────────────────────────────

/**
 * newStartAt: IST "YYYY-MM-DDTHH:mm" (employee convention) or an ISO string with
 * an offset / Z. Seconds are dropped (minute slots).
 */
function parseNewStartAt(raw: unknown): Date {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new RescheduleError(
      StatusCode.BAD_REQUEST,
      "VALIDATION_ERROR",
      "newStartAt is required — the new pickup date and time, e.g. 2026-10-05T10:30 (IST).",
    );
  }
  const dt = TimezoneService.parseISO(raw.trim());
  if (!dt.isValid) {
    throw new RescheduleError(
      StatusCode.BAD_REQUEST,
      "VALIDATION_ERROR",
      "newStartAt must be a date and time like 2026-10-05T10:30 (IST).",
    );
  }
  return TimezoneService.toPrisma(dt.startOf("minute"));
}

function parseReason(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new RescheduleError(StatusCode.BAD_REQUEST, "VALIDATION_ERROR", "reason must be text.");
  }
  const reason = raw.trim();
  if (reason.length > RESCHEDULE_REASON_MAX) {
    throw new RescheduleError(
      StatusCode.BAD_REQUEST,
      "VALIDATION_ERROR",
      `reason can be at most ${RESCHEDULE_REASON_MAX} characters.`,
    );
  }
  return reason.length > 0 ? reason : null;
}

async function requireBooking(req: Request, bookingPublicId: string): Promise<RescheduleBooking> {
  const booking = await loadBooking(bookingPublicId, req.branch_Id);
  if (!booking) {
    throw new RescheduleError(StatusCode.NOT_FOUND, "BOOKING_NOT_FOUND", "Booking not found at your branch.");
  }
  return booking;
}

// ── GET: options for the picker ──────────────────────────────────────────────

export async function getRescheduleOptions(req: Request, bookingPublicId: string) {
  const booking = await requireBooking(req, bookingPublicId);
  const now = new Date();
  const { blocker } = await findBlocker(booking, prisma, now);

  const durationMs = booking.endAt.getTime() - booking.startAt.getTime();
  const durationMinutes = Math.round(durationMs / MINUTE_MS);
  const earliestStartAt = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
  const latestStartAt = latestStartFor(booking, durationMs, now);
  const rangeStart = new Date(earliestStartAt.getTime() - RESCHEDULE_PAST_TOLERANCE_MINUTES * MINUTE_MS);
  const rangeEnd = new Date(Math.max(latestStartAt.getTime(), earliestStartAt.getTime()) + durationMs);

  const schedule = await loadBranchScheduleConfig(booking.branchId);

  // What is in the way between now and the latest return: other bookings and
  // holds on the vehicle(s), and other bookings on the customer's licence
  const [bookingBusy, holdBusy] = await Promise.all([
    findBookingConflicts(prisma, booking, rangeStart, rangeEnd, now),
    findHoldConflicts(booking, rangeStart, rangeEnd),
  ]);
  const dl = cleanDl(booking.customer.drivingLicenceNumber);
  const dlBookings = dl
    ? await prisma.booking.findMany({
        where: {
          id: { not: booking.id },
          deletedAt: null,
          customer: { drivingLicenceNumber: dl },
          startAt: { lt: rangeEnd },
          OR: [
            { status: BookingStatus.PICKED_UP },
            { status: BookingStatus.CONFIRMED, endAt: { gt: rangeStart } },
            { status: BookingStatus.HOLD, holdExpiresAt: { gt: now }, endAt: { gt: rangeStart } },
          ],
        },
        orderBy: { startAt: "asc" },
        select: { publicId: true, status: true, startAt: true, endAt: true },
      })
    : [];

  return {
    bookingPublicId: booking.publicId,
    status: booking.status,
    reschedulable: blocker === null,
    code: blocker?.code ?? null,
    reason: blocker?.message ?? null,
    startAt: booking.startAt.toISOString(),
    endAt: booking.endAt.toISOString(),
    durationMinutes,
    durationLabel: durationLabel(durationMinutes),
    isMonthly: booking.rentalPeriodType === RentalPeriodType.MONTHLY,
    rentalPeriodType: booking.rentalPeriodType,
    earliestStartAt: earliestStartAt.toISOString(),
    latestStartAt: latestStartAt.toISOString(),
    pastToleranceMinutes: RESCHEDULE_PAST_TOLERANCE_MINUTES,
    branchPublicId: booking.branch.publicId,
    officeHours: buildScheduleResponse(
      schedule ?? { schedules: [], graceMinutes: 0, is24Hours: false },
    ),
    vehicles: booking.items.map((i) => ({
      publicId: i.vehicle.publicId,
      make: i.vehicle.make,
      model: i.vehicle.model,
      regNo: i.vehicle.regNo,
    })),
    vehicleBusy: [...bookingBusy, ...holdBusy]
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
      .map((c) => ({
        vehiclePublicId: c.vehiclePublicId,
        kind: c.kind,
        bookingPublicId: c.kind === "HOLD" && c.bookingStatus === null ? null : c.bookingPublicId,
        bookingStatus: c.bookingStatus,
        startAt: c.startAt.toISOString(),
        // An out vehicle is busy at least until now (overdue)
        endAt: (c.bookingStatus === BookingStatus.PICKED_UP && c.endAt < now ? now : c.endAt).toISOString(),
      })),
    dlBusy: dlBookings.map((b) => ({
      bookingPublicId: b.publicId,
      bookingStatus: b.status,
      startAt: b.startAt.toISOString(),
      endAt: (b.status === BookingStatus.PICKED_UP && b.endAt < now ? now : b.endAt).toISOString(),
    })),
  };
}

// ── POST: move the booking ────────────────────────────────────────────────────

export interface RescheduleResult {
  booking: {
    publicId: string;
    status: BookingStatus;
    startAt: string;
    endAt: string;
    durationMinutes: number;
    rentalPeriodType: RentalPeriodType | null;
    branchPublicId: string;
    vehicles: Array<{ publicId: string; make: string; model: string; regNo: string }>;
  };
  previous: { startAt: string; endAt: string };
  /** Positive = later, negative = earlier. */
  shiftMinutes: number;
  reason: string | null;
  /** An uncommitted customer extension quote that the move released, if any. */
  releasedExtensionQuotePublicId: string | null;
}

export async function rescheduleBooking(
  req: Request,
  bookingPublicId: string,
  actorRole: RescheduleActorRole,
): Promise<RescheduleResult> {
  const body = (req.body ?? {}) as { newStartAt?: unknown; reason?: unknown };
  const newStart = parseNewStartAt(body.newStartAt);
  const reason = parseReason(body.reason);

  const actor = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, publicId: true, name: true, role: true, branchId: true },
  });
  if (!actor) {
    throw new RescheduleError(StatusCode.UNAUTHORIZED, "UNAUTHORIZED", "Your session has expired. Please log in again.");
  }

  const booking = await requireBooking(req, bookingPublicId);
  const now = new Date();
  const { blocker } = await findBlocker(booking, prisma, now);
  if (blocker) throw blocker;

  const shiftMs = newStart.getTime() - booking.startAt.getTime();
  if (Math.abs(shiftMs) < MINUTE_MS) {
    throw new RescheduleError(
      StatusCode.BAD_REQUEST,
      "RESCHEDULE_NO_CHANGE",
      "That is the booking's current pickup time. Choose a different time.",
    );
  }
  if (newStart.getTime() < now.getTime() - RESCHEDULE_PAST_TOLERANCE_MINUTES * MINUTE_MS) {
    throw new RescheduleError(
      StatusCode.BAD_REQUEST,
      "RESCHEDULE_IN_PAST",
      "The new pickup time has already passed. Choose a time from now on.",
    );
  }
  const durationMs = booking.endAt.getTime() - booking.startAt.getTime();
  const durationMinutes = Math.round(durationMs / MINUTE_MS);
  const newEnd = new Date(booking.endAt.getTime() + shiftMs);
  const isMonthly = booking.rentalPeriodType === RentalPeriodType.MONTHLY;

  // 15-day window (a monthly booking: its pickup inside the window)
  try {
    assertBookingWindow(newStart, newEnd, { monthly: isMonthly, now });
  } catch (err) {
    if (err instanceof BookingWindowError) {
      throw windowError(err, latestStartFor(booking, durationMs, now), durationMinutes);
    }
    throw err;
  }

  // Office hours: pickup slot (last pickup 30 min before closing) and the return window
  const hoursProblem = hoursError(await loadBranchScheduleConfig(booking.branchId), newStart, newEnd);
  if (hoursProblem) throw hoursProblem;

  // One vehicle per driving licence — re-checked under a lock below
  await assertDlFree({
    dlNumber: booking.customer.drivingLicenceNumber,
    mode: "reschedule",
    window: { startAt: newStart, endAt: newEnd },
    excludeBookingId: booking.id,
    now,
  });

  // The customer's two-wheeler / four-wheeler (or any-vehicle) limit at this branch
  const { conflicts: typeClassConflicts } = await checkCustomerTypeClassLimits(
    booking.customerId,
    booking.items.map((i) => ({
      id: i.vehicle.id,
      make: i.vehicle.make,
      model: i.vehicle.model,
      category: { typeClass: i.vehicle.category.typeClass },
    })),
    newStart,
    newEnd,
    {
      restrictionMode: booking.branch.bookingRestrictionMode,
      branchId: booking.branchId,
      excludeBookingId: booking.id,
    },
  );
  if (typeClassConflicts.length > 0) {
    const c = typeClassConflicts[0]!;
    throw new RescheduleError(
      StatusCode.CONFLICT,
      "VEHICLE_TYPE_LIMIT_EXCEEDED",
      c.reason === "ANY_VEHICLE"
        ? "This customer already has another booking at this branch that overlaps the new dates."
        : `This customer already has another ${c.typeClass === "TWO_WHEELER" ? "two-wheeler" : "four-wheeler"} booking that overlaps the new dates.`,
      { conflicts: typeClassConflicts },
    );
  }

  // Vehicle(s) free in the new window — serialised with extension commits on
  // the same vehicles (they hold the same Redis locks)
  const vehicleIds = booking.items.map((i) => i.vehicle.id);
  const locks = await extensionLockService.acquireMultipleLocks(vehicleIds);
  if (locks.failed.length > 0) {
    throw new RescheduleError(
      StatusCode.CONFLICT,
      "RESCHEDULE_BUSY",
      "This vehicle is being updated by another request. Please try again in a moment.",
    );
  }

  let releasedQuotePublicId: string | null = null;
  try {
    const holdConflicts = await findHoldConflicts(booking, newStart, newEnd);
    if (holdConflicts.length > 0) throw vehicleUnavailable(booking, holdConflicts);

    releasedQuotePublicId = await prisma.$transaction(
      async (tx) => {
        await lockAndAssertDlFree(
          {
            dlNumber: booking.customer.drivingLicenceNumber,
            mode: "reschedule",
            window: { startAt: newStart, endAt: newEnd },
            excludeBookingId: booking.id,
            now,
          },
          tx,
        );

        const conflicts = await findBookingConflicts(tx, booking, newStart, newEnd, now);
        if (conflicts.length > 0) throw vehicleUnavailable(booking, conflicts);

        // Re-read what could have changed since the checks above
        const { blocker: lateBlocker, releasableQuoteId } = await findBlocker(booking, tx, now);
        if (lateBlocker) throw lateBlocker;

        const shift = (d: Date) => new Date(d.getTime() + shiftMs);
        const updated = await tx.booking.updateMany({
          where: {
            id: booking.id,
            status: BookingStatus.CONFIRMED,
            startAt: booking.startAt,
            endAt: booking.endAt,
            requiresManagerConfirmation: false,
            activeExtensionId: booking.activeExtensionId,
          },
          data: {
            startAt: newStart,
            endAt: newEnd,
            ...(booking.originalEndAt ? { originalEndAt: shift(booking.originalEndAt) } : {}),
            ...(releasableQuoteId !== null ? { activeExtensionId: null } : {}),
          },
        });
        if (updated.count === 0) {
          throw new RescheduleError(
            StatusCode.CONFLICT,
            "RESCHEDULE_CONFLICT",
            "This booking changed while you were rescheduling it. Refresh and try again.",
          );
        }

        let released: string | null = null;
        if (releasableQuoteId !== null) {
          const quote = await tx.bookingExtension.update({
            where: { id: releasableQuoteId },
            data: { extensionStatus: ExtensionStatus.CANCELLED, rejectionReason: "Superseded by a reschedule" },
            select: { publicId: true },
          });
          released = quote.publicId;
        }

        // Confirmed extensions move with the booking, so the original period and
        // each extension keep their lengths (drop timeline, km allowance)
        const extensions = await tx.bookingExtension.findMany({
          where: { bookingId: booking.id, extensionStatus: ExtensionStatus.CONFIRMED },
          select: { id: true, oldEndAt: true, requestedEndAt: true, actualNewEndAt: true },
        });
        for (const ext of extensions) {
          await tx.bookingExtension.update({
            where: { id: ext.id },
            data: {
              oldEndAt: shift(ext.oldEndAt),
              requestedEndAt: shift(ext.requestedEndAt),
              ...(ext.actualNewEndAt ? { actualNewEndAt: shift(ext.actualNewEndAt) } : {}),
            },
          });
        }
        return released;
      },
      { timeout: 15000 },
    );
  } finally {
    await extensionLockService.releaseMultipleLocks(vehicleIds).catch(() => undefined);
  }

  const shiftMinutes = Math.round(shiftMs / MINUTE_MS);
  const direction = shiftMs > 0 ? "later" : "earlier";
  const moved = `${durationLabel(Math.abs(shiftMinutes))} ${direction}`;
  const reasonSuffix = reason ? ` Reason: ${reason}` : "";
  const description =
    `Booking ${booking.publicId} rescheduled ${moved}: pickup ${formatIst(booking.startAt)} → ${formatIst(newStart)}, ` +
    `return ${formatIst(booking.endAt)} → ${formatIst(newEnd)}.${reasonSuffix}`;

  await Promise.all([
    auditService
      .log({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        actorBranchId: actor.branchId ?? undefined,
        action: "BOOKING_RESCHEDULED",
        category: AuditCategory.BOOKING,
        description,
        entity: "Booking",
        entityId: booking.publicId,
        entityLabel: booking.publicId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        before: { startAt: booking.startAt.toISOString(), endAt: booking.endAt.toISOString() },
        after: { startAt: newStart.toISOString(), endAt: newEnd.toISOString() },
        metadata: {
          shiftMinutes,
          reason,
          via: actorRole,
          releasedExtensionQuotePublicId: releasedQuotePublicId,
        },
      })
      .catch((err) => console.error("[reschedule] Audit log error (non-fatal):", err)),
    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.UPDATED,
      entityType: StaffEntityType.BOOKING,
      entityRef: booking.publicId,
      description,
      metadata: {
        previousStartAt: booking.startAt.toISOString(),
        previousEndAt: booking.endAt.toISOString(),
        startAt: newStart.toISOString(),
        endAt: newEnd.toISOString(),
        shiftMinutes,
        reason,
      },
    }),
  ]);

  void notifyEvents.bookingRescheduled({
    bookingId: booking.id,
    previousStartAt: booking.startAt,
    newStartAt: newStart,
    actorUserId: actor.id,
    reason,
  });

  try {
    await invalidateVehicleAvailability(redis, vehicleIds);
    await invalidateGroupListingCache(redis as any);
  } catch (err) {
    console.warn("[reschedule] Cache invalidation failed (non-fatal):", err);
  }

  return {
    booking: {
      publicId: booking.publicId,
      status: BookingStatus.CONFIRMED,
      startAt: newStart.toISOString(),
      endAt: newEnd.toISOString(),
      durationMinutes,
      rentalPeriodType: booking.rentalPeriodType,
      branchPublicId: booking.branch.publicId,
      vehicles: booking.items.map((i) => ({
        publicId: i.vehicle.publicId,
        make: i.vehicle.make,
        model: i.vehicle.model,
        regNo: i.vehicle.regNo,
      })),
    },
    previous: { startAt: booking.startAt.toISOString(), endAt: booking.endAt.toISOString() },
    shiftMinutes,
    reason,
    releasedExtensionQuotePublicId: releasedQuotePublicId,
  };
}


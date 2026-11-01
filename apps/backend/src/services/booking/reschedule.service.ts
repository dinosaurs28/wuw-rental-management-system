/**
 * Reschedule a confirmed booking (12 h / 24 h packages, Fleet / BM flexibility).
 *
 * Customers book packages only; when one asks to come earlier or later, Fleet
 * (STAFF, own branch) or the Branch Manager moves the booking: a new pickup
 * time, the return shifted by the same amount. Length, price, GST, discounts,
 * free km and payments are unchanged — nothing is re-priced. A 12-hour package
 * that hasn't been extended (client item 6) instead takes the package's return
 * for the new pickup — pickup + 12 h, or the branch's closing that day when
 * that is outside hours (pricingSnapshot.heldToClosing follows) — still billed
 * as the 12 hours it was sold as. With weekend pricing (pricingSnapshot.
 * weekendDays) or festival pricing (the stored pricingSnapshot.specialRules,
 * and today's rules for the new window) a move that would change the rent —
 * onto or off the weekend or a festival — is refused (RESCHEDULE_PRICE_CHANGE);
 * otherwise the items' weekend / festival breakdowns (and the stored festival
 * rules) follow the new window.
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
 * hours (no auto-adjust: the length is fixed), stay inside the booking window
 * (pickup ≤ 30 days ahead; a monthly booking likewise), keep the driving licence
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
import Decimal from "decimal.js";
import {
  ADVANCE_BOOKING_DAYS,
  MAX_RENTAL_DAYS,
  MONTHLY_MAX_DAYS,
  MONTHLY_MIN_DAYS,
  BOOKING_TURNAROUND_HOURS,
  BOOKING_TURNAROUND_MS,
  bookingWindowEnd,
  HALF_DAY_PACKAGE_HOURS,
} from "@repo/schemas";
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
  isClampedHalfDay,
  type ScheduleVerdict,
} from "../../utils/booking/branchScheduleValidator.js";
import { computeBookingOwed, getBookingMoney } from "../payment/booking-owed.service.js";
import { isRazorpayOrderId } from "../payment/razorpay.service.js";
import { isGstOnTopBooking, refreshInvoiceTotals } from "../invoice-totals.service.js";
import {
  RESCHEDULE_PERIOD_MIN_HOURS,
  RESCHEDULE_PERIOD_PAST_SLACK_MINUTES,
  applyItemDelta,
  balanceAfterReprice,
  itemDelta,
  periodTimeProblem,
  snapshotAfterReprice,
  sumDeltas,
  type BalanceOutcome,
  type ItemDelta,
} from "./reschedule-period.js";
import { bookingPeriodFields } from "../../utils/booking/rentalPeriod.js";
import {
  heldToClosingOf,
  isHalfDayPackageBooking,
  rescheduledReturn,
  withHeldToClosing,
} from "../../utils/booking/halfDayPackage.js";
import { checkCustomerTypeClassLimits } from "../../utils/booking/customerTypeClassLimits.js";
import { listOverlappingHolds } from "../../utils/availability/availabilityBatch.js";
import { findLocksCovering } from "../../utils/availability/bookingLocks.js";
import {
  DROP_NOT_RECORDED_WHERE,
  automaticGraceMinutes,
  bookingBlocksWindow,
  turnaroundMsFor,
} from "../../utils/availability/vehicleEligibility.js";
import { invalidateGroupListingCache, invalidateVehicleAvailability } from "../../utils/cache/vehicleCacheKeys.js";
import { extensionLockService } from "../extension/extension-lock.service.js";
import { assertDlFree, cleanDl, lockAndAssertDlFree } from "./dl-in-use.service.js";
import { PricingEngineService } from "../pricing/pricing-engine.service.js";
import type { FestivalBreakdown, WeekendBreakdown } from "../pricing/base-price-rule.js";
import { formatRupees, weekendDaysOf, withItemWeekendBreakdowns } from "../../utils/pricing/weekendRule.js";
import {
  rescheduleChecksRent,
  rescheduleRuleSets,
  specialRulesOf,
  unionSpecialRules,
  withItemFestivalBreakdowns,
  type SpecialRule,
} from "../../utils/pricing/specialDateRule.js";
import { getBranchSpecialRules } from "../pricing/branch-special-rules.service.js";

type Db = Prisma.TransactionClient | typeof prisma;

/** How far around a window to look for bookings whose turnaround may reach it (superset; bookingBlocksWindow decides). */
const RESCHEDULE_CANDIDATE_REACH_MS = 24 * 60 * 60 * 1000;
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
  | "RESCHEDULE_CONFLICT"
  | "RESCHEDULE_PRICE_CHANGE"
  // Period reschedule (TODO 4)
  | "RESCHEDULE_END_IN_PAST"
  | "RESCHEDULE_END_NOT_AFTER_START"
  | "RESCHEDULE_PERIOD_TOO_SHORT"
  | "RESCHEDULE_PRICE_CONFIRMATION_REQUIRED"
  | "RESCHEDULE_PRICE_STALE"
  | "RESCHEDULE_PRICING_UNAVAILABLE"
  | "RESCHEDULE_PERIOD_EXTENDED_BOOKING";

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
      pricingSnapshot: true,
      // Period reschedule (TODO 4): the money it re-prices
      totalFinal: true,
      totalBase: true,
      totalDiscount: true,
      totalTax: true,
      isAdvancePayment: true,
      advanceAmount: true,
      remainingBalance: true,
      remainingPaidAt: true,
      remainingPaymentId: true,
      couponCode: true,
      branch: { select: { publicId: true, bookingRestrictionMode: true } },
      customer: { select: { drivingLicenceNumber: true, user: { select: { name: true } } } },
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          days: true,
          baseTotal: true,
          discountAmount: true,
          taxAmount: true,
          cgstAmount: true,
          sgstAmount: true,
          finalTotal: true,
          vehicle: {
            select: {
              id: true,
              publicId: true,
              make: true,
              model: true,
              regNo: true,
              categoryId: true,
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

// ── 12-hour packages (client item 6) ─────────────────────────────────────────

// Rules: utils/booking/halfDayPackage.ts (isHalfDayPackageBooking, rescheduledReturn)
const HALF_DAY_MS = HALF_DAY_PACKAGE_HOURS * 60 * MINUTE_MS;

// ── Window rules ─────────────────────────────────────────────────────────────

/** Latest pickup this booking can move to: the end of the 30-day advance window (any plan). */
function latestStartFor(_booking: RescheduleBooking, _durationMs: number, now: Date): Date {
  return bookingWindowEnd(now);
}

function windowError(
  err: BookingWindowError,
  latestStartAt: Date,
  durationMinutes: number,
): BookingWindowError {
  if (err.reason !== "WINDOW") return err;
  const body = err.toJSON();
  return new RescheduleWindowError(
    `Bookings open up to ${ADVANCE_BOOKING_DAYS} days ahead, so this booking (${durationLabel(durationMinutes)}) must start by ${formatIst(latestStartAt)}.`,
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
  now: Date,
): RescheduleError | null {
  if (!schedule) return null;
  // now: tonight's late window after the last pickup; no same-day pickup after closing
  const pickupVerdict = validateBookingSchedule(schedule, newStart, newEnd, { now });
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
  /** LOCK = a branch manager's booking lock (a plain overlap, no turnaround). */
  kind: "BOOKING" | "HOLD" | "LOCK";
  /** The lock's reason (staff only), for kind LOCK. */
  lockReason?: string;
  bookingPublicId: string | null;
  bookingStatus: BookingStatus | null;
  startAt: Date;
  endAt: Date;
  /**
   * What the conflict keeps from a new booking: [startAt − turnaround,
   * endAt + turnaround); an overdue rental (not dropped yet) has no end —
   * null.
   */
  blockedFrom: Date;
  blockedUntil: Date | null;
}

/**
 * Other bookings on these vehicles that keep them from [start, end) by the
 * booking rule (bookingBlocksWindow): CONFIRMED and unexpired HOLD with the
 * 3 h turnaround either side, PICKED_UP until its return plus the turnaround —
 * for every window once overdue, until fleet records the drop.
 */
async function findBookingConflicts(
  db: Db,
  booking: RescheduleBooking,
  start: Date,
  end: Date,
  now: Date,
): Promise<VehicleConflict[]> {
  const vehicleIds = booking.items.map((i) => i.vehicle.id);
  const near = {
    startAt: { lt: new Date(end.getTime() + RESCHEDULE_CANDIDATE_REACH_MS) },
    endAt: { gt: new Date(start.getTime() - RESCHEDULE_CANDIDATE_REACH_MS) },
  };
  const rows = await db.bookingItem.findMany({
    where: {
      vehicleId: { in: vehicleIds },
      booking: {
        id: { not: booking.id },
        deletedAt: null,
        OR: [
          { status: BookingStatus.CONFIRMED, ...near },
          { status: BookingStatus.HOLD, holdExpiresAt: { gt: now }, ...near },
          { status: BookingStatus.PICKED_UP, ...DROP_NOT_RECORDED_WHERE },
        ],
      },
    },
    orderBy: { booking: { startAt: "asc" } },
    select: {
      vehicle: { select: { publicId: true } },
      booking: {
        select: {
          publicId: true,
          status: true,
          startAt: true,
          endAt: true,
          holdExpiresAt: true,
          requiresManagerConfirmation: true,
          returnedAt: true,
          frozenChargeConfig: true,
          branch: {
            select: { chargeConfig: { select: { gracePolicyEnabled: true, graceType: true, graceMinutes: true } } },
          },
        },
      },
    },
  });
  return rows.flatMap((r) => {
    const grace = automaticGraceMinutes(r.booking.frozenChargeConfig, r.booking.branch.chargeConfig);
    if (!bookingBlocksWindow(r.booking, start, end, now, grace)) return [];
    const t = turnaroundMsFor(grace);
    const overdue = r.booking.status === BookingStatus.PICKED_UP && r.booking.endAt.getTime() <= now.getTime();
    return [
      {
        vehiclePublicId: r.vehicle.publicId,
        kind: r.booking.status === BookingStatus.HOLD ? ("HOLD" as const) : ("BOOKING" as const),
        bookingPublicId: r.booking.publicId,
        bookingStatus: r.booking.status,
        startAt: r.booking.startAt,
        endAt: r.booking.endAt,
        blockedFrom: new Date(r.booking.startAt.getTime() - t),
        blockedUntil: overdue ? null : new Date(r.booking.endAt.getTime() + t),
      },
    ];
  });
}

/** Customer checkouts in progress (Redis holds) on these vehicles — never this booking's own. */
async function findHoldConflicts(booking: RescheduleBooking, start: Date, end: Date): Promise<VehicleConflict[]> {
  const idMap = new Map(booking.items.map((i) => [i.vehicle.id, i.vehicle.publicId]));
  const holds = await listOverlappingHolds(idMap, start, end, new Set([booking.publicId]), {
    bufferMs: BOOKING_TURNAROUND_MS,
  });
  return holds.map((h) => ({
    vehiclePublicId: idMap.get(h.vehicleId)!,
    kind: "HOLD",
    bookingPublicId: h.holdId,
    bookingStatus: null,
    startAt: h.startAt,
    endAt: h.endAt,
    blockedFrom: new Date(h.startAt.getTime() - BOOKING_TURNAROUND_MS),
    blockedUntil: new Date(h.endAt.getTime() + BOOKING_TURNAROUND_MS),
  }));
}

/**
 * Booking locks on these vehicles overlapping [start, end) — a plain overlap
 * with the lock's effective window: blocked from 00:00 IST the day before it
 * starts (effectiveLockStart) to its end. A reschedule is a staff action, so
 * customers-only locks don't count.
 */
async function findLockConflicts(db: Db, booking: RescheduleBooking, start: Date, end: Date): Promise<VehicleConflict[]> {
  const publicIdOf = new Map(booking.items.map((i) => [i.vehicle.id, i.vehicle.publicId]));
  const covering = await findLocksCovering([...publicIdOf.keys()], start, end, { forStaff: true, db });
  return [...covering].flatMap(([vehicleId, locks]) =>
    locks.map((l) => ({
      vehiclePublicId: publicIdOf.get(vehicleId)!,
      kind: "LOCK" as const,
      lockReason: l.reason,
      bookingPublicId: null,
      bookingStatus: null,
      startAt: l.startAt,
      endAt: l.endAt,
      blockedFrom: l.effectiveStartAt,
      blockedUntil: l.endAt,
    })),
  );
}

function vehicleUnavailable(booking: RescheduleBooking, conflicts: VehicleConflict[]): RescheduleError {
  const first = conflicts[0]!;
  const vehicle = booking.items.find((i) => i.vehicle.publicId === first.vehiclePublicId)?.vehicle;
  const name = vehicle ? vehicleLabel(vehicle) : "The vehicle";
  const when = `${formatIst(first.startAt)} – ${formatIst(first.endAt)}`;
  const message =
    first.kind === "LOCK"
      ? `${name} is locked for bookings ${formatIst(first.blockedFrom)} – ${formatIst(first.endAt)} (${first.lockReason ?? "booking lock"}; from 1 day before the lock starts). Choose another time, or swap the vehicle first.`
      : first.kind === "HOLD"
      ? `${name} is being booked by another customer for ${when}, which is too close to the new dates (bookings of the same car need ${BOOKING_TURNAROUND_HOURS} hours between them). Choose another time, or try again in a few minutes.`
      : first.bookingStatus === BookingStatus.PICKED_UP && first.blockedUntil === null
        ? `${name} is not back from booking ${first.bookingPublicId} (due ${formatIst(first.endAt)}), so it can't be promised for any dates until its drop is recorded. Swap the vehicle first, or try again after the drop.`
        : `${name} is booked for ${when} (booking ${first.bookingPublicId}), which is too close to the new dates (bookings of the same car need ${BOOKING_TURNAROUND_HOURS} hours between them). Choose another time, or swap the vehicle first.`;
  return new RescheduleError(StatusCode.CONFLICT, "VEHICLE_UNAVAILABLE", message, {
    conflicts: conflicts.map((c) => ({
      vehiclePublicId: c.vehiclePublicId,
      kind: c.kind,
      bookingPublicId: c.bookingPublicId,
      bookingStatus: c.bookingStatus,
      ...(c.lockReason != null && { lockReason: c.lockReason }),
      startAt: c.startAt.toISOString(),
      endAt: c.endAt.toISOString(),
    })),
  });
}

// ── Weekend / festival pricing ────────────────────────────────────────────────

const pricingEngine = new PricingEngineService();

/**
 * A reschedule never re-prices, so with weekend or festival pricing in effect
 * it may not change the rent. Both windows are priced now, at today's rates
 * and the booking's stored weekend days (rescheduleRuleSets for the festival
 * rules): the current window as it was charged — the stored rules
 * (pricingSnapshot.specialRules, which confirmed extensions / swaps add to), a
 * rule deleted or edited since still counting in its stored form — and the new
 * window with the stored rules plus today's live rules not stored. So a move
 * onto a festival is refused (a booking made before festival pricing has none
 * stored and gets today's), a move off one it paid for too, and a move that
 * keeps the festival days is allowed whatever happened to the rule since. A
 * different rent → RESCHEDULE_PRICE_CHANGE (no money moves on a reschedule);
 * the same → the new window's weekend / festival breakdowns per vehicle and
 * the rules touching it, stored on the booking. null = no check: no weekend
 * days and no rule touching either window, or it can't be priced.
 */
async function checkRentUnchanged(
  booking: RescheduleBooking,
  newStart: Date,
  newEnd: Date,
  held: { was: boolean; now: boolean },
): Promise<{
  items: { vehicleId: number; weekend?: WeekendBreakdown; festival?: FestivalBreakdown }[];
  /** The stored rules after the move (null = none stored before, and none touch the new window) */
  specialRules: SpecialRule[] | null;
} | null> {
  const weekendDays = weekendDaysOf(booking.pricingSnapshot);
  const stored = specialRulesOf(booking.pricingSnapshot);
  const at = (d: Date) => DateTime.fromJSDate(d, { zone: "Asia/Kolkata" });

  type Priced = Awaited<ReturnType<PricingEngineService["calculateRent"]>>;
  let priced: { vehicleId: number; before: Priced; after: Priced }[];
  try {
    const rules = rescheduleRuleSets(stored, await getBranchSpecialRules(booking.branchId));
    const checks = rescheduleChecksRent(
      weekendDays,
      rules,
      { startMs: booking.startAt.getTime(), endMs: booking.endAt.getTime() },
      { startMs: newStart.getTime(), endMs: newEnd.getTime() },
    );
    if (!checks) return null;
    priced = await Promise.all(
      booking.items.map(async ({ vehicle }) => {
        const [before, after] = await Promise.all([
          pricingEngine.calculateRent(vehicle.id, at(booking.startAt), at(booking.endAt), booking.branchId,
            { weekendDays, heldToClosing: held.was, specialRules: rules.current }, vehicle.categoryId),
          pricingEngine.calculateRent(vehicle.id, at(newStart), at(newEnd), booking.branchId,
            { weekendDays, heldToClosing: held.now, specialRules: rules.next }, vehicle.categoryId),
        ]);
        return { vehicleId: vehicle.id, before, after };
      }),
    );
  } catch (err) {
    console.warn(`[reschedule] weekend / festival rent check skipped for ${booking.publicId}:`, err);
    return null;
  }

  const total = (pick: (p: (typeof priced)[number]) => Decimal) =>
    priced.reduce((sum, p) => sum.add(pick(p)), new Decimal(0)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const festivalOf = (r: Priced) => new Decimal(r.festival?.amount ?? 0);
  const currentRent = total((p) => p.before.rent);
  const newRent = total((p) => p.after.rent);
  if (!currentRent.eq(newRent)) {
    const festivalMoved = !total((p) => festivalOf(p.before)).eq(total((p) => festivalOf(p.after)));
    const weekendMoved = !total((p) => p.before.rent.sub(festivalOf(p.before)))
      .eq(total((p) => p.after.rent.sub(festivalOf(p.after))));
    const change = `These dates change the rent from ${formatRupees(currentRent.toNumber())} to ${formatRupees(newRent.toNumber())}`;
    throw new RescheduleError(
      StatusCode.CONFLICT,
      "RESCHEDULE_PRICE_CHANGE",
      festivalMoved && !weekendMoved
        ? `${change} (festival pricing). Choose dates with the same festival days, or cancel and rebook.`
        : festivalMoved
          ? `${change} (weekend and festival pricing). Choose dates priced the same, or cancel and rebook.`
          : `${change} (weekend pricing). Choose dates with the same weekday/weekend mix, or cancel and rebook.`,
      { currentRent: currentRent.toNumber(), newRent: newRent.toNumber() },
    );
  }
  return {
    items: priced.map((p) => ({
      vehicleId: p.vehicleId,
      ...(p.after.weekend && { weekend: p.after.weekend }),
      ...(p.after.festival && { festival: p.after.festival }),
    })),
    specialRules: (() => {
      // Stored rules + those the new window was priced with (a stored version wins)
      const next = priced.reduce<SpecialRule[]>((rules, p) => unionSpecialRules(rules, p.after.specialRules), [...(stored ?? [])]);
      return stored === null && next.length === 0 ? null : next;
    })(),
  };
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
  // A 12-hour package's return depends on the new pickup (up to pickup + 12 h)
  const halfDayPackage = isHalfDayPackageBooking(booking);
  const reachMs = halfDayPackage ? Math.max(durationMs, HALF_DAY_MS) : durationMs;
  const earliestStartAt = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
  const latestStartAt = latestStartFor(booking, reachMs, now);
  const rangeStart = new Date(earliestStartAt.getTime() - RESCHEDULE_PAST_TOLERANCE_MINUTES * MINUTE_MS);
  const rangeEnd = new Date(Math.max(latestStartAt.getTime(), earliestStartAt.getTime()) + reachMs);

  const schedule = await loadBranchScheduleConfig(booking.branchId);

  // What is in the way between now and the latest return: other bookings and
  // holds on the vehicle(s), and other bookings on the customer's licence
  const [bookingBusy, holdBusy, lockBusy] = await Promise.all([
    findBookingConflicts(prisma, booking, rangeStart, rangeEnd, now),
    findHoldConflicts(booking, rangeStart, rangeEnd),
    findLockConflicts(prisma, booking, rangeStart, rangeEnd),
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
    // 12-hour package (item 6): the new return is the package's return for the
    // new pickup (halfDayReturnFor), not pickup + durationMinutes
    halfDayPackage,
    isMonthly: booking.rentalPeriodType === RentalPeriodType.MONTHLY,
    rentalPeriodType: booking.rentalPeriodType,
    earliestStartAt: earliestStartAt.toISOString(),
    latestStartAt: latestStartAt.toISOString(),
    pastToleranceMinutes: RESCHEDULE_PAST_TOLERANCE_MINUTES,
    // Period reschedule (TODO 4, additive): a new start AND end — POST with newEndAt,
    // preview with POST …/reschedule/quote
    periodReschedule: true,
    periodRules: {
      pastSlackMinutes: RESCHEDULE_PERIOD_PAST_SLACK_MINUTES,
      minHours: RESCHEDULE_PERIOD_MIN_HOURS,
      maxRentalDays: MAX_RENTAL_DAYS,
      monthlyMinDays: MONTHLY_MIN_DAYS,
      monthlyMaxDays: MONTHLY_MAX_DAYS,
      advanceBookingDays: ADVANCE_BOOKING_DAYS,
    },
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
    vehicleBusy: [...bookingBusy, ...holdBusy, ...lockBusy]
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
      .map((c) => ({
        vehiclePublicId: c.vehiclePublicId,
        kind: c.kind,
        bookingPublicId: c.kind === "HOLD" && c.bookingStatus === null ? null : c.bookingPublicId,
        bookingStatus: c.bookingStatus,
        ...(c.lockReason != null && { lockReason: c.lockReason }),
        // The span a new pickup / return can't fall in: the booking plus the
        // turnaround either side; an overdue rental is busy for the whole range
        startAt: c.blockedFrom.toISOString(),
        endAt: (c.blockedUntil ?? new Date(Math.max(rangeEnd.getTime(), now.getTime()))).toISOString(),
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
  /** Period reschedule (newEndAt sent): the price difference and where it landed. Absent for a start-only move. */
  pricing?: PeriodPricing;
}

/**
 * POST …/reschedule. With newEndAt (TODO 4, "Reschedule rental period"): the
 * start and the end move independently and the price follows
 * (reschedulePeriod). Without it (older app builds): the start moves, the
 * return moves by the same amount, the price never changes.
 */
export async function rescheduleBooking(
  req: Request,
  bookingPublicId: string,
  actorRole: RescheduleActorRole,
): Promise<RescheduleResult> {
  const raw = (req.body ?? {}) as { newEndAt?: unknown };
  if (raw.newEndAt !== undefined && raw.newEndAt !== null && raw.newEndAt !== "") {
    return reschedulePeriod(req, bookingPublicId, actorRole);
  }
  return rescheduleStartOnly(req, bookingPublicId, actorRole);
}

async function rescheduleStartOnly(
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
  const schedule = await loadBranchScheduleConfig(booking.branchId);
  // Shifted by the same amount — or, for a 12-hour package (item 6), the
  // package's return for the new pickup (pickup + 12 h, or closing that day);
  // null = only whole days fit from there
  const nextWindow = rescheduledReturn(booking, newStart, schedule);
  if (!nextWindow) {
    throw (
      hoursError(schedule, newStart, newStart, now) ??
      new RescheduleError(
        StatusCode.BAD_REQUEST,
        "BRANCH_SCHEDULE_VIOLATION",
        "This is a 12-hour booking, and from this pickup its return would be outside branch hours with less than an hour left before closing. Choose an earlier pickup time.",
      )
    );
  }
  const halfDay = nextWindow.halfDayPackage;
  const newEnd = nextWindow.endAt;
  const wasHeld = heldToClosingOf(booking.pricingSnapshot);
  const nowHeld = nextWindow.heldToClosing;
  const durationMs = newEnd.getTime() - newStart.getTime();
  const durationMinutes = Math.round(durationMs / MINUTE_MS);
  const isMonthly = booking.rentalPeriodType === RentalPeriodType.MONTHLY;

  // Booking window: pickup ≤ 30 days ahead, ≤ 30 days long (monthly: 30–180 days)
  try {
    assertBookingWindow(newStart, newEnd, { monthly: isMonthly, now });
  } catch (err) {
    if (err instanceof BookingWindowError) {
      throw windowError(err, latestStartFor(booking, halfDay ? Math.max(durationMs, HALF_DAY_MS) : durationMs, now), durationMinutes);
    }
    throw err;
  }

  // Office hours: pickup slot (last pickup 30 min before closing) and the return window
  const hoursProblem = hoursError(schedule, newStart, newEnd, now);
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

  // Weekend / festival pricing: the move may not change the rent (nothing is re-priced)
  const repriced = await checkRentUnchanged(booking, newStart, newEnd, { was: wasHeld, now: nowHeld });
  // The held-to-closing flag re-prices bill by, the items' weekend / festival breakdowns
  // and the stored festival rules follow the new window
  let nextSnapshot: Prisma.InputJsonValue | null =
    nowHeld !== wasHeld ? withHeldToClosing(booking.pricingSnapshot, nowHeld) : null;
  if (repriced) {
    let snapshot = withItemWeekendBreakdowns(nextSnapshot ?? booking.pricingSnapshot, repriced.items);
    if (repriced.specialRules) {
      snapshot = { ...withItemFestivalBreakdowns(snapshot, repriced.items), specialRules: repriced.specialRules };
    }
    nextSnapshot = snapshot as Prisma.InputJsonValue;
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
        const lockConflicts = await findLockConflicts(tx, booking, newStart, newEnd);
        if (lockConflicts.length > 0) throw vehicleUnavailable(booking, lockConflicts);

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
            // A 12-hour package's clock length may change (8 h 30 m ↔ 12 h): period
            // columns follow, and the held-to-closing flag the re-prices bill by
            ...(halfDay ? bookingPeriodFields(newStart, newEnd) : {}),
            ...(nextSnapshot ? { pricingSnapshot: nextSnapshot } : {}),
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


// ══ Reschedule rental period (client TODO 4) ═══════════════════════════════════
//
// Fleet / BM pick a new start AND a new end (newEndAt) for a CONFIRMED booking
// not picked up yet. Rules: both from now on (5-min slack — the start may be
// "now"), end after start, at least 12 h (a held-to-closing 12-hour package
// counts as 12 h); branch hours for the pickup (last pickup, tonight's late
// window) and the return (no auto-adjust); pickup ≤ 30 days ahead; ≤ 30 days
// long, or 30–180 days for a MONTHLY booking (it stays MONTHLY); the
// vehicle(s) free with the 3 h turnaround (this booking excluded), no booking
// lock, the DL free, the customer's type-class limit.
//
// Price (rules + money: reschedule-period.ts): both windows priced now with
// the booking's own terms; the difference moves totalFinal, the items, the GST
// split, the snapshot (free km / billed-as follow the new period) and the
// balance — more is due at pickup, less leaves an over-payment to refund
// through the existing refund paths. A difference needs the caller's
// acceptPriceChange (shown first by POST …/reschedule/quote); expectedNewTotal,
// when sent, must still match.

export interface PeriodPricing {
  /** totalFinal before / after (rent incl. GST after discounts + refundable category deposit + extensions) */
  oldTotal: string;
  newTotal: string;
  /** newTotal − oldTotal (+ more to pay, − less) */
  difference: string;
  /** Rent incl. GST after discounts of the two windows, priced now (the difference's source) */
  oldWindowRent: string;
  newWindowRent: string;
  priceChanged: boolean;
  /** The booking's coupon (locked in), and whether it still applies to the new window */
  couponCode: string | null;
  couponAppliesToNewWindow: boolean | null;
  /** Money in (confirmed) less refunds paid out, before the move */
  netPaid: string;
  /** Balance the pickup bill collects after the move */
  dueAtPickup: string;
  /** Paid beyond the new total — refund via "Refund to customer" / BM settlement (never automatic) */
  refundable: string;
  outcome: BalanceOutcome["kind"];
  /** Free km and billed-as of the first vehicle, before / after */
  freeKm: { before: number | null; after: number | null };
  billedAs: { before: string | null; after: string | null };
  rentalPeriodType: RentalPeriodType | null;
}

export interface PeriodQuote {
  bookingPublicId: string;
  previous: { startAt: string; endAt: string; durationMinutes: number; durationLabel: string };
  next: { startAt: string; endAt: string; durationMinutes: number; durationLabel: string };
  /** Same length, only moved */
  pureShift: boolean;
  /** true ⇒ POST with acceptPriceChange: true (and, best, expectedNewTotal) */
  confirmationRequired: boolean;
  pricing: PeriodPricing;
}

function parseNewEndAt(raw: unknown): Date {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new RescheduleError(
      StatusCode.BAD_REQUEST,
      "VALIDATION_ERROR",
      "newEndAt is required — the new return date and time, e.g. 2026-10-06T10:30 (IST).",
    );
  }
  const dt = TimezoneService.parseISO(raw.trim());
  if (!dt.isValid) {
    throw new RescheduleError(StatusCode.BAD_REQUEST, "VALIDATION_ERROR", "newEndAt must be a date and time like 2026-10-06T10:30 (IST).");
  }
  return TimezoneService.toPrisma(dt.startOf("minute"));
}

/** Office hours for a period the caller chose (both ends picked — nothing is auto-adjusted). */
function periodHoursError(
  schedule: Awaited<ReturnType<typeof loadBranchScheduleConfig>>,
  newStart: Date,
  newEnd: Date,
  now: Date,
): RescheduleError | null {
  if (!schedule) return null;
  const pickupVerdict = validateBookingSchedule(schedule, newStart, newEnd, { now });
  if (pickupVerdict.status.startsWith("PICKUP_")) {
    return new RescheduleError(StatusCode.BAD_REQUEST, "BRANCH_SCHEDULE_VIOLATION", buildScheduleErrorMessage(pickupVerdict), {
      verdict: pickupVerdict,
    });
  }
  const returnVerdict: ScheduleVerdict = validateReturnTime(schedule, newEnd);
  if (returnVerdict.status !== "RETURN_OUTSIDE_HOURS") return null;
  const at = `The return (${formatIstShort(newEnd)})`;
  const message =
    returnVerdict.reason === "CLOSED_DAY"
      ? `${at} falls on ${returnVerdict.closedDayName ?? "a day"} when the branch is closed. Choose a return on an open day.`
      : returnVerdict.reason === "BEFORE_OPEN"
        ? `${at} is before the branch opens (${returnVerdict.openingTime ?? "opening time"}). Choose a later return.`
        : `${at} is after the branch closes (${returnVerdict.closingTime ?? "closing time"}${
            returnVerdict.gracePeriodEnd && returnVerdict.gracePeriodEnd !== returnVerdict.closingTime
              ? `, returns accepted until ${returnVerdict.gracePeriodEnd}`
              : ""
          }). Choose an earlier return.`;
  return new RescheduleError(StatusCode.BAD_REQUEST, "BRANCH_SCHEDULE_VIOLATION", message, {
    verdict: { ...returnVerdict, returnAt: newEnd.toISOString() },
  });
}

type EnginePriced = Awaited<ReturnType<PricingEngineService["calculateBookingPrice"]>>;

/** Both windows of every vehicle priced now with the booking's own terms. */
async function priceBothWindows(
  booking: RescheduleBooking,
  newStart: Date,
  newEnd: Date,
  held: { was: boolean; now: boolean },
): Promise<{ vehicleId: number; before: EnginePriced; after: EnginePriced }[]> {
  const at = (x: Date) => DateTime.fromJSDate(x, { zone: "Asia/Kolkata" });
  const weekendDays = weekendDaysOf(booking.pricingSnapshot);
  const rules = rescheduleRuleSets(specialRulesOf(booking.pricingSnapshot), await getBranchSpecialRules(booking.branchId));
  const monthlyPlan = booking.rentalPeriodType === RentalPeriodType.MONTHLY;
  const common = {
    paymentPlan: (booking.isAdvancePayment ? "ADVANCE" : "FULL") as "ADVANCE" | "FULL",
    excludeBookingId: booking.id,
    couponLockedIn: true,
    deferPaymentPlanCheck: true,
    weekendDays,
    monthlyPlan,
  };
  return Promise.all(
    booking.items.map(async ({ vehicle }, index) => {
      const coupon = index === 0 ? booking.couponCode ?? undefined : undefined;
      const [before, after] = await Promise.all([
        pricingEngine.calculateBookingPrice(vehicle.id, at(booking.startAt), at(booking.endAt), booking.branchId,
          booking.customerId, coupon, undefined, undefined, vehicle.categoryId, undefined,
          { ...common, heldToClosing: held.was, specialRules: rules.current }),
        pricingEngine.calculateBookingPrice(vehicle.id, at(newStart), at(newEnd), booking.branchId,
          booking.customerId, coupon, undefined, undefined, vehicle.categoryId, undefined,
          { ...common, heldToClosing: held.now, specialRules: rules.next }),
      ]);
      return { vehicleId: vehicle.id, before, after };
    }),
  );
}

/** Paid beyond what the booking owes right now (≥ 0). */
async function overpaidNow(bookingId: number, db?: Prisma.TransactionClient) {
  const [owed, money] = await Promise.all([computeBookingOwed(bookingId, db as any), getBookingMoney(bookingId, db as any)]);
  return {
    netPaid: money.netConfirmed,
    overpaid: Decimal.max(new Decimal(0), money.netConfirmed.sub(owed.totalOwed)),
  };
}

interface PreparedPeriod {
  booking: RescheduleBooking;
  now: Date;
  newStart: Date;
  newEnd: Date;
  nowHeld: boolean;
  wasHeld: boolean;
  isMonthly: boolean;
  pureShift: boolean;
  priced: { vehicleId: number; before: EnginePriced; after: EnginePriced }[];
  deltas: ItemDelta[];
  total: ItemDelta;
  balance: BalanceOutcome;
  quote: PeriodQuote;
}

/**
 * Every check that doesn't need the write locks, and the price: shared by the
 * quote (preview) and the POST. Throws the same 4xx errors either way.
 */
async function preparePeriod(req: Request, bookingPublicId: string): Promise<PreparedPeriod> {
  const body = (req.body ?? {}) as { newStartAt?: unknown; newEndAt?: unknown };
  const newStart = parseNewStartAt(body.newStartAt);
  const newEnd = parseNewEndAt(body.newEndAt);

  const booking = await requireBooking(req, bookingPublicId);
  const now = new Date();
  const { blocker } = await findBlocker(booking, prisma, now);
  if (blocker) throw blocker;

  const isMonthly = booking.rentalPeriodType === RentalPeriodType.MONTHLY;
  const schedule = await loadBranchScheduleConfig(booking.branchId);
  const nowHeld = !isMonthly && !!schedule && isClampedHalfDay(schedule, newStart, newEnd);
  const wasHeld = heldToClosingOf(booking.pricingSnapshot);

  const timeProblem = periodTimeProblem({
    now,
    current: { startAt: booking.startAt, endAt: booking.endAt },
    startAt: newStart,
    endAt: newEnd,
    monthly: isMonthly,
    clampedHalfDay: nowHeld,
  });
  if (timeProblem) throw new RescheduleError(StatusCode.BAD_REQUEST, timeProblem.code, timeProblem.message);

  const durationMs = newEnd.getTime() - newStart.getTime();
  const currentMs = booking.endAt.getTime() - booking.startAt.getTime();
  const pureShift = Math.abs(durationMs - currentMs) < MINUTE_MS;

  // A confirmed extension before pickup: its own price sits on the booking — only a plain move
  const confirmedExtensions = await prisma.bookingExtension.count({
    where: { bookingId: booking.id, extensionStatus: ExtensionStatus.CONFIRMED },
  });
  if (confirmedExtensions > 0 && !pureShift) {
    throw new RescheduleError(
      StatusCode.CONFLICT,
      "RESCHEDULE_PERIOD_EXTENDED_BOOKING",
      "This booking was already extended, so only its pickup can be moved (the return moves with it). To change the length, cancel the extension or rebook.",
    );
  }

  // Booking window: pickup ≤ 30 days ahead; ≤ 30 days long (monthly: 30–180 days)
  try {
    assertBookingWindow(newStart, newEnd, { monthly: isMonthly, now });
  } catch (err) {
    if (err instanceof BookingWindowError) {
      if (err.reason === "WINDOW" || err.reason === "PICKUP_WINDOW") {
        throw windowError(err, bookingWindowEnd(now), Math.round(durationMs / MINUTE_MS));
      }
      throw err;
    }
    throw err;
  }

  const hoursProblem = periodHoursError(schedule, newStart, newEnd, now);
  if (hoursProblem) throw hoursProblem;

  await assertDlFree({
    dlNumber: booking.customer.drivingLicenceNumber,
    mode: "reschedule",
    window: { startAt: newStart, endAt: newEnd },
    excludeBookingId: booking.id,
    now,
  });

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
    { restrictionMode: booking.branch.bookingRestrictionMode, branchId: booking.branchId, excludeBookingId: booking.id },
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

  // Availability (re-checked under the locks on POST): other bookings / holds with the turnaround, locks
  const [bookingConflicts, holdConflicts, lockConflicts] = await Promise.all([
    findBookingConflicts(prisma, booking, newStart, newEnd, now),
    findHoldConflicts(booking, newStart, newEnd),
    findLockConflicts(prisma, booking, newStart, newEnd),
  ]);
  const conflicts = [...bookingConflicts, ...lockConflicts, ...holdConflicts];
  if (conflicts.length > 0) throw vehicleUnavailable(booking, conflicts);

  // Price both windows now with the booking's own terms
  let priced: Awaited<ReturnType<typeof priceBothWindows>>;
  try {
    priced = await priceBothWindows(booking, newStart, newEnd, { was: wasHeld, now: nowHeld });
  } catch (err) {
    console.warn(`[reschedule] period pricing failed for ${booking.publicId}:`, err);
    throw new RescheduleError(
      StatusCode.CONFLICT,
      "RESCHEDULE_PRICING_UNAVAILABLE",
      "This booking's new price can't be worked out (check the vehicle's pricing and the branch GST rule), so it can't be rescheduled to a different period right now.",
    );
  }
  const deltas = priced.map((p) => itemDelta(p.before, p.after));
  const total = sumDeltas(deltas);
  const difference = total.final;

  if (!difference.isZero()) {
    // Booked before GST-inclusive rents (item 17): its records are in other terms
    if (isGstOnTopBooking(booking.pricingSnapshot)) {
      throw new RescheduleError(
        StatusCode.CONFLICT,
        "RESCHEDULE_PRICE_CHANGE",
        `These dates change the price by ${difference.gt(0) ? "+" : "−"}${formatRupees(difference.abs().toNumber())}, and this booking was priced before GST-inclusive rents, so its price can't be recalculated. Choose dates priced the same, or cancel and rebook.`,
        { difference: difference.toFixed(2) },
      );
    }
    if (!booking.remainingPaidAt && isRazorpayOrderId(booking.remainingPaymentId)) {
      throw new RescheduleError(
        StatusCode.CONFLICT,
        "PAYMENT_IN_PROGRESS",
        "An online payment of the remaining balance is in progress. Check its status first — the booking can be rescheduled once it is paid or has failed.",
      );
    }
  }

  const { netPaid, overpaid } = await overpaidNow(booking.id);
  const balance = balanceAfterReprice(
    {
      isAdvancePayment: booking.isAdvancePayment,
      advanceAmount: booking.advanceAmount,
      remainingBalance: booking.remainingBalance,
      remainingPaidAt: booking.remainingPaidAt,
      totalFinal: booking.totalFinal,
    },
    difference,
    overpaid,
  );

  const sumOf = (pick: (p: (typeof priced)[number]) => Decimal) =>
    priced.reduce((acc, p) => acc.add(pick(p)), new Decimal(0)).toFixed(2);
  const first = priced[0];
  const couponCode = booking.couponCode ?? null;
  const durationMinutes = Math.round(durationMs / MINUTE_MS);
  const currentMinutes = Math.round(currentMs / MINUTE_MS);
  const quote: PeriodQuote = {
    bookingPublicId: booking.publicId,
    previous: {
      startAt: booking.startAt.toISOString(),
      endAt: booking.endAt.toISOString(),
      durationMinutes: currentMinutes,
      durationLabel: durationLabel(currentMinutes),
    },
    next: {
      startAt: newStart.toISOString(),
      endAt: newEnd.toISOString(),
      durationMinutes,
      durationLabel: durationLabel(durationMinutes),
    },
    pureShift,
    confirmationRequired: !difference.isZero(),
    pricing: {
      oldTotal: new Decimal(booking.totalFinal.toString()).toFixed(2),
      newTotal: balance.newTotalFinal.toFixed(2),
      difference: difference.toFixed(2),
      oldWindowRent: sumOf((p) => p.before.finalTotal),
      newWindowRent: sumOf((p) => p.after.finalTotal),
      priceChanged: !difference.isZero(),
      couponCode,
      couponAppliesToNewWindow: couponCode ? first?.after.discountEvaluation.couponValid === true : null,
      netPaid: netPaid.toFixed(2),
      dueAtPickup: balance.dueAtPickup.toFixed(2),
      refundable: balance.refundable.toFixed(2),
      outcome: balance.kind,
      freeKm: { before: first?.before.freeKmLimit ?? null, after: first?.after.freeKmLimit ?? null },
      billedAs: {
        before: first?.before.pricingBreakdown.billedAs ?? null,
        after: first?.after.pricingBreakdown.billedAs ?? null,
      },
      rentalPeriodType: isMonthly ? RentalPeriodType.MONTHLY : bookingPeriodFields(newStart, newEnd).rentalPeriodType,
    },
  };

  return { booking, now, newStart, newEnd, nowHeld, wasHeld, isMonthly, pureShift, priced, deltas, total, balance, quote };
}

/** POST …/bookings/:publicId/reschedule/quote { newStartAt, newEndAt } — the preview: checks + price difference, nothing written. */
export async function quoteReschedulePeriod(req: Request, bookingPublicId: string): Promise<PeriodQuote> {
  return (await preparePeriod(req, bookingPublicId)).quote;
}

async function reschedulePeriod(
  req: Request,
  bookingPublicId: string,
  actorRole: RescheduleActorRole,
): Promise<RescheduleResult> {
  const body = (req.body ?? {}) as { reason?: unknown; acceptPriceChange?: unknown; expectedNewTotal?: unknown };
  const reason = parseReason(body.reason);

  const actor = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, publicId: true, name: true, role: true, branchId: true },
  });
  if (!actor) {
    throw new RescheduleError(StatusCode.UNAUTHORIZED, "UNAUTHORIZED", "Your session has expired. Please log in again.");
  }

  const prepared = await preparePeriod(req, bookingPublicId);
  const { booking, now, newStart, newEnd, quote, balance, deltas, priced } = prepared;

  // An extended booking only moves (checked in preparePeriod): the start-only path shifts its extensions
  const hasExtensions =
    prepared.pureShift &&
    (await prisma.bookingExtension.count({ where: { bookingId: booking.id, extensionStatus: ExtensionStatus.CONFIRMED } })) > 0;
  if (hasExtensions) return rescheduleStartOnly(req, bookingPublicId, actorRole);

  const difference = new Decimal(quote.pricing.difference);
  if (!difference.isZero() && body.acceptPriceChange !== true) {
    throw new RescheduleError(
      StatusCode.CONFLICT,
      "RESCHEDULE_PRICE_CONFIRMATION_REQUIRED",
      difference.gt(0)
        ? `The new period costs ${formatRupees(difference.toNumber())} more (total ${formatRupees(Number(quote.pricing.newTotal))}). Confirm the new price to reschedule.`
        : `The new period costs ${formatRupees(difference.abs().toNumber())} less (total ${formatRupees(Number(quote.pricing.newTotal))}). Confirm the new price to reschedule.`,
      { quote },
    );
  }
  if (body.expectedNewTotal !== undefined && body.expectedNewTotal !== null) {
    const expected = new Decimal(Number(body.expectedNewTotal) || 0).toDecimalPlaces(2);
    if (!expected.eq(quote.pricing.newTotal)) {
      throw new RescheduleError(
        StatusCode.CONFLICT,
        "RESCHEDULE_PRICE_STALE",
        `The price changed since it was shown: the new total is now ${formatRupees(Number(quote.pricing.newTotal))}. Check it and confirm again.`,
        { quote },
      );
    }
  }

  const periodFields = bookingPeriodFields(newStart, newEnd, { monthly: prepared.isMonthly });
  let snapshot: Record<string, unknown> = snapshotAfterReprice(
    booking.pricingSnapshot,
    priced.map((p, i) => ({
      vehicleId: p.vehicleId,
      delta: deltas[i]!,
      days: p.after.pricingBreakdown.duration.days,
      breakdown: {
        periodType: p.after.pricingBreakdown.periodType,
        billedAs: p.after.pricingBreakdown.billedAs,
        billedAsType: p.after.pricingBreakdown.billedAsType,
        billableHours: p.after.pricingBreakdown.duration.billableDuration,
        actualHours: p.after.pricingBreakdown.duration.actualDuration,
        freeKmLimit: p.after.freeKmLimit,
        extraKmRate: Number(p.after.extraKmRate.toString()),
        ...(p.after.pricingBreakdown.weekend && { weekend: p.after.pricingBreakdown.weekend }),
        ...(p.after.pricingBreakdown.festival && { festival: p.after.pricingBreakdown.festival }),
      },
    })),
  );
  if (prepared.nowHeld !== prepared.wasHeld) {
    snapshot = withHeldToClosing(snapshot, prepared.nowHeld) as Record<string, unknown>;
  }
  // Stored festival rules + those the new window was priced with (a stored version wins)
  const stored = specialRulesOf(booking.pricingSnapshot);
  const nextRules = priced.reduce<SpecialRule[]>((rules, p) => unionSpecialRules(rules, p.after.pricingBreakdown.specialRules), [...(stored ?? [])]);
  if (stored !== null || nextRules.length > 0) snapshot.specialRules = nextRules;
  const history = Array.isArray(snapshot.reschedules) ? (snapshot.reschedules as unknown[]) : [];
  snapshot.reschedules = [
    ...history,
    {
      at: now.toISOString(),
      byUserPublicId: actor.publicId,
      from: { startAt: booking.startAt.toISOString(), endAt: booking.endAt.toISOString() },
      to: { startAt: newStart.toISOString(), endAt: newEnd.toISOString() },
      oldTotal: quote.pricing.oldTotal,
      newTotal: quote.pricing.newTotal,
      difference: quote.pricing.difference,
      outcome: balance.kind,
      ...(balance.update.reopenBalance && {
        reopenedFrom: {
          isAdvancePayment: booking.isAdvancePayment,
          advanceAmount: new Decimal(booking.advanceAmount.toString()).toFixed(2),
          remainingPaidAt: booking.remainingPaidAt?.toISOString() ?? null,
          remainingPaymentId: booking.remainingPaymentId,
        },
      }),
    },
  ];

  const vehicleIds = booking.items.map((i) => i.vehicle.id);
  const locks = await extensionLockService.acquireMultipleLocks(vehicleIds);
  if (locks.failed.length > 0) {
    throw new RescheduleError(StatusCode.CONFLICT, "RESCHEDULE_BUSY", "This vehicle is being updated by another request. Please try again in a moment.");
  }

  let releasedQuotePublicId: string | null = null;
  let finalBalance = balance;
  try {
    const holdConflicts = await findHoldConflicts(booking, newStart, newEnd);
    if (holdConflicts.length > 0) throw vehicleUnavailable(booking, holdConflicts);

    const out = await prisma.$transaction(
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
        const lockConflicts = await findLockConflicts(tx, booking, newStart, newEnd);
        if (lockConflicts.length > 0) throw vehicleUnavailable(booking, lockConflicts);

        const { blocker: lateBlocker, releasableQuoteId } = await findBlocker(booking, tx, now);
        if (lateBlocker) throw lateBlocker;

        // The over-payment the balance was worked out with, re-read inside the transaction
        const { overpaid } = await overpaidNow(booking.id, tx);
        const settled = balanceAfterReprice(
          {
            isAdvancePayment: booking.isAdvancePayment,
            advanceAmount: booking.advanceAmount,
            remainingBalance: booking.remainingBalance,
            remainingPaidAt: booking.remainingPaidAt,
            totalFinal: booking.totalFinal,
          },
          difference,
          overpaid,
        );

        const u = settled.update;
        const updated = await tx.booking.updateMany({
          where: {
            id: booking.id,
            status: BookingStatus.CONFIRMED,
            startAt: booking.startAt,
            endAt: booking.endAt,
            requiresManagerConfirmation: false,
            activeExtensionId: booking.activeExtensionId,
            totalFinal: booking.totalFinal,
            remainingBalance: booking.remainingBalance,
            remainingPaidAt: booking.remainingPaidAt,
          },
          data: {
            startAt: newStart,
            endAt: newEnd,
            ...(booking.originalEndAt ? { originalEndAt: newEnd } : {}),
            ...(releasableQuoteId !== null ? { activeExtensionId: null } : {}),
            ...periodFields,
            pricingSnapshot: snapshot as Prisma.InputJsonValue,
            totalBase: new Decimal(booking.totalBase.toString()).add(prepared.total.base).toFixed(2),
            totalDiscount: new Decimal(booking.totalDiscount.toString()).add(prepared.total.discount).toFixed(2),
            totalTax: new Decimal(booking.totalTax.toString()).add(prepared.total.tax).toFixed(2),
            totalFinal: u.totalFinal.toFixed(2),
            ...(u.remainingBalance !== undefined && { remainingBalance: u.remainingBalance.toFixed(2) }),
            ...(u.isAdvancePayment !== undefined && { isAdvancePayment: u.isAdvancePayment }),
            ...(u.advanceAmount !== undefined && { advanceAmount: u.advanceAmount.toFixed(2) }),
            ...(u.reopenBalance && { remainingPaidAt: null, remainingPaymentId: null, remainingPaidDuring: null }),
          },
        });
        if (updated.count === 0) {
          throw new RescheduleError(StatusCode.CONFLICT, "RESCHEDULE_CONFLICT", "This booking changed while you were rescheduling it. Refresh and try again.");
        }

        if (!difference.isZero() || priced.some((p) => p.before.pricingBreakdown.duration.days !== p.after.pricingBreakdown.duration.days)) {
          for (const [index, item] of booking.items.entries()) {
            const next = applyItemDelta(item, deltas[index]!);
            await tx.bookingItem.update({
              where: { id: item.id },
              data: {
                days: priced[index]!.after.pricingBreakdown.duration.days,
                baseTotal: next.baseTotal.toFixed(2),
                discountAmount: next.discountAmount.toFixed(2),
                discountPercent: next.discountPercent.toString(),
                taxAmount: next.taxAmount.toFixed(2),
                cgstAmount: next.cgstAmount.toFixed(2),
                sgstAmount: next.sgstAmount.toFixed(2),
                finalTotal: next.finalTotal.toFixed(2),
              },
            });
          }
        }

        // The recorded discount layers (GST-inclusive terms) follow the new window
        const t = prepared.total;
        if (!t.grossPrice.isZero() || !t.grossDiscount.isZero()) {
          await tx.discountApplication.updateMany({
            where: { bookingId: booking.id },
            data: {
              originalAmount: { increment: t.grossPrice.toFixed(2) },
              durationDiscountAmount: { increment: t.grossDurationDiscount.toFixed(2) },
              couponDiscountAmount: { increment: t.grossCouponDiscount.toFixed(2) },
              totalDiscountAmount: { increment: t.grossDiscount.toFixed(2) },
              finalAmount: { increment: t.grossTotal.toFixed(2) },
            },
          });
          if (!t.grossCouponDiscount.isZero()) {
            await tx.couponUsageLog.updateMany({
              where: { bookingId: booking.id },
              data: { discountedAmount: { increment: t.grossCouponDiscount.toFixed(2) } },
            });
          }
        }

        let released: string | null = null;
        if (releasableQuoteId !== null) {
          const q = await tx.bookingExtension.update({
            where: { id: releasableQuoteId },
            data: { extensionStatus: ExtensionStatus.CANCELLED, rejectionReason: "Superseded by a reschedule" },
            select: { publicId: true },
          });
          released = q.publicId;
        }
        return { released, settled };
      },
      { timeout: 15000 },
    );
    releasedQuotePublicId = out.released;
    finalBalance = out.settled;
  } finally {
    await extensionLockService.releaseMultipleLocks(vehicleIds).catch(() => undefined);
  }

  const pricing: PeriodPricing = {
    ...quote.pricing,
    newTotal: finalBalance.newTotalFinal.toFixed(2),
    dueAtPickup: finalBalance.dueAtPickup.toFixed(2),
    refundable: finalBalance.refundable.toFixed(2),
    outcome: finalBalance.kind,
  };
  const durationMinutes = quote.next.durationMinutes;
  const shiftMinutes = Math.round((newStart.getTime() - booking.startAt.getTime()) / MINUTE_MS);
  const money = difference.isZero()
    ? "Price unchanged."
    : `Price ${formatRupees(Number(pricing.oldTotal))} → ${formatRupees(Number(pricing.newTotal))} (${difference.gt(0) ? "+" : "−"}${formatRupees(difference.abs().toNumber())})` +
      (finalBalance.dueAtPickup.gt(0) ? `, ${formatRupees(finalBalance.dueAtPickup.toNumber())} due at pickup` : "") +
      (finalBalance.refundable.gt(0) ? `, ${formatRupees(finalBalance.refundable.toNumber())} to refund` : "") +
      ".";
  const reasonSuffix = reason ? ` Reason: ${reason}` : "";
  const description =
    `Booking ${booking.publicId} rental period rescheduled: pickup ${formatIst(booking.startAt)} → ${formatIst(newStart)}, ` +
    `return ${formatIst(booking.endAt)} → ${formatIst(newEnd)} (${quote.previous.durationLabel} → ${quote.next.durationLabel}). ${money}${reasonSuffix}`;

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
        before: {
          startAt: booking.startAt.toISOString(),
          endAt: booking.endAt.toISOString(),
          totalFinal: pricing.oldTotal,
          remainingBalance: new Decimal(booking.remainingBalance.toString()).toFixed(2),
        },
        after: {
          startAt: newStart.toISOString(),
          endAt: newEnd.toISOString(),
          totalFinal: pricing.newTotal,
          remainingBalance: finalBalance.update.remainingBalance?.toFixed(2) ?? new Decimal(booking.remainingBalance.toString()).toFixed(2),
        },
        metadata: {
          mode: "PERIOD",
          shiftMinutes,
          durationMinutes,
          previousDurationMinutes: quote.previous.durationMinutes,
          difference: pricing.difference,
          dueAtPickup: pricing.dueAtPickup,
          refundable: pricing.refundable,
          outcome: pricing.outcome,
          couponCode: pricing.couponCode,
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
        difference: pricing.difference,
        reason,
      },
    }),
  ]);

  void notifyEvents.bookingRescheduled({
    bookingId: booking.id,
    previousStartAt: booking.startAt,
    previousEndAt: booking.endAt,
    newStartAt: newStart,
    newEndAt: newEnd,
    priceDifference: difference.toNumber(),
    dueAtPickup: finalBalance.dueAtPickup.toNumber(),
    actorUserId: actor.id,
    reason,
  });

  try {
    await invalidateVehicleAvailability(redis, vehicleIds);
    await invalidateGroupListingCache(redis as any);
  } catch (err) {
    console.warn("[reschedule] Cache invalidation failed (non-fatal):", err);
  }
  if (!difference.isZero()) {
    refreshInvoiceTotals(booking.id).catch((err) =>
      console.error(`[reschedule] invoice refresh failed for booking ${booking.publicId}:`, err),
    );
  }

  return {
    booking: {
      publicId: booking.publicId,
      status: BookingStatus.CONFIRMED,
      startAt: newStart.toISOString(),
      endAt: newEnd.toISOString(),
      durationMinutes,
      rentalPeriodType: periodFields.rentalPeriodType,
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
    pricing,
  };
}

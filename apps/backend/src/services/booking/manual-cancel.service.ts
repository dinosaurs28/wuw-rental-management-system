/**
 * The branch manager cancels a customer's rent by hand (Fleet tab, Oct 2026) —
 * an upcoming (CONFIRMED) or an active (PICKED_UP) one, at their own branch.
 * Independent of the automatic cancellations (hold expiry, the 06:00 no-show run).
 *
 *   GET  /api/branchManager/bookings/:publicId/cancel   what the dialog needs and
 *                                                       whether it can be cancelled
 *   POST /api/branchManager/bookings/:publicId/cancel   { reason, refund: { amount,
 *        method?, note? }, vehicleReturned?, vehicleStatus?, odometer? }
 *
 * Rules (which rents, the refund cap, the body): manual-cancel-rules.ts.
 *
 * In one transaction under the booking row lock (booking-row-lock.ts — the one
 * every pickup completion takes first, so a later pickup sees CANCELLED and
 * refuses) and the per-booking refund lock the settlement refunds take: the
 * booking becomes CANCELLED (cancelledAt / by /
 * source MANUAL_BM / reason; the row, its items, payments and history stay), and
 *   - the coupon use is given back and counter credit pending on it is voided
 *   - open counter payment sessions (pickup / drop bill / edit difference) are
 *     abandoned, pending extensions cancelled, paused pickup / drop forms deleted,
 *     a safety deposit request awaiting approval rejected, a pickup or a displaced
 *     booking awaiting the manager dropped from those lists
 *   - active rent: the car (back at the branch) is set Available or Maintenance —
 *     it is no longer out on this rental — unless another rental holds it or it is
 *     in damage review / inactive; an optional odometer reading is saved on it
 *   - refund > 0: a CANCELLATION_REFUND PaymentTransaction (confirmed, cash linked
 *     to the manager's open shift) and a COMPLETED RefundRequest — the manager pays
 *     it back now — so it shows in Transactions, the shift and the reports
 *   - an audit log
 * After commit: the Redis holds and availability caches of its vehicles are
 * cleared, staff activity logged and the customer (and Fleet) notified.
 *
 * Refused while a payment is in flight (an online payment started on a counter
 * session, an open UPI QR) or cash on it awaits the manager's confirmation.
 * Every booking check (availability, one vehicle per DL, type-class limits,
 * overdue / recovery lists) only counts HOLD / CONFIRMED / PICKED_UP, so the
 * customer can book again at once and the car is bookable for those dates.
 *
 * Errors: HTTP 4xx { success:false, code, message, ...extra } (ManualCancelError).
 */
import type { Request } from "express";
import Decimal from "decimal.js";
import {
  prisma,
  BookingStatus,
  DamageReportStatus,
  ExtensionStatus,
  PaymentPurpose,
  PaymentSessionStatus,
  PaymentSessionType,
  VehicleStatus,
  AuditSeverity,
} from "@repo/database/client";
import type { Prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { createID } from "../../utils/nanoID.js";
import { redis } from "../../lib/redisconfig.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../staffActivity/staffActivity.service.js";
import { notifyEvents } from "../notification/notification.events.js";
import { discountApplicationService } from "../discount/discount-application.service.js";
import { summarizeBookingMoney } from "../payment/booking-owed.service.js";
import { fetchOrderStatus, isRazorpayOrderId } from "../payment/razorpay.service.js";
import { isDropDamage, vehicleStatusAfterDrop } from "../damage/drop-damage.service.js";
import { getBookingCreditSummary, voidPendingCreditOnCancel } from "../payment/customer-credit.service.js";
import { ACTIVE_RENTAL_ITEM_WHERE } from "../../utils/availability/outForRental.js";
import { lockBookingRow } from "./booking-row-lock.js";
import { invalidateGroupListingCache, invalidateVehicleAvailability } from "../../utils/cache/vehicleCacheKeys.js";
import { formatRupees } from "../../utils/pricing/weekendRule.js";
import {
  MANUAL_CANCEL_NOTE_MAX,
  MANUAL_CANCEL_REASON_MAX,
  MANUAL_CANCEL_REASON_MIN,
  MANUAL_CANCEL_REFUND_METHODS,
  MANUAL_CANCEL_REFUND_METHOD_LABELS,
  MANUAL_CANCEL_VEHICLE_STATUSES,
  ORIGINAL_PAYMENT_REFUND_REASON_PREFIX,
  ManualCancelError,
  cancelRefusalFor,
  cashShiftRefusal,
  committedRefunds,
  dropInProgressRefusal,
  manualCancelStage,
  moneyRefusal,
  odometerProblem,
  originalPaymentCap,
  originalPaymentProblem,
  parseManualCancelBody,
  razorpayCapturedAmount,
  refundAmountProblem,
  refundRecordFor,
  refundableAmount,
  remainingPaymentRefusal,
  type CancelMoney,
  type ManualCancelStage,
  type ManualCancelRefundMethod,
} from "./manual-cancel-rules.js";

type Db = Prisma.TransactionClient | typeof prisma;

/** Counter payment sessions still open — abandoned by the cancel (an open drop bill refuses it instead). */
const ABANDONABLE_SESSION_STATUSES: PaymentSessionStatus[] = [
  PaymentSessionStatus.OPEN,
  PaymentSessionStatus.COMPUTING,
  PaymentSessionStatus.AWAITING_PAYMENT,
];

/** A drop bill in any of these is a drop in progress. */
const OPEN_DROP_SESSION_STATUSES: PaymentSessionStatus[] = [
  ...ABANDONABLE_SESSION_STATUSES,
  PaymentSessionStatus.PAYMENT_INITIATED,
];

/** Extensions not settled yet — cancelled with the rent. */
const OPEN_EXTENSION_STATUSES: ExtensionStatus[] = [ExtensionStatus.PENDING_PAYMENT, ExtensionStatus.PAYMENT_COLLECTED];

/** Vehicle statuses the cancel leaves alone (damage review hold, retired). */
const KEEP_VEHICLE_STATUSES: VehicleStatus[] = [VehicleStatus.MANAGER_REPORTED, VehicleStatus.INACTIVE];

/** idempotencyKey prefix of the refund a manual cancel records (one per booking). */
const MANUAL_CANCEL_REFUND_KEY_PREFIX = "mcr:";

// ── Loading ──────────────────────────────────────────────────────────────────

async function loadBooking(bookingPublicId: string, branchId: number, db: Db = prisma) {
  return db.booking.findFirst({
    where: { publicId: bookingPublicId, branchId, deletedAt: null },
    select: {
      id: true,
      publicId: true,
      status: true,
      startAt: true,
      endAt: true,
      branchId: true,
      customerId: true,
      totalFinal: true,
      rentalPeriodType: true,
      requiresManagerConfirmation: true,
      couponCode: true,
      dlStatus: true,
      extensionDisplacedAt: true,
      remainingPaymentId: true,
      remainingPaidAt: true,
      customer: { select: { user: { select: { name: true, phone: true } } } },
      items: {
        orderBy: { id: "asc" },
        select: {
          vehicle: {
            select: { id: true, publicId: true, make: true, model: true, regNo: true, status: true, odo: true },
          },
        },
      },
    },
  });
}

type CancelBooking = NonNullable<Awaited<ReturnType<typeof loadBooking>>>;

async function requireBooking(req: Request, bookingPublicId: string, db: Db = prisma): Promise<CancelBooking> {
  const booking = await loadBooking(bookingPublicId, req.branch_Id, db);
  if (!booking) {
    throw new ManualCancelError(StatusCode.NOT_FOUND, "BOOKING_NOT_FOUND", "Booking not found at your branch.");
  }
  return booking;
}

/** Paid / committed refunds / cash awaiting confirmation / captured through Razorpay on the booking. */
async function readMoney(bookingId: number, db: Db = prisma): Promise<CancelMoney> {
  const [txns, requests] = await Promise.all([
    db.paymentTransaction.findMany({
      where: { bookingId },
      select: {
        purpose: true,
        status: true,
        totalAmount: true,
        onlineAmount: true,
        onlineGateway: true,
        onlineTransactionRef: true,
      },
    }),
    db.refundRequest.aggregate({
      where: { bookingId, status: { in: ["PENDING_APPROVAL", "APPROVED", "COMPLETED"] } },
      _sum: { amount: true },
    }),
  ]);
  const money = summarizeBookingMoney(txns);
  return {
    paid: money.confirmed.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    refunded: committedRefunds(money.refundedOut, new Decimal((requests._sum.amount ?? 0).toString())),
    pendingCash: money.pending.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    razorpayCaptured: razorpayCapturedAmount(txns),
  };
}

/** An open drop bill or a drop damage awaiting review on the booking. */
async function dropInProgress(bookingId: number, db: Db): Promise<ManualCancelError | null> {
  const [returnSession, pendingDamages] = await Promise.all([
    db.paymentSession.findFirst({
      where: { bookingId, sessionType: PaymentSessionType.RETURN, status: { in: OPEN_DROP_SESSION_STATUSES } },
      select: { id: true },
    }),
    db.damageReport.findMany({
      where: { bookingId, status: DamageReportStatus.PENDING },
      select: { notes: true },
    }),
  ]);
  return dropInProgressRefusal({
    openReturnSession: returnSession !== null,
    pendingDropDamage: pendingDamages.some((d) => isDropDamage(d.notes)),
  });
}

/**
 * A legacy counter balance payment through Razorpay started and not recorded:
 * asks Razorpay for the order's state (never inside a transaction). Null when
 * there is none, or it failed / expired.
 */
async function remainingPaymentBlocker(
  booking: Pick<CancelBooking, "remainingPaymentId" | "remainingPaidAt">,
): Promise<ManualCancelError | null> {
  if (booking.remainingPaidAt || !isRazorpayOrderId(booking.remainingPaymentId)) return null;
  return remainingPaymentRefusal(await fetchOrderStatus(booking.remainingPaymentId!));
}

/** A payment in flight on the booking: an online payment started on a counter session, or an open UPI QR. */
async function paymentInProgress(bookingId: number, db: Db, now: Date): Promise<ManualCancelError | null> {
  const [initiated, openQr] = await Promise.all([
    db.paymentSession.findFirst({
      where: { bookingId, status: PaymentSessionStatus.PAYMENT_INITIATED },
      select: { publicId: true },
    }),
    db.upiQrPayment.findFirst({
      where: { bookingId, status: "ACTIVE", closeBy: { gt: now } },
      select: { publicId: true },
    }),
  ]);
  if (initiated) {
    return new ManualCancelError(
      StatusCode.CONFLICT,
      "PAYMENT_IN_PROGRESS",
      "An online payment was started at the counter for this booking. Finish or cancel it first, then cancel the rent.",
      { paymentSessionPublicId: initiated.publicId },
    );
  }
  if (openQr) {
    return new ManualCancelError(
      StatusCode.CONFLICT,
      "PAYMENT_IN_PROGRESS",
      "The customer has an open UPI QR payment for this booking. Try again once it's paid or has expired.",
    );
  }
  return null;
}

/**
 * Why the rent can't be cancelled right now (state, a drop in progress, cash
 * awaiting confirmation, a payment in flight), or null. The Razorpay check of a
 * legacy balance payment runs only outside the transaction (remainingPaymentBlocker).
 */
async function findBlocker(
  booking: Pick<CancelBooking, "id" | "status" | "requiresManagerConfirmation">,
  money: CancelMoney,
  db: Db,
  now: Date,
): Promise<ManualCancelError | null> {
  return (
    cancelRefusalFor(booking) ??
    (await dropInProgress(booking.id, db)) ??
    moneyRefusal(money) ??
    (await paymentInProgress(booking.id, db, now))
  );
}

/** The actor's open cash shift (a cash refund comes out of their drawer), or null. */
async function openCashShift(userId: number, db: Db) {
  return db.cashShift.findFirst({ where: { employeeId: userId, status: "OPEN" }, select: { id: true } });
}

const vehicleLabel = (v: { make: string; model: string; regNo: string }) => `${v.make} ${v.model} (${v.regNo})`;

// ── GET: what the dialog needs ───────────────────────────────────────────────

export async function getManualCancelOptions(req: Request, bookingPublicId: string) {
  const booking = await requireBooking(req, bookingPublicId);
  const now = new Date();
  const actor = await prisma.user.findUnique({ where: { publicId: req.public_Id }, select: { id: true } });
  const [money, credit, openSessions, openExtensions, shift] = await Promise.all([
    readMoney(booking.id),
    getBookingCreditSummary(booking.id),
    prisma.paymentSession.count({
      where: { bookingId: booking.id, status: { in: ABANDONABLE_SESSION_STATUSES } },
    }),
    prisma.bookingExtension.count({
      where: { bookingId: booking.id, extensionStatus: { in: OPEN_EXTENSION_STATUSES } },
    }),
    actor ? openCashShift(actor.id, prisma) : Promise.resolve(null),
  ]);
  const blocker = (await findBlocker(booking, money, prisma, now)) ?? (await remainingPaymentBlocker(booking));
  const stage = manualCancelStage(booking.status);
  const refundable = refundableAmount(money);

  return {
    bookingPublicId: booking.publicId,
    status: booking.status,
    stage,
    cancellable: blocker === null,
    blockedCode: blocker?.code ?? null,
    blockedReason: blocker?.message ?? null,
    startAt: booking.startAt.toISOString(),
    endAt: booking.endAt.toISOString(),
    rentalPeriodType: booking.rentalPeriodType,
    totalFinal: new Decimal(booking.totalFinal.toString()).toFixed(2),
    customer: { name: booking.customer.user.name, phone: booking.customer.user.phone },
    vehicles: booking.items.map((i) => ({
      publicId: i.vehicle.publicId,
      make: i.vehicle.make,
      model: i.vehicle.model,
      regNo: i.vehicle.regNo,
      status: i.vehicle.status,
      odo: i.vehicle.odo,
    })),
    money: {
      paid: money.paid.toFixed(2),
      // Refunds paid out or committed (approved / awaiting approval) — one figure, never added twice
      refunded: money.refunded.toFixed(2),
      pendingCash: money.pendingCash.toFixed(2),
      refundable: refundable.toFixed(2),
      // What "original online payment" can take: refundable, at most what Razorpay captured
      onlineRefundable: originalPaymentCap(refundable, money.razorpayCaptured).toFixed(2),
    },
    // A cash refund needs the manager's open cash shift
    cashShiftOpen: shift !== null,
    // Counter credit still pending on it — written off by the cancel (nothing is owed on a cancelled rent)
    creditPending: (credit?.pending ?? new Decimal(0)).toFixed(2),
    couponCode: booking.couponCode,
    dlStatus: booking.dlStatus,
    openPaymentSessions: openSessions,
    openExtensions,
    refundMethods: MANUAL_CANCEL_REFUND_METHODS.map((value) => ({
      value,
      label: MANUAL_CANCEL_REFUND_METHOD_LABELS[value],
    })),
    vehicleStatuses: [...MANUAL_CANCEL_VEHICLE_STATUSES],
    limits: {
      reasonMin: MANUAL_CANCEL_REASON_MIN,
      reasonMax: MANUAL_CANCEL_REASON_MAX,
      noteMax: MANUAL_CANCEL_NOTE_MAX,
    },
  };
}

// ── POST: cancel ─────────────────────────────────────────────────────────────

export interface ManualCancelResult {
  booking: {
    publicId: string;
    status: "CANCELLED";
    previousStatus: BookingStatus;
    stage: ManualCancelStage;
    cancelledAt: string;
    cancellationReason: string;
    cancellationSource: "MANUAL_BM";
  };
  refund: {
    /** The refund row paid out now; null for "original online payment" (completed later) */
    paymentTransactionPublicId: string | null;
    refundRequestPublicId: string;
    /** COMPLETED: paid back now · APPROVED: complete it in Payments → Refunds with the Razorpay refund id */
    status: "COMPLETED" | "APPROVED";
    amount: string;
    method: ManualCancelRefundMethod;
    methodLabel: string;
  } | null;
  /** Active rents: what each car became (unchanged when another rental holds it or it is under review / inactive). */
  vehicles: Array<{ publicId: string; regNo: string; status: VehicleStatus; changed: boolean }>;
  releasedCouponUses: number;
  voidedCredit: string;
  abandonedPaymentSessions: number;
  cancelledExtensions: number;
}

export async function manualCancelBooking(req: Request, bookingPublicId: string): Promise<ManualCancelResult> {
  const actor = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, publicId: true, name: true, role: true, branchId: true },
  });
  if (!actor) throw new ManualCancelError(StatusCode.UNAUTHORIZED, "UNAUTHORIZED", "User not found.");

  const booking = await requireBooking(req, bookingPublicId);
  const stateRefusal = cancelRefusalFor(booking);
  if (stateRefusal) throw stateRefusal;
  const stage = manualCancelStage(booking.status)!;
  const input = parseManualCancelBody(req.body, stage);

  // Fail fast before taking locks; everything is checked again under them. The
  // Razorpay check of a legacy balance payment runs here only (never in the transaction).
  const now = new Date();
  const early =
    (await findBlocker(booking, await readMoney(booking.id), prisma, now)) ??
    (await remainingPaymentBlocker(booking));
  if (early) throw early;

  const outcome = await prisma.$transaction(
    async (tx) => {
      // The same row lock every pickup completion takes first: neither lands in the middle of the other
      await lockBookingRow(tx, booking.id);
      // One refund at a time per booking (shared with the settlement refunds)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"deposit-refund:" + booking.id}))`;

      const locked = await requireBooking(req, bookingPublicId, tx);
      if (locked.status !== booking.status) {
        throw (
          cancelRefusalFor(locked) ??
          new ManualCancelError(
            StatusCode.CONFLICT,
            "CANCEL_CONFLICT",
            "This rent changed while you were cancelling it (it was picked up). Refresh and try again.",
          )
        );
      }
      const money = await readMoney(locked.id, tx);
      const blocker = await findBlocker(locked, money, tx, now);
      if (blocker) throw blocker;
      // A new online balance payment started since the gateway check above
      if (
        !locked.remainingPaidAt &&
        isRazorpayOrderId(locked.remainingPaymentId) &&
        locked.remainingPaymentId !== booking.remainingPaymentId
      ) {
        throw remainingPaymentRefusal({ state: "PENDING" });
      }

      const refundable = refundableAmount(money);
      const refundProblem = refundAmountProblem(input.refund.amount, refundable);
      if (refundProblem) {
        throw new ManualCancelError(StatusCode.BAD_REQUEST, "REFUND_EXCEEDS_PAID", refundProblem, {
          refundable: refundable.toFixed(2),
          field: "refund.amount",
        });
      }
      if (input.refund.method === "ORIGINAL_PAYMENT") {
        const cap = originalPaymentCap(refundable, money.razorpayCaptured);
        const problem = originalPaymentProblem(input.refund.amount, cap);
        if (problem) {
          throw new ManualCancelError(StatusCode.BAD_REQUEST, "REFUND_EXCEEDS_ONLINE", problem, {
            onlineRefundable: cap.toFixed(2),
            field: "refund.amount",
          });
        }
      }
      // A cash refund comes out of the manager's drawer: their open shift records it
      const refunding = input.refund.amount.gt(0) ? input.refund.method : null;
      const shift = refunding === "CASH" ? await openCashShift(actor.id, tx) : null;
      const shiftRefusal = cashShiftRefusal(refunding, shift !== null);
      if (shiftRefusal) throw shiftRefusal;
      if (input.odometer !== null) {
        const problem = odometerProblem(input.odometer, locked.items[0]?.vehicle.odo ?? 0, locked.items.length);
        if (problem) {
          throw new ManualCancelError(StatusCode.BAD_REQUEST, "VALIDATION_ERROR", problem, { field: "odometer" });
        }
      }

      const cancelledAt = new Date();
      const updated = await tx.booking.updateMany({
        where: { id: locked.id, status: locked.status },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt,
          cancellationReason: input.reason,
          cancelledById: actor.id,
          cancellationSource: "MANUAL_BM",
          // Off the Confirmations / Displaced lists; nothing pending or in progress on it
          requiresManagerConfirmation: false,
          extensionDisplacedAt: null,
          activeExtensionId: null,
          activePaymentSessionId: null,
          holdExpiresAt: null,
        },
      });
      if (updated.count === 0) {
        throw new ManualCancelError(
          StatusCode.CONFLICT,
          "CANCEL_CONFLICT",
          "This rent changed while you were cancelling it. Refresh and try again.",
        );
      }

      const sessions = await tx.paymentSession.findMany({
        where: { bookingId: locked.id, status: { in: ABANDONABLE_SESSION_STATUSES } },
        select: { id: true, publicId: true, sessionType: true },
      });
      if (sessions.length > 0) {
        await tx.paymentSession.updateMany({
          where: { id: { in: sessions.map((s) => s.id) } },
          data: { status: PaymentSessionStatus.ABANDONED },
        });
      }

      const extensions = await tx.bookingExtension.updateMany({
        where: { bookingId: locked.id, extensionStatus: { in: OPEN_EXTENSION_STATUSES } },
        data: { extensionStatus: ExtensionStatus.CANCELLED, rejectionReason: "Rent cancelled by the branch manager" },
      });

      await tx.safetyDepositRequest.updateMany({
        where: { bookingId: locked.id, status: "PENDING_APPROVAL" },
        data: { status: "REJECTED", rejectedAt: cancelledAt, rejectionReason: "Rent cancelled by the branch manager" },
      });

      // Paused pickup / drop forms can't be resumed on a cancelled rent
      await tx.operationDraft.deleteMany({ where: { bookingId: locked.id } });

      // Give the coupon use back; nothing is owed on a cancelled rent, so close its pending credit
      const releasedCouponUses = await discountApplicationService.releaseUsage(locked.id, tx);
      const voided = await voidPendingCreditOnCancel(tx, locked.id, `Rent cancelled by the branch manager: ${input.reason}`);

      // Active rent: the car is back and no longer out on this rental
      const vehicles: ManualCancelResult["vehicles"] = [];
      if (stage === "ACTIVE") {
        for (const { vehicle } of locked.items) {
          const otherRental = await tx.bookingItem.findFirst({
            where: { vehicleId: vehicle.id, ...ACTIVE_RENTAL_ITEM_WHERE },
            select: { id: true },
          });
          const keep = otherRental !== null || KEEP_VEHICLE_STATUSES.includes(vehicle.status);
          // Safety net: a drop damage decided for this car (held for review, maintenance …) wins
          const afterDrop = keep ? null : await vehicleStatusAfterDrop(locked.id, vehicle.id, tx as any);
          const status = keep
            ? vehicle.status
            : afterDrop && afterDrop !== VehicleStatus.AVAILABLE
              ? afterDrop
              : (input.vehicleStatus as VehicleStatus);
          if (!keep || input.odometer !== null) {
            await tx.vehicle.update({
              where: { id: vehicle.id },
              data: {
                ...(keep ? {} : { status }),
                ...(input.odometer !== null ? { odo: input.odometer } : {}),
              },
            });
          }
          vehicles.push({ publicId: vehicle.publicId, regNo: vehicle.regNo, status, changed: !keep && status !== vehicle.status });
        }
      }

      // Cash / UPI / bank transfer: the manager pays it back now — a refund row (money
      // out) and a completed request. Original online payment: an approved request,
      // completed later in Payments → Refunds with the Razorpay refund id.
      let refund: ManualCancelResult["refund"] = null;
      if (input.refund.amount.gt(0) && input.refund.method) {
        const record = refundRecordFor(input.refund.method);
        const isCash = record.method === "CASH";
        const amount = input.refund.amount.toFixed(2);
        const methodLabel = MANUAL_CANCEL_REFUND_METHOD_LABELS[input.refund.method];
        const notes = `Rent cancelled by the branch manager — ${methodLabel}${input.refund.note ? `: ${input.refund.note}` : ""}`;
        const txn = record.paidOutNow
          ? await tx.paymentTransaction.create({
              data: {
                publicId: createID(),
                idempotencyKey: `${MANUAL_CANCEL_REFUND_KEY_PREFIX}${locked.publicId}`,
                bookingId: locked.id,
                branchId: locked.branchId,
                purpose: PaymentPurpose.CANCELLATION_REFUND,
                method: record.method,
                status: "CONFIRMED",
                totalAmount: amount,
                cashAmount: isCash ? amount : "0.00",
                onlineAmount: isCash ? "0.00" : amount,
                onlineGateway: record.onlineGateway,
                collectedById: actor.id,
                collectedAt: cancelledAt,
                confirmedById: actor.id,
                confirmedAt: cancelledAt,
                cashShiftId: shift?.id ?? null,
                notes: notes.slice(0, 1000),
              },
              select: { publicId: true },
            })
          : null;
        const request = await tx.refundRequest.create({
          data: {
            publicId: createID(),
            bookingId: locked.id,
            branchId: locked.branchId,
            amount,
            reason: `${record.paidOutNow ? `Rent cancelled (${methodLabel})` : ORIGINAL_PAYMENT_REFUND_REASON_PREFIX}: ${input.reason}${input.refund.note ? ` (${input.refund.note})` : ""}`,
            method: record.method,
            status: record.paidOutNow ? "COMPLETED" : "APPROVED",
            requestedById: actor.id,
            approvedById: actor.id,
            approvedAt: cancelledAt,
            ...(record.paidOutNow ? { completedById: actor.id, completedAt: cancelledAt } : {}),
          },
          select: { publicId: true },
        });
        refund = {
          paymentTransactionPublicId: txn?.publicId ?? null,
          refundRequestPublicId: request.publicId,
          status: record.paidOutNow ? "COMPLETED" : "APPROVED",
          amount,
          method: input.refund.method,
          methodLabel,
        };
      }

      const result: ManualCancelResult = {
        booking: {
          publicId: locked.publicId,
          status: "CANCELLED",
          previousStatus: locked.status,
          stage,
          cancelledAt: cancelledAt.toISOString(),
          cancellationReason: input.reason,
          cancellationSource: "MANUAL_BM",
        },
        refund,
        vehicles,
        releasedCouponUses,
        voidedCredit: new Decimal(voided?.voidedAmount ?? 0).toFixed(2),
        abandonedPaymentSessions: sessions.length,
        cancelledExtensions: extensions.count,
      };

      await auditService.log(
        {
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          actorBranchId: actor.branchId ?? undefined,
          action: "BOOKING_CANCELLED_BY_MANAGER",
          category: AuditCategory.BOOKING,
          severity: AuditSeverity.WARNING,
          description:
            `${stage === "ACTIVE" ? "Active" : "Upcoming"} rent ${locked.publicId} cancelled by the branch manager. Reason: ${input.reason}` +
            (refund
              ? refund.status === "APPROVED"
                ? ` Refund ₹${refund.amount} to the original online payment approved (to be completed).`
                : ` Refund ₹${refund.amount} (${refund.methodLabel}).`
              : " No refund."),
          entity: "Booking",
          entityId: locked.publicId,
          entityLabel: locked.publicId,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          before: { status: locked.status },
          after: { status: BookingStatus.CANCELLED, cancellationSource: "MANUAL_BM" },
          metadata: {
            reason: input.reason,
            stage,
            refundable: refundable.toFixed(2),
            paid: money.paid.toFixed(2),
            refund,
            vehicleStatus: input.vehicleStatus,
            odometer: input.odometer,
            vehicles,
            releasedCouponUses,
            voidedCredit: result.voidedCredit,
            abandonedPaymentSessions: sessions.map((s) => ({ publicId: s.publicId, type: s.sessionType })),
            cancelledExtensions: extensions.count,
          },
        },
        tx,
      );

      return { result, items: locked.items };
    },
    { timeout: 15000 },
  );

  const { result } = outcome;
  const vehicleIds = outcome.items.map((i) => i.vehicle.id);

  // Redis isn't transactional: clear the booking's holds and the availability caches now
  try {
    for (const { vehicle } of outcome.items) {
      const key = `vehicle_holds:${vehicle.publicId}`;
      await redis.srem(key, result.booking.publicId);
      if ((await redis.scard(key)) === 0) await redis.del(key);
    }
    await redis.del(result.booking.publicId);
    await invalidateVehicleAvailability(redis, vehicleIds);
    await invalidateGroupListingCache(redis as any);
  } catch (err) {
    console.warn("[manual-cancel] Redis cleanup failed (non-fatal):", err);
  }

  const vehicleNames = outcome.items.map((i) => vehicleLabel(i.vehicle)).join(", ");
  await staffActivityService.logFromRequest(req, {
    actionType: StaffActionType.CANCELLED,
    entityType: StaffEntityType.BOOKING,
    entityRef: result.booking.publicId,
    description: `${stage === "ACTIVE" ? "Active" : "Upcoming"} rent ${result.booking.publicId} (${vehicleNames}) cancelled: ${input.reason}`,
    metadata: {
      reason: input.reason,
      previousStatus: result.booking.previousStatus,
      vehicles: result.vehicles,
      refundAmount: result.refund?.amount ?? "0.00",
    },
  });
  if (result.refund) {
    const approvedOnly = result.refund.status === "APPROVED";
    await staffActivityService.logFromRequest(req, {
      actionType: approvedOnly ? StaffActionType.INITIATED : StaffActionType.REFUNDED,
      entityType: StaffEntityType.BOOKING,
      entityRef: result.booking.publicId,
      description: approvedOnly
        ? `₹${result.refund.amount} refund to the original online payment approved on cancelling rent ${result.booking.publicId}`
        : `₹${result.refund.amount} refunded (${result.refund.methodLabel}) on cancelling rent ${result.booking.publicId}`,
      metadata: { amount: result.refund.amount, method: result.refund.method, status: result.refund.status },
    });
  }

  const refundRupees = result.refund ? formatRupees(Number(result.refund.amount)) : "";
  void notifyEvents.bookingCancelled({
    bookingId: booking.id,
    actorUserId: actor.id,
    reason: input.reason,
    byBranch: true,
    refundNote: !result.refund
      ? null
      : result.refund.status === "APPROVED"
        ? `A refund of ${refundRupees} will be made to your original payment method.`
        : `A refund of ${refundRupees} (${result.refund.methodLabel}) has been issued.`,
  });

  return result;
}

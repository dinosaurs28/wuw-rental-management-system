import {
  prisma,
  BookingStatus,
  ExtensionStatus,
  PaymentPurpose,
  PaymentStatus,
} from "@repo/database/client";
import type { UpiQrPayment } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { createID } from "../../utils/nanoID.js";
import {
  closeUpiQrCode,
  createRazorpayOrder,
  createUpiQrCode,
  fetchRazorpayOrder,
  fetchUpiQrCode,
  fetchUpiQrPayments,
  isRazorpayOrderId,
  isSettledGatewayPayment,
  toUpiQrPayment,
  UpiQrGatewayError,
  type UpiQrPaymentEntity,
} from "./razorpay.service.js";
import { confirmBookingPayment, confirmExtensionPayment } from "./bookingConfirmation.service.js";
import { extensionAvailabilityService } from "../extension/extension-availability.service.js";
import { findDlConflict } from "../booking/dl-in-use.service.js";
import { notifyEvents } from "../notification/notification.events.js";

/**
 * UPI QR payments for customers whose phone has no UPI app (TODO #2).
 *
 * The customer's own online payments — a booking hold's advance / full payment
 * and a self-pay extension — can be paid by scanning a Razorpay single-use,
 * fixed-amount UPI QR from another phone. The QR is an alternative to the
 * Razorpay order the booking/extension already has, never a second charge:
 *
 * - The QR amount is exactly what that order charges (cross-checked against
 *   the order on Razorpay).
 * - It settles through the SAME confirmBookingPayment / confirmExtensionPayment
 *   the order verify, poll and webhook paths use, under the SAME transaction
 *   id (the order id), so the `initial:<order>` / `ext:razorpay:<order>`
 *   idempotency keys make a double confirmation impossible whichever channel
 *   lands first.
 * - A booking QR closes 45 s before the hold lapses and a payment is applied
 *   only while the booking is still on HOLD. Money that cannot be applied
 *   (hold lapsed, booking already paid another way, extension closed) is
 *   detect-only: logged REFUND REQUIRED and the branch manager is notified.
 *
 * Settlement runs from the `qr_code.credited` webhook, from the customer's
 * status poll, from the hold-expiry worker (last chance before the hold
 * lapses) and from the branch manager's gateway recheck.
 */

export const UPI_QR_STATUS = {
  ACTIVE: "ACTIVE",
  PAID: "PAID",
  CLOSED: "CLOSED",
  EXPIRED: "EXPIRED",
} as const;
export type UpiQrStatus = (typeof UPI_QR_STATUS)[keyof typeof UPI_QR_STATUS];

/** What the customer should be told about a QR, derived from the QR and the booking/extension state. */
export type UpiQrOutcome = "PENDING" | "CONFIRMED" | "REFUND_REQUIRED" | "EXPIRED" | "CLOSED";

export type UpiQrRefundReason =
  | "HOLD_LAPSED"
  | "BOOKING_CANCELLED"
  | "DUPLICATE_PAYMENT"
  | "AMOUNT_MISMATCH"
  | "EXTENSION_CLOSED";

/** Longest a QR stays payable. */
const QR_MAX_LIFETIME_MS = 15 * 60_000;
/** Razorpay needs close_by at least 2 minutes out; 15 s more covers clock skew. */
const QR_MIN_LIFETIME_MS = 2 * 60_000 + 15_000;
/**
 * A booking QR closes this long before the hold lapses, so a payment made in
 * the last second is settled (webhook / poll) while the booking is still HOLD.
 */
const HOLD_SETTLE_BUFFER_MS = 45_000;
/** An open QR with less time than this left is replaced instead of reused. */
const REUSE_MIN_REMAINING_MS = 60_000;
/** QR codes one booking hold / extension may create. */
const MAX_QR_PER_TARGET = 10;
/** One gateway sync per QR per this window — clients poll every few seconds. */
const SYNC_THROTTLE_MS = 2_500;

const SYSTEM_ACTOR = { ip: undefined, userAgent: "upi-qr" } as const;

type Actor = { ip?: string; userAgent?: string };

/** 4xx/5xx raised by the QR endpoints, in the `{ success:false, code, message }` contract. */
export class UpiQrError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "UpiQrError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message, ...this.extra };
  }
}

type Money = { toString(): string } | number | string;

function toPaise(value: Money): number {
  return Math.round(Number(value.toString()) * 100);
}

function bookingChargeAmount(b: { isAdvancePayment: boolean; advanceAmount: Money; totalFinal: Money }): Money {
  return b.isAdvancePayment ? b.advanceAmount : b.totalFinal;
}

function shortRef(publicId: string): string {
  return `#${publicId.slice(-8).toUpperCase()}`;
}

async function bookingPaidByPayment(bookingId: number, paymentId: string): Promise<boolean> {
  const txn = await prisma.paymentTransaction.findFirst({
    where: { bookingId, notes: { contains: `razorpay_payment_id=${paymentId}` } },
    select: { id: true },
  });
  return txn !== null;
}

async function extensionPaidByPayment(extensionId: number, paymentId: string): Promise<boolean> {
  const ext = await prisma.bookingExtension.findUnique({
    where: { id: extensionId },
    select: { paymentTransaction: { select: { notes: true } } },
  });
  return ext?.paymentTransaction?.notes?.includes(`razorpay_payment_id=${paymentId}`) ?? false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Settlement
// ─────────────────────────────────────────────────────────────────────────────

type SettleResult =
  | { outcome: "CONFIRMED"; newlyConfirmed: boolean }
  | { outcome: "REFUND_REQUIRED"; reason: UpiQrRefundReason };

/**
 * Applies a captured QR payment to its booking / extension. Idempotent: every
 * caller (webhook, poll, expiry worker, recheck) may run it for the same
 * payment, and it re-derives the same answer each time.
 */
async function settlePaidQr(
  row: UpiQrPayment,
  payment: UpiQrPaymentEntity,
  actor: Actor,
): Promise<SettleResult> {
  // Record the money on the QR first — it arrived whatever happens next.
  const marked = await prisma.upiQrPayment.updateMany({
    where: { id: row.id, OR: [{ paymentId: null }, { paymentId: payment.id }] },
    data: {
      status: UPI_QR_STATUS.PAID,
      paymentId: payment.id,
      paidAt: row.paidAt ?? (payment.createdAt ? new Date(payment.createdAt * 1000) : new Date()),
    },
  });

  // Every refund notice for QR money names the QR's own pay_xxx (deduped on it)
  const refund = async (reason: UpiQrRefundReason): Promise<SettleResult> => {
    console.error(
      `[upiQr] REFUND REQUIRED qr=${row.qrId} payment=${payment.id} amount=${payment.amount}p ` +
        `booking=${row.bookingId} extension=${row.extensionId ?? "-"} reason=${reason}`,
    );
    void notifyEvents.upiQrPaymentNeedsRefund({
      bookingId: row.bookingId,
      extensionId: row.extensionId,
      paymentId: payment.id,
      amountInPaise: payment.amount,
      reason,
    });
    return { outcome: "REFUND_REQUIRED", reason };
  };

  // A single-use code that somehow took a second payment: that one is surplus.
  if (marked.count === 0) return refund("DUPLICATE_PAYMENT");

  if (payment.amount !== toPaise(row.amount)) return refund("AMOUNT_MISMATCH");

  // ── Extension ──────────────────────────────────────────────────────────────
  if (row.extensionId !== null) {
    const ext = await prisma.bookingExtension.findUnique({
      where: { id: row.extensionId },
      select: {
        id: true,
        extensionStatus: true,
        additionalAmount: true,
        gatewayTransactionId: true,
        booking: { select: { status: true } },
      },
    });
    if (!ext) throw new Error(`[upiQr] extension id=${row.extensionId} not found for qr=${row.qrId}`);

    if (ext.extensionStatus === ExtensionStatus.CONFIRMED) {
      return (await extensionPaidByPayment(ext.id, payment.id))
        ? { outcome: "CONFIRMED", newlyConfirmed: false }
        : refund("DUPLICATE_PAYMENT");
    }
    if (toPaise(ext.additionalAmount) !== payment.amount) return refund("AMOUNT_MISMATCH");
    // Staff collected it at the counter meanwhile — this money is surplus.
    if (ext.extensionStatus === ExtensionStatus.PAYMENT_COLLECTED) return refund("EXTENSION_CLOSED");
    // Rejected / cancelled while the code was open. Refunded here so the notice
    // names this QR payment (pay_xxx) — it never touched the extension's order.
    if (ext.extensionStatus === ExtensionStatus.REJECTED || ext.extensionStatus === ExtensionStatus.CANCELLED) {
      return refund(ext.booking.status === BookingStatus.CANCELLED ? "BOOKING_CANCELLED" : "EXTENSION_CLOSED");
    }
    // The rental ended (returned / cancelled) while the code was open
    if (
      ext.extensionStatus === ExtensionStatus.PENDING_PAYMENT &&
      ext.booking.status !== BookingStatus.CONFIRMED &&
      ext.booking.status !== BookingStatus.PICKED_UP
    ) {
      return refund(ext.booking.status === BookingStatus.CANCELLED ? "BOOKING_CANCELLED" : "EXTENSION_CLOSED");
    }

    const result = await confirmExtensionPayment({
      extensionId: ext.id,
      // Same key as the extension's order, so the order path can't confirm it twice
      transactionId: ext.gatewayTransactionId ?? row.qrId,
      gatewayPaymentId: payment.id,
      // Our refund notice names pay_xxx; the order-level one would send the BM to the wrong payment
      callerNotifiesRefund: true,
      actorName: "Razorpay UPI QR",
      actor,
    });
    // Closed in a race after the checks above
    if (result.skipped) {
      return refund(result.skipped === "CANCELLED" ? "BOOKING_CANCELLED" : "EXTENSION_CLOSED");
    }
    if (result.alreadyConfirmed) {
      return (await extensionPaidByPayment(ext.id, payment.id))
        ? { outcome: "CONFIRMED", newlyConfirmed: false }
        : refund("DUPLICATE_PAYMENT");
    }
    return { outcome: "CONFIRMED", newlyConfirmed: true };
  }

  // ── Booking (advance / full payment of a hold) ─────────────────────────────
  const booking = await prisma.booking.findUnique({
    where: { id: row.bookingId },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      transactionId: true,
      isAdvancePayment: true,
      advanceAmount: true,
      totalFinal: true,
    },
  });
  if (!booking) throw new Error(`[upiQr] booking id=${row.bookingId} not found for qr=${row.qrId}`);

  if (booking.paymentStatus === PaymentStatus.SUCCESS) {
    return (await bookingPaidByPayment(booking.id, payment.id))
      ? { outcome: "CONFIRMED", newlyConfirmed: false }
      : refund("DUPLICATE_PAYMENT");
  }
  // Hold expiry is respected: once the hold lapsed (or was cancelled) the cars
  // may belong to someone else, so the payment is not applied.
  if (booking.status !== BookingStatus.HOLD) {
    return refund(booking.status === BookingStatus.CANCELLED ? "BOOKING_CANCELLED" : "HOLD_LAPSED");
  }
  if (toPaise(bookingChargeAmount(booking)) !== payment.amount) return refund("AMOUNT_MISMATCH");

  const result = await confirmBookingPayment({
    bookingId: booking.id,
    // The order id: one `initial:<order>` idempotency key for every channel
    transactionId: isRazorpayOrderId(booking.transactionId) ? booking.transactionId! : row.qrId,
    isCash: false,
    gatewayPaymentId: payment.id,
    // Our refund notice names pay_xxx; the order-level one would send the BM to the wrong payment
    callerNotifiesRefund: true,
    actor,
  });
  // Cancelled in a race after the HOLD check above
  if (result.skipped) return refund("BOOKING_CANCELLED");
  if (result.alreadyConfirmed) {
    return (await bookingPaidByPayment(booking.id, payment.id))
      ? { outcome: "CONFIRMED", newlyConfirmed: false }
      : refund("DUPLICATE_PAYMENT");
  }
  return { outcome: "CONFIRMED", newlyConfirmed: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync (poll / close / reconcile)
// ─────────────────────────────────────────────────────────────────────────────

interface SyncState {
  outcome: UpiQrOutcome;
  reason: UpiQrRefundReason | null;
  /** Razorpay could not be reached — the state is "unknown", never "unpaid". */
  gatewayUnreachable: boolean;
}

const pending = (gatewayUnreachable = false): SyncState => ({
  outcome: "PENDING",
  reason: null,
  gatewayUnreachable,
});

function fromSettle(r: SettleResult): SyncState {
  return r.outcome === "CONFIRMED"
    ? { outcome: "CONFIRMED", reason: null, gatewayUnreachable: false }
    : { outcome: "REFUND_REQUIRED", reason: r.reason, gatewayUnreachable: false };
}

async function claimSyncSlot(rowId: number): Promise<boolean> {
  try {
    const ok = await redis.set(`upiqr:sync:${rowId}`, "1", "PX", SYNC_THROTTLE_MS, "NX");
    return ok === "OK";
  } catch {
    return true; // Redis down: don't block the customer's status check
  }
}

/** Is the booking / extension this QR pays for already settled (by any channel), or still payable? */
async function targetState(row: UpiQrPayment): Promise<{ settled: boolean; open: boolean }> {
  if (row.extensionId !== null) {
    const ext = await prisma.bookingExtension.findUnique({
      where: { id: row.extensionId },
      select: { extensionStatus: true },
    });
    return {
      settled: ext?.extensionStatus === ExtensionStatus.CONFIRMED,
      open: ext?.extensionStatus === ExtensionStatus.PENDING_PAYMENT,
    };
  }
  const booking = await prisma.booking.findUnique({
    where: { id: row.bookingId },
    select: { status: true, paymentStatus: true },
  });
  return {
    settled: booking?.paymentStatus === PaymentStatus.SUCCESS,
    open: booking?.status === BookingStatus.HOLD && booking.paymentStatus !== PaymentStatus.SUCCESS,
  };
}

async function markIfActive(rowId: number, status: UpiQrStatus): Promise<void> {
  await prisma.upiQrPayment.updateMany({
    where: { id: rowId, status: UPI_QR_STATUS.ACTIVE },
    data: { status },
  });
}

/**
 * Stops a QR from taking money and records why. A payment that landed before
 * the close is settled instead. Returns null when Razorpay can't be reached
 * (the row is left ACTIVE so a later sync retries).
 */
async function closeRow(
  row: UpiQrPayment,
  finalStatus: "CLOSED" | "EXPIRED",
  actor: Actor,
): Promise<SyncState | null> {
  if ((await closeUpiQrCode(row.qrId)) === null) {
    // Already closed (paid / expired / closed earlier), or Razorpay unreachable —
    // never record a code as closed while it may still take money
    const qr = await fetchUpiQrCode(row.qrId);
    if (qr === null || qr.status !== "closed") return null;
  }
  const payments = await fetchUpiQrPayments(row.qrId);
  if (payments === null) return null;
  const paid = payments.find(isSettledGatewayPayment);
  if (paid) return fromSettle(await settlePaidQr(row, paid, actor));
  await markIfActive(row.id, finalStatus);
  return {
    outcome: finalStatus === "CLOSED" ? "CLOSED" : "EXPIRED",
    reason: null,
    gatewayUnreachable: false,
  };
}

/**
 * Brings one QR row up to date with Razorpay and derives the customer-facing
 * outcome. `force` skips the per-QR throttle (webhook-less paths that must
 * look now, e.g. create-or-reuse).
 */
async function syncRow(row: UpiQrPayment, actor: Actor, force = false): Promise<SyncState> {
  if (row.status === UPI_QR_STATUS.PAID) {
    // Settled by this payment already — answer from the database
    if (row.paymentId) {
      const confirmedByUs =
        row.extensionId !== null
          ? await extensionPaidByPayment(row.extensionId, row.paymentId)
          : await bookingPaidByPayment(row.bookingId, row.paymentId);
      if (confirmedByUs) return { outcome: "CONFIRMED", reason: null, gatewayUnreachable: false };
    }
    // Paid but not (yet) applied — re-run the settlement with the gateway's payment
    if (!force && !(await claimSyncSlot(row.id))) return pending();
    const payments = await fetchUpiQrPayments(row.qrId);
    if (payments === null) return pending(true);
    const paid =
      payments.find((p) => p.id === row.paymentId && isSettledGatewayPayment(p)) ??
      payments.find(isSettledGatewayPayment);
    if (!paid) return pending();
    return fromSettle(await settlePaidQr(row, paid, actor));
  }

  if (row.status !== UPI_QR_STATUS.ACTIVE) {
    // Closed codes take no payments; a payment made before the close was
    // settled when the row was closed. Report the target's state.
    const t = await targetState(row);
    if (t.settled) return { outcome: "CONFIRMED", reason: null, gatewayUnreachable: false };
    return { outcome: row.status === UPI_QR_STATUS.CLOSED ? "CLOSED" : "EXPIRED", reason: null, gatewayUnreachable: false };
  }

  // ACTIVE
  if (!force && !(await claimSyncSlot(row.id))) return pending();

  const payments = await fetchUpiQrPayments(row.qrId);
  if (payments === null) return pending(true);
  const paid = payments.find(isSettledGatewayPayment);
  if (paid) return fromSettle(await settlePaidQr(row, paid, actor));

  // Unpaid. Paid another way (Razorpay checkout), or the hold / extension is
  // gone? Then close this code so it can't take money.
  const t = await targetState(row);
  if (t.settled) {
    const closed = await closeRow(row, "CLOSED", actor);
    return closed?.outcome === "REFUND_REQUIRED" ? closed : { outcome: "CONFIRMED", reason: null, gatewayUnreachable: false };
  }
  if (!t.open) {
    return (await closeRow(row, row.extensionId !== null ? "CLOSED" : "EXPIRED", actor)) ?? pending(true);
  }

  if (Date.now() >= row.closeBy.getTime()) {
    const qr = await fetchUpiQrCode(row.qrId);
    if (qr === null) return pending(true);
    if (qr.status === "closed") {
      await markIfActive(row.id, qr.closeReason === "on_demand" ? UPI_QR_STATUS.CLOSED : UPI_QR_STATUS.EXPIRED);
      return { outcome: qr.closeReason === "on_demand" ? "CLOSED" : "EXPIRED", reason: null, gatewayUnreachable: false };
    }
    // Open past our deadline (created without a Razorpay close_by) — close it now
    return (await closeRow(row, "EXPIRED", actor)) ?? pending(true);
  }

  return pending();
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer-facing view
// ─────────────────────────────────────────────────────────────────────────────

export interface UpiQrView {
  /** UpiQrPayment.publicId — use it to poll / close. */
  qrPaymentId: string;
  /** Razorpay `qr_xxx`. */
  qrId: string;
  purpose: "ADVANCE" | "FULL_PAYMENT" | "EXTENSION";
  bookingId: string;
  extensionId: string | null;
  /** Razorpay order id this payment settles under (booking.transactionId / extension order). */
  transactionId: string | null;
  amount: number;
  currency: "INR";
  /** Razorpay link that serves the QR image (PNG). */
  imageUrl: string;
  status: UpiQrStatus;
  outcome: UpiQrOutcome;
  reason: UpiQrRefundReason | null;
  message: string;
  gatewayUnreachable: boolean;
  closeBy: string;
  expiresInSeconds: number;
  paidAt: string | null;
  createdAt: string;
  reused: boolean;
  booking: { publicId: string; status: string; paymentStatus: string };
  extension: { publicId: string; extensionStatus: string; newEndAt: string | null } | null;
}

function outcomeMessage(kind: "booking" | "extension", s: SyncState): string {
  switch (s.outcome) {
    case "CONFIRMED":
      return kind === "booking"
        ? "Payment received — your booking is confirmed."
        : "Payment received — your extension is confirmed.";
    case "REFUND_REQUIRED":
      switch (s.reason) {
        case "HOLD_LAPSED":
          return "Your payment arrived after this booking's hold ended, so it couldn't be confirmed. The amount will be refunded.";
        case "BOOKING_CANCELLED":
          return kind === "booking"
            ? "This booking was cancelled before the payment arrived. The amount will be refunded."
            : "The booking for this extension was cancelled before the payment arrived. The amount will be refunded.";
        case "DUPLICATE_PAYMENT":
          return `This ${kind} was already paid, so this payment will be refunded.`;
        case "EXTENSION_CLOSED":
          return "This extension is no longer active. The amount will be refunded.";
        case "AMOUNT_MISMATCH":
        default:
          return "The amount paid didn't match what was due, so it couldn't be applied. The amount will be refunded.";
      }
    case "EXPIRED":
      return kind === "booking"
        ? "This QR code has expired. Please start the booking again."
        : "This QR code has expired. Please try the payment again.";
    case "CLOSED":
      return "This QR code was closed. Generate a new one to pay.";
    case "PENDING":
    default:
      return s.gatewayUnreachable
        ? "Checking your payment… We'll confirm it as soon as the payment gateway responds."
        : "Scan this QR with any UPI app on another phone and pay the exact amount.";
  }
}

async function buildView(row: UpiQrPayment, state: SyncState, reused = false): Promise<UpiQrView> {
  const fresh = (await prisma.upiQrPayment.findUnique({ where: { id: row.id } })) ?? row;
  const booking = await prisma.booking.findUnique({
    where: { id: fresh.bookingId },
    select: { publicId: true, status: true, paymentStatus: true, transactionId: true },
  });
  const ext =
    fresh.extensionId !== null
      ? await prisma.bookingExtension.findUnique({
          where: { id: fresh.extensionId },
          select: {
            publicId: true,
            extensionStatus: true,
            gatewayTransactionId: true,
            requestedEndAt: true,
            actualNewEndAt: true,
          },
        })
      : null;
  const now = Date.now();
  return {
    qrPaymentId: fresh.publicId,
    qrId: fresh.qrId,
    purpose: fresh.purpose as UpiQrView["purpose"],
    bookingId: booking?.publicId ?? "",
    extensionId: ext?.publicId ?? null,
    transactionId: ext ? ext.gatewayTransactionId : (booking?.transactionId ?? null),
    amount: Number(fresh.amount.toString()),
    currency: "INR",
    imageUrl: fresh.imageUrl,
    status: fresh.status as UpiQrStatus,
    outcome: state.outcome,
    reason: state.reason,
    message: outcomeMessage(ext ? "extension" : "booking", state),
    gatewayUnreachable: state.gatewayUnreachable,
    closeBy: fresh.closeBy.toISOString(),
    expiresInSeconds:
      fresh.status === UPI_QR_STATUS.ACTIVE ? Math.max(0, Math.floor((fresh.closeBy.getTime() - now) / 1000)) : 0,
    paidAt: fresh.paidAt ? fresh.paidAt.toISOString() : null,
    createdAt: fresh.createdAt.toISOString(),
    reused,
    booking: {
      publicId: booking?.publicId ?? "",
      status: booking?.status ?? "",
      paymentStatus: booking?.paymentStatus ?? "",
    },
    extension: ext
      ? {
          publicId: ext.publicId,
          extensionStatus: ext.extensionStatus,
          newEndAt: (ext.actualNewEndAt ?? ext.requestedEndAt)?.toISOString() ?? null,
        }
      : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Create (or reuse)
// ─────────────────────────────────────────────────────────────────────────────

interface QrTarget {
  bookingId: number;
  bookingPublicId: string;
  extensionId: number | null;
  extensionPublicId: string | null;
  purpose: PaymentPurpose;
  amount: Money;
  /** Latest moment the QR may take money. */
  latestCloseBy: Date;
  /** true: the deadline is a booking hold — never extended past it. */
  holdBound: boolean;
  description: string;
}

function isCloseByRejection(err: UpiQrGatewayError): boolean {
  return /close_by|close by/i.test(err.detail);
}

async function openQr(target: QrTarget, actor: Actor): Promise<UpiQrView> {
  const lockKey = `upiqr:create:${target.bookingId}:${target.extensionId ?? 0}`;
  let locked = false;
  try {
    locked = (await redis.set(lockKey, "1", "EX", 20, "NX")) === "OK";
  } catch {
    locked = true; // Redis down: proceed without the lock
  }
  if (!locked) {
    throw new UpiQrError(409, "QR_BUSY", "A QR code is already being created for this payment. Please wait a moment.");
  }

  try {
    const existing = await prisma.upiQrPayment.findMany({
      where: {
        bookingId: target.bookingId,
        extensionId: target.extensionId,
        status: { in: [UPI_QR_STATUS.ACTIVE, UPI_QR_STATUS.PAID] },
      },
      orderBy: { createdAt: "desc" },
    });

    // A paid code wins: report it rather than asking the customer to pay again
    for (const row of existing.filter((r) => r.status === UPI_QR_STATUS.PAID)) {
      const state = await syncRow(row, actor, true);
      if (state.outcome === "CONFIRMED" || state.outcome === "PENDING") return buildView(row, state);
    }

    const amountPaise = toPaise(target.amount);
    for (const row of existing.filter((r) => r.status === UPI_QR_STATUS.ACTIVE)) {
      const state = await syncRow(row, actor, true);
      if (state.outcome === "CONFIRMED" || state.outcome === "REFUND_REQUIRED") return buildView(row, state);
      if (state.gatewayUnreachable) {
        throw new UpiQrError(
          502,
          "GATEWAY_UNAVAILABLE",
          "We couldn't reach the payment gateway. Please try again in a moment.",
        );
      }
      if (state.outcome !== "PENDING") continue; // it just closed / expired
      const remaining = row.closeBy.getTime() - Date.now();
      if (toPaise(row.amount) === amountPaise && remaining >= REUSE_MIN_REMAINING_MS) {
        return buildView(row, state, true);
      }
      // Wrong amount or about to lapse — retire it before issuing a new one
      const closed = await closeRow(row, "CLOSED", actor);
      if (closed === null) {
        throw new UpiQrError(
          502,
          "GATEWAY_UNAVAILABLE",
          "We couldn't reach the payment gateway. Please try again in a moment.",
        );
      }
      if (closed.outcome === "CONFIRMED" || closed.outcome === "REFUND_REQUIRED") return buildView(row, closed);
    }

    const used = await prisma.upiQrPayment.count({
      where: { bookingId: target.bookingId, extensionId: target.extensionId },
    });
    if (used >= MAX_QR_PER_TARGET) {
      throw new UpiQrError(
        429,
        "QR_LIMIT_REACHED",
        "Too many QR codes were generated for this payment. Please pay another way or start again.",
      );
    }

    const now = Date.now();
    const closeBy = new Date(Math.min(now + QR_MAX_LIFETIME_MS, target.latestCloseBy.getTime()));
    if (closeBy.getTime() - now < QR_MIN_LIFETIME_MS) {
      throw new UpiQrError(
        409,
        "QR_HOLD_TOO_SHORT",
        "There isn't enough time left on this booking's hold to pay by QR. Please start the booking again.",
      );
    }

    const publicId = createID();
    const notes: Record<string, string> = {
      purpose: target.extensionId !== null ? "EXTENSION" : String(target.purpose),
      booking_id: target.bookingPublicId,
      upi_qr_payment_id: publicId,
      ...(target.extensionPublicId ? { extension_id: target.extensionPublicId } : {}),
    };
    const qrParams = {
      amountInPaise: amountPaise,
      name: "WUW Rentals",
      description: target.description,
      notes,
    };

    let qr;
    let storedCloseBy = closeBy;
    try {
      qr = await createUpiQrCode({ ...qrParams, closeBy });
    } catch (err) {
      if (!(err instanceof UpiQrGatewayError) || !isCloseByRejection(err)) throw err;
      // An account on the older "close_by ≥ 15 min" rule. A hold-bound code is
      // created open-ended and closed by us (poll, hold-expiry worker, cancel);
      // an extension code simply gets the longer window.
      console.warn(`[upiQr] close_by rejected (${err.detail}) — retrying`);
      if (target.holdBound) {
        qr = await createUpiQrCode({ ...qrParams, closeBy: null });
      } else {
        storedCloseBy = new Date(Date.now() + QR_MAX_LIFETIME_MS + 60_000);
        qr = await createUpiQrCode({ ...qrParams, closeBy: storedCloseBy });
      }
    }

    let row: UpiQrPayment;
    try {
      row = await prisma.upiQrPayment.create({
        data: {
          publicId,
          qrId: qr.id,
          bookingId: target.bookingId,
          purpose: target.purpose,
          extensionId: target.extensionId,
          amount: (amountPaise / 100).toFixed(2),
          imageUrl: qr.imageUrl,
          status: UPI_QR_STATUS.ACTIVE,
          closeBy: storedCloseBy,
        },
      });
    } catch (dbErr) {
      // Never leave a payable code we can't settle
      await closeUpiQrCode(qr.id);
      throw dbErr;
    }

    console.log(
      `[upiQr] created qr=${qr.id} row=${publicId} booking=${target.bookingPublicId} ` +
        `extension=${target.extensionPublicId ?? "-"} amount=${amountPaise}p closeBy=${storedCloseBy.toISOString()}`,
    );
    return buildView(row, pending());
  } catch (err) {
    if (err instanceof UpiQrGatewayError) {
      throw new UpiQrError(
        502,
        "QR_CREATE_FAILED",
        "We couldn't create a UPI QR code right now. Please try again or pay another way.",
      );
    }
    throw err;
  } finally {
    try {
      await redis.del(lockKey);
    } catch {
      /* lock expires on its own */
    }
  }
}

/**
 * Ops switch: RAZORPAY_UPI_QR_ENABLED=false turns the option off (e.g. QR Codes
 * not activated on the Razorpay account). Open codes still poll / settle.
 */
export function isUpiQrEnabled(): boolean {
  const flag = (process.env.RAZORPAY_UPI_QR_ENABLED ?? "true").trim().toLowerCase();
  return flag !== "false" && flag !== "0" && Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

function assertUpiQrEnabled(): void {
  if (!isUpiQrEnabled()) {
    throw new UpiQrError(
      503,
      "UPI_QR_DISABLED",
      "Paying by UPI QR isn't available right now. Please choose another way to pay.",
    );
  }
}

async function customerIdForUser(userPublicId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { publicId: userPublicId },
    select: { customerProfile: { select: { id: true } } },
  });
  if (!user?.customerProfile) throw new UpiQrError(404, "NOT_FOUND", "Booking not found or access denied");
  return user.customerProfile.id;
}

/** QR for a booking hold's online payment (advance or full — whatever its Razorpay order charges). */
export async function createBookingUpiQr(
  userPublicId: string,
  bookingPublicId: string,
  actor: Actor,
): Promise<UpiQrView> {
  assertUpiQrEnabled();
  const customerId = await customerIdForUser(userPublicId);
  const booking = await prisma.booking.findUnique({
    where: { publicId: bookingPublicId },
    select: {
      id: true,
      publicId: true,
      customerId: true,
      status: true,
      paymentStatus: true,
      transactionId: true,
      holdExpiresAt: true,
      isAdvancePayment: true,
      advanceAmount: true,
      totalFinal: true,
    },
  });
  if (!booking || booking.customerId !== customerId) {
    throw new UpiQrError(404, "BOOKING_NOT_FOUND", "Booking not found or access denied");
  }
  if (booking.paymentStatus === PaymentStatus.SUCCESS) {
    throw new UpiQrError(409, "BOOKING_ALREADY_PAID", "This booking is already paid.");
  }
  if (!isRazorpayOrderId(booking.transactionId)) {
    throw new UpiQrError(400, "NOT_ONLINE_PAYMENT", "This booking isn't paid online, so it can't be paid by UPI QR.");
  }
  if (
    booking.status !== BookingStatus.HOLD ||
    !booking.holdExpiresAt ||
    booking.holdExpiresAt.getTime() <= Date.now()
  ) {
    throw new UpiQrError(409, "HOLD_EXPIRED", "This booking's hold has ended. Please start the booking again.");
  }

  // The QR must charge exactly what the booking's order charges
  const amount = bookingChargeAmount(booking);
  const order = await fetchRazorpayOrder(booking.transactionId!);
  if (!order) {
    throw new UpiQrError(502, "GATEWAY_UNAVAILABLE", "We couldn't reach the payment gateway. Please try again in a moment.");
  }
  if (order.status === "paid") {
    throw new UpiQrError(
      409,
      "BOOKING_ALREADY_PAID",
      "This booking has already been paid. Refresh to see your confirmed booking.",
    );
  }
  if (order.amount !== toPaise(amount)) {
    console.error(
      `[upiQr] amount mismatch booking=${booking.publicId} order=${order.id} order=${order.amount}p booking=${toPaise(amount)}p`,
    );
    throw new UpiQrError(409, "AMOUNT_MISMATCH", "This booking's payable amount has changed. Please start the booking again.");
  }

  return openQr(
    {
      bookingId: booking.id,
      bookingPublicId: booking.publicId,
      extensionId: null,
      extensionPublicId: null,
      purpose: booking.isAdvancePayment ? PaymentPurpose.ADVANCE : PaymentPurpose.FULL_PAYMENT,
      amount,
      latestCloseBy: new Date(booking.holdExpiresAt.getTime() - HOLD_SETTLE_BUFFER_MS),
      holdBound: true,
      description: `${booking.isAdvancePayment ? "Advance" : "Payment"} for booking ${shortRef(booking.publicId)}`,
    },
    actor,
  );
}

/** QR for a customer self-pay extension (PENDING_PAYMENT, same amount as its Razorpay order). */
export async function createExtensionUpiQr(
  userPublicId: string,
  extensionPublicId: string,
  actor: Actor,
): Promise<UpiQrView> {
  assertUpiQrEnabled();
  const customerId = await customerIdForUser(userPublicId);
  const ext = await prisma.bookingExtension.findUnique({
    where: { publicId: extensionPublicId },
    select: {
      id: true,
      publicId: true,
      extensionStatus: true,
      additionalAmount: true,
      requestedEndAt: true,
      gatewayTransactionId: true,
      booking: {
        select: {
          id: true,
          publicId: true,
          customerId: true,
          status: true,
          endAt: true,
          items: { select: { vehicleId: true }, take: 1 },
        },
      },
    },
  });
  if (!ext || ext.booking.customerId !== customerId) {
    throw new UpiQrError(404, "EXTENSION_NOT_FOUND", "Extension not found or access denied");
  }
  if (ext.extensionStatus === ExtensionStatus.CONFIRMED) {
    throw new UpiQrError(409, "EXTENSION_ALREADY_PAID", "This extension is already paid and confirmed.");
  }
  if (ext.extensionStatus !== ExtensionStatus.PENDING_PAYMENT) {
    throw new UpiQrError(409, "EXTENSION_NOT_PAYABLE", `Extension is already in ${ext.extensionStatus} status`);
  }
  const booking = ext.booking;
  if (booking.status !== BookingStatus.CONFIRMED && booking.status !== BookingStatus.PICKED_UP) {
    throw new UpiQrError(
      400,
      "BOOKING_NOT_EXTENDABLE",
      `Extensions are only allowed for CONFIRMED or PICKED_UP bookings. Current status: ${booking.status}`,
    );
  }
  const amount = ext.additionalAmount;
  if (toPaise(amount) <= 0) {
    throw new UpiQrError(400, "NOTHING_TO_PAY", "This extension has nothing to pay — confirm it with the normal Pay button.");
  }

  // Same pre-payment checks as the Razorpay order path: the car and the
  // driving licence must still be free up to the quoted end.
  const vehicleId = booking.items[0]?.vehicleId;
  const availability = vehicleId
    ? await extensionAvailabilityService.checkVehicleAvailability(
        vehicleId,
        booking.endAt,
        ext.requestedEndAt,
        booking.id,
      )
    : null;
  if (!availability?.available) {
    throw new UpiQrError(
      409,
      "VEHICLE_NOT_FREE",
      "Your vehicle is no longer free for the new return time. Please check the extension again.",
    );
  }
  const dlConflict = await findDlConflict({
    customerId: booking.customerId,
    mode: "extend",
    window: { startAt: booking.endAt, endAt: ext.requestedEndAt },
    excludeBookingId: booking.id,
  });
  if (dlConflict) {
    // Customer-safe wording: never names the other booking
    throw new UpiQrError(dlConflict.status, dlConflict.code, dlConflict.customerMessage());
  }

  // Settle under the extension's Razorpay order id (created here if the
  // customer went straight to the QR) so both channels share one idempotency key
  if (ext.gatewayTransactionId) {
    const order = await fetchRazorpayOrder(ext.gatewayTransactionId);
    if (!order) {
      throw new UpiQrError(502, "GATEWAY_UNAVAILABLE", "We couldn't reach the payment gateway. Please try again in a moment.");
    }
    if (order.status === "paid") {
      throw new UpiQrError(
        409,
        "EXTENSION_ALREADY_PAID",
        "This extension has already been paid. Refresh to see your new return time.",
      );
    }
    if (order.amount !== toPaise(amount)) {
      console.error(`[upiQr] amount mismatch extension=${ext.publicId} order=${order.amount}p ext=${toPaise(amount)}p`);
      throw new UpiQrError(409, "AMOUNT_MISMATCH", "This extension's amount has changed. Please check the extension again.");
    }
  } else {
    let orderId: string;
    try {
      const order = await createRazorpayOrder(Number(amount.toString()), {
        receipt: ext.publicId,
        customerPublicId: userPublicId,
        notes: { purpose: "EXTENSION", extension_id: ext.publicId, booking_id: booking.publicId },
      });
      orderId = order.orderId;
    } catch {
      throw new UpiQrError(
        502,
        "QR_CREATE_FAILED",
        "We couldn't create a UPI QR code right now. Please try again or pay another way.",
      );
    }
    await prisma.bookingExtension.update({ where: { id: ext.id }, data: { gatewayTransactionId: orderId } });
  }

  return openQr(
    {
      bookingId: booking.id,
      bookingPublicId: booking.publicId,
      extensionId: ext.id,
      extensionPublicId: ext.publicId,
      purpose: PaymentPurpose.EXTENSION,
      amount,
      latestCloseBy: new Date(Date.now() + QR_MAX_LIFETIME_MS),
      holdBound: false,
      description: `Extension for booking ${shortRef(booking.publicId)}`,
    },
    actor,
  );
}

async function loadOwnedRow(userPublicId: string, qrPaymentId: string): Promise<UpiQrPayment> {
  const customerId = await customerIdForUser(userPublicId);
  const row = await prisma.upiQrPayment.findUnique({
    where: { publicId: qrPaymentId },
    include: { booking: { select: { customerId: true } } },
  });
  if (!row || row.booking.customerId !== customerId) {
    throw new UpiQrError(404, "QR_NOT_FOUND", "QR payment not found or access denied");
  }
  const { booking: _owner, ...plain } = row;
  return plain;
}

/** Status poll: syncs with Razorpay (throttled) and settles a captured payment. */
export async function getUpiQrStatus(userPublicId: string, qrPaymentId: string, actor: Actor): Promise<UpiQrView> {
  const row = await loadOwnedRow(userPublicId, qrPaymentId);
  return buildView(row, await syncRow(row, actor));
}

/** Customer closes the QR (went back / chose another way to pay). A payment that already landed is settled. */
export async function closeUpiQrForCustomer(
  userPublicId: string,
  qrPaymentId: string,
  actor: Actor,
): Promise<UpiQrView> {
  const row = await loadOwnedRow(userPublicId, qrPaymentId);
  if (row.status !== UPI_QR_STATUS.ACTIVE) return buildView(row, await syncRow(row, actor, true));
  const state = await closeRow(row, "CLOSED", actor);
  if (state === null) {
    throw new UpiQrError(502, "GATEWAY_UNAVAILABLE", "We couldn't reach the payment gateway. Please try again in a moment.");
  }
  return buildView(row, state);
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `qr_code.*` events from the Razorpay webhook (signature already verified).
 * Returns the acknowledgement message. Throws only when Razorpay must retry.
 */
export async function handleUpiQrWebhookEvent(event: any, actor: Actor): Promise<string> {
  const eventName: string = event?.event ?? "unknown";
  const qrEntity = event?.payload?.qr_code?.entity;
  const qrId: string | undefined = qrEntity?.id;
  if (!qrId) return "Acknowledged — no QR code in payload";

  const row = await prisma.upiQrPayment.findUnique({ where: { qrId } });
  if (!row) {
    console.log(`[upiQr] webhook ${eventName} for unknown qr=${qrId} — acknowledging`);
    return "Acknowledged — QR code not linked to a booking";
  }

  if (eventName === "qr_code.credited") {
    const entity = event?.payload?.payment?.entity;
    if (!entity?.id) return "Acknowledged — no payment in payload";
    const payment = toUpiQrPayment(entity);
    if (!isSettledGatewayPayment(payment)) {
      console.log(`[upiQr] webhook credited qr=${qrId} payment=${payment.id} status=${payment.status} — not settled yet`);
      return "Acknowledged — payment not captured";
    }
    const result = await settlePaidQr(row, payment, actor);
    console.log(`[upiQr] webhook credited qr=${qrId} payment=${payment.id} → ${result.outcome}`);
    if (result.outcome === "REFUND_REQUIRED") return `Acknowledged — refund required (${result.reason})`;
    return result.newlyConfirmed ? "Confirmed" : "Already confirmed";
  }

  if (eventName === "qr_code.closed") {
    if (row.status !== UPI_QR_STATUS.ACTIVE) return "Already resolved";
    // Closed after taking a payment whose credited event we haven't seen yet
    if (Number(qrEntity.payments_count_received ?? 0) > 0 || qrEntity.close_reason === "paid") {
      const payments = await fetchUpiQrPayments(qrId);
      if (payments === null) throw new Error(`[upiQr] cannot read payments of closed qr=${qrId} — retry`);
      const paid = payments.find(isSettledGatewayPayment);
      if (paid) {
        const result = await settlePaidQr(row, paid, actor);
        return result.outcome === "CONFIRMED" ? "Confirmed" : `Acknowledged — refund required (${result.reason})`;
      }
    }
    const status = qrEntity.close_reason === "on_demand" ? UPI_QR_STATUS.CLOSED : UPI_QR_STATUS.EXPIRED;
    await markIfActive(row.id, status);
    return `QR code ${status.toLowerCase()}`;
  }

  return "Acknowledged";
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation hooks (hold expiry, cancel, manager recheck)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Settles any captured QR payment on a booking hold and optionally closes the
 * open codes. Returns true when the booking ended up CONFIRMED by a QR payment.
 * Only touches holds that have QR rows, so it costs one query otherwise.
 *
 * - hold-expiry worker: `close: "EXPIRED"` — last chance before the hold lapses
 * - customer cancels the hold: `close: "CLOSED"`
 * - manager gateway recheck: no close (the customer may still be paying)
 */
export async function reconcileBookingUpiQrs(
  bookingId: number,
  opts: { close?: "CLOSED" | "EXPIRED" } = {},
): Promise<boolean> {
  const rows = await prisma.upiQrPayment.findMany({
    where: {
      bookingId,
      extensionId: null,
      status: { in: [UPI_QR_STATUS.ACTIVE, UPI_QR_STATUS.PAID] },
    },
    orderBy: { createdAt: "asc" },
  });
  let confirmed = false;
  for (const row of rows) {
    try {
      const state =
        row.status === UPI_QR_STATUS.ACTIVE && opts.close
          ? await closeRow(row, opts.close, SYSTEM_ACTOR)
          : await syncRow(row, SYSTEM_ACTOR, true);
      if (state?.outcome === "CONFIRMED") confirmed = true;
    } catch (err) {
      console.error(`[upiQr] reconcile failed qr=${row.qrId}:`, err);
    }
  }
  if (!confirmed) return false;
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { paymentStatus: true } });
  return booking?.paymentStatus === PaymentStatus.SUCCESS;
}

/**
 * For the order status poll of a booking hold: is the customer paying by UPI QR
 * instead? Syncs its QR codes (throttled) and settles a captured payment.
 * CONFIRMED — a QR payment confirmed the booking; OPEN — a QR is still payable
 * (keep the hold pending, never fail it); NONE — no QR in play.
 */
export async function bookingUpiQrState(bookingId: number, actor: Actor): Promise<"CONFIRMED" | "OPEN" | "NONE"> {
  const rows = await prisma.upiQrPayment.findMany({
    where: { bookingId, extensionId: null, status: { in: [UPI_QR_STATUS.ACTIVE, UPI_QR_STATUS.PAID] } },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length === 0) return "NONE";
  let open = false;
  for (const row of rows) {
    const state = await syncRow(row, actor);
    if (state.outcome === "CONFIRMED") {
      const b = await prisma.booking.findUnique({ where: { id: bookingId }, select: { paymentStatus: true } });
      if (b?.paymentStatus === PaymentStatus.SUCCESS) return "CONFIRMED";
    }
    if (state.outcome === "PENDING") open = true;
  }
  return open ? "OPEN" : "NONE";
}

/**
 * A checkout (Razorpay order) payment that lands after a UPI QR payment
 * already settled the same booking / extension is surplus: the customer paid
 * twice. Callers run this when the shared confirmation answered
 * "already confirmed". Detect-only, like every refund case: logged REFUND
 * REQUIRED and the branch manager + customer are notified (deduped per payment).
 */
export async function flagCheckoutPaymentAfterQr(params: {
  bookingId?: number;
  extensionId?: number;
  gatewayPaymentId: string | null | undefined;
}): Promise<boolean> {
  const { gatewayPaymentId } = params;
  if (!gatewayPaymentId || (params.bookingId === undefined && params.extensionId === undefined)) return false;
  const rows = await prisma.upiQrPayment.findMany({
    where: {
      ...(params.extensionId !== undefined
        ? { extensionId: params.extensionId }
        : { bookingId: params.bookingId, extensionId: null }),
      status: UPI_QR_STATUS.PAID,
      paymentId: { not: null },
    },
  });
  for (const row of rows) {
    if (!row.paymentId || row.paymentId === gatewayPaymentId) continue;
    const settledByQr =
      row.extensionId !== null
        ? await extensionPaidByPayment(row.extensionId, row.paymentId)
        : await bookingPaidByPayment(row.bookingId, row.paymentId);
    if (!settledByQr) continue;
    console.error(
      `[upiQr] REFUND REQUIRED checkout payment=${gatewayPaymentId} on booking=${row.bookingId} ` +
        `extension=${row.extensionId ?? "-"} — already paid by UPI QR payment=${row.paymentId}`,
    );
    void notifyEvents.upiQrPaymentNeedsRefund({
      bookingId: row.bookingId,
      extensionId: row.extensionId,
      paymentId: gatewayPaymentId,
      amountInPaise: toPaise(row.amount),
      reason: "DUPLICATE_PAYMENT",
      via: "CHECKOUT",
    });
    return true;
  }
  return false;
}

/**
 * Closes an extension's open QR codes before it is cancelled (customer, Fleet
 * or BM). `confirmed`: a captured QR payment confirmed the extension instead.
 * `unresolved`: a code could not be closed, or its payment could not be read,
 * because Razorpay was unreachable — it may still take money, so the caller
 * must not cancel over it.
 */
export async function closeExtensionUpiQrs(
  extensionId: number,
): Promise<{ confirmed: boolean; unresolved: boolean }> {
  const rows = await prisma.upiQrPayment.findMany({
    where: { extensionId, status: { in: [UPI_QR_STATUS.ACTIVE, UPI_QR_STATUS.PAID] } },
    orderBy: { createdAt: "asc" },
  });
  let confirmed = false;
  let unresolved = false;
  for (const row of rows) {
    try {
      const state =
        row.status === UPI_QR_STATUS.ACTIVE
          ? await closeRow(row, "CLOSED", SYSTEM_ACTOR)
          : await syncRow(row, SYSTEM_ACTOR, true);
      if (state?.outcome === "CONFIRMED") confirmed = true;
      else if (state === null || state.gatewayUnreachable) unresolved = true;
    } catch (err) {
      unresolved = true;
      console.error(`[upiQr] reconcile failed qr=${row.qrId}:`, err);
    }
  }
  return { confirmed, unresolved };
}

/** {@link closeExtensionUpiQrs}, answering only whether a QR payment confirmed the extension. */
export async function reconcileExtensionUpiQrs(extensionId: number): Promise<boolean> {
  return (await closeExtensionUpiQrs(extensionId)).confirmed;
}

/**
 * Run before an extension is cancelled. Throws 409 UPI_QR_ALREADY_PAID when a
 * QR payment confirmed it, and 502 GATEWAY_UNAVAILABLE when an open code could
 * not be closed (cancelling over it would leave a payable QR on a dead extension).
 */
export async function assertExtensionQrsClosedForCancel(extensionId: number): Promise<void> {
  const { confirmed, unresolved } = await closeExtensionUpiQrs(extensionId);
  if (confirmed) {
    throw new UpiQrError(409, "UPI_QR_ALREADY_PAID", "This extension was already paid by UPI QR and is confirmed.");
  }
  if (unresolved) {
    throw new UpiQrError(
      502,
      "GATEWAY_UNAVAILABLE",
      "We couldn't reach the payment gateway to close the UPI QR code for this extension. Please try again in a moment.",
    );
  }
}

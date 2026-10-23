/**
 * Void a payment (Oct 2026) — reverse a wrong entry. Rules and how it lands in
 * the money: payment-void-rules.ts.
 *
 *   GET  /api/{branchManager|admin|employee}/bookings/:publicId/payments
 *        the booking's payment history with each row's void state
 *   POST /api/{branchManager|admin|employee}/payments/:transactionPublicId/void  { reason }
 *
 * Scope: branch manager and Fleet Executive — their branch's bookings only (404
 * otherwise); admin — any branch.
 *
 * In one transaction: the per-booking refund lock (the one "Refund to customer",
 * the settlement deposit refund and the manual cancel take — always first, so
 * the lock order matches theirs), then its cash shift FOR SHARE (a shift close
 * can't snapshot the drawer half-way through the void; taken before the row, as
 * the close locks shift → rows), then the payment row FOR UPDATE (a second void
 * waits, then sees VOIDED → 409). The row becomes VOIDED
 * (never deleted); a voided refund's RefundRequest becomes VOIDED; a voided
 * deposit refund clears the booking's "deposit refunded" flag when no other
 * deposit refund is left. The booking status is never written. Audit log
 * CRITICAL with the actor's role.
 */
import type { Request } from "express";
import Decimal from "decimal.js";
import { prisma, AuditSeverity } from "@repo/database/client";
import type { Prisma, Role } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../staffActivity/staffActivity.service.js";
import { financialStateService } from "./financial-state.service.js";
import { LEGACY_DEPOSIT_REFUND_KEY_PREFIX } from "./safety-deposit.service.js";
import { syncLegacyReturnInvoice } from "../invoice-finalization.service.js";
import { isCashRefundOutsideShift, isCustomerRefundKey } from "../booking/customer-refund-rules.js";
import {
  PaymentVoidError,
  SHIFT_CLOSED_VOID_WARNING,
  VOID_FIELDS_SELECT,
  isRefundPurpose,
  pairedRefundRequest,
  parsePaymentVoidBody,
  voidEffectNote,
  voidRefusal,
  voidShiftClosed,
  voidView,
} from "./payment-void-rules.js";

type Db = Prisma.TransactionClient | typeof prisma;

/** Who is acting: a branch manager or Fleet Executive (their branch only) or an admin (any branch). */
export type PaymentStaffScope = { role: "MANAGER"; branchId: number } | { role: "STAFF"; branchId: number } | { role: "ADMIN" };

export function staffScopeFromRequest(req: Request, role: PaymentStaffScope["role"]): PaymentStaffScope {
  return role === "ADMIN" ? { role } : { role, branchId: req.branch_Id };
}

const branchWhere = (scope: PaymentStaffScope) => (scope.role === "ADMIN" ? {} : { branchId: scope.branchId });

async function requireActor(req: Request) {
  const actor = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, publicId: true, name: true, role: true, branchId: true },
  });
  if (!actor) throw new PaymentVoidError(StatusCode.UNAUTHORIZED, "UNAUTHORIZED", "User not found.");
  return actor;
}

/** Deposit refunds that set the booking's "deposit refunded" flag. */
const isDepositRefundKey = (key: string) => key.startsWith(LEGACY_DEPOSIT_REFUND_KEY_PREFIX) || (key.startsWith("pt:") && key.endsWith(":deposit-refund"));

/**
 * isDepositRefundKey, plus a drop bill's record-refund (`pt:<key>`, written
 * with its REFUND ledger line `<key>`), which sets the flag too when its
 * session is the drop (RETURN) bill.
 */
async function isDepositRefundRow(db: Db, key: string): Promise<boolean> {
  if (isDepositRefundKey(key)) return true;
  if (!key.startsWith("pt:")) return false;
  const line = await db.ledgerEntry.findUnique({
    where: { idempotencyKey: key.slice(3) },
    select: { entryType: true, session: { select: { sessionType: true } } },
  });
  return line?.entryType === "REFUND" && line.session.sessionType === "RETURN";
}

const TXN_SELECT = {
  id: true,
  publicId: true,
  idempotencyKey: true,
  bookingId: true,
  branchId: true,
  purpose: true,
  method: true,
  status: true,
  totalAmount: true,
  cashAmount: true,
  onlineAmount: true,
  onlineGateway: true,
  onlineTransactionRef: true,
  goodwillAmount: true,
  cashShiftId: true,
  notes: true,
  collectedAt: true,
  confirmedAt: true,
  rejectedAt: true,
  rejectionReason: true,
  createdAt: true,
  collectedBy: { select: { name: true } },
  confirmedBy: { select: { name: true } },
  cashShift: { select: { publicId: true, status: true } },
  ...VOID_FIELDS_SELECT,
} as const;

type TxnRow = Prisma.PaymentTransactionGetPayload<{ select: typeof TXN_SELECT }>;

/** One payment-history row with its void state (the shape every staff view shares). */
export function paymentHistoryRow(t: TxnRow) {
  return {
    publicId: t.publicId,
    purpose: t.purpose,
    method: t.method,
    status: t.status,
    isRefund: isRefundPurpose(t.purpose),
    isCustomerRefund: isCustomerRefundKey(t.idempotencyKey),
    cashOutsideShift: isCashRefundOutsideShift(t),
    totalAmount: new Decimal(t.totalAmount.toString()).toFixed(2),
    cashAmount: new Decimal(t.cashAmount.toString()).toFixed(2),
    onlineAmount: new Decimal(t.onlineAmount.toString()).toFixed(2),
    goodwillAmount: new Decimal(t.goodwillAmount.toString()).toFixed(2),
    onlineGateway: t.onlineGateway,
    onlineTransactionRef: t.onlineTransactionRef,
    collectedBy: t.collectedBy?.name ?? null,
    collectedAt: t.collectedAt?.toISOString() ?? null,
    confirmedBy: t.confirmedBy?.name ?? null,
    confirmedAt: t.confirmedAt?.toISOString() ?? null,
    rejectedAt: t.rejectedAt?.toISOString() ?? null,
    rejectionReason: t.rejectionReason,
    cashShift: t.cashShift ? { publicId: t.cashShift.publicId, status: t.cashShift.status } : null,
    notes: t.notes,
    createdAt: t.createdAt.toISOString(),
    ...voidView(t),
  };
}

// ── GET: the booking's payment history ───────────────────────────────────────

export async function listBookingPayments(req: Request, scope: PaymentStaffScope, bookingPublicId: string) {
  await requireActor(req);
  const booking = await prisma.booking.findFirst({
    where: { publicId: bookingPublicId, deletedAt: null, ...branchWhere(scope) },
    select: {
      id: true,
      publicId: true,
      status: true,
      branch: { select: { name: true } },
      customer: { select: { user: { select: { name: true, phone: true } } } },
    },
  });
  if (!booking) {
    throw new PaymentVoidError(
      StatusCode.NOT_FOUND,
      "BOOKING_NOT_FOUND",
      scope.role === "ADMIN" ? "Booking not found." : "Booking not found at your branch.",
    );
  }
  const [rows, state] = await Promise.all([
    prisma.paymentTransaction.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: "asc" }, select: TXN_SELECT }),
    financialStateService.getState(booking.id),
  ]);
  return {
    bookingPublicId: booking.publicId,
    status: booking.status,
    branch: { name: booking.branch.name },
    customer: { name: booking.customer.user.name, phone: booking.customer.user.phone },
    money: {
      totalOwed: state.totalOwed.toFixed(2),
      paid: state.totalCollectedConfirmed.toFixed(2),
      pending: state.totalCollectedPending.toFixed(2),
      refunded: state.totalRefunded.toFixed(2),
      amountDue: state.amountDue.toFixed(2),
      lifecycleState: state.lifecycleState,
    },
    transactions: rows.map(paymentHistoryRow),
  };
}

// ── POST: void one payment ───────────────────────────────────────────────────

export interface PaymentVoidResult {
  transactionPublicId: string;
  bookingPublicId: string;
  bookingStatus: string;
  purpose: string;
  method: string;
  amount: string;
  isRefund: boolean;
  reason: string;
  voidedAt: string;
  /** Its cash shift was already closed: counted cash won't change */
  shiftClosed: boolean;
  warning: string | null;
  cashShiftPublicId: string | null;
  /** A voided refund's RefundRequest, now VOIDED (null: none was written) */
  refundRequestPublicId: string | null;
  /** A voided deposit refund cleared the booking's "deposit refunded" flag */
  depositRefundReopened: boolean;
  /** Other rows of the same collection (same key stem) that stay counted */
  siblingRowsKept: number;
  effect: string;
  amountDueAfter: string;
}

export async function voidPayment(req: Request, scope: PaymentStaffScope, transactionPublicId: string): Promise<PaymentVoidResult> {
  const actor = await requireActor(req);
  const input = parsePaymentVoidBody(req.body);

  const found = await prisma.paymentTransaction.findFirst({
    where: { publicId: transactionPublicId, booking: { deletedAt: null, ...branchWhere(scope) } },
    select: { id: true, bookingId: true, cashShiftId: true, booking: { select: { publicId: true, status: true, branchId: true, branch: { select: { name: true } } } } },
  });
  if (!found) {
    throw new PaymentVoidError(
      StatusCode.NOT_FOUND,
      "PAYMENT_NOT_FOUND",
      scope.role === "ADMIN" ? "Payment not found." : "Payment not found at your branch.",
    );
  }
  const booking = found.booking;

  const outcome = await prisma.$transaction(
    async (tx) => {
      // Same lock order as the other refund writers: the booking's refund lock first
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"deposit-refund:" + found.bookingId}))`;
      // The shift FOR SHARE BEFORE the payment row: a shift close takes the shift
      // FOR UPDATE and then its payment rows FOR UPDATE, so locking the row first
      // and the shift second could deadlock with it.
      const lockShift = async (shiftId: number) =>
        (await tx.$queryRaw<{ status: string }[]>`
          SELECT "status"::text AS "status" FROM "CashShift" WHERE "id" = ${shiftId} FOR SHARE`)[0] ?? null;
      let shift: { status: string } | null = found.cashShiftId ? await lockShift(found.cashShiftId) : null;
      await tx.$queryRaw`SELECT "id" FROM "PaymentTransaction" WHERE "id" = ${found.id} FOR UPDATE`;
      const t = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: found.id }, select: TXN_SELECT });
      const refusal = voidRefusal(t);
      if (refusal) throw refusal;
      // Linked to a shift since the read above (only a stray COLLECTED row is ever re-linked)
      if (t.cashShiftId !== found.cashShiftId) shift = t.cashShiftId ? await lockShift(t.cashShiftId) : null;
      const shiftClosed = voidShiftClosed(t, shift);
      const now = new Date();

      const { count } = await tx.paymentTransaction.updateMany({
        where: { id: t.id, status: "CONFIRMED" },
        data: { status: "VOIDED", voidedAt: now, voidedById: actor.id, voidReason: input.reason, voidShiftClosed: shiftClosed },
      });
      if (count === 0) throw new PaymentVoidError(StatusCode.CONFLICT, "ALREADY_VOIDED", "This payment was already voided.");

      // A refund's RefundRequest goes with it (the period report counts COMPLETED ones)
      let refundRequestPublicId: string | null = null;
      if (isRefundPurpose(t.purpose)) {
        const requests = await tx.refundRequest.findMany({
          where: {
            bookingId: t.bookingId,
            status: { notIn: ["VOIDED", "REJECTED"] },
            createdAt: { gte: new Date(t.createdAt.getTime() - 10_000), lte: new Date(t.createdAt.getTime() + 10_000) },
          },
          select: { id: true, publicId: true, amount: true, status: true, reason: true, createdAt: true },
        });
        const paired = pairedRefundRequest(t, requests);
        if (paired) {
          await tx.refundRequest.update({ where: { id: paired.id }, data: { status: "VOIDED" } });
          refundRequestPublicId = paired.publicId;
        }
      }

      // A voided deposit refund: the deposit is waiting to be refunded again
      let depositRefundReopened = false;
      if (isRefundPurpose(t.purpose) && (await isDepositRefundRow(tx, t.idempotencyKey))) {
        const others = await tx.paymentTransaction.findMany({
          where: { bookingId: t.bookingId, status: { in: ["COLLECTED", "CONFIRMED"] }, purpose: { in: ["OVERPAYMENT_REFUND", "CANCELLATION_REFUND"] } },
          select: { idempotencyKey: true },
        });
        let otherLeft = false;
        for (const o of others) {
          if (await isDepositRefundRow(tx, o.idempotencyKey)) {
            otherLeft = true;
            break;
          }
        }
        if (!otherLeft) {
          const r = await tx.booking.updateMany({
            where: { id: t.bookingId, safetyDepositRefunded: true },
            data: { safetyDepositRefunded: false, safetyDepositRefundedAt: null },
          });
          depositRefundReopened = r.count > 0;
        }
      }

      // Rows written by the same collection (key stem `pt:<key>` + `:deposit`, …) stay counted
      const stem = t.idempotencyKey.startsWith("pt:") ? t.idempotencyKey.split(":").slice(0, 2).join(":") : null;
      const siblingRowsKept = stem
        ? await tx.paymentTransaction.count({
            where: { bookingId: t.bookingId, id: { not: t.id }, status: { in: ["COLLECTED", "CONFIRMED"] }, OR: [{ idempotencyKey: stem }, { idempotencyKey: { startsWith: stem + ":" } }] },
          })
        : 0;

      const amount = new Decimal(t.totalAmount.toString()).toFixed(2);
      const effect = voidEffectNote(t);
      const kind = isRefundPurpose(t.purpose) ? "Refund" : "Payment";
      await auditService.log(
        {
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role as Role,
          actorBranchId: actor.branchId ?? undefined,
          action: "PAYMENT_VOIDED",
          category: AuditCategory.PAYMENT,
          severity: AuditSeverity.CRITICAL,
          description:
            `${kind} ₹${amount} [${t.purpose}] via ${t.method} voided on booking ${booking.publicId} by ${actor.role}. Reason: ${input.reason}. ${effect}` +
            (shiftClosed ? ` ${SHIFT_CLOSED_VOID_WARNING}.` : ""),
          entity: "PaymentTransaction",
          entityId: t.publicId,
          entityLabel: booking.publicId,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          before: { status: "CONFIRMED" },
          after: { status: "VOIDED", voidReason: input.reason },
          metadata: {
            bookingPublicId: booking.publicId,
            bookingStatus: booking.status,
            purpose: t.purpose,
            method: t.method,
            amount,
            cashAmount: new Decimal(t.cashAmount.toString()).toFixed(2),
            onlineAmount: new Decimal(t.onlineAmount.toString()).toFixed(2),
            goodwillAmount: new Decimal(t.goodwillAmount.toString()).toFixed(2),
            isCustomerRefund: isCustomerRefundKey(t.idempotencyKey),
            reason: input.reason,
            cashShiftPublicId: t.cashShift?.publicId ?? null,
            shiftClosed,
            refundRequestPublicId,
            depositRefundReopened,
            siblingRowsKept,
            role: actor.role,
            scope: scope.role,
          },
        },
        tx,
      );

      return {
        t,
        result: {
          transactionPublicId: t.publicId,
          bookingPublicId: booking.publicId,
          bookingStatus: booking.status,
          purpose: t.purpose,
          method: t.method,
          amount,
          isRefund: isRefundPurpose(t.purpose),
          reason: input.reason,
          voidedAt: now.toISOString(),
          shiftClosed,
          warning: shiftClosed ? SHIFT_CLOSED_VOID_WARNING : null,
          cashShiftPublicId: t.cashShift?.publicId ?? null,
          refundRequestPublicId,
          depositRefundReopened,
          siblingRowsKept,
          effect,
          amountDueAfter: "0.00",
        } satisfies PaymentVoidResult,
      };
    },
    { timeout: 15000 },
  );

  const { result } = outcome;
  try {
    result.amountDueAfter = (await financialStateService.getState(found.bookingId)).amountDue.toFixed(2);
  } catch {
    // informational only
  }

  const activity = {
    actionType: StaffActionType.CANCELLED,
    entityType: StaffEntityType.PAYMENT_TRANSACTION,
    entityRef: result.transactionPublicId,
    description:
      `${result.isRefund ? "Refund" : "Payment"} ₹${result.amount} voided on booking ${result.bookingPublicId}: ${result.reason}` +
      (result.shiftClosed ? ` (${SHIFT_CLOSED_VOID_WARNING})` : ""),
    metadata: { bookingPublicId: result.bookingPublicId, amount: result.amount, purpose: result.purpose, shiftClosed: result.shiftClosed },
  };
  if (scope.role === "ADMIN") {
    await staffActivityService
      .log({
        actorPublicId: actor.publicId,
        actorName: actor.name,
        actorRole: actor.role as Role,
        branchId: booking.branchId,
        branchName: booking.branch.name,
        ...activity,
      })
      .catch(() => {});
  } else {
    await staffActivityService.logFromRequest(req, activity);
  }

  // A legacy returned booking's invoice follows its settlement (PAID or not)
  if (booking.status === "RETURNED") {
    syncLegacyReturnInvoice(found.bookingId).catch((err) => console.error("[payment-void] Invoice sync failed:", err));
  }

  return result;
}

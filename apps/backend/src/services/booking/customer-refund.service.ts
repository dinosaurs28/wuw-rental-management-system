/**
 * "Refund to customer" (Oct 2026) — the branch manager (own branch) or an admin
 * pays money back to the customer on any booking, in any status, at any time,
 * with no cap. Rules and how it lands in the money: customer-refund-rules.ts.
 *
 *   GET  /api/branchManager/bookings/:publicId/refund-to-customer   what the dialog needs
 *   POST /api/branchManager/bookings/:publicId/refund-to-customer
 *        { amount, method: CASH | UPI | BANK_TRANSFER, reason, reference?, proofFileId?,
 *          confirmOverReceived?, requestId? }
 *   (the same two under /api/admin/bookings/:publicId/refund-to-customer, any branch)
 *
 * In one transaction under the per-booking refund lock the settlement refunds and
 * the manual cancel take: reads what the booking owes
 * and what it was paid, splits the refund (owed back → plain refund, beyond →
 * goodwill), writes the OVERPAYMENT_REFUND PaymentTransaction (CONFIRMED, cash
 * linked to the actor's open shift if any) and a COMPLETED RefundRequest, and the
 * audit log. The booking itself (status included) is never written.
 * After commit: staff activity, the customer's "Refund processed" notification,
 * and a legacy returned booking's invoice re-sync (as the settlement refunds do).
 *
 * Errors: HTTP 4xx { success:false, code, message, ...extra } (CustomerRefundError,
 * or CounterGuardError for a bad proof photo).
 */
import type { Request } from "express";
import Decimal from "decimal.js";
import { prisma, PaymentPurpose, AuditSeverity } from "@repo/database/client";
import type { Prisma, Role } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { createID } from "../../utils/nanoID.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../staffActivity/staffActivity.service.js";
import { notifyEvents } from "../notification/notification.events.js";
import { computeBookingOwed, creditOutstanding, getBookingMoney } from "../payment/booking-owed.service.js";
import { getBookingCreditSummary } from "../payment/customer-credit.service.js";
import { depositToRefund } from "../payment/settlement-engine.service.js";
import { claimPaymentProof, proofPhotosCreate, resolvePaymentProof } from "../payment/payment-proof.service.js";
import { syncLegacyReturnInvoice } from "../invoice-finalization.service.js";
import {
  CUSTOMER_REFUND_KEY_PREFIX,
  CUSTOMER_REFUND_METHODS,
  CUSTOMER_REFUND_METHOD_LABELS,
  CUSTOMER_REFUND_REASON_MAX,
  CUSTOMER_REFUND_REASON_MIN,
  CUSTOMER_REFUND_REFERENCE_MAX,
  CustomerRefundError,
  cashShiftLink,
  customerRefundKey,
  customerRefundNote,
  customerRefundRecord,
  isCashRefundOutsideShift,
  netReceived,
  overReceivedBy,
  overReceivedRefusal,
  owedBack,
  parseCustomerRefundBody,
  splitCustomerRefund,
  type CustomerRefundMethod,
} from "./customer-refund-rules.js";

type Db = Prisma.TransactionClient | typeof prisma;

/** Who is refunding: a branch manager (their branch only) or an admin (any branch). */
export type CustomerRefundScope = { role: "MANAGER"; branchId: number } | { role: "ADMIN" };

export function scopeFromRequest(req: Request, role: "MANAGER" | "ADMIN"): CustomerRefundScope {
  return role === "MANAGER" ? { role, branchId: req.branch_Id } : { role };
}

async function loadBooking(bookingPublicId: string, scope: CustomerRefundScope, db: Db = prisma) {
  return db.booking.findFirst({
    where: {
      publicId: bookingPublicId,
      deletedAt: null,
      ...(scope.role === "MANAGER" ? { branchId: scope.branchId } : {}),
    },
    select: {
      id: true,
      publicId: true,
      status: true,
      branchId: true,
      startAt: true,
      endAt: true,
      branch: { select: { name: true } },
      customer: { select: { user: { select: { name: true, phone: true } } } },
      items: { orderBy: { id: "asc" }, select: { vehicle: { select: { make: true, model: true, regNo: true } } } },
    },
  });
}

async function requireBooking(bookingPublicId: string, scope: CustomerRefundScope, db: Db = prisma) {
  const booking = await loadBooking(bookingPublicId, scope, db);
  if (!booking) {
    throw new CustomerRefundError(
      StatusCode.NOT_FOUND,
      "BOOKING_NOT_FOUND",
      scope.role === "MANAGER" ? "Booking not found at your branch." : "Booking not found.",
    );
  }
  return booking;
}

async function requireActor(req: Request) {
  const actor = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, publicId: true, name: true, role: true, branchId: true },
  });
  if (!actor) throw new CustomerRefundError(StatusCode.UNAUTHORIZED, "UNAUTHORIZED", "User not found.");
  return actor;
}

/**
 * The booking's money as the refund reads it: what it owes the customer back
 * (paid beyond what it owes), net money received, and the safety deposit.
 */
async function readMoney(bookingId: number, db: Db = prisma) {
  const [owed, money, credit] = await Promise.all([
    computeBookingOwed(bookingId, db),
    getBookingMoney(bookingId, db),
    getBookingCreditSummary(bookingId, db),
  ]);
  // As Settlements: an edit's difference still open is settled on its own session
  const netPayable = owed.totalOwed.sub(money.netConfirmed).sub(owed.adjustmentPending);
  const creditPending = creditOutstanding(owed, money.netConfirmed, credit?.pending ?? new Decimal(0));
  return {
    owed,
    money,
    netPayable,
    owedBack: owedBack(netPayable),
    received: netReceived(money.confirmed, money.refundedOut),
    // A legacy drop's deposit refund still to do in Settlements (marks it refunded there)
    depositToRefund: depositToRefund(owed, netPayable, creditPending),
  };
}

/** The actor's open cash shift (a cash refund comes out of their drawer), or null. */
async function openCashShift(userId: number, db: Db) {
  return db.cashShift.findFirst({ where: { employeeId: userId, status: "OPEN" }, select: { id: true, publicId: true } });
}

/**
 * The booking's "Refund to customer" rows, newest first — the booking money
 * history the staff views show (the completed pickup / drop summaries too).
 */
export async function listCustomerRefunds(bookingId: number, db: Db = prisma) {
  const rows = await db.paymentTransaction.findMany({
    where: { bookingId, idempotencyKey: { startsWith: CUSTOMER_REFUND_KEY_PREFIX } },
    orderBy: { createdAt: "desc" },
    select: {
      publicId: true,
      purpose: true,
      method: true,
      totalAmount: true,
      cashAmount: true,
      goodwillAmount: true,
      onlineGateway: true,
      onlineTransactionRef: true,
      cashShiftId: true,
      notes: true,
      createdAt: true,
      collectedBy: { select: { name: true } },
    },
  });
  return rows.map((t) => ({
    publicId: t.publicId,
    amount: new Decimal(t.totalAmount.toString()).toFixed(2),
    goodwillAmount: new Decimal(t.goodwillAmount.toString()).toFixed(2),
    method: t.method,
    onlineGateway: t.onlineGateway,
    reference: t.onlineTransactionRef,
    cashOutsideShift: isCashRefundOutsideShift(t),
    notes: t.notes,
    by: t.collectedBy?.name ?? null,
    at: t.createdAt.toISOString(),
  }));
}

// ── GET: what the dialog needs ───────────────────────────────────────────────

export async function getCustomerRefundOptions(req: Request, scope: CustomerRefundScope, bookingPublicId: string) {
  const actor = await requireActor(req);
  const booking = await requireBooking(bookingPublicId, scope);
  const [m, shift, refunds] = await Promise.all([
    readMoney(booking.id),
    openCashShift(actor.id, prisma),
    listCustomerRefunds(booking.id),
  ]);
  return {
    bookingPublicId: booking.publicId,
    status: booking.status,
    branch: { name: booking.branch.name },
    startAt: booking.startAt.toISOString(),
    endAt: booking.endAt.toISOString(),
    customer: { name: booking.customer.user.name, phone: booking.customer.user.phone },
    vehicles: booking.items.map((i) => ({ make: i.vehicle.make, model: i.vehicle.model, regNo: i.vehicle.regNo })),
    money: {
      /** Confirmed money in (refund rows excluded) */
      paid: m.money.confirmed.toFixed(2),
      /** Refunds already paid out */
      refunded: m.money.refundedOut.toFixed(2),
      /** paid − refunded: refunding more than this needs the confirmation tick */
      netReceived: m.received.toFixed(2),
      /** Cash collected and still awaiting the manager's confirmation (not counted as received) */
      pendingCash: m.money.pending.toFixed(2),
      /** What the booking owes the customer back now (paid beyond what it owes) — refunded first */
      owedBack: m.owedBack.toFixed(2),
      /** What the customer still owes (unchanged by a refund) */
      amountDue: Decimal.max(0, m.netPayable).toFixed(2),
      /** Refundable safety deposit held — paid back on the drop bill */
      safetyDepositHeld: m.owed.safetyDepositHeld.toFixed(2),
      /** Legacy drop: deposit still to refund in Settlements (refund it there to mark it refunded) */
      depositToRefund: m.depositToRefund.toFixed(2),
    },
    /** A cash refund is recorded against this shift; without one it is recorded outside a shift */
    cashShiftOpen: shift !== null,
    methods: CUSTOMER_REFUND_METHODS.map((value) => ({ value, label: CUSTOMER_REFUND_METHOD_LABELS[value] })),
    /** Payment-proof photos are uploaded through the branch manager's portal */
    proofPhotoSupported: scope.role === "MANAGER",
    limits: {
      reasonMin: CUSTOMER_REFUND_REASON_MIN,
      reasonMax: CUSTOMER_REFUND_REASON_MAX,
      referenceMax: CUSTOMER_REFUND_REFERENCE_MAX,
    },
    refunds,
  };
}

// ── POST: record the refund ──────────────────────────────────────────────────

export interface CustomerRefundResult {
  paymentTransactionPublicId: string;
  refundRequestPublicId: string;
  bookingPublicId: string;
  bookingStatus: string;
  amount: string;
  method: CustomerRefundMethod;
  methodLabel: string;
  /** Part that paid back money the booking owed the customer */
  coveredAmount: string;
  /** Part beyond it (goodwill) — also taken off what the booking owes */
  goodwillAmount: string;
  /** Net money received before this refund */
  netReceivedBefore: string;
  /** How far it went beyond the money received (confirmed by the actor); "0.00" when it didn't */
  overReceivedBy: string;
  /** Cash: the shift it was recorded against (null: no shift open — outside a shift) */
  cashShiftPublicId: string | null;
  cashOutsideShift: boolean;
  reference: string | null;
  proofFileId: string | null;
  reason: string;
  refundedAt: string;
}

export async function recordCustomerRefund(
  req: Request,
  scope: CustomerRefundScope,
  bookingPublicId: string,
): Promise<CustomerRefundResult> {
  const actor = await requireActor(req);
  const booking = await requireBooking(bookingPublicId, scope);
  const input = parseCustomerRefundBody(req.body);
  // The photo must be one uploaded in the booking's branch and not backing another payment
  const proof = input.proofFileId ? await resolvePaymentProof(input.proofFileId, booking.branchId) : null;
  const requestId = input.requestId ?? createID();
  const record = customerRefundRecord(input.method);
  const methodLabel = CUSTOMER_REFUND_METHOD_LABELS[input.method];

  let outcome: { result: CustomerRefundResult; refundRequestId: number };
  try {
    outcome = await prisma.$transaction(
      async (tx) => {
        // One refund at a time per booking (the lock the settlement refunds and the manual
        // cancel take). The booking row is never written, so its row lock isn't taken —
        // that would invert the lock order of the settlement deposit refund.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"deposit-refund:" + booking.id}))`;

        const locked = await requireBooking(bookingPublicId, scope, tx);
        const m = await readMoney(locked.id, tx);
        const refusal = overReceivedRefusal(input.amount, m.received, input.confirmOverReceived);
        if (refusal) throw refusal;
        const { covered, goodwill } = splitCustomerRefund(input.amount, m.owedBack);
        const overBy = overReceivedBy(input.amount, m.received);

        if (proof) await claimPaymentProof(proof, tx);
        const link = cashShiftLink(input.method, record.method === "CASH" ? await openCashShift(actor.id, tx) : null);
        const cashOutsideShift = link.cashOutsideShift;
        const now = new Date();
        const amount = input.amount.toFixed(2);
        const note = customerRefundNote(input, cashOutsideShift);

        const txn = await tx.paymentTransaction.create({
          data: {
            publicId: createID(),
            idempotencyKey: customerRefundKey(locked.publicId, requestId),
            bookingId: locked.id,
            branchId: locked.branchId,
            purpose: PaymentPurpose.OVERPAYMENT_REFUND,
            method: record.method,
            status: "CONFIRMED",
            totalAmount: amount,
            cashAmount: record.method === "CASH" ? amount : "0.00",
            onlineAmount: record.method === "CASH" ? "0.00" : amount,
            onlineGateway: record.onlineGateway,
            onlineTransactionRef: input.reference,
            proofFileId: proof?.id ?? null,
            proofPhotos: proofPhotosCreate(proof ? [proof] : null),
            goodwillAmount: goodwill.toFixed(2),
            collectedById: actor.id,
            collectedAt: now,
            confirmedById: actor.id,
            confirmedAt: now,
            cashShiftId: link.cashShiftId,
            notes: note,
          },
          select: { publicId: true },
        });
        // Paid out now by the actor: approved and completed at once (the period report counts these)
        const request = await tx.refundRequest.create({
          data: {
            publicId: createID(),
            bookingId: locked.id,
            branchId: locked.branchId,
            amount,
            reason: note,
            method: record.method,
            status: "COMPLETED",
            requestedById: actor.id,
            approvedById: actor.id,
            approvedAt: now,
            completedById: actor.id,
            completedAt: now,
            onlineTransactionRef: input.reference,
          },
          select: { id: true, publicId: true },
        });

        const out: CustomerRefundResult = {
          paymentTransactionPublicId: txn.publicId,
          refundRequestPublicId: request.publicId,
          bookingPublicId: locked.publicId,
          bookingStatus: locked.status,
          amount,
          method: input.method,
          methodLabel,
          coveredAmount: covered.toFixed(2),
          goodwillAmount: goodwill.toFixed(2),
          netReceivedBefore: m.received.toFixed(2),
          overReceivedBy: overBy.toFixed(2),
          cashShiftPublicId: link.cashShiftPublicId,
          cashOutsideShift,
          reference: input.reference,
          proofFileId: proof?.publicId ?? null,
          reason: input.reason,
          refundedAt: now.toISOString(),
        };

        await auditService.log(
          {
            actorId: actor.id,
            actorName: actor.name,
            actorRole: actor.role as Role,
            actorBranchId: actor.branchId ?? undefined,
            action: "CUSTOMER_REFUND_RECORDED",
            category: AuditCategory.PAYMENT,
            severity: overBy.gt(0) ? AuditSeverity.CRITICAL : AuditSeverity.WARNING,
            description:
              `₹${amount} refunded to the customer (${methodLabel}) on booking ${locked.publicId} (${locked.status}). Reason: ${input.reason}` +
              (input.reference ? ` Ref ${input.reference}.` : "") +
              (cashOutsideShift ? " Cash paid out with no cash shift open." : "") +
              (overBy.gt(0) ? ` ₹${overBy.toFixed(2)} more than the money received (confirmed).` : "") +
              (goodwill.gt(0) ? ` Goodwill beyond what was owed back: ₹${goodwill.toFixed(2)}.` : ""),
            entity: "PaymentTransaction",
            entityId: txn.publicId,
            entityLabel: locked.publicId,
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"],
            metadata: {
              bookingPublicId: locked.publicId,
              bookingStatus: locked.status,
              amount,
              method: input.method,
              reason: input.reason,
              reference: input.reference,
              proofFileId: proof?.publicId ?? null,
              coveredAmount: out.coveredAmount,
              goodwillAmount: out.goodwillAmount,
              netReceivedBefore: out.netReceivedBefore,
              overReceivedBy: out.overReceivedBy,
              overReceivedConfirmed: input.confirmOverReceived,
              cashShiftPublicId: out.cashShiftPublicId,
              cashOutsideShift,
              refundRequestPublicId: request.publicId,
              scope: scope.role,
            },
          },
          tx,
        );

        return { result: out, refundRequestId: request.id };
      },
      { timeout: 15000 },
    );
  } catch (err: any) {
    if (err?.code === "P2002" && String(err?.meta?.target ?? "").includes("idempotencyKey")) {
      throw new CustomerRefundError(
        StatusCode.CONFLICT,
        "DUPLICATE_REFUND",
        "This refund was already recorded. Refresh to see it in the booking's payments.",
      );
    }
    throw err;
  }

  const { result, refundRequestId } = outcome;

  const activity = {
    actionType: StaffActionType.REFUNDED,
    entityType: StaffEntityType.BOOKING,
    entityRef: result.bookingPublicId,
    description: `₹${result.amount} refunded to the customer (${result.methodLabel})${result.cashOutsideShift ? " — no cash shift open" : ""}: ${result.reason}`,
    metadata: {
      amount: result.amount,
      method: result.method,
      reference: result.reference,
      goodwillAmount: result.goodwillAmount,
      overReceivedBy: result.overReceivedBy,
      cashOutsideShift: result.cashOutsideShift,
    },
  };
  if (scope.role === "MANAGER") {
    await staffActivityService.logFromRequest(req, activity);
  } else {
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
  }

  void notifyEvents.refundCompleted({ refundRequestId, actorUserId: actor.id });
  if (booking.status === "RETURNED") {
    syncLegacyReturnInvoice(booking.id).catch((err) => console.error("[customer-refund] Invoice sync failed:", err));
  }

  return result;
}

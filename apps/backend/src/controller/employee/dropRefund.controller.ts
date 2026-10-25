/**
 * Fleet Executive refund at the drop (Oct 25 2026, client: "Refund during drop
 * should be given to fleet members").
 *
 * Unified Payments branches already refund on the drop bill (paymentSession
 * record-refund / the payment's depositRefund). These endpoints cover what is
 * owed back once the drop is recorded and NOT on a drop bill — a legacy drop
 * (no Unified Payments: the deposit choice SET_OFF / REFUND_IN_FULL is recorded
 * at the drop and used to wait for the branch manager's Pending Settlements), a
 * drop bill whose refund was sent to the manager ("Refund later"), or money paid
 * beyond what the booking owes:
 *
 *   GET  /api/employee/bookings/:publicId/drop-refund   what is owed back now
 *   POST /api/employee/bookings/:publicId/drop-refund
 *        { method: CASH | UPI | BANK_TRANSFER, amount?, proof_file_id?, notes? }
 *
 * Same money rules as the branch manager's settlement refunds (depositToRefund +
 * overpaymentToRefund, settlement-engine.service.ts): one OVERPAYMENT_REFUND
 * PaymentTransaction — key `sdr:` when a legacy deposit choice is being paid back
 * (so computeBookingOwed counts the deposit as credited), `ovr:` otherwise — plus
 * a RefundRequest (cash: PENDING_APPROVAL for the manager's acknowledgement, as
 * every Fleet refund; UPI / bank: APPROVED). It lands in the executive's open
 * shift (lockShiftForPayment FIRST, so the lock order is shift → booking refund
 * lock; SHIFT_REQUIRED without one): a cash refund lowers the shift's expected
 * cash. UPI / bank need the payment-success photo (REFUND_PROOF_REQUIRED).
 * Marks the deposit refunded once nothing is left owed back.
 *
 * Allowed once the drop is recorded: RETURNED, or a legacy drop awaiting the
 * manager's confirmation (PICKED_UP + requiresManagerConfirmation). A SET_OFF
 * deposit with a drop damage still awaiting review stays with the manager
 * (the damage may still be charged against it). Skipping it ("Refund later")
 * needs no call: what is owed back stays in Pending Settlements.
 */
import { Request, Response } from "express";
import { z } from "zod";
import Decimal from "decimal.js";
import { prisma, PaymentPurpose } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { createID } from "../../utils/nanoID.js";
import { computeBookingOwed, creditOutstanding, getBookingMoney } from "../../services/payment/booking-owed.service.js";
import { getBookingCreditSummary } from "../../services/payment/customer-credit.service.js";
import { depositToRefund, overpaymentToRefund } from "../../services/payment/settlement-engine.service.js";
import { LEGACY_DEPOSIT_REFUND_KEY_PREFIX } from "../../services/payment/safety-deposit.service.js";
import { CounterGuardError, assertOpenShift, lockShiftForPayment } from "../../services/payment/counter-guard.service.js";
import { claimPaymentProof, proofPhotosCreate, resolvePaymentProof } from "../../services/payment/payment-proof.service.js";
import { refundProofRefusal } from "../../services/payment/refund-proof-rules.js";
import { syncLegacyReturnInvoice } from "../../services/invoice-finalization.service.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
import { isDropDamage } from "../../services/damage/drop-damage.service.js";
import type { Prisma } from "@repo/database/client";

type Db = Prisma.TransactionClient | typeof prisma;

/** idempotencyKey prefix of an over-payment refund (shared with the BM's refund-overpayment). */
const OVERPAYMENT_REFUND_KEY_PREFIX = "ovr:";

const dropRefundSchema = z.object({
  method: z.enum(["CASH", "UPI", "BANK_TRANSFER"]),
  // Defaults to everything owed back
  amount: z.number().positive().optional(),
  proof_file_id: z.string().trim().min(1).max(64).optional(),
  notes: z.string().max(500).optional(),
});

class DropRefundRejection extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(String(body.message));
  }
}

const reject = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  new DropRefundRejection(status, { success: false, code, message, ...extra });

async function loadBooking(publicId: string, branchId: number, db: Db = prisma) {
  return db.booking.findFirst({
    where: { publicId, branchId, deletedAt: null },
    select: {
      id: true,
      publicId: true,
      branchId: true,
      status: true,
      requiresManagerConfirmation: true,
      safetyDepositRefunded: true,
    },
  });
}

type DropBooking = NonNullable<Awaited<ReturnType<typeof loadBooking>>>;

/** The drop is recorded: returned, or a legacy drop waiting for the manager's confirmation. */
function dropRecorded(b: Pick<DropBooking, "status" | "requiresManagerConfirmation">): boolean {
  return b.status === "RETURNED" || (b.status === "PICKED_UP" && b.requiresManagerConfirmation);
}

/** What the booking owes the customer back now, as the BM's settlement computes it. */
async function owedBackNow(bookingId: number, db: Db) {
  const [owed, money, credit, damages] = await Promise.all([
    computeBookingOwed(bookingId, db as any),
    getBookingMoney(bookingId, db as any),
    getBookingCreditSummary(bookingId, db as any),
    db.damageReport.findMany({ where: { bookingId, status: "PENDING" }, select: { notes: true } }),
  ]);
  const netPayable = owed.totalOwed.sub(money.netConfirmed).sub(owed.adjustmentPending);
  const creditPending = creditOutstanding(owed, money.netConfirmed, credit?.pending ?? new Decimal(0));
  const deposit = depositToRefund(owed, netPayable, creditPending);
  const overpaid = overpaymentToRefund(owed, netPayable, deposit);
  return {
    owed,
    money,
    deposit,
    overpaid,
    total: deposit.add(overpaid).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    pendingDropDamage: damages.some((d) => isDropDamage(d.notes)),
  };
}

/** Why the executive can't refund it now (the manager settles it), or null. */
function refusalFor(b: DropBooking, m: Awaited<ReturnType<typeof owedBackNow>>): DropRefundRejection | null {
  if (!dropRecorded(b)) {
    return reject(StatusCode.CONFLICT, "DROP_NOT_RECORDED", "Record the drop first — the refund is worked out from it.");
  }
  if (m.money.pending.gt(0)) {
    return reject(
      StatusCode.CONFLICT,
      "CASH_AWAITING_CONFIRMATION",
      "Cash on this booking is still awaiting the branch manager's confirmation — the branch manager settles the refund.",
    );
  }
  // Same guard as the BM's refund-deposit: marked refunded outside Settlements (the
  // old Return Review flag) with no deposit refund recorded — paying it would refund it twice
  if (b.safetyDepositRefunded && m.owed.safetyDepositHandling && m.owed.legacyDepositRefunded.lte(0) && m.deposit.gt(0)) {
    return reject(
      StatusCode.CONFLICT,
      "DEPOSIT_ALREADY_REFUNDED",
      "This safety deposit was already marked as refunded to the customer — the branch manager settles what is left.",
    );
  }
  if (m.owed.safetyDepositHandling === "SET_OFF" && m.pendingDropDamage && m.deposit.gt(0)) {
    return reject(
      StatusCode.CONFLICT,
      "DAMAGE_REVIEW_PENDING",
      "A damage recorded at this drop is waiting for the branch manager's review and may be charged against the deposit — the branch manager settles the deposit.",
    );
  }
  if (m.total.lte(0)) {
    return reject(StatusCode.BAD_REQUEST, "NOTHING_TO_REFUND", "Nothing is owed back to the customer on this booking.");
  }
  return null;
}

// GET /api/employee/bookings/:publicId/drop-refund
export const GetDropRefund = async (req: Request, res: Response) => {
  try {
    const booking = await loadBooking(req.params.publicId!, req.branch_Id);
    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ success: false, code: "BOOKING_NOT_FOUND", message: "Booking not found at your branch." });
    }
    const m = await owedBackNow(booking.id, prisma);
    const refusal = refusalFor(booking, m);
    const actor = await prisma.user.findUnique({ where: { publicId: req.public_Id }, select: { id: true } });
    const shift = actor
      ? await prisma.cashShift.findFirst({ where: { employeeId: actor.id, status: "OPEN" }, select: { publicId: true } })
      : null;
    return res.status(StatusCode.OK).json({
      success: true,
      data: {
        bookingPublicId: booking.publicId,
        bookingStatus: booking.status,
        /** Everything owed back now (deposit + paid beyond what is owed) */
        owedBack: m.total.toFixed(2),
        depositToRefund: m.deposit.toFixed(2),
        overpaidToRefund: m.overpaid.toFixed(2),
        safetyDepositHandling: m.owed.safetyDepositHandling,
        /** The executive can refund it now; otherwise blockedCode / blockedReason say why */
        canRefund: refusal === null,
        blockedCode: refusal ? refusal.body.code : null,
        blockedReason: refusal ? refusal.body.message : null,
        cashShiftOpen: shift !== null,
        methods: [
          { value: "CASH", label: "Cash" },
          { value: "UPI", label: "UPI" },
          { value: "BANK_TRANSFER", label: "Bank transfer" },
        ],
        /** The payment-success photo is required for these */
        proofRequiredMethods: ["UPI", "BANK_TRANSFER"],
      },
    });
  } catch (err) {
    console.error("GetDropRefund Error:", err);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
  }
};

// POST /api/employee/bookings/:publicId/drop-refund
export const RecordDropRefund = async (req: Request, res: Response) => {
  try {
    const validation = dropRefundSchema.safeParse(req.body ?? {});
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "VALIDATION_FAILED",
        message: validation.error.issues[0]?.message ?? "Invalid input",
        errors: validation.error.format(),
      });
    }
    const { method, notes } = validation.data;
    const noProof = refundProofRefusal(method, !!validation.data.proof_file_id, { field: "proof_file_id" });
    if (noProof) throw new CounterGuardError(noProof.status, noProof.code, noProof.message, { field: noProof.field });

    const actor = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, name: true, role: true, branchId: true },
    });
    if (!actor) return res.status(StatusCode.UNAUTHORIZED).json({ success: false, code: "UNAUTHORIZED", message: "User not found." });
    const booking = await loadBooking(req.params.publicId!, req.branch_Id);
    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ success: false, code: "BOOKING_NOT_FOUND", message: "Booking not found at your branch." });
    }
    // Every refund a Fleet Executive pays out is in their open shift
    await assertOpenShift(actor);
    const isCash = method === "CASH";
    const proof = isCash ? null : await resolvePaymentProof(validation.data.proof_file_id, booking.branchId);

    const result = await prisma.$transaction(async (tx) => {
      // Shift first (FOR SHARE — never a shift being closed), then the per-booking refund lock
      const shift = await lockShiftForPayment(tx, actor);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"deposit-refund:" + booking.id}))`;

      const locked = await loadBooking(booking.publicId, booking.branchId, tx);
      if (!locked) throw reject(StatusCode.NOT_FOUND, "BOOKING_NOT_FOUND", "Booking not found at your branch.");
      const m = await owedBackNow(locked.id, tx);
      const refusal = refusalFor(locked, m);
      if (refusal) throw refusal;
      const amount = validation.data.amount != null
        ? new Decimal(validation.data.amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        : m.total;
      if (amount.lte(0)) {
        throw reject(StatusCode.BAD_REQUEST, "VALIDATION_FAILED", "Enter a refund amount of at least ₹0.01.");
      }
      if (amount.gt(m.total)) {
        throw reject(StatusCode.BAD_REQUEST, "REFUND_EXCEEDS_OWED", `Only ₹${m.total.toFixed(2)} is owed back to the customer.`, {
          owedBack: m.total.toFixed(2),
        });
      }

      if (proof) await claimPaymentProof(proof, tx);
      const now = new Date();
      // A legacy deposit choice being paid back: `sdr:` so the deposit counts as credited
      const keyPrefix = m.owed.safetyDepositHandling && m.deposit.gt(0) ? LEGACY_DEPOSIT_REFUND_KEY_PREFIX : OVERPAYMENT_REFUND_KEY_PREFIX;
      const reason = notes?.trim() || (m.deposit.gt(0) ? "Safety deposit refunded at drop" : "Paid more than the booking owes, refunded at drop");
      const txn = await tx.paymentTransaction.create({
        data: {
          publicId: createID(),
          idempotencyKey: `${keyPrefix}${locked.publicId}:${createID()}`,
          bookingId: locked.id,
          branchId: locked.branchId,
          purpose: PaymentPurpose.OVERPAYMENT_REFUND,
          method: isCash ? "CASH" : "ONLINE",
          status: "CONFIRMED",
          totalAmount: amount.toFixed(2),
          cashAmount: isCash ? amount.toFixed(2) : "0.00",
          onlineAmount: isCash ? "0.00" : amount.toFixed(2),
          onlineGateway: isCash ? null : method === "UPI" ? "UPI" : "BANK_TRANSFER",
          proofFileId: proof?.id ?? null,
          proofPhotos: proofPhotosCreate(proof ? [proof] : null),
          collectedById: actor.id,
          collectedAt: now,
          confirmedById: actor.id,
          confirmedAt: now,
          // Cash off the drawer; UPI / bank as the shift's non-cash refunds
          cashShiftId: shift?.id ?? null,
          notes: reason,
        },
        select: { publicId: true, status: true },
      });
      await tx.refundRequest.create({
        data: {
          publicId: createID(),
          bookingId: locked.id,
          branchId: locked.branchId,
          amount: amount.toFixed(2),
          reason,
          method: isCash ? "CASH" : "ONLINE",
          // As every Fleet refund: the manager acknowledges cash; a transfer is approved at once
          status: isCash ? "PENDING_APPROVAL" : "APPROVED",
          requestedById: actor.id,
          approvedById: isCash ? null : actor.id,
          approvedAt: isCash ? null : now,
        },
      });
      const remaining = m.total.sub(amount);
      if (remaining.lte(0) && (m.deposit.gt(0) || m.owed.safetyDepositCredited.gt(0))) {
        await tx.booking.updateMany({
          where: { id: locked.id, safetyDepositRefunded: false },
          data: { safetyDepositRefunded: true, safetyDepositRefundedAt: now },
        });
      }
      return { txn, amount, remaining, shiftPublicId: shift?.publicId ?? null };
    }, { timeout: 15000 });

    if (booking.status === "RETURNED") {
      syncLegacyReturnInvoice(booking.id).catch((err) => console.error("[drop-refund] Invoice sync failed:", err));
    }
    await auditService.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      actorBranchId: actor.branchId ?? undefined,
      action: "DROP_REFUND_RECORDED",
      category: AuditCategory.PAYMENT,
      description: `₹${result.amount.toFixed(2)} refunded to the customer at drop (${method}) on booking ${booking.publicId}`,
      entity: "PaymentTransaction",
      entityId: result.txn.publicId,
      entityLabel: booking.publicId,
      metadata: { method, amount: result.amount.toFixed(2), ...(proof && { proofFileId: proof.publicId }) },
    });
    staffActivityService
      .logFromRequest(req, {
        actionType: StaffActionType.REFUNDED,
        entityType: StaffEntityType.BOOKING,
        entityRef: booking.publicId,
        description: `₹${result.amount.toFixed(2)} refunded to the customer at drop (${method})`,
        metadata: { method, amount: result.amount.toFixed(2) },
      })
      .catch(() => {});

    return res.status(StatusCode.CREATED).json({
      success: true,
      message: `₹${result.amount.toFixed(2)} refunded to the customer`,
      data: {
        publicId: result.txn.publicId,
        method,
        amount: result.amount.toFixed(2),
        status: result.txn.status,
        remainingOwedBack: result.remaining.toFixed(2),
        cashShiftPublicId: result.shiftPublicId,
        proofFileId: proof?.publicId ?? null,
      },
    });
  } catch (err) {
    if (err instanceof DropRefundRejection) return res.status(err.status).json(err.body);
    if (err instanceof CounterGuardError) return res.status(err.status).json(err.toJSON());
    console.error("RecordDropRefund Error:", err);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
  }
};

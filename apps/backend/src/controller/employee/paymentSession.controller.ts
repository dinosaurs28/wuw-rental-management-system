/**
 * Payment Session controllers — session-driven ledger-based financial flow.
 *
 * Endpoints:
 *   GET  /employee/sessions/:sessionPublicId
 *   GET  /employee/bookings/:bookingId/active-session
 *   POST /employee/sessions/:sessionPublicId/add-deposit
 *   POST /employee/sessions/:sessionPublicId/record-payment
 *   POST /employee/sessions/:sessionPublicId/record-refund
 */
import { Request, Response } from "express";
import { z } from "zod";
import Decimal from "decimal.js";
import {
  prisma,
  BookingStatus,
  LedgerEntryType,
  LedgerEntryClassification,
  PaymentPurpose,
  PaymentSessionStatus,
  PaymentSessionType,
  ExtensionStatus,
  VehicleStatus,
} from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { paymentSessionService } from "../../services/payment/paymentSession.service.js";
import { ledgerService } from "../../services/payment/ledger.service.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";
import { createID } from "../../utils/nanoID.js";
import { notifyEvents } from "../../services/notification/notification.events.js";
import { redis } from "../../lib/redisconfig.js";
import { invalidateVehicleAvailability } from "../../utils/cache/vehicleCacheKeys.js";
import { finalizeInvoice } from "../../services/invoice-finalization.service.js";
import { refreshInvoiceTotals } from "../../services/invoice-totals.service.js";
import { refreshBookingPeriodFields } from "../../utils/booking/rentalPeriod.js";
import {
  applyCounterCouponOnSessionCompletion,
  CounterCouponError,
} from "../../services/discount/counter-coupon.service.js";
import {
  CounterGuardError,
  assertOpenShift,
  assertUtrUnused,
  claimUtr,
  validateNewUtr,
} from "../../services/payment/counter-guard.service.js";
import {
  DROP_BILL_STALE,
  isDropBillInSync,
  lockBookingForDrop,
  vehicleStatusAfterDrop,
} from "../../services/damage/drop-damage.service.js";
import { lockAndAssertDlFreeForPickup, DlInUseError } from "../../services/booking/dl-in-use.service.js";
import {
  resolveCounterUpi,
  claimCounterUpi,
  resolvePaymentProof,
  claimPaymentProof,
  type CounterUpi,
  type ResolvedProof,
} from "../../services/payment/payment-proof.service.js";
import {
  addFleetCredit,
  parseCollateral,
  getBookingCreditSummary,
  serializeCreditSummary,
} from "../../services/payment/customer-credit.service.js";
import { CREDIT_NOT_FOR_DEPOSIT_MESSAGE, DEPOSIT_REFUND_METHOD_REQUIRED_MESSAGE } from "@repo/schemas";
import { SAFETY_DEPOSIT_REFUND_REF } from "../../services/payment/safety-deposit.service.js";

// ── Schemas ──────────────────────────────────────────────────────────────────

const addDepositSchema = z.object({
  amount: z.coerce.number().positive(),
  reason: z.string().min(1).max(500),
  idempotencyKey: z.string().min(1),
});

/** A counter online payment with no gateway (or "UPI") is a UPI transfer backed by a 12-digit UTR. */
function isUpiGateway(gateway?: string | null): boolean {
  const g = gateway?.trim();
  return !g || g.toUpperCase() === "UPI";
}

/** How the deposit is paid back when the drop bill refunds it in full (REFUND_IN_FULL). */
const depositRefundSchema = z.object({
  method: z.enum(["CASH", "UPI", "ONLINE"]),
  // Optional photo of the UPI transfer to the customer
  proof_file_id: z.string().trim().min(1).max(64).optional(),
  notes: z.string().max(500).optional(),
});

const recordPaymentSchema = z.object({
  // UPI = ONLINE with the UPI gateway (merchant QR); CREDIT = the amount stays
  // owed by the customer against the collateral noted (#11)
  method: z.enum(["CASH", "ONLINE", "SPLIT", "UPI", "CREDIT"]),
  amount: z.coerce.number().min(0),
  idempotencyKey: z.string().min(1),
  notes: z.string().optional(),
  onlineTransactionRef: z.string().optional(),
  onlineGateway: z.string().optional(),
  cashAmount: z.coerce.number().min(0).optional(),
  onlineAmount: z.coerce.number().min(0).optional(),
  // Photo of the customer's UPI payment-success screen (#3) — replaces the UTR
  proof_file_id: z.string().trim().min(1).max(64).optional(),
  // CREDIT only: what was taken from the customer until the credit is cleared
  collateral: z.string().optional(),
  // Drop bill with the safety deposit refunded in full: how it is paid back
  depositRefund: depositRefundSchema.optional(),
}).superRefine((d, ctx) => {
  // UPI refs are checked as UTRs (or a proof photo) in the handler; other gateways just need a ref
  if (d.method === "UPI" || d.method === "CREDIT" || isUpiGateway(d.onlineGateway)) return;
  if (d.method === "ONLINE" && !d.onlineTransactionRef?.trim()) {
    ctx.addIssue({ code: "custom", message: "Transaction reference is required for online payments", path: ["onlineTransactionRef"] });
  }
  if (d.method === "SPLIT" && !d.onlineTransactionRef?.trim() && (d.onlineAmount ?? 0) > 0) {
    ctx.addIssue({ code: "custom", message: "Transaction reference required for the online portion", path: ["onlineTransactionRef"] });
  }
});

const recordRefundSchema = z.object({
  // UPI = ONLINE paid back by UPI (optionally with a photo of the transfer)
  method: z.enum(["CASH", "ONLINE", "UPI"]),
  amount: z.coerce.number().positive(),
  idempotencyKey: z.string().min(1),
  notes: z.string().optional(),
  proof_file_id: z.string().trim().min(1).max(64).optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveActor(req: Request) {
  const user = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true, branchId: true },
  });
  if (!user) throw new Error("Actor not found");
  return user;
}

/** A settlement precondition that no longer holds under the booking lock — sent as-is. */
class SettlementConflict extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(String(body.message));
    this.name = "SettlementConflict";
  }
}

/**
 * First step of every transaction that settles a session: locks the booking row
 * (serialising with drop computes and drop damage changes), then re-checks under
 * the lock that the session still awaits payment, the amount still matches the
 * ledger and — for a RETURN session — the drop bill is still current.
 */
async function lockSessionForSettlement(
  tx: any,
  session: { id: number; bookingId: number; sessionType: string },
  expectedNetPayable: number,
  allowedStatuses: string[],
): Promise<Decimal> {
  await lockBookingForDrop(tx, session.bookingId);

  const current = await tx.paymentSession.findUniqueOrThrow({
    where: { id: session.id },
    select: { status: true },
  });
  if (!allowedStatuses.includes(current.status)) {
    throw new SettlementConflict(StatusCode.BAD_REQUEST, {
      message: `Session is not awaiting payment (current status: ${current.status})`,
    });
  }

  const check = await ledgerService.validateSessionAmount(session.id, expectedNetPayable, tx);
  if (!check.valid) {
    throw new SettlementConflict(StatusCode.CONFLICT, {
      message: `Amount mismatch. Session netPayable is ₹${check.recomputed.toFixed(2)}. Re-fetch session and retry.`,
      sessionNetPayable: check.recomputed.toFixed(2),
    });
  }

  if (
    session.sessionType === PaymentSessionType.RETURN &&
    !(await isDropBillInSync(session.bookingId, session.id, tx))
  ) {
    throw new SettlementConflict(StatusCode.CONFLICT, DROP_BILL_STALE);
  }

  // The ledger's own figure (the client's amount may be within the ₹1 tolerance)
  return check.recomputed;
}

// ── Counter-money helpers (#3 proof photo, #6 deposit at drop, #11 credit) ────

/** A safety deposit is being charged on this bill (a DEPOSIT line, not a drop credit). */
function chargesSafetyDeposit(entries: Array<{ entryType: string; classification: string; isVoided?: boolean }>): boolean {
  return entries.some(
    (e) =>
      !e.isVoided &&
      e.entryType === LedgerEntryType.DEPOSIT &&
      e.classification === LedgerEntryClassification.NON_TAXABLE,
  );
}

/** The safety deposit this drop bill refunds in full (REFUND_IN_FULL), or null. */
function depositRefundOnBill(
  entries: Array<{ entryType: string; referenceType: string | null; amount: unknown; isVoided?: boolean }>,
): Decimal | null {
  const total = entries
    .filter((e) => !e.isVoided && e.entryType === LedgerEntryType.REFUND && e.referenceType === SAFETY_DEPOSIT_REFUND_REF)
    .reduce((sum, e) => sum.add(new Decimal(String(e.amount))), new Decimal(0));
  return total.gt(0) ? total : null;
}

type CreditRecorded = { creditEntryPublicId: string; sectionKey: string; amount: string; collateral: string };
type DepositRefunded = { publicId: string; amount: string; method: string };

interface DepositRefundChoice {
  method: "CASH" | "ONLINE";
  isUpi: boolean;
  proof: ResolvedProof | null;
  notes: string | null;
}

/**
 * Pays the safety deposit back (drop bill REFUND_IN_FULL): an OVERPAYMENT_REFUND
 * PaymentTransaction (cash comes off the collector's open shift drawer) plus a
 * RefundRequest under the existing approval rules — cash needs the manager's
 * acknowledgement, UPI is approved at once (same as record-refund).
 */
async function writeDepositRefund(
  tx: any,
  p: {
    session: { id: number; bookingId: number; branchId: number };
    amount: Decimal;
    choice: DepositRefundChoice;
    actorId: number;
    idempotencyKey: string;
  },
): Promise<{ publicId: string; amount: string; method: string }> {
  if (p.choice.proof) await claimPaymentProof(p.choice.proof, tx);
  const isCash = p.choice.method === "CASH";
  const shift = isCash
    ? await tx.cashShift.findFirst({ where: { employeeId: p.actorId, status: "OPEN" }, select: { id: true } })
    : null;
  const now = new Date();
  const amount = p.amount.toFixed(2);
  const note = p.choice.notes ?? "Safety deposit refunded in full at drop";
  const txn = await tx.paymentTransaction.create({
    data: {
      publicId: createID(),
      idempotencyKey: `pt:${p.idempotencyKey}:deposit-refund`,
      bookingId: p.session.bookingId,
      branchId: p.session.branchId,
      purpose: PaymentPurpose.OVERPAYMENT_REFUND,
      method: p.choice.method,
      status: "CONFIRMED",
      totalAmount: amount,
      cashAmount: isCash ? amount : "0.00",
      onlineAmount: isCash ? "0.00" : amount,
      onlineGateway: p.choice.isUpi ? "UPI" : null,
      proofFileId: p.choice.proof?.id ?? null,
      collectedById: p.actorId,
      collectedAt: now,
      confirmedById: p.actorId,
      confirmedAt: now,
      cashShiftId: shift?.id ?? null,
      notes: note,
    },
  });
  await tx.refundRequest.create({
    data: {
      publicId: createID(),
      bookingId: p.session.bookingId,
      branchId: p.session.branchId,
      amount,
      reason: note,
      method: p.choice.method,
      status: isCash ? "PENDING_APPROVAL" : "APPROVED",
      requestedById: p.actorId,
      approvedById: isCash ? null : p.actorId,
      approvedAt: isCash ? null : now,
    },
  });
  await tx.booking.update({
    where: { id: p.session.bookingId },
    data: { safetyDepositRefunded: true, safetyDepositRefundedAt: now },
  });
  return { publicId: txn.publicId, amount, method: p.choice.isUpi ? "UPI" : p.choice.method };
}

/** Ledger label + credit label for a session put on credit. */
function creditLabel(sessionType: PaymentSessionType): string {
  switch (sessionType) {
    case PaymentSessionType.PICKUP:    return "Pickup payment on credit";
    case PaymentSessionType.EXTENSION: return "Extension payment on credit";
    case PaymentSessionType.RETURN:    return "Drop charges on credit";
    default:                           return "Payment on credit";
  }
}

async function resolveSession(sessionPublicId: string, branchId: number) {
  const session = await prisma.paymentSession.findUnique({
    where: { publicId: sessionPublicId },
    include: {
      entries: { where: { isVoided: false }, orderBy: { createdAt: "asc" } },
      booking: { select: { publicId: true, status: true, branchId: true } },
    },
  });
  if (!session) throw Object.assign(new Error("Session not found"), { status: 404 });
  if (session.branchId !== branchId) {
    throw Object.assign(new Error("Access denied"), { status: 403 });
  }
  return session;
}

// ── GET /sessions/:sessionPublicId ────────────────────────────────────────────

export const GetPaymentSession = async (req: Request, res: Response) => {
  try {
    const actor = await resolveActor(req);
    const session = await resolveSession(req.params.sessionPublicId!, actor.branchId!);

    return res.status(StatusCode.OK).json({
      message: "Session fetched",
      data: serializeSession(session),
    });
  } catch (err: any) {
    return res.status(err.status ?? StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message });
  }
};

// ── GET /bookings/:bookingId/active-session ───────────────────────────────────

export const GetActiveSession = async (req: Request, res: Response) => {
  try {
    const session = await paymentSessionService.getActiveSessionForBooking(req.params.bookingId!);
    if (!session) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "No active session for this booking" });
    }
    return res.status(StatusCode.OK).json({ message: "Active session", data: serializeSession(session) });
  } catch (err: any) {
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message });
  }
};

// ── POST /sessions/:sessionPublicId/add-deposit ───────────────────────────────

export const AddDepositToSession = async (req: Request, res: Response) => {
  try {
    const validation = addDepositSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Validation failed", errors: validation.error.format() });
    }
    const { amount, reason, idempotencyKey } = validation.data;
    const actor = await resolveActor(req);
    const session = await resolveSession(req.params.sessionPublicId!, actor.branchId!);

    // Verify safety deposit is enabled on this booking's frozen config
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: session.bookingId },
      select: { id: true, frozenChargeConfig: true },
    });
    const config = (booking.frozenChargeConfig as any) ?? {};
    if (!config.safetyDepositEnabled) {
      return res.status(StatusCode.FORBIDDEN).json({ message: "Safety deposit is not enabled for this booking" });
    }

    await prisma.$transaction(async (tx) => {
      // Auto-approve SafetyDepositRequest (no manager gate in session flow)
      const existingRequest = await tx.safetyDepositRequest.findUnique({
        where: { bookingId: booking.id },
      });

      if (!existingRequest) {
        await tx.safetyDepositRequest.create({
          data: {
            publicId: createID(),
            bookingId: booking.id,
            requestedAmount: String(amount),
            reason,
            status: "APPROVED",
            requestedById: actor.id,
            approvedById: actor.id,
            approvedAmount: String(amount),
            approvedAt: new Date(),
          },
        });
      } else {
        // If deposit request already exists (e.g. from pickup), update it
        await tx.safetyDepositRequest.update({
          where: { bookingId: booking.id },
          data: {
            requestedAmount: { increment: amount },
            approvedAmount: { increment: amount },
            approvedAt: new Date(),
          },
        });
      }

      // Update booking safety deposit amount
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          safetyDeposit: { increment: amount },
          safetyDepositPaidAt: new Date(),
        },
      });

      // Add DEPOSIT ledger entry
      await ledgerService.addEntry(
        session.id,
        booking.id,
        LedgerEntryType.DEPOSIT,
        LedgerEntryClassification.NON_TAXABLE,
        amount,
        reason,
        actor.id,
        String(actor.role),
        { idempotencyKey, referenceType: "SAFETY_DEPOSIT" },
        tx as any,
      );
    });

    // Log outside transaction
    await staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.APPLIED,
      entityType: StaffEntityType.PAYMENT_SESSION,
      entityRef: session.publicId,
      description: `Safety deposit ₹${amount} added to session ${session.publicId}`,
      metadata: { amount, reason },
    });

    const updatedSession = await paymentSessionService.getSession(session.publicId);
    return res.status(StatusCode.OK).json({
      message: "Safety deposit added to session",
      data: serializeSession(updatedSession!),
    });
  } catch (err: any) {
    console.error("AddDepositToSession Error:", err);
    return res.status(err.status ?? StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message ?? "Internal server error" });
  }
};

// ── POST /sessions/:sessionPublicId/record-payment ────────────────────────────

export const RecordPayment = async (req: Request, res: Response) => {
  try {
    const validation = recordPaymentSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Validation failed", errors: validation.error.format() });
    }
    const { amount, idempotencyKey, notes, onlineTransactionRef, cashAmount: splitCash, onlineAmount: splitOnline, proof_file_id, depositRefund } = validation.data;
    // "UPI" is a counter UPI (merchant QR) payment: ONLINE through the UPI gateway
    const method = validation.data.method === "UPI" ? "ONLINE" : validation.data.method;
    const onlineGateway = validation.data.method === "UPI" ? "UPI" : validation.data.onlineGateway;
    const actor = await resolveActor(req);
    const session = await resolveSession(req.params.sessionPublicId!, actor.branchId!);

    if (!["AWAITING_PAYMENT", "PAYMENT_INITIATED"].includes(session.status)) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `Session is not awaiting payment (current status: ${session.status})`,
      });
    }

    // Validate amount matches ledger
    const validation2 = await ledgerService.validateSessionAmount(session.id, amount);
    if (!validation2.valid) {
      return res.status(StatusCode.CONFLICT).json({
        message: `Amount mismatch. Session netPayable is ₹${validation2.recomputed.toFixed(2)}, you provided ₹${amount}. Re-fetch session and retry.`,
        sessionNetPayable: validation2.recomputed.toFixed(2),
      });
    }

    // The drop bill must still match the booking (damages, rental period) — re-checked under the lock below
    if (
      session.sessionType === PaymentSessionType.RETURN &&
      !(await isDropBillInSync(session.bookingId, session.id))
    ) {
      return res.status(StatusCode.CONFLICT).json(DROP_BILL_STALE);
    }

    // CREDIT (#11): the amount stays owed against the collateral noted. Nothing
    // to credit on a ₹0 bill, and a safety deposit can't be taken on credit.
    let collateral: string | null = null;
    if (method === "CREDIT") {
      if (amount <= 0) {
        return res.status(StatusCode.BAD_REQUEST).json({
          success: false,
          code: "NOTHING_TO_CREDIT",
          message: "Nothing is due on this bill, so there is nothing to put on credit.",
        });
      }
      collateral = parseCollateral(validation.data.collateral);
      if (chargesSafetyDeposit(session.entries)) {
        throw new CounterGuardError(StatusCode.BAD_REQUEST, "CREDIT_NOT_FOR_DEPOSIT", CREDIT_NOT_FOR_DEPOSIT_MESSAGE);
      }
    }

    // A split's cash and UPI parts must add up to the amount collected
    if (method === "SPLIT" && amount > 0) {
      const cashPart = splitCash ?? 0;
      const onlinePart = splitOnline ?? 0;
      if (Math.abs(cashPart + onlinePart - amount) >= 0.01) {
        throw new CounterGuardError(
          StatusCode.BAD_REQUEST,
          "SPLIT_AMOUNT_MISMATCH",
          `The cash (₹${cashPart.toFixed(2)}) and UPI (₹${onlinePart.toFixed(2)}) parts must add up to ₹${amount.toFixed(2)}.`,
        );
      }
    }

    // Counter money: cash and UPI need the staff member's open shift. UPI is backed
    // by a photo of the payment screen (proof_file_id) or, from older builds, a UTR;
    // either can back only one payment. Zero-balance completions and credit take
    // no money and aren't gated.
    const hasOnlinePart = method === "ONLINE" || (method === "SPLIT" && (splitOnline ?? 0) > 0);
    const isUpi = hasOnlinePart && isUpiGateway(onlineGateway);
    let onlineRef: string | null = onlineTransactionRef?.trim() || null;
    let gateway: string | null = onlineGateway?.trim() || null;
    let upi: CounterUpi | null = null;
    if (amount > 0 && method !== "CREDIT") {
      if (method !== "ONLINE" || isUpi) {
        await assertOpenShift(actor);
      }
      if (isUpi) {
        upi = await resolveCounterUpi({ utr: onlineTransactionRef, proofFileId: proof_file_id, branchId: session.branchId });
        onlineRef = upi.utr;
        gateway = "UPI";
      } else if (hasOnlinePart) {
        await assertUtrUnused(onlineRef!);
      }
    }
    const proofFileId = upi?.proof?.id ?? null;

    // Drop bill refunding the safety deposit in full (#6): the deposit is paid back
    // in the same settlement, so staff must say how (cash / UPI).
    const depositRefundDue = depositRefundOnBill(session.entries);
    let refundChoice: DepositRefundChoice | null = null;
    if (depositRefundDue) {
      if (!depositRefund) {
        return res.status(StatusCode.BAD_REQUEST).json({
          success: false,
          code: "DEPOSIT_REFUND_METHOD_REQUIRED",
          message: DEPOSIT_REFUND_METHOD_REQUIRED_MESSAGE,
          depositRefundAmount: depositRefundDue.toFixed(2),
        });
      }
      const refundIsUpi = depositRefund.method !== "CASH";
      refundChoice = {
        method: refundIsUpi ? "ONLINE" : "CASH",
        isUpi: refundIsUpi,
        proof: refundIsUpi ? await resolvePaymentProof(depositRefund.proof_file_id, session.branchId) : null,
        notes: depositRefund.notes?.trim() || null,
      };
    }

    let returnedVehicleIds: number[] = [];
    let creditRecorded: CreditRecorded | null = null;
    let depositRefunded: DepositRefunded | null = null;

    if (amount === 0) {
      // Zero-balance session: complete immediately without creating a PaymentTransaction.
      // A ₹0 record would pollute financial reports with meaningless rows.
      await prisma.$transaction(async (tx) => {
        await lockSessionForSettlement(tx, session, amount, ["AWAITING_PAYMENT", "PAYMENT_INITIATED"]);

        // Nothing to collect, but a deposit refunded in full is still paid back
        if (refundChoice && depositRefundDue) {
          depositRefunded = await writeDepositRefund(tx, {
            session, amount: depositRefundDue, choice: refundChoice, actorId: actor.id, idempotencyKey,
          });
        }

        await paymentSessionService.updateStatus(session.id, PaymentSessionStatus.COMPLETED, {}, tx as any);
        await (tx as any).booking.update({
          where: { id: session.bookingId },
          data: { activePaymentSessionId: null },
        });
        returnedVehicleIds = await runPostCompletionHooks(session.sessionType as PaymentSessionType, session.bookingId, session.id, actor.id, tx as any);
      }, { timeout: 15000 });
    } else if (method === "CASH") {
      await prisma.$transaction(async (tx) => {
        await lockSessionForSettlement(tx, session, amount, ["AWAITING_PAYMENT", "PAYMENT_INITIATED"]);

        // Add PAYMENT ledger entry (negative = money in)
        await ledgerService.addEntry(
          session.id,
          session.bookingId,
          LedgerEntryType.PAYMENT,
          LedgerEntryClassification.PAYMENT,
          -Math.abs(amount),
          notes ?? `Cash payment of ₹${amount}`,
          actor.id,
          String(actor.role),
          { idempotencyKey, referenceType: "CASH_PAYMENT" },
          tx as any,
        );

        // Link to the employee's open cash shift so the manager can track handover
        const activeShift = await (tx as any).cashShift.findFirst({
          where: { employeeId: actor.id, status: "OPEN" },
          select: { id: true },
        });

        // Create backward-compat PaymentTransaction (COLLECTED — awaits manager cash confirmation);
        // a safety deposit on the bill gets its own SAFETY_DEPOSIT row
        await createSessionPaymentTransactions(tx, {
          sessionId: session.id,
          sessionType: session.sessionType as PaymentSessionType,
          idempotencyKey,
          amount: new Decimal(amount),
          cash: new Decimal(amount),
          online: new Decimal(0),
          data: {
            bookingId: session.bookingId,
            branchId: session.branchId,
            method: "CASH",
            status: "COLLECTED",
            collectedById: actor.id,
            collectedAt: new Date(),
            cashShiftId: activeShift?.id ?? null,
            notes: notes ?? null,
          },
        });

        if (refundChoice && depositRefundDue) {
          depositRefunded = await writeDepositRefund(tx, {
            session, amount: depositRefundDue, choice: refundChoice, actorId: actor.id, idempotencyKey,
          });
        }

        // Mark session completed
        await paymentSessionService.updateStatus(session.id, PaymentSessionStatus.COMPLETED, {}, tx as any);
        await (tx as any).booking.update({
          where: { id: session.bookingId },
          data: { activePaymentSessionId: null },
        });

        // Run post-completion hooks (returns vehicle IDs for RETURN sessions)
        returnedVehicleIds = await runPostCompletionHooks(session.sessionType as PaymentSessionType, session.bookingId, session.id, actor.id, tx as any);
      }, { timeout: 15000 });
    } else if (method === "ONLINE") {
      await prisma.$transaction(async (tx) => {
        await lockSessionForSettlement(tx, session, amount, ["AWAITING_PAYMENT", "PAYMENT_INITIATED"]);
        // Race-safe: two staff recording the same UTR / payment photo serialise here
        // and the second gets DUPLICATE_UTR / DUPLICATE_PAYMENT_PROOF
        if (upi) await claimCounterUpi(upi, tx);
        else if (onlineRef) await claimUtr(onlineRef, tx);

        await ledgerService.addEntry(
          session.id,
          session.bookingId,
          LedgerEntryType.PAYMENT,
          LedgerEntryClassification.PAYMENT,
          -Math.abs(amount),
          notes ?? `Online payment of ₹${amount}${onlineRef ? ` (ref: ${onlineRef})` : ""}`,
          actor.id,
          String(actor.role),
          { idempotencyKey, referenceType: "ONLINE_PAYMENT" },
          tx as any,
        );

        // A counter UPI (UTR) payment counts toward the shift's UPI-collected figure
        const upiShift = isUpiGateway(gateway)
          ? await tx.cashShift.findFirst({
              where: { employeeId: actor.id, status: "OPEN" },
              select: { id: true },
            })
          : null;

        await createSessionPaymentTransactions(tx, {
          sessionId: session.id,
          sessionType: session.sessionType as PaymentSessionType,
          idempotencyKey,
          amount: new Decimal(amount),
          cash: new Decimal(0),
          online: new Decimal(amount),
          data: {
            bookingId: session.bookingId,
            branchId: session.branchId,
            method: "ONLINE",
            status: "CONFIRMED",
            onlineTransactionRef: onlineRef,
            onlineGateway: gateway,
            collectedById: actor.id,
            collectedAt: new Date(),
            confirmedById: actor.id,
            confirmedAt: new Date(),
            cashShiftId: upiShift?.id ?? null,
            proofFileId,
            notes: notes ?? null,
          },
        });

        if (refundChoice && depositRefundDue) {
          depositRefunded = await writeDepositRefund(tx, {
            session, amount: depositRefundDue, choice: refundChoice, actorId: actor.id, idempotencyKey,
          });
        }

        await paymentSessionService.updateStatus(session.id, PaymentSessionStatus.COMPLETED, {}, tx as any);
        await (tx as any).booking.update({
          where: { id: session.bookingId },
          data: { activePaymentSessionId: null },
        });

        returnedVehicleIds = await runPostCompletionHooks(session.sessionType as PaymentSessionType, session.bookingId, session.id, actor.id, tx as any);
      }, { timeout: 15000 });
    } else if (method === "SPLIT") {
      const cash = Math.abs(splitCash ?? 0);
      const online = Math.abs(splitOnline ?? 0);

      await prisma.$transaction(async (tx) => {
        await lockSessionForSettlement(tx, session, amount, ["AWAITING_PAYMENT", "PAYMENT_INITIATED"]);
        if (upi) await claimCounterUpi(upi, tx);
        else if (hasOnlinePart && onlineRef) await claimUtr(onlineRef, tx);

        await ledgerService.addEntry(
          session.id,
          session.bookingId,
          LedgerEntryType.PAYMENT,
          LedgerEntryClassification.PAYMENT,
          -Math.abs(amount),
          notes ?? `Split payment: ₹${cash} cash + ₹${online} online${onlineRef ? ` (ref: ${onlineRef})` : ""}`,
          actor.id,
          String(actor.role),
          { idempotencyKey, referenceType: "SPLIT_PAYMENT" },
          tx as any,
        );

        const activeShift = await (tx as any).cashShift.findFirst({
          where: { employeeId: actor.id, status: "OPEN" },
          select: { id: true },
        });

        await createSessionPaymentTransactions(tx, {
          sessionId: session.id,
          sessionType: session.sessionType as PaymentSessionType,
          idempotencyKey,
          amount: new Decimal(amount),
          cash: new Decimal(cash),
          online: new Decimal(online),
          data: {
            bookingId: session.bookingId,
            branchId: session.branchId,
            method: "SPLIT",
            status: "COLLECTED",
            onlineTransactionRef: onlineRef,
            onlineGateway: gateway,
            collectedById: actor.id,
            collectedAt: new Date(),
            cashShiftId: activeShift?.id ?? null,
            proofFileId,
            notes: notes ?? null,
          },
        });

        if (refundChoice && depositRefundDue) {
          depositRefunded = await writeDepositRefund(tx, {
            session, amount: depositRefundDue, choice: refundChoice, actorId: actor.id, idempotencyKey,
          });
        }

        await paymentSessionService.updateStatus(session.id, PaymentSessionStatus.COMPLETED, {}, tx as any);
        await (tx as any).booking.update({
          where: { id: session.bookingId },
          data: { activePaymentSessionId: null },
        });

        returnedVehicleIds = await runPostCompletionHooks(session.sessionType as PaymentSessionType, session.bookingId, session.id, actor.id, tx as any);
      }, { timeout: 15000 });
    } else if (method === "CREDIT" && collateral) {
      // Credit (#11): no money moves, so no PaymentTransaction — a CREDIT ledger line
      // settles the bill and the booking's CustomerCreditEntry records what is owed
      // and the collateral held. The financial state keeps it due until the branch
      // manager clears it (which records the payment then).
      const creditCollateral = collateral;
      await prisma.$transaction(async (tx) => {
        const owed = await lockSessionForSettlement(tx, session, amount, ["AWAITING_PAYMENT", "PAYMENT_INITIATED"]);

        // Re-checked under the lock: a deposit may have been added since the request was read
        const liveEntries = await tx.ledgerEntry.findMany({
          where: { sessionId: session.id, isVoided: false },
          select: { entryType: true, classification: true },
        });
        if (chargesSafetyDeposit(liveEntries)) {
          throw new CounterGuardError(StatusCode.BAD_REQUEST, "CREDIT_NOT_FOR_DEPOSIT", CREDIT_NOT_FOR_DEPOSIT_MESSAGE);
        }

        const label = creditLabel(session.sessionType as PaymentSessionType);
        await ledgerService.addEntry(
          session.id,
          session.bookingId,
          LedgerEntryType.CREDIT,
          LedgerEntryClassification.PAYMENT,
          owed.negated(),
          notes ?? `${label}: ₹${owed.toFixed(2)} (collateral: ${creditCollateral})`,
          actor.id,
          String(actor.role),
          {
            idempotencyKey,
            referenceType: "CUSTOMER_CREDIT",
            metadata: { collateral: creditCollateral },
          },
          tx as any,
        );

        const credit = await addFleetCredit(tx, {
          bookingId: session.bookingId,
          amount: owed,
          purpose: sessionTypeToPurpose(session.sessionType as PaymentSessionType),
          label,
          collateral: creditCollateral,
          reference: { type: "PAYMENT_SESSION", publicId: session.publicId },
          actor: { id: actor.id, name: actor.name },
        });
        creditRecorded = {
          creditEntryPublicId: credit.creditEntryPublicId,
          sectionKey: credit.sectionKey,
          amount: owed.toFixed(2),
          collateral: creditCollateral,
        };

        if (refundChoice && depositRefundDue) {
          depositRefunded = await writeDepositRefund(tx, {
            session, amount: depositRefundDue, choice: refundChoice, actorId: actor.id, idempotencyKey,
          });
        }

        await paymentSessionService.updateStatus(session.id, PaymentSessionStatus.COMPLETED, {}, tx as any);
        await (tx as any).booking.update({
          where: { id: session.bookingId },
          data: { activePaymentSessionId: null },
        });

        returnedVehicleIds = await runPostCompletionHooks(session.sessionType as PaymentSessionType, session.bookingId, session.id, actor.id, tx as any);
      }, { timeout: 15000 });
    }

    // Invalidate vehicle availability cache for returned vehicles (every completion path)
    if (returnedVehicleIds.length > 0) {
      try {
        await invalidateVehicleAvailability(redis, returnedVehicleIds);
      } catch (redisErr) {
        console.warn("[record-payment] Cache invalidation failed (non-fatal):", redisErr);
      }
    }

    // Assigned inside the transaction callbacks (TS can't see that)
    const credit = creditRecorded as CreditRecorded | null;
    const refunded = depositRefunded as DepositRefunded | null;
    const creditSummary = await getBookingCreditSummary(session.bookingId);

    // Rebuild and regenerate invoice after RETURN session completes — it is PAID
    // only when nothing of the booking is still owed on credit
    if (session.sessionType === PaymentSessionType.RETURN) {
      finalizeInvoice(session.bookingId, { markPaid: !(creditSummary?.pending.gt(0) ?? false) }).catch((err) =>
        console.error("[record-payment] Invoice finalization error:", err),
      );
    } else {
      // An extension confirmed by this session changes the invoice totals
      refreshInvoiceTotals(session.bookingId).catch((err) =>
        console.error("[record-payment] Invoice refresh error:", err),
      );
    }

    // Audit + activity outside transaction
    const methodLabel = validation.data.method === "UPI" || (method === "ONLINE" && isUpi) ? "UPI" : method;
    await auditService.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      actorBranchId: actor.branchId ?? undefined,
      action: credit ? "PAYMENT_ON_CREDIT" : "PAYMENT_RECORDED",
      category: AuditCategory.PAYMENT,
      description: credit
        ? `₹${credit.amount} put on credit on session ${session.publicId} (collateral: ${credit.collateral})`
        : `${methodLabel} payment of ₹${amount} recorded on session ${session.publicId}`,
      entity: "PaymentSession",
      entityId: session.publicId,
      metadata: {
        method: methodLabel,
        amount,
        sessionType: session.sessionType,
        ...(upi?.proof && { proofFileId: upi.proof.publicId }),
        ...(credit && { credit }),
        ...(refunded && { depositRefund: refunded }),
      },
    });

    await staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.COLLECTED,
      entityType: StaffEntityType.PAYMENT_SESSION,
      entityRef: session.publicId,
      description: credit
        ? `₹${credit.amount} put on credit on ${session.sessionType} session (collateral: ${credit.collateral})`
        : `Payment ₹${amount} (${methodLabel}) recorded on ${session.sessionType} session`,
      metadata: { amount, method: methodLabel, ...(credit && { collateral: credit.collateral }) },
    });

    if (refunded) {
      await staffActivityService.logFromRequest(req, {
        actionType: StaffActionType.REFUNDED,
        entityType: StaffEntityType.PAYMENT_SESSION,
        entityRef: session.publicId,
        description: `Safety deposit ₹${refunded.amount} refunded in full (${refunded.method})`,
        metadata: refunded,
      });
    }

    void notifyEvents.paymentSessionCompleted({ sessionId: session.id, actorUserId: actor.id });

    const updatedSession = await paymentSessionService.getSession(session.publicId);
    return res.status(StatusCode.OK).json({
      message: credit
        ? `₹${credit.amount} put on credit — the branch manager clears it when the customer pays`
        : "Payment recorded successfully",
      data: {
        ...serializeSession(updatedSession!),
        // Additive: what this settlement put on credit / refunded, and the booking's credit position
        credit: credit ?? null,
        depositRefund: refunded ?? null,
        bookingCredit: serializeCreditSummary(creditSummary),
      },
    });
  } catch (err: any) {
    if (err instanceof CounterGuardError) {
      return res.status(err.status).json(err.toJSON());
    }
    if (err instanceof SettlementConflict) {
      return res.status(err.status).json(err.body);
    }
    console.error("RecordPayment Error:", err);
    return res.status(err.status ?? StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message ?? "Internal server error" });
  }
};

// ── POST /sessions/:sessionPublicId/record-refund ─────────────────────────────

export const RecordRefund = async (req: Request, res: Response) => {
  try {
    const validation = recordRefundSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Validation failed", errors: validation.error.format() });
    }
    const { amount, idempotencyKey, notes } = validation.data;
    // UPI = paid back by UPI (ONLINE through the UPI gateway), optionally with a photo
    const refundIsUpi = validation.data.method === "UPI";
    const method = refundIsUpi ? "ONLINE" : validation.data.method;
    const actor = await resolveActor(req);
    const session = await resolveSession(req.params.sessionPublicId!, actor.branchId!);
    const refundProof = method === "ONLINE"
      ? await resolvePaymentProof(validation.data.proof_file_id, session.branchId)
      : null;

    if (session.status !== PaymentSessionStatus.AWAITING_PAYMENT) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: `Session is not awaiting payment` });
    }

    // Validate: netPayable must be negative (refund situation)
    const validation2 = await ledgerService.validateSessionAmount(session.id, -Math.abs(amount));
    if (!validation2.valid) {
      return res.status(StatusCode.CONFLICT).json({
        message: `Refund amount mismatch. Session refundable is ₹${validation2.recomputed.abs().toFixed(2)}.`,
        sessionNetPayable: validation2.recomputed.toFixed(2),
      });
    }

    // The drop bill must still match the booking (damages, rental period) — re-checked under the lock below
    if (
      session.sessionType === PaymentSessionType.RETURN &&
      !(await isDropBillInSync(session.bookingId, session.id))
    ) {
      return res.status(StatusCode.CONFLICT).json(DROP_BILL_STALE);
    }

    let returnedVehicleIds: number[] = [];

    await prisma.$transaction(async (tx) => {
      await lockSessionForSettlement(tx, session, -Math.abs(amount), ["AWAITING_PAYMENT"]);

      await ledgerService.addEntry(
        session.id,
        session.bookingId,
        LedgerEntryType.REFUND,
        LedgerEntryClassification.PAYMENT,
        Math.abs(amount),
        notes ?? `Cash refund of ₹${amount}`,
        actor.id,
        String(actor.role),
        { idempotencyKey, referenceType: "REFUND" },
        tx as any,
      );

      // Cash paid out of the drawer comes off the open shift's expected cash
      const refundShift = method === "CASH"
        ? await tx.cashShift.findFirst({
            where: { employeeId: actor.id, status: "OPEN" },
            select: { id: true },
          })
        : null;

      if (refundProof) await claimPaymentProof(refundProof, tx);

      await tx.paymentTransaction.create({
        data: {
          publicId: createID(),
          idempotencyKey: `pt:${idempotencyKey}`,
          bookingId: session.bookingId,
          branchId: session.branchId,
          purpose: PaymentPurpose.OVERPAYMENT_REFUND,
          method: method as any,
          status: "CONFIRMED",
          totalAmount: amount.toFixed(2),
          cashAmount: method === "CASH" ? amount.toFixed(2) : "0.00",
          onlineAmount: method === "ONLINE" ? amount.toFixed(2) : "0.00",
          onlineGateway: refundIsUpi ? "UPI" : null,
          proofFileId: refundProof?.id ?? null,
          collectedById: actor.id,
          collectedAt: new Date(),
          confirmedById: actor.id,
          confirmedAt: new Date(),
          cashShiftId: refundShift?.id ?? null,
          notes: notes ?? null,
        },
      });

      // A drop bill's refund is the safety deposit (or what is left of it after the charges)
      if (session.sessionType === PaymentSessionType.RETURN) {
        await tx.booking.update({
          where: { id: session.bookingId },
          data: { safetyDepositRefunded: true, safetyDepositRefundedAt: new Date() },
        });
      }

      // Create a RefundRequest so the branch manager can see and acknowledge the refund.
      // CASH refunds need manager acknowledgment (PENDING_APPROVAL); online refunds auto-approve.
      await (tx as any).refundRequest.create({
        data: {
          publicId: createID(),
          bookingId: session.bookingId,
          branchId: session.branchId,
          amount: amount.toFixed(2),
          reason: notes ?? "Deposit refund on vehicle return",
          method: method as any,
          status: method === "CASH" ? "PENDING_APPROVAL" : "APPROVED",
          requestedById: actor.id,
          approvedById: method !== "CASH" ? actor.id : null,
          approvedAt: method !== "CASH" ? new Date() : null,
        },
      });

      await paymentSessionService.updateStatus(session.id, PaymentSessionStatus.COMPLETED, {}, tx as any);
      await (tx as any).booking.update({
        where: { id: session.bookingId },
        data: { activePaymentSessionId: null },
      });

      returnedVehicleIds = await runPostCompletionHooks(session.sessionType as PaymentSessionType, session.bookingId, session.id, actor.id, tx as any);
    }, { timeout: 15000 });

    if (returnedVehicleIds.length > 0) {
      try {
        await invalidateVehicleAvailability(redis, returnedVehicleIds);
      } catch (redisErr) {
        console.warn("[record-refund] Cache invalidation failed (non-fatal):", redisErr);
      }
    }

    // Rebuild and regenerate invoice after RETURN session completes (PAID unless
    // something of the booking is still owed on credit)
    if (session.sessionType === PaymentSessionType.RETURN) {
      const creditOpen = (await getBookingCreditSummary(session.bookingId))?.pending.gt(0) ?? false;
      finalizeInvoice(session.bookingId, { markPaid: !creditOpen }).catch((err) =>
        console.error("[record-refund] Invoice finalization error:", err),
      );
    }

    await auditService.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      actorBranchId: actor.branchId ?? undefined,
      action: "REFUND_RECORDED",
      category: AuditCategory.PAYMENT,
      description: `Refund of ₹${amount} (${refundIsUpi ? "UPI" : method}) issued via session ${session.publicId}`,
      entity: "PaymentSession",
      entityId: session.publicId,
      metadata: { method: refundIsUpi ? "UPI" : method, amount, ...(refundProof && { proofFileId: refundProof.publicId }) },
    });

    void notifyEvents.paymentSessionCompleted({ sessionId: session.id, actorUserId: actor.id });

    const updatedSession = await paymentSessionService.getSession(session.publicId);
    return res.status(StatusCode.OK).json({
      message: "Refund recorded successfully",
      data: serializeSession(updatedSession!),
    });
  } catch (err: any) {
    if (err instanceof CounterGuardError) {
      return res.status(err.status).json(err.toJSON());
    }
    if (err instanceof SettlementConflict) {
      return res.status(err.status).json(err.body);
    }
    console.error("RecordRefund Error:", err);
    return res.status(err.status ?? StatusCode.INTERNAL_SERVER_ERROR).json({ message: err.message ?? "Internal server error" });
  }
};

// ── Post-completion hooks ─────────────────────────────────────────────────────

/**
 * Actions to run after a session reaches COMPLETED state.
 * Each session type has different post-payment effects on the booking.
 */
/**
 * Returns vehicle IDs that need Redis cache invalidation (RETURN sessions only).
 */
async function runPostCompletionHooks(
  sessionType: PaymentSessionType,
  bookingId: number,
  sessionId: number,
  actorId: number,
  tx: any,
): Promise<number[]> {
  if (sessionType === PaymentSessionType.PICKUP) {
    // One vehicle per driving licence (X3): the handover is refused (and the
    // payment rolled back) while another booking on this DL is out.
    try {
      await lockAndAssertDlFreeForPickup(bookingId, tx);
    } catch (err) {
      if (err instanceof DlInUseError) {
        throw new SettlementConflict(err.status, err.toJSON("staff"));
      }
      throw err;
    }

    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { items: { select: { vehicleId: true } } },
    });
    const vehicleIds = booking.items.map((i: any) => i.vehicleId);

    // Keep when/where the balance was actually paid if it was settled earlier
    // (e.g. initiate-remaining-payment before the handover)
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.PICKED_UP,
        ...(booking.remainingPaidAt == null && {
          remainingPaidAt: new Date(),
          remainingPaidDuring: "PICKUP",
        }),
      },
    });

    await tx.vehicle.updateMany({
      where: { id: { in: vehicleIds } },
      data: { status: VehicleStatus.OUT_FOR_RENTAL },
    });

    // An extension paid in cash before this session (PAYMENT_COLLECTED) is NOT
    // confirmed here: it waits for the manager's cash confirmation, which adds
    // it to totalFinal (paymentTransactionService.confirmCash) — or for a
    // rejection, which releases it. Confirming it here skipped totalFinal and
    // left a rejected cash payment with a free extension.

    // Extension added to this pickup session via an EXTENSION ledger entry
    // (extension status is PENDING_PAYMENT — payment deferred to this session)
    {
      const extLedgerEntry = await tx.ledgerEntry.findFirst({
        where: { sessionId, entryType: LedgerEntryType.EXTENSION, isVoided: false },
      });
      if (extLedgerEntry?.referenceId) {
        const sessionExt = await tx.bookingExtension.findUnique({
          where: { publicId: extLedgerEntry.referenceId },
          include: { booking: { select: { extensionCount: true, originalEndAt: true } } },
        });
        if (sessionExt && sessionExt.extensionStatus === ExtensionStatus.PENDING_PAYMENT) {
          await tx.bookingExtension.update({
            where: { id: sessionExt.id },
            data: {
              extensionStatus: ExtensionStatus.CONFIRMED,
              actualNewEndAt: sessionExt.requestedEndAt,
            },
          });
          // booking.endAt is already set by commit() as the vehicle hold —
          // just clear activeExtensionId and increment the counter.
          await tx.booking.update({
            where: { id: bookingId },
            data: {
              activeExtensionId: null,
              extensionCount: { increment: 1 },
              lastExtendedAt: new Date(),
              totalFinal: { increment: sessionExt.additionalAmount },
              ...(sessionExt.booking.extensionCount === 0 && !sessionExt.booking.originalEndAt
                ? { originalEndAt: sessionExt.oldEndAt }
                : {}),
            },
          });
          // days / rentalPeriodType / hours follow the extended end (#5/#17)
          await refreshBookingPeriodFields(bookingId, tx);
        }
      }
    }

    // Case 3: Counter coupon on the pickup bill — re-checked under a rule lock,
    // then folded into the booking (totals, item, invoice, DiscountApplication)
    // and its usage recorded. A coupon that stopped being valid fails the
    // settlement so staff remove it and collect the full amount.
    try {
      await applyCounterCouponOnSessionCompletion(tx, bookingId, sessionId);
    } catch (err) {
      if (err instanceof CounterCouponError) {
        throw new SettlementConflict(err.status, { ...err.toJSON(), couponRejected: true });
      }
      throw err;
    }

    return [];
  } else if (sessionType === PaymentSessionType.EXTENSION) {
    const extension = await tx.bookingExtension.findFirst({
      where: { bookingId, extensionStatus: ExtensionStatus.PENDING_PAYMENT },
      orderBy: { createdAt: "desc" },
      include: { booking: { select: { extensionCount: true, originalEndAt: true } } },
    });
    if (extension) {
      await tx.bookingExtension.update({
        where: { id: extension.id },
        data: {
          extensionStatus: ExtensionStatus.CONFIRMED,
          actualNewEndAt: extension.requestedEndAt,
        },
      });
      // Same booking effects as every other extension finalizer: the paid
      // amount (taxable + GST) joins totalFinal.
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          endAt: extension.requestedEndAt,
          activeExtensionId: null,
          extensionCount: { increment: 1 },
          lastExtendedAt: new Date(),
          totalFinal: { increment: extension.additionalAmount },
          ...(extension.booking.extensionCount === 0 && !extension.booking.originalEndAt
            ? { originalEndAt: extension.oldEndAt }
            : {}),
        },
      });
      // days / rentalPeriodType / hours follow the extended end (#5/#17)
      await refreshBookingPeriodFields(bookingId, tx);
    }
    return [];
  } else if (sessionType === PaymentSessionType.RETURN) {
    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { items: { select: { vehicleId: true } } },
    });
    const vehicleIds = booking.items.map((i: any) => i.vehicleId);

    // Actual return time = the moment the drop bill froze it (first compute), else now
    const returnSession = await tx.paymentSession.findUnique({
      where: { id: sessionId },
      select: { metadata: true },
    });
    const frozenReturnedAt = (returnSession?.metadata as any)?.returnedAt;
    const returnedAt = frozenReturnedAt && !Number.isNaN(Date.parse(frozenReturnedAt))
      ? new Date(frozenReturnedAt)
      : new Date();

    await tx.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.RETURNED, returnedAt },
    });

    // Damage recorded at drop holds that vehicle for the manager's disposition
    // (MANAGER_REPORTED); every other vehicle is back in the fleet.
    for (const vehicleId of vehicleIds) {
      const vehicleStatus = (await vehicleStatusAfterDrop(bookingId, vehicleId, tx)) ?? VehicleStatus.AVAILABLE;
      await tx.vehicle.update({
        where: { id: vehicleId },
        data: { status: vehicleStatus },
      });
    }

    // Bust the cached PDF synchronously inside the transaction so any
    // download request that arrives before finalizeInvoice completes
    // sees a null invoicePdfFileId and is forced to wait for regeneration.
    await (tx as any).invoice.updateMany({
      where: { bookingId },
      data: { invoicePdfFileId: null, generatedAt: null },
    });

    return vehicleIds;
  }
  return [];
}

// ── Purpose mapping ───────────────────────────────────────────────────────────

function sessionTypeToPurpose(sessionType: PaymentSessionType): PaymentPurpose {
  switch (sessionType) {
    case PaymentSessionType.PICKUP:    return PaymentPurpose.REMAINING_BALANCE;
    case PaymentSessionType.EXTENSION: return PaymentPurpose.EXTENSION;
    case PaymentSessionType.RETURN:    return PaymentPurpose.REMAINING_BALANCE;
    default:                           return PaymentPurpose.FULL_PAYMENT;
  }
}

/**
 * Writes the PaymentTransaction(s) behind a session payment. The ledger keeps one
 * PAYMENT line for the whole amount; the transactions split it by what it paid for:
 *  - the rental part, with the session's purpose (key `pt:<key>`)
 *  - the refundable safety deposit on the bill (non-voided DEPOSIT lines) as purpose
 *    SAFETY_DEPOSIT (key `pt:<key>:deposit`), so revenue reports leave it out.
 * Both rows share the method, status, UTR / reference, collector and cash shift, so
 * the shift's cash / UPI totals are unchanged; the deposit takes the cash first, then
 * the online part. A part of ₹0 gets no row. Runs inside the settlement transaction.
 */
async function createSessionPaymentTransactions(
  tx: any,
  p: {
    sessionId: number;
    sessionType: PaymentSessionType;
    idempotencyKey: string;
    amount: Decimal;
    cash: Decimal;
    online: Decimal;
    data: Record<string, unknown> & { bookingId: number; branchId: number };
  },
): Promise<void> {
  const depositLines = await tx.ledgerEntry.aggregate({
    where: {
      sessionId: p.sessionId,
      isVoided: false,
      entryType: LedgerEntryType.DEPOSIT,
      classification: LedgerEntryClassification.NON_TAXABLE,
    },
    _sum: { amount: true },
  });
  const onBill = new Decimal((depositLines._sum.amount ?? 0).toString());
  const deposit = Decimal.max(0, Decimal.min(onBill, p.amount));
  const depositCash = Decimal.min(deposit, p.cash);
  const depositOnline = Decimal.min(deposit.sub(depositCash), p.online);

  const parts = [
    {
      idempotencyKey: `pt:${p.idempotencyKey}`,
      purpose: sessionTypeToPurpose(p.sessionType),
      total: p.amount.sub(deposit),
      cash: p.cash.sub(depositCash),
      online: p.online.sub(depositOnline),
    },
    {
      idempotencyKey: `pt:${p.idempotencyKey}:deposit`,
      purpose: PaymentPurpose.SAFETY_DEPOSIT,
      total: deposit,
      cash: depositCash,
      online: depositOnline,
    },
  ];
  for (const part of parts) {
    if (part.total.lte(0)) continue;
    await tx.paymentTransaction.create({
      data: {
        ...p.data,
        publicId: createID(),
        idempotencyKey: part.idempotencyKey,
        purpose: part.purpose,
        totalAmount: part.total.toFixed(2),
        cashAmount: part.cash.toFixed(2),
        onlineAmount: part.online.toFixed(2),
      },
    });
  }
}

// ── Serializer ────────────────────────────────────────────────────────────────

/** A stored CGST/SGST part, signed like the line's gstAmount (a coupon's metadata keeps it positive). */
function signedGstPart(part: unknown, gstAmount: unknown): string {
  const value = new Decimal(String(part ?? "0")).abs();
  return (new Decimal(String(gstAmount ?? "0")).lt(0) ? value.negated() : value).toFixed(2);
}

function serializeSession(session: any) {
  return {
    publicId: session.publicId,
    sessionType: session.sessionType,
    status: session.status,
    netPayable: new Decimal(session.netPayable.toString()).toFixed(2),
    totalCharges: new Decimal(session.totalCharges.toString()).toFixed(2),
    totalDiscounts: new Decimal(session.totalDiscounts.toString()).toFixed(2),
    totalPaymentsRecorded: new Decimal(session.totalPaymentsRecorded.toString()).toFixed(2),
    taxableBase: new Decimal(session.taxableBase.toString()).toFixed(2),
    nonTaxableBase: new Decimal(session.nonTaxableBase.toString()).toFixed(2),
    gstAmount: new Decimal(session.gstAmount.toString()).toFixed(2),
    isRefund: new Decimal(session.netPayable.toString()).lt(0),
    entries: (session.entries ?? []).map((e: any) => ({
      publicId: e.publicId,
      entryType: e.entryType,
      classification: e.classification,
      amount: new Decimal(e.amount.toString()).toFixed(2),
      gstAmount: new Decimal(e.gstAmount?.toString() ?? "0").toFixed(2),
      // Same per-line GST fields as the pickup / return session serializers (#23)
      baseAmount: new Decimal(e.baseAmount?.toString() ?? "0").toFixed(2),
      cgst: signedGstPart(e.metadata?.cgst ?? e.metadata?.cgstAmount, e.gstAmount),
      sgst: signedGstPart(e.metadata?.sgst ?? e.metadata?.sgstAmount, e.gstAmount),
      description: e.description,
      referenceId: e.referenceId,
      referenceType: e.referenceType,
      isVoided: e.isVoided,
      createdAt: e.createdAt,
    })),
  };
}

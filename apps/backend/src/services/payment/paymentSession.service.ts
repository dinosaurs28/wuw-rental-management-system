import Decimal from "decimal.js";
import {
  prisma,
  PaymentSessionStatus,
  PaymentSessionType,
  LedgerEntryClassification,
} from "@repo/database/client";
import type { PrismaClient } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../staffActivity/staffActivity.service.js";

export type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export interface SessionTotals {
  taxableBase: Decimal;
  nonTaxableBase: Decimal;
  gstAmount: Decimal;
  totalCharges: Decimal;
  totalDiscounts: Decimal;
  totalPaymentsRecorded: Decimal;
  netPayable: Decimal;
}

// Valid status transitions
const ALLOWED_TRANSITIONS: Record<PaymentSessionStatus, PaymentSessionStatus[]> = {
  OPEN: [PaymentSessionStatus.COMPUTING, PaymentSessionStatus.AWAITING_PAYMENT, PaymentSessionStatus.ABANDONED],
  COMPUTING: [PaymentSessionStatus.AWAITING_PAYMENT, PaymentSessionStatus.ABANDONED],
  AWAITING_PAYMENT: [PaymentSessionStatus.PAYMENT_INITIATED, PaymentSessionStatus.COMPLETED, PaymentSessionStatus.ABANDONED],
  PAYMENT_INITIATED: [PaymentSessionStatus.COMPLETED, PaymentSessionStatus.AWAITING_PAYMENT, PaymentSessionStatus.ABANDONED],
  COMPLETED: [],
  ABANDONED: [],
};

export class PaymentSessionService {
  /**
   * Creates a new PaymentSession for a booking and sets it as the active session.
   * If the booking already has an OPEN/AWAITING_PAYMENT session of the same type,
   * returns it instead of creating a duplicate.
   */
  async createSession(
    bookingId: number,
    branchId: number,
    sessionType: PaymentSessionType,
    actorId: number,
    tx?: TxClient,
  ): Promise<any> {
    const db = tx ?? prisma;

    // Check for existing open session of the same type
    const existing = await db.paymentSession.findFirst({
      where: {
        bookingId,
        sessionType,
        status: { in: [PaymentSessionStatus.OPEN, PaymentSessionStatus.COMPUTING, PaymentSessionStatus.AWAITING_PAYMENT, PaymentSessionStatus.PAYMENT_INITIATED] },
      },
      include: { entries: { where: { isVoided: false } } },
    });

    if (existing) return existing;

    const session = await db.paymentSession.create({
      data: {
        publicId: createID(),
        bookingId,
        branchId,
        sessionType,
        status: PaymentSessionStatus.OPEN,
        actorId,
      },
      include: { entries: true },
    });

    // Set as active on the booking
    await db.booking.update({
      where: { id: bookingId },
      data: { activePaymentSessionId: session.id },
    });

    return session;
  }

  /**
   * Fetches a session with all non-voided ledger entries.
   */
  async getSession(sessionPublicId: string, tx?: TxClient): Promise<any> {
    const db = tx ?? prisma;
    return db.paymentSession.findUnique({
      where: { publicId: sessionPublicId },
      include: { entries: { where: { isVoided: false }, orderBy: { createdAt: "asc" } } },
    });
  }

  /**
   * Fetches the active session for a booking (by bookingPublicId).
   */
  async getActiveSessionForBooking(bookingPublicId: string, tx?: TxClient): Promise<any> {
    const db = tx ?? prisma;
    const booking = await db.booking.findUnique({
      where: { publicId: bookingPublicId },
      select: { id: true, activePaymentSessionId: true },
    });
    if (!booking?.activePaymentSessionId) return null;

    return db.paymentSession.findUnique({
      where: { id: booking.activePaymentSessionId },
      include: { entries: { where: { isVoided: false }, orderBy: { createdAt: "asc" } } },
    });
  }

  /**
   * Recomputes all cached total fields on the session from live ledger entries.
   * Must be called inside a transaction whenever entries are mutated.
   */
  async recomputeTotals(sessionId: number, tx?: TxClient) {
    const db = tx ?? prisma;

    const entries = await db.ledgerEntry.findMany({
      where: { sessionId, isVoided: false },
    });

    const totals = this._aggregateEntries(entries);

    await db.paymentSession.update({
      where: { id: sessionId },
      data: {
        taxableBase: totals.taxableBase.toFixed(2),
        nonTaxableBase: totals.nonTaxableBase.toFixed(2),
        gstAmount: totals.gstAmount.toFixed(2),
        totalCharges: totals.totalCharges.toFixed(2),
        totalDiscounts: totals.totalDiscounts.toFixed(2),
        totalPaymentsRecorded: totals.totalPaymentsRecorded.toFixed(2),
        netPayable: totals.netPayable.toFixed(2),
      },
    });

    return totals;
  }

  /**
   * Pure aggregation — no DB writes. Used for pre-payment validation.
   */
  computeTotals(entries: Array<{ classification: LedgerEntryClassification; amount: string | number | Decimal; gstAmount: string | number | Decimal }>): SessionTotals {
    return this._aggregateEntries(entries as any);
  }

  /**
   * Transitions session status with allowed-transition validation.
   */
  async updateStatus(
    sessionId: number,
    newStatus: PaymentSessionStatus,
    extraData?: { idempotencyKey?: string; gatewayTransactionId?: string; gatewayPaymentUrl?: string; completedAt?: Date },
    tx?: TxClient,
  ): Promise<any> {
    const db = tx ?? prisma;

    const session = await db.paymentSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { status: true },
    });

    const allowed = ALLOWED_TRANSITIONS[session.status];
    if (!allowed.includes(newStatus)) {
      throw new Error(`Invalid session transition: ${session.status} → ${newStatus}`);
    }

    return db.paymentSession.update({
      where: { id: sessionId },
      data: {
        status: newStatus,
        ...(extraData?.idempotencyKey && { idempotencyKey: extraData.idempotencyKey }),
        ...(extraData?.gatewayTransactionId && { gatewayTransactionId: extraData.gatewayTransactionId }),
        ...(extraData?.gatewayPaymentUrl && { gatewayPaymentUrl: extraData.gatewayPaymentUrl }),
        ...(newStatus === PaymentSessionStatus.COMPLETED && { completedAt: extraData?.completedAt ?? new Date() }),
      },
    });
  }

  /**
   * Marks the session as ABANDONED and clears the booking's activePaymentSessionId.
   * Logs audit entry.
   */
  async abandonSession(
    sessionId: number,
    actorId: number,
    actorName: string,
    actorRole: string,
    reason: string,
    tx?: TxClient,
  ) {
    const db = tx ?? prisma;

    const session = await db.paymentSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { id: true, publicId: true, bookingId: true, status: true },
    });

    await db.paymentSession.update({
      where: { id: sessionId },
      data: { status: PaymentSessionStatus.ABANDONED },
    });

    await db.booking.update({
      where: { id: session.bookingId },
      data: { activePaymentSessionId: null },
    });

    // Audit outside transaction scope — caller should call this after tx completes
    await auditService.log({
      actorId,
      actorName,
      actorRole: actorRole as any,
      action: "PAYMENT_SESSION_ABANDONED",
      category: AuditCategory.PAYMENT,
      description: `Payment session ${session.publicId} abandoned: ${reason}`,
      entity: "PaymentSession",
      entityId: session.publicId,
      metadata: { reason },
    });
  }

  /**
   * Marks the session as COMPLETED, clears the booking's activePaymentSessionId,
   * and logs audit + activity entries.
   */
  async completeSession(
    sessionId: number,
    bookingId: number,
    actorId: number,
    actorName: string,
    actorRole: string,
    branchId: number,
    tx?: TxClient,
  ): Promise<any> {
    const db = tx ?? prisma;

    const session = await db.paymentSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { publicId: true, sessionType: true, netPayable: true },
    });

    await this.updateStatus(sessionId, PaymentSessionStatus.COMPLETED, { completedAt: new Date() }, db);

    await db.booking.update({
      where: { id: bookingId },
      data: { activePaymentSessionId: null },
    });

    // Audit + activity written outside transaction by caller
    return session;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _aggregateEntries(
    entries: Array<{ classification: LedgerEntryClassification; amount: any; gstAmount: any }>,
  ): SessionTotals {
    let taxableBase = new Decimal(0);
    let nonTaxableBase = new Decimal(0);
    let gstAmount = new Decimal(0);
    let totalDiscounts = new Decimal(0);
    let totalPaymentsRecorded = new Decimal(0);

    for (const e of entries) {
      const amt = new Decimal(e.amount.toString());
      const gst = new Decimal(e.gstAmount?.toString() ?? "0");

      switch (e.classification) {
        case LedgerEntryClassification.TAXABLE:
          taxableBase = taxableBase.add(amt);
          gstAmount = gstAmount.add(gst);
          break;
        case LedgerEntryClassification.NON_TAXABLE:
          nonTaxableBase = nonTaxableBase.add(amt);
          break;
        case LedgerEntryClassification.DISCOUNT:
          totalDiscounts = totalDiscounts.add(amt); // negative
          break;
        case LedgerEntryClassification.PAYMENT:
          totalPaymentsRecorded = totalPaymentsRecorded.add(amt); // negative
          break;
      }
    }

    const totalCharges = taxableBase.add(gstAmount).add(nonTaxableBase);
    const netPayable = totalCharges.add(totalDiscounts).add(totalPaymentsRecorded);

    return {
      taxableBase,
      nonTaxableBase,
      gstAmount,
      totalCharges,
      totalDiscounts,
      totalPaymentsRecorded,
      netPayable,
    };
  }
}

export const paymentSessionService = new PaymentSessionService();

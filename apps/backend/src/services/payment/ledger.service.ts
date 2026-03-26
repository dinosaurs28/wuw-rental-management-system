import Decimal from "decimal.js";
import {
  prisma,
  LedgerEntryType,
  LedgerEntryClassification,
} from "@repo/database/client";
import type { PrismaClient } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { paymentSessionService } from "./paymentSession.service.js";
import type { TxClient } from "./paymentSession.service.js";

export interface AddEntryOptions {
  baseAmount?: Decimal | number;
  gstAmount?: Decimal | number;
  referenceId?: string;
  referenceType?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface TaxableEntryResult {
  baseAmount: Decimal;
  gstAmount: Decimal;
  totalAmount: Decimal;
  classification: LedgerEntryClassification;
}

/**
 * Maps charge-engine ChargeType moduleKey → LedgerEntryType + classification.
 */
const CHARGE_TYPE_MAP: Record<string, { entryType: LedgerEntryType; classification: LedgerEntryClassification }> = {
  extra_km:         { entryType: LedgerEntryType.EXTRA_KM,        classification: LedgerEntryClassification.TAXABLE },
  extra_time:       { entryType: LedgerEntryType.EXTRA_TIME,       classification: LedgerEntryClassification.TAXABLE },
  fuel_deficit:     { entryType: LedgerEntryType.FUEL,             classification: LedgerEntryClassification.TAXABLE },
  fastag:           { entryType: LedgerEntryType.FASTAG,           classification: LedgerEntryClassification.NON_TAXABLE },
  damage:           { entryType: LedgerEntryType.DAMAGE,           classification: LedgerEntryClassification.TAXABLE },
  grace_adjustment: { entryType: LedgerEntryType.GRACE_ADJUSTMENT, classification: LedgerEntryClassification.NON_TAXABLE },
  base:             { entryType: LedgerEntryType.BOOKING_BASE,     classification: LedgerEntryClassification.TAXABLE },
};

export class LedgerService {
  /**
   * Adds a ledger entry to a session and recomputes session totals.
   * Idempotent: if `idempotencyKey` already exists, returns the existing entry.
   *
   * @param sessionId   Internal PaymentSession.id
   * @param bookingId   Internal Booking.id
   * @param entryType   LedgerEntryType enum value
   * @param classification  TAXABLE | NON_TAXABLE | DISCOUNT | PAYMENT
   * @param amount      Positive = charge; negative = credit/discount/payment
   * @param description Human-readable label
   * @param actorId     User.id of acting employee
   * @param actorRole   Role string
   * @param opts        Optional fields (baseAmount, gstAmount, refs, idempotency key, metadata)
   * @param tx          Optional Prisma transaction client
   */
  async addEntry(
    sessionId: number,
    bookingId: number,
    entryType: LedgerEntryType,
    classification: LedgerEntryClassification,
    amount: Decimal | number,
    description: string,
    actorId: number,
    actorRole: string,
    opts: AddEntryOptions = {},
    tx?: TxClient,
  ): Promise<any> {
    const db = tx ?? prisma;
    const decimalAmount = new Decimal(amount.toString());
    const idempotencyKey = opts.idempotencyKey ?? `${actorId}:${sessionId}:${entryType}:${Date.now()}`;

    // Idempotency check — return existing entry if key already used
    const existingEntry = await db.ledgerEntry.findUnique({
      where: { idempotencyKey },
    });
    if (existingEntry) return existingEntry;

    // Verify session is still mutable
    const session = await db.paymentSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { status: true },
    });

    if (["COMPLETED", "ABANDONED"].includes(session.status)) {
      throw new Error(`Cannot add entry to a ${session.status} session`);
    }

    const entry = await db.ledgerEntry.create({
      data: {
        publicId: createID(),
        sessionId,
        bookingId,
        entryType,
        classification,
        amount: decimalAmount.toFixed(2),
        baseAmount: opts.baseAmount != null ? new Decimal(opts.baseAmount.toString()).toFixed(2) : "0.00",
        gstAmount: opts.gstAmount != null ? new Decimal(opts.gstAmount.toString()).toFixed(2) : "0.00",
        description,
        referenceId: opts.referenceId ?? null,
        referenceType: opts.referenceType ?? null,
        idempotencyKey,
        actorId,
        actorRole,
        metadata: opts.metadata ? (opts.metadata as any) : undefined,
      },
    });

    // Recompute session totals after every mutation
    await paymentSessionService.recomputeTotals(sessionId, db);

    return entry;
  }

  /**
   * Soft-voids a ledger entry and recomputes totals.
   * Only allowed when session is OPEN, COMPUTING, or AWAITING_PAYMENT.
   */
  async voidEntry(
    entryPublicId: string,
    actorId: number,
    voidReason: string,
    tx?: TxClient,
  ) {
    const db = tx ?? prisma;

    const entry = await db.ledgerEntry.findUniqueOrThrow({
      where: { publicId: entryPublicId },
      include: { session: { select: { status: true } } },
    });

    if (entry.isVoided) throw new Error("Entry is already voided");

    const mutableStatuses = ["OPEN", "COMPUTING", "AWAITING_PAYMENT"];
    if (!mutableStatuses.includes(entry.session.status)) {
      throw new Error(`Cannot void entry on a ${entry.session.status} session`);
    }

    await db.ledgerEntry.update({
      where: { id: entry.id },
      data: {
        isVoided: true,
        voidedAt: new Date(),
        voidedById: actorId,
        voidReason,
      },
    });

    await paymentSessionService.recomputeTotals(entry.sessionId, db);
  }

  /**
   * Validates that the provided amount matches the session's computed netPayable
   * within a tolerance of ₹1 (to handle rounding).
   */
  async validateSessionAmount(
    sessionId: number,
    expectedNetPayable: Decimal | number,
    tx?: TxClient,
  ): Promise<{ valid: boolean; delta: Decimal; recomputed: Decimal }> {
    const db = tx ?? prisma;

    const entries = await db.ledgerEntry.findMany({
      where: { sessionId, isVoided: false },
    });

    const totals = paymentSessionService.computeTotals(entries);
    const expected = new Decimal(expectedNetPayable.toString());
    const delta = totals.netPayable.sub(expected).abs();

    return {
      valid: delta.lte(1), // ₹1 tolerance
      delta,
      recomputed: totals.netPayable,
    };
  }

  /**
   * Helper: computes gst on a base amount using branch GST rates.
   * Returns structured result for building a TAXABLE entry.
   */
  buildTaxableEntry(
    baseAmount: Decimal | number,
    cgstRate: number,
    sgstRate: number,
  ): TaxableEntryResult {
    const base = new Decimal(baseAmount.toString());
    const rate = new Decimal(cgstRate).add(sgstRate).div(100);
    const gst = base.mul(rate).toDecimalPlaces(2);
    const total = base.add(gst);

    return {
      baseAmount: base,
      gstAmount: gst,
      totalAmount: total,
      classification: LedgerEntryClassification.TAXABLE,
    };
  }

  /**
   * Converts a ChargeBreakdown result set into LedgerEntry rows on the given session.
   * Handles GRACE_ADJUSTMENT as a NON_TAXABLE credit (negative amount).
   * Called by the return-session flow.
   */
  async addEntriesFromChargeBreakdown(
    sessionId: number,
    bookingId: number,
    chargeResults: Array<{
      moduleKey: string;
      label: string;
      finalAmount: Decimal;
      originalAmount: Decimal;
      chargeType: string;
      isOverridden?: boolean;
      notes?: string;
      skip?: boolean;
    }>,
    actorId: number,
    actorRole: string,
    tx?: TxClient,
  ): Promise<any[]> {
    const db = tx ?? prisma;
    const added: Awaited<ReturnType<typeof this.addEntry>>[] = [];

    for (const result of chargeResults) {
      if (result.skip || result.finalAmount.lte(0)) continue;
      if (result.moduleKey === "base") continue; // base is already paid — don't re-ledger

      const mapping = CHARGE_TYPE_MAP[result.moduleKey];
      if (!mapping) continue;

      // Grace adjustment: negate because it reduces the charge
      const isGrace = result.moduleKey === "grace_adjustment";
      const amount = isGrace ? result.finalAmount.negated() : result.finalAmount;

      const entry = await this.addEntry(
        sessionId,
        bookingId,
        mapping.entryType,
        isGrace ? LedgerEntryClassification.NON_TAXABLE : mapping.classification,
        amount,
        isGrace ? `Grace adjustment: ${result.label}` : result.label,
        actorId,
        actorRole,
        {
          referenceType: "CHARGE_ENTRY",
          referenceId: result.moduleKey,
          idempotencyKey: `${actorId}:${sessionId}:${result.moduleKey}:ce`,
          metadata: {
            originalAmount: result.originalAmount.toFixed(2),
            isOverridden: result.isOverridden ?? false,
            notes: result.notes ?? null,
          },
        },
        db,
      );
      added.push(entry);
    }

    return added;
  }
}

export const ledgerService = new LedgerService();

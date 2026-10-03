/**
 * CREDIT payment option (Oct 2026 TODO #11).
 *
 * At the counter a Fleet Executive may settle a payment step "on credit": the
 * amount stays owed by the customer, something is held as collateral until it
 * is paid, and the branch manager clears it on the Customer Credit page when
 * the money arrives.
 *
 *  - Nothing is paid, so no PaymentTransaction is written. A payment session
 *    is settled with a CREDIT ledger line instead of a PAYMENT line. The
 *    financial state, settlement and over-payment guard (computeBookingOwed)
 *    therefore keep showing the amount as due until it is cleared.
 *  - The booking's CustomerCreditEntry gets a section for it (one entry per
 *    booking, sections appended), with the collateral note, the payment purpose
 *    it stands for and what it came from.
 *  - Clearing a section records a CONFIRMED PaymentTransaction (cash, UPI with
 *    its proof photo, or split) on the clearing manager's open shift, so the
 *    money shows up where it actually arrives (ledger.controller.ts).
 *
 * A safety deposit can't be put on credit (it is money held, and the drop bill
 * would credit back a deposit never taken).
 *
 * Credit is collected only by clearing it: Settlements and the over-payment
 * guard leave it out (creditOutstanding, booking-owed.service.ts). A cancelled
 * booking's pending credit is voided (voidPendingCreditOnCancel).
 */
import Decimal from "decimal.js";
import { prisma, CreditStatus, PaymentPurpose } from "@repo/database/client";
import type { Prisma } from "@repo/database/client";
import { collateralSchema, COLLATERAL_REQUIRED_MESSAGE } from "@repo/schemas";
import { createID } from "../../utils/nanoID.js";
import { StatusCode } from "../../types/statusCode.js";
import { CounterGuardError } from "./counter-guard.service.js";

const ZERO = new Decimal(0);

type Db = Prisma.TransactionClient | typeof prisma;

/** Where a Fleet credit came from — part of the section key, so one credit per source. */
export type CreditSourceType = "PAYMENT_SESSION" | "EXTENSION" | "WALKIN" | "REMAINING_PAYMENT";

/**
 * One section of CustomerCreditEntry.sections. The first seven fields are the
 * original shape (BM "Add credit"); the rest are set on Fleet credits.
 */
export interface CreditSection {
  sectionKey: string;
  label: string;
  amount: number;
  isCleared: boolean;
  clearedAt?: string | null;
  clearedRef?: string | null;
  isCustom?: boolean;
  /** "FLEET_CREDIT" for a payment taken on credit at the counter */
  source?: "FLEET_CREDIT";
  /** What the money pays for — the purpose of the PaymentTransaction recorded on clearing */
  purpose?: PaymentPurpose;
  /** What was taken from the customer until the credit is cleared */
  collateral?: string;
  reference?: { type: CreditSourceType; publicId: string };
  createdAt?: string;
  createdByName?: string;
  /** PaymentTransaction publicIds recorded when the section was cleared */
  clearedPaymentPublicIds?: string[];
  /**
   * Closed without payment because the booking was cancelled (no-show, displaced):
   * nothing is owed on it any more. Also isCleared, so no screen offers it for
   * clearing; left out of the entry's totals.
   */
  voided?: boolean;
  voidReason?: string;
}

/** Totals of a section list, to the paisa (sections store plain numbers). Voided sections don't count. */
export function recalcCreditAggregates(allSections: CreditSection[]) {
  const sections = allSections.filter((s) => !s.voided);
  const total = sections.reduce((sum, s) => sum.add(new Decimal(String(s.amount))), ZERO);
  const cleared = sections
    .filter((s) => s.isCleared)
    .reduce((sum, s) => sum.add(new Decimal(String(s.amount))), ZERO);
  const pending = total.sub(cleared);
  let status: CreditStatus = CreditStatus.PENDING;
  if (pending.lte(0)) status = CreditStatus.CLEARED;
  else if (cleared.gt(0)) status = CreditStatus.PARTIALLY_CLEARED;
  return {
    totalAmount: total.toDecimalPlaces(2).toNumber(),
    clearedAmount: cleared.toDecimalPlaces(2).toNumber(),
    pendingAmount: pending.toDecimalPlaces(2).toNumber(),
    status,
  };
}

/**
 * The collateral note a CREDIT payment must carry: trimmed, 3–300 chars.
 * Throws 400 COLLATERAL_REQUIRED.
 */
export function parseCollateral(raw: unknown): string {
  const parsed = collateralSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CounterGuardError(
      StatusCode.BAD_REQUEST,
      "COLLATERAL_REQUIRED",
      parsed.error.issues[0]?.message ?? COLLATERAL_REQUIRED_MESSAGE,
    );
  }
  return parsed.data;
}

/** Serialises credit changes on one booking (Fleet credits and BM clearances). */
export async function lockBookingCredit(tx: Prisma.TransactionClient, bookingId: number): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"customer-credit:" + bookingId}))`;
}

export interface AddFleetCreditInput {
  bookingId: number;
  amount: Decimal;
  purpose: PaymentPurpose;
  label: string;
  collateral: string;
  reference: { type: CreditSourceType; publicId: string };
  actor: { id: number; name: string };
}

/**
 * Adds a Fleet credit section to the booking's CustomerCreditEntry (creating
 * the entry on first use). Runs inside the caller's transaction, so the credit
 * exists exactly when the payment step it settles does.
 */
export async function addFleetCredit(
  tx: Prisma.TransactionClient,
  input: AddFleetCreditInput,
): Promise<{ creditEntryPublicId: string; sectionKey: string; pendingAmount: number }> {
  const amount = input.amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (amount.lte(0)) throw new Error("A credit must be more than ₹0");

  await lockBookingCredit(tx, input.bookingId);

  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: input.bookingId },
    select: { id: true, customerId: true, branchId: true },
  });
  const existing = await tx.customerCreditEntry.findUnique({ where: { bookingId: booking.id } });
  const sections: CreditSection[] = (existing?.sections as CreditSection[] | undefined) ?? [];

  const sectionKey = `credit:${input.reference.type.toLowerCase()}:${input.reference.publicId}`;
  if (sections.some((s) => s.sectionKey === sectionKey)) {
    throw new Error(`Credit for ${input.reference.type} ${input.reference.publicId} is already recorded`);
  }

  const section: CreditSection = {
    sectionKey,
    label: input.label,
    amount: amount.toNumber(),
    isCleared: false,
    clearedAt: null,
    clearedRef: null,
    isCustom: false,
    source: "FLEET_CREDIT",
    purpose: input.purpose,
    collateral: input.collateral,
    reference: input.reference,
    createdAt: new Date().toISOString(),
    createdByName: input.actor.name,
  };
  const merged = [...sections, section];
  const agg = recalcCreditAggregates(merged);

  const entry = await tx.customerCreditEntry.upsert({
    where: { bookingId: booking.id },
    create: {
      publicId: createID(),
      customerId: booking.customerId,
      bookingId: booking.id,
      branchId: booking.branchId,
      createdById: input.actor.id,
      sections: merged as unknown as Prisma.InputJsonValue,
      ...agg,
    },
    update: {
      sections: merged as unknown as Prisma.InputJsonValue,
      ...agg,
    },
    select: { publicId: true },
  });

  return { creditEntryPublicId: entry.publicId, sectionKey, pendingAmount: agg.pendingAmount };
}

/**
 * A cancelled booking owes nothing, so the credit still pending on it is closed:
 * each pending section is marked voided (and isCleared, with the reason), and
 * the entry's totals are recomputed without them — the Customer Credit page,
 * the BM Customers tab and the financial state stop counting it. Runs inside
 * the cancelling transaction. No-op when nothing is pending.
 */
export async function voidPendingCreditOnCancel(
  tx: Prisma.TransactionClient,
  bookingId: number,
  reason: string,
): Promise<{ voidedAmount: number } | null> {
  await lockBookingCredit(tx, bookingId);
  const entry = await tx.customerCreditEntry.findUnique({ where: { bookingId } });
  if (!entry) return null;
  const sections = (entry.sections as unknown as CreditSection[] | null) ?? [];
  if (!sections.some((s) => !s.isCleared)) return null;

  const nowISO = new Date().toISOString();
  let voidedAmount = ZERO;
  const updated = sections.map((s) => {
    if (s.isCleared) return s;
    voidedAmount = voidedAmount.add(new Decimal(String(s.amount)));
    return { ...s, isCleared: true, clearedAt: nowISO, clearedRef: "VOID", voided: true, voidReason: reason };
  });
  await tx.customerCreditEntry.update({
    where: { id: entry.id },
    data: {
      sections: updated as unknown as Prisma.InputJsonValue,
      ...recalcCreditAggregates(updated),
    },
  });
  return { voidedAmount: voidedAmount.toDecimalPlaces(2).toNumber() };
}

export interface BookingCreditSummary {
  creditEntryPublicId: string;
  status: CreditStatus;
  total: Decimal;
  cleared: Decimal;
  /** Still owed on credit (not yet cleared) */
  pending: Decimal;
  /** Collateral notes of the sections still pending */
  collateral: string[];
  pendingSections: Array<{
    sectionKey: string;
    label: string;
    amount: string;
    collateral: string | null;
    purpose: string | null;
    createdAt: string | null;
  }>;
}

/** A booking's credit position, or null when nothing was ever put on credit. */
export async function getBookingCreditSummary(bookingId: number, db: Db = prisma): Promise<BookingCreditSummary | null> {
  const entry = await db.customerCreditEntry.findUnique({
    where: { bookingId },
    select: { publicId: true, status: true, sections: true, totalAmount: true, clearedAmount: true, pendingAmount: true },
  });
  if (!entry) return null;
  const sections = (entry.sections as CreditSection[] | null) ?? [];
  const pendingSections = sections.filter((s) => !s.isCleared);
  return {
    creditEntryPublicId: entry.publicId,
    status: entry.status,
    total: new Decimal(entry.totalAmount.toString()),
    cleared: new Decimal(entry.clearedAmount.toString()),
    pending: new Decimal(entry.pendingAmount.toString()),
    collateral: [...new Set(pendingSections.map((s) => s.collateral).filter((c): c is string => !!c))],
    pendingSections: pendingSections.map((s) => ({
      sectionKey: s.sectionKey,
      label: s.label,
      amount: new Decimal(String(s.amount)).toFixed(2),
      collateral: s.collateral ?? null,
      purpose: s.purpose ?? null,
      createdAt: s.createdAt ?? null,
    })),
  };
}

/** JSON view of a credit summary (money as 2-dp strings). */
export function serializeCreditSummary(summary: BookingCreditSummary | null) {
  if (!summary) return null;
  return {
    creditEntryPublicId: summary.creditEntryPublicId,
    status: summary.status,
    total: summary.total.toFixed(2),
    cleared: summary.cleared.toFixed(2),
    pending: summary.pending.toFixed(2),
    collateral: summary.collateral,
    pendingSections: summary.pendingSections,
  };
}

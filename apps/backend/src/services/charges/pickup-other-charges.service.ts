/**
 * Pickup other charges on the open PICKUP payment session (rules:
 * pickup-other-charges.ts). The caller holds the booking's pickup lock and has
 * checked the bill is still open (lockOpenPickupSession), so two saves never
 * interleave with each other or with the payment.
 */
import Decimal from "decimal.js";
import { LedgerEntryClassification, LedgerEntryType } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { paymentSessionService, type TxClient } from "../payment/paymentSession.service.js";
import {
  PICKUP_OTHER_CHARGE_PART,
  PICKUP_OTHER_CHARGE_REF,
  pickupChargeLines,
  pickupChargesTotal,
  sameCharges,
  type PickupOtherCharge,
} from "./pickup-other-charges.js";

export interface ReplacePickupChargesResult {
  changed: boolean;
  before: Array<{ label: string; amount: string }>;
  after: Array<{ label: string; amount: string }>;
  total: string;
}

/**
 * Replaces the session's pickup other charges with `charges` (the whole set):
 * the live lines are voided and the new ones written, then the totals are
 * recomputed. The same set again changes nothing (no void / re-add churn).
 */
export async function replaceSessionPickupCharges(
  tx: TxClient,
  p: {
    sessionId: number;
    bookingId: number;
    charges: PickupOtherCharge[];
    actor: { id: number; role: string };
  },
): Promise<ReplacePickupChargesResult> {
  const entries = await tx.ledgerEntry.findMany({
    where: { sessionId: p.sessionId, isVoided: false, entryType: LedgerEntryType.DAMAGE, referenceType: PICKUP_OTHER_CHARGE_REF },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, publicId: true, description: true, amount: true, entryType: true, referenceType: true, isVoided: true },
  });
  const current = pickupChargeLines(entries as any[]);
  const before = current.map((c) => ({ label: c.description, amount: new Decimal(c.amount.toString()).toFixed(2) }));
  const after = p.charges.map((c) => ({ label: c.label, amount: c.amount.toFixed(2) }));
  const total = pickupChargesTotal(p.charges).toFixed(2);
  if (sameCharges(current, p.charges)) return { changed: false, before, after: before, total };

  const now = new Date();
  if (current.length > 0) {
    await tx.ledgerEntry.updateMany({
      where: { id: { in: current.map((c: any) => c.id) } },
      data: { isVoided: true, voidedAt: now, voidedById: p.actor.id, voidReason: "Pickup other charges replaced" },
    });
  }
  // createdAt is spaced by the index so the lines read back in the order sent
  for (const [i, c] of p.charges.entries()) {
    await tx.ledgerEntry.create({
      data: {
        publicId: createID(),
        sessionId: p.sessionId,
        bookingId: p.bookingId,
        entryType: LedgerEntryType.DAMAGE,
        classification: LedgerEntryClassification.NON_TAXABLE,
        amount: c.amount.toFixed(2),
        baseAmount: "0.00",
        gstAmount: "0.00",
        description: c.label,
        referenceType: PICKUP_OTHER_CHARGE_REF,
        idempotencyKey: `pickup:${p.bookingId}:other:${p.sessionId}:${createID()}`,
        actorId: p.actor.id,
        actorRole: p.actor.role,
        createdAt: new Date(now.getTime() + i),
        metadata: { part: PICKUP_OTHER_CHARGE_PART, index: i },
      },
    });
  }
  await paymentSessionService.recomputeTotals(p.sessionId, tx);
  return { changed: true, before, after, total };
}

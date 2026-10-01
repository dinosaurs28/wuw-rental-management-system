/**
 * What a booking owes and what has been paid against it — one computation shared
 * by the financial state (Fleet / BM payment summary), the BM settlement and the
 * over-payment guard, so the three always agree.
 *
 * Owed = Booking.totalFinal (rental incl. GST, refundable category deposit and
 * confirmed extensions)
 *      + return charges that sit outside totalFinal:
 *          - Unified Payments drop bill: the RETURN session's charge lines with their
 *            GST, less the drop discount (sessions not abandoned)
 *          - legacy drop: extra km / late return / swap difference ChargeEntry rows
 *            with the GST frozen on them (collected by the BM in Settlements)
 *          - approved damage charged at drop that no drop bill carries
 *      + refundable safety deposit put on a payment-session bill or taken as a
 *        standalone SAFETY_DEPOSIT payment
 *      − safety deposit credited back on a drop bill.
 *
 * The safety deposit is on both sides — the money taken for it counts as paid and
 * the deposit counts as owed until a drop bill credits it — so holding a deposit
 * never reads as an over-payment, and a deposit spent on drop charges (or refunded
 * by the drop bill) settles exactly. This holds for deposits recorded inside a
 * pickup payment (before they got their own SAFETY_DEPOSIT transaction) too, since
 * the deposit side is read from the session ledger.
 *
 * Paid = CONFIRMED money in (refund rows excluded) − refunds paid out
 * (OVERPAYMENT_REFUND / CANCELLATION_REFUND rows).
 */
import Decimal from "decimal.js";
import {
  prisma,
  LedgerEntryClassification,
  LedgerEntryType,
  PaymentPurpose,
  PaymentSessionStatus,
  PaymentSessionType,
} from "@repo/database/client";
import type { TxClient } from "./paymentSession.service.js";
import { legacyReturnChargesTotal } from "../charges/legacy-return-charges.service.js";
import { DROP_DAMAGE_REF, dropDamageAmount } from "../damage/drop-damage.service.js";

const ZERO = new Decimal(0);

/** Purposes of money paid back to the customer (money out, never money in). */
export const REFUND_PAYMENT_PURPOSES: PaymentPurpose[] = [
  PaymentPurpose.OVERPAYMENT_REFUND,
  PaymentPurpose.CANCELLATION_REFUND,
];

/**
 * idempotencyKey prefix of every PaymentTransaction a payment session writes
 * (`pt:<ledger key>`, its deposit part `pt:<ledger key>:deposit`). A session's
 * deposit is read from its ledger, so these rows are not counted again.
 */
export const SESSION_TXN_KEY_PREFIX = "pt:";

export interface BookingOwed {
  /** Booking.totalFinal rounded to paise */
  totalFinal: Decimal;
  /** Unified drop bill(s): charges + GST − drop discount */
  dropBillCharges: Decimal;
  /** Legacy drop ChargeEntry rows + their frozen GST */
  legacyReturnCharges: Decimal;
  /** Approved damage charged at drop that no drop bill carries */
  dropDamageOutsideBill: Decimal;
  /** dropBillCharges + legacyReturnCharges + dropDamageOutsideBill — all outside totalFinal */
  returnCharges: Decimal;
  /** Safety deposit put on a session bill or taken as a standalone SAFETY_DEPOSIT payment */
  safetyDepositCharged: Decimal;
  /** Safety deposit credited back on a drop bill */
  safetyDepositCredited: Decimal;
  /** max(0, charged − credited) — the refundable deposit still held */
  safetyDepositHeld: Decimal;
  /** totalFinal + returnCharges + safetyDepositCharged − safetyDepositCredited */
  totalOwed: Decimal;
}

type DecimalLike = { toString(): string } | number | string;
const dec = (v: DecimalLike | null | undefined) => new Decimal(v == null ? "0" : v.toString());

export async function computeBookingOwed(bookingId: number, tx?: TxClient): Promise<BookingOwed> {
  const db = tx ?? prisma;

  const [booking, entries, legacyReturnCharges, dropDamages, standaloneDeposits] = await Promise.all([
    db.booking.findUnique({ where: { id: bookingId }, select: { totalFinal: true } }),
    // Drop bill lines and safety-deposit lines of every payment session still in play
    db.ledgerEntry.findMany({
      where: {
        bookingId,
        isVoided: false,
        session: { status: { not: PaymentSessionStatus.ABANDONED } },
        OR: [
          { entryType: LedgerEntryType.DEPOSIT },
          { session: { sessionType: PaymentSessionType.RETURN } },
        ],
      },
      select: {
        entryType: true,
        classification: true,
        amount: true,
        gstAmount: true,
        referenceType: true,
        referenceId: true,
        session: { select: { sessionType: true } },
      },
    }),
    legacyReturnChargesTotal(bookingId, db),
    db.damageReport.findMany({
      where: { bookingId, status: "APPROVED", chargedAtDrop: true },
      select: { publicId: true, finalCost: true, estimatedCost: true },
    }),
    // A deposit taken outside a payment session (legacy pickup, BM record payment)
    db.paymentTransaction.findMany({
      where: {
        bookingId,
        purpose: PaymentPurpose.SAFETY_DEPOSIT,
        status: { in: ["COLLECTED", "CONFIRMED"] },
        NOT: { idempotencyKey: { startsWith: SESSION_TXN_KEY_PREFIX } },
      },
      select: { totalAmount: true },
    }),
  ]);
  if (!booking) throw new Error("Booking not found.");

  // Rounded to paise: rows written from JS numbers can carry float noise (e.g. 9885.200000000001)
  const totalFinal = dec(booking.totalFinal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  let dropBillCharges = ZERO;
  let safetyDepositCharged = ZERO;
  let safetyDepositCredited = ZERO;
  const damagesOnBill = new Set<string>();

  for (const e of entries) {
    const amount = dec(e.amount);
    if (e.entryType === LedgerEntryType.DEPOSIT) {
      if (e.classification === LedgerEntryClassification.NON_TAXABLE) {
        safetyDepositCharged = safetyDepositCharged.add(amount);
      } else if (e.classification === LedgerEntryClassification.PAYMENT) {
        safetyDepositCredited = safetyDepositCredited.add(amount.abs());
      }
      continue;
    }
    if (e.session.sessionType !== PaymentSessionType.RETURN) continue;
    switch (e.classification) {
      case LedgerEntryClassification.TAXABLE:
        // amount = taxable value, its GST on top
        dropBillCharges = dropBillCharges.add(amount).add(dec(e.gstAmount));
        break;
      case LedgerEntryClassification.NON_TAXABLE:
        dropBillCharges = dropBillCharges.add(amount);
        break;
      case LedgerEntryClassification.DISCOUNT:
        // amount = −(discount + the GST it takes off)
        dropBillCharges = dropBillCharges.add(amount);
        break;
      default:
        // PAYMENT / REFUND lines are money, not charges
        break;
    }
    if (e.referenceType === DROP_DAMAGE_REF && e.referenceId) damagesOnBill.add(e.referenceId);
  }

  for (const t of standaloneDeposits) safetyDepositCharged = safetyDepositCharged.add(dec(t.totalAmount));

  const dropDamageOutsideBill = dropDamages
    .filter((d) => !damagesOnBill.has(d.publicId))
    .reduce((acc, d) => acc.add(dropDamageAmount(d)), ZERO);

  const returnCharges = dropBillCharges.add(legacyReturnCharges).add(dropDamageOutsideBill);
  const totalOwed = totalFinal.add(returnCharges).add(safetyDepositCharged).sub(safetyDepositCredited);

  return {
    totalFinal,
    dropBillCharges,
    legacyReturnCharges,
    dropDamageOutsideBill,
    returnCharges,
    safetyDepositCharged,
    safetyDepositCredited,
    safetyDepositHeld: Decimal.max(ZERO, safetyDepositCharged.sub(safetyDepositCredited)),
    totalOwed,
  };
}

export interface BookingMoney {
  /** CONFIRMED money in (refund rows excluded) */
  confirmed: Decimal;
  /** COLLECTED money in, awaiting the manager's cash confirmation */
  pending: Decimal;
  /** Refund rows (OVERPAYMENT_REFUND / CANCELLATION_REFUND) — money paid back */
  refundedOut: Decimal;
  /** Payments the gateway refunded in full (status REFUNDED) */
  gatewayRefunded: Decimal;
  /** confirmed − refundedOut */
  netConfirmed: Decimal;
}

/** Splits a booking's PaymentTransactions into money in, pending cash and refunds paid out. */
export function summarizeBookingMoney(
  txns: Array<{ purpose: string; status: string; totalAmount: DecimalLike }>,
): BookingMoney {
  let confirmed = ZERO;
  let pending = ZERO;
  let refundedOut = ZERO;
  let gatewayRefunded = ZERO;
  for (const t of txns) {
    const amt = dec(t.totalAmount);
    if ((REFUND_PAYMENT_PURPOSES as string[]).includes(t.purpose)) {
      if (t.status === "CONFIRMED" || t.status === "COLLECTED") refundedOut = refundedOut.add(amt);
      continue;
    }
    if (t.status === "CONFIRMED") confirmed = confirmed.add(amt);
    else if (t.status === "COLLECTED") pending = pending.add(amt);
    else if (t.status === "REFUNDED") gatewayRefunded = gatewayRefunded.add(amt);
  }
  return { confirmed, pending, refundedOut, gatewayRefunded, netConfirmed: confirmed.sub(refundedOut) };
}

/** A booking's PaymentTransactions summarised by summarizeBookingMoney. */
export async function getBookingMoney(bookingId: number, tx?: TxClient): Promise<BookingMoney> {
  const db = tx ?? prisma;
  const txns = await db.paymentTransaction.findMany({
    where: { bookingId },
    select: { purpose: true, status: true, totalAmount: true },
  });
  return summarizeBookingMoney(txns);
}

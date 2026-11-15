import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import type { Prisma } from "@repo/database/client";
import {
  computeBookingOwed,
  computeBookingsOwed,
  creditOutstanding,
  getBookingMoney,
  getBookingsMoney,
  type BookingMoney,
  type BookingOwed,
} from "./booking-owed.service.js";
import { getBookingCreditSummaries, getBookingCreditSummary, type BookingCreditSummary } from "./customer-credit.service.js";

const ZERO = new Decimal(0);

export interface SettlementSummary {
  bookingId: number;
  bookingPublicId: string;
  bookingStatus: string;
  customerName: string;
  vehicleRegNo: string;
  rentalBalanceRemaining: string; // was remainingRentalBalance
  damageCharges: string;          // was damageChargesTotal
  extensionCharges: string;      // Added
  /**
   * Return charges outside totalFinal (incl. GST): a legacy drop's extra km + late return +
   * vehicle-swap difference collected here, or the Unified Payments drop bill (after its discount)
   */
  returnCharges: string;
  /** Other charges added at the pickup (no GST) — inside the total owed */
  pickupCharges: string;
  alreadyPaid: string;           // was totalCollectedConfirmed; refunds paid out are taken off
  totalCollectedPending: string;
  netPayable: string;
  isSettled: boolean;
  /** Refundable safety deposit taken and not yet credited back on a drop bill */
  safetyDepositHeld: string;
  /** Refunds paid out (OVERPAYMENT_REFUND / CANCELLATION_REFUND) */
  refunded: string;
  /** totalFinal + returnCharges + safety deposit held — what netPayable is measured against */
  totalOwed: string;
  /**
   * Part of what is owed that is on customer credit (#11) — cleared on the Customer
   * Credit page (never more than the booking hasn't paid). Inside netPayable.
   */
  creditPending: string;
  /**
   * What Settlements collects: netPayable less the money on credit (≥ 0). Credit is
   * collected only by clearing it on the Customer Credit page.
   */
  payableExcludingCredit: string;
  /** The customer's publicId — the Customer Credit page is /manager/ledger/:customerPublicId */
  customerPublicId: string;
  /** Collateral held for that credit */
  creditCollateral: string[];
  /** Legacy drop's safety-deposit choice (#6): SET_OFF | REFUND_IN_FULL; null when none was recorded */
  safetyDepositHandling: string | null;
  /** Safety deposit still to pay back to the customer under that choice (refund-deposit endpoint) */
  safetyDepositToRefund: string;
  /**
   * An edit's difference still to be settled at the counter (+ collect, − refund) —
   * left out of netPayable: it is collected / refunded on its own session, never here
   */
  adjustmentPending: string;
  /**
   * Paid beyond what the booking owes (e.g. a legacy drop's charges lowered by an
   * edit after they were collected), the deposit refund aside — refund-overpayment pays it back
   */
  overpaidToRefund: string;
}

export interface PaginatedSettlements {
  settlements: SettlementSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Legacy drop's deposit choice (#6): REFUND_IN_FULL — the deposit still held goes
 * back in full; SET_OFF — what the deposit paid beyond the charges goes back
 * (never more than the deposit itself). Zero when no choice was recorded.
 * `netPayable` = totalOwed − confirmed money (refunds paid out taken off).
 * `creditPending` (creditOutstanding) stays owed against its collateral: the
 * deposit is set off against the charges, not against money on credit (#11).
 */
export function depositToRefund(owed: BookingOwed, netPayable: Decimal, creditPending: Decimal = ZERO): Decimal {
  if (owed.safetyDepositHandling === "REFUND_IN_FULL") return owed.safetyDepositHeld;
  if (owed.safetyDepositHandling === "SET_OFF") {
    return Decimal.min(owed.safetyDepositCharged, Decimal.max(ZERO, netPayable.sub(creditPending).negated()));
  }
  return ZERO;
}

/**
 * Money paid beyond what the booking owes, to pay back (refund-overpayment):
 * what netPayable is below zero, less the deposit refund that already covers
 * part of it (legacy SET_OFF — a REFUND_IN_FULL deposit is still owed until it
 * is refunded, so it isn't in the overpayment).
 */
export function overpaymentToRefund(owed: Pick<BookingOwed, "safetyDepositHandling">, netPayable: Decimal, depositRefund: Decimal): Decimal {
  if (netPayable.gte(0)) return ZERO;
  const coveredByDeposit = owed.safetyDepositHandling === "SET_OFF" ? depositRefund : ZERO;
  return Decimal.max(ZERO, netPayable.negated().sub(coveredByDeposit)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** The booking fields a settlement summary reads (shared by the single and the batched read). */
const SETTLEMENT_BOOKING_SELECT = {
  publicId: true,
  status: true,
  totalFinal: true,
  customer: {
    select: {
      publicId: true,
      user: { select: { name: true } },
    },
  },
  items: {
    select: {
      vehicle: { select: { regNo: true } },
    },
    take: 1,
  },
  damages: {
    where: { status: "APPROVED" },
    select: { finalCost: true, estimatedCost: true, chargedAtDrop: true },
  },
  extensions: {
    where: { extensionStatus: "CONFIRMED" },
    select: { additionalAmount: true },
  },
} satisfies Prisma.BookingSelect;

type SettlementBooking = Prisma.BookingGetPayload<{ select: typeof SETTLEMENT_BOOKING_SELECT }>;

/**
 * The settlement arithmetic (pure) — one rule for calculateSettlement and the batched
 * calculateSettlements, so the Pending Settlements list and a booking's own summary agree.
 */
function assembleSettlement(
  bookingId: number,
  booking: SettlementBooking,
  owed: BookingOwed,
  money: BookingMoney,
  credit: BookingCreditSummary | null,
): SettlementSummary {
  // Sum approved damage charges (use finalCost if set, else estimatedCost)
  const damageCost = (d: { finalCost: unknown; estimatedCost: unknown }) =>
    new Decimal(String(d.finalCost ?? d.estimatedCost));
  const damageChargesTotal = booking.damages.reduce((acc, d) => acc.add(damageCost(d)), ZERO);

  // What the booking owes (computeBookingOwed) — shared with the financial state and the over-payment
  // guard: totalFinal (rounded to paise) + return charges outside it (a legacy drop's
  // ChargeEntry rows with their frozen GST, or the Unified Payments drop bill after
  // its discount; damage billed at drop is on that bill — a damage the manager
  // charged in review is already inside totalFinal) + safety deposit held.
  // Money: refund rows are paid back, so they come off what was paid.
  const { totalFinal, totalOwed } = owed;
  const totalCollectedConfirmed = money.netConfirmed;
  const totalCollectedPending = money.pending;

  // Rental money paid = what was paid less the deposit still held / credited back
  const rentalPaid = totalCollectedConfirmed.sub(owed.safetyDepositCharged.sub(owed.safetyDepositCredited));
  // A goodwill "Refund to customer" came off what was paid and what is owed alike
  const rentalBalanceRemaining = Decimal.max(ZERO, totalFinal.sub(owed.refundsGoodwill).sub(rentalPaid));
  // An edit's difference still open is settled at the counter on its own session
  const netPayable = totalOwed.sub(totalCollectedConfirmed).sub(owed.adjustmentPending);
  // Money on credit stays inside netPayable (the booking isn't settled until it is
  // cleared) but is collected only on the Customer Credit page (#11)
  const creditPending = creditOutstanding(owed, totalCollectedConfirmed, credit?.pending ?? ZERO);
  const payableExcludingCredit = Decimal.max(ZERO, netPayable.sub(creditPending));

  const safetyDepositToRefund = depositToRefund(owed, netPayable, creditPending);
  const overpaidToRefund = overpaymentToRefund(owed, netPayable, safetyDepositToRefund);
  const isSettled =
    netPayable.lte(ZERO) &&
    totalCollectedPending.eq(ZERO) &&
    safetyDepositToRefund.lte(ZERO) &&
    overpaidToRefund.lte(ZERO);

  // Confirmed extension charges (taxable + GST). Informational: every
  // extension finalizer already added them to totalFinal.
  const extensionCharges = booking.extensions.reduce(
    (acc, e) => acc.add(new Decimal(e.additionalAmount.toString())),
    ZERO,
  );

  return {
    bookingId,
    bookingPublicId: booking.publicId,
    bookingStatus: booking.status,
    customerName: booking.customer.user.name,
    vehicleRegNo: booking.items[0]?.vehicle.regNo ?? "N/A",
    rentalBalanceRemaining: rentalBalanceRemaining.toString(),
    damageCharges: damageChargesTotal.toString(),
    extensionCharges: extensionCharges.toString(),
    returnCharges: owed.returnCharges.toString(),
    // Other charges added at the pickup (additive, Nov 15 2026)
    pickupCharges: owed.pickupCharges.toString(),
    alreadyPaid: totalCollectedConfirmed.toString(),
    totalCollectedPending: totalCollectedPending.toString(),
    netPayable: netPayable.toString(),
    isSettled,
    safetyDepositHeld: owed.safetyDepositHeld.toString(),
    refunded: money.refundedOut.toString(),
    totalOwed: totalOwed.toString(),
    creditPending: creditPending.toFixed(2),
    payableExcludingCredit: payableExcludingCredit.toFixed(2),
    customerPublicId: booking.customer.publicId,
    creditCollateral: creditPending.gt(0) ? (credit?.collateral ?? []) : [],
    safetyDepositHandling: owed.safetyDepositHandling,
    safetyDepositToRefund: safetyDepositToRefund.toFixed(2),
    adjustmentPending: owed.adjustmentPending.toFixed(2),
    overpaidToRefund: overpaidToRefund.toFixed(2),
  };
}

/** Bookings per batch in the Pending Settlements list (bounded IN lists / memory). */
const SETTLEMENT_BATCH = 1000;

class SettlementEngineService {
  async calculateSettlement(bookingId: number): Promise<SettlementSummary> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: SETTLEMENT_BOOKING_SELECT,
    });
    if (!booking) throw new Error("Booking not found.");

    const [owed, money, credit] = await Promise.all([
      computeBookingOwed(bookingId),
      getBookingMoney(bookingId),
      getBookingCreditSummary(bookingId),
    ]);
    return assembleSettlement(bookingId, booking, owed, money, credit);
  }

  /**
   * calculateSettlement for many bookings with a fixed number of queries (same reads,
   * same arithmetic). Bookings not found are left out of the map.
   */
  async calculateSettlements(bookingIds: number[]): Promise<Map<number, SettlementSummary>> {
    const out = new Map<number, SettlementSummary>();
    const ids = [...new Set(bookingIds)];
    if (ids.length === 0) return out;
    const [bookings, owedBy, moneyBy, creditBy] = await Promise.all([
      prisma.booking.findMany({
        where: { id: { in: ids } },
        select: { id: true, ...SETTLEMENT_BOOKING_SELECT },
      }),
      computeBookingsOwed(ids),
      getBookingsMoney(ids),
      getBookingCreditSummaries(ids),
    ]);
    for (const b of bookings) {
      const owed = owedBy.get(b.id);
      const money = moneyBy.get(b.id);
      if (!owed || !money) continue;
      out.set(b.id, assembleSettlement(b.id, b, owed, money, creditBy.get(b.id) ?? null));
    }
    return out;
  }

  async listPendingSettlements(
    branchId: number,
    filters: { page?: number; pageSize?: number; minAmount?: number },
  ): Promise<PaginatedSettlements> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    // Every RETURNED booking of the branch is a candidate (RETURNED is final, so this
    // holds the branch's whole return history; whether one is settled is derived money).
    const bookings = await prisma.booking.findMany({
      where: { branchId, status: "RETURNED" },
      select: { id: true },
      orderBy: { updatedAt: "desc" },
    });

    // Nov 2026: computed in batches (a fixed number of queries per batch) instead of
    // ~10 queries per booking one after another — same summaries, same order.
    const summaries: SettlementSummary[] = [];
    for (let i = 0; i < bookings.length; i += SETTLEMENT_BATCH) {
      const chunk = bookings.slice(i, i + SETTLEMENT_BATCH).map((b) => b.id);
      const byId = await this.calculateSettlements(chunk);
      for (const id of chunk) {
        const s = byId.get(id);
        if (!s) throw new Error("Booking not found.");
        if (s.isSettled) continue;
        if (filters.minAmount && new Decimal(s.netPayable).lt(new Decimal(filters.minAmount))) continue;
        summaries.push(s);
      }
    }

    const total = summaries.length;
    const page_items = summaries.slice(skip, skip + pageSize);

    return { settlements: page_items, total, page, pageSize };
  }
}

export const settlementEngineService = new SettlementEngineService();

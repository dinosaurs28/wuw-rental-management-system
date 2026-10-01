import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import type { PaymentTransaction } from "@repo/database/client";
import { computeBookingOwed, summarizeBookingMoney } from "./booking-owed.service.js";

export type PaymentLifecycleState =
  | "UNPAID"
  | "PARTIALLY_PAID"
  | "PAID_PENDING_CONFIRMATION"
  | "FULLY_PAID"
  | "OVERPAID"
  | "REFUNDED";

export interface PaymentTransactionSummary {
  publicId: string;
  purpose: string;
  method: string;
  status: string;
  totalAmount: Decimal;
  collectedAt: Date | null;
  confirmedAt: Date | null;
}

export interface FinancialState {
  bookingId: number;
  bookingPublicId: string;
  totalFinal: Decimal;
  /** Money in (refund rows excluded) */
  totalCollectedConfirmed: Decimal;
  totalCollectedPending: Decimal;
  /** Refunds paid out (refund rows) + payments the gateway refunded */
  totalRefunded: Decimal;
  /** max(0, totalOwed − (totalCollectedConfirmed − refunds paid out)) */
  amountDue: Decimal;
  lifecycleState: PaymentLifecycleState;
  transactions: PaymentTransactionSummary[];
  /** Drop / return charges outside totalFinal (drop bill or legacy return charges, incl. GST, after the drop discount) */
  returnCharges: Decimal;
  /** Refundable safety deposit taken and not yet credited back on a drop bill */
  safetyDepositHeld: Decimal;
  /** What the booking owes: totalFinal + returnCharges + safety deposit taken − deposit credited at drop */
  totalOwed: Decimal;
}

const ZERO = new Decimal(0);

class FinancialStateService {
  async getState(bookingId: number): Promise<FinancialState> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { publicId: true },
    });
    if (!booking) throw new Error("Booking not found.");

    const [txns, owed] = await Promise.all([
      prisma.paymentTransaction.findMany({
        where: { bookingId },
        orderBy: { createdAt: "asc" },
      }),
      // totalFinal (rounded to paise) + drop / return charges + safety deposit held —
      // the same total the BM settlement and the over-payment guard use
      computeBookingOwed(bookingId),
    ]);

    const { totalFinal, totalOwed } = owed;
    // Refund rows are money paid back, not money in
    const money = summarizeBookingMoney(txns);
    const totalCollectedConfirmed = money.confirmed;
    const totalCollectedPending = money.pending;
    const totalRefunded = money.gatewayRefunded.add(money.refundedOut);
    const netConfirmed = money.netConfirmed;

    const amountDue = Decimal.max(ZERO, totalOwed.sub(netConfirmed));

    let lifecycleState: PaymentLifecycleState;
    if (netConfirmed.gte(totalOwed) && totalOwed.gt(ZERO)) {
      lifecycleState = netConfirmed.gt(totalOwed) ? "OVERPAID" : "FULLY_PAID";
    } else if (totalRefunded.gt(ZERO) && netConfirmed.lte(ZERO)) {
      lifecycleState = "REFUNDED";
    } else if (totalCollectedPending.gt(ZERO) && netConfirmed.add(totalCollectedPending).gte(totalOwed)) {
      lifecycleState = "PAID_PENDING_CONFIRMATION";
    } else if (netConfirmed.gt(ZERO) || totalCollectedPending.gt(ZERO)) {
      lifecycleState = "PARTIALLY_PAID";
    } else {
      lifecycleState = "UNPAID";
    }

    const transactions: PaymentTransactionSummary[] = txns.map((t: PaymentTransaction) => ({
      publicId: t.publicId,
      purpose: t.purpose,
      method: t.method,
      status: t.status,
      totalAmount: new Decimal(t.totalAmount.toString()),
      collectedAt: t.collectedAt,
      confirmedAt: t.confirmedAt,
    }));

    return {
      bookingId,
      bookingPublicId: booking.publicId,
      totalFinal,
      totalCollectedConfirmed,
      totalCollectedPending,
      totalRefunded,
      amountDue,
      lifecycleState,
      transactions,
      returnCharges: owed.returnCharges,
      safetyDepositHeld: owed.safetyDepositHeld,
      totalOwed,
    };
  }
}

export const financialStateService = new FinancialStateService();

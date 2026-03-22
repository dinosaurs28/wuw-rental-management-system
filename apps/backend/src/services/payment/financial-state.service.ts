import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import type { PaymentTransaction } from "@repo/database/client";

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
  totalCollectedConfirmed: Decimal;
  totalCollectedPending: Decimal;
  totalRefunded: Decimal;
  amountDue: Decimal;
  lifecycleState: PaymentLifecycleState;
  transactions: PaymentTransactionSummary[];
}

const ZERO = new Decimal(0);

class FinancialStateService {
  async getState(bookingId: number): Promise<FinancialState> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { publicId: true, totalFinal: true },
    });
    if (!booking) throw new Error("Booking not found.");

    const txns = await prisma.paymentTransaction.findMany({
      where: { bookingId },
      orderBy: { createdAt: "asc" },
    });

    const totalFinal = new Decimal(booking.totalFinal.toString());

    let totalCollectedConfirmed = ZERO;
    let totalCollectedPending = ZERO;
    let totalRefunded = ZERO;

    for (const t of txns) {
      const amt = new Decimal(t.totalAmount.toString());
      if (t.status === "CONFIRMED") totalCollectedConfirmed = totalCollectedConfirmed.add(amt);
      else if (t.status === "COLLECTED") totalCollectedPending = totalCollectedPending.add(amt);
      else if (t.status === "REFUNDED") totalRefunded = totalRefunded.add(amt);
    }

    const amountDue = Decimal.max(ZERO, totalFinal.sub(totalCollectedConfirmed));

    let lifecycleState: PaymentLifecycleState;
    if (totalCollectedConfirmed.gte(totalFinal) && totalFinal.gt(ZERO)) {
      lifecycleState = totalCollectedConfirmed.gt(totalFinal) ? "OVERPAID" : "FULLY_PAID";
    } else if (totalRefunded.gt(ZERO) && totalCollectedConfirmed.eq(ZERO)) {
      lifecycleState = "REFUNDED";
    } else if (totalCollectedPending.gt(ZERO) && totalCollectedConfirmed.add(totalCollectedPending).gte(totalFinal)) {
      lifecycleState = "PAID_PENDING_CONFIRMATION";
    } else if (totalCollectedConfirmed.gt(ZERO) || totalCollectedPending.gt(ZERO)) {
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
    };
  }
}

export const financialStateService = new FinancialStateService();

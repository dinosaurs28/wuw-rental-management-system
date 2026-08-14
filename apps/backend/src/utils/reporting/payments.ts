import { prisma, Prisma } from "@repo/database/client";
import {
  COLLECTED_PAYMENT_STATUSES,
  REVENUE_PAYMENT_PURPOSES,
  type SpecPaymentMode,
} from "./constants.js";

export interface PaidAmounts {
  /** Total collected toward rental revenue. */
  total: number;
  /** Portion received as physical cash. */
  cash: number;
  /** Portion received online (UPI + gateway). */
  online: number;
  /** Online portion classified as manual UPI transfer. */
  upi: number;
  /** Online portion classified as a payment gateway (Razorpay etc.). */
  gateway: number;
}

const empty = (): PaidAmounts => ({
  total: 0,
  cash: 0,
  online: 0,
  upi: 0,
  gateway: 0,
});

/**
 * Classify the online portion of a payment as UPI vs Gateway.
 *
 * DATA LIMITATION: PaymentTransaction only splits cash vs online (cashAmount /
 * onlineAmount). The only signal for UPI-vs-gateway is the free-text
 * `onlineGateway` field. Heuristic: a recognised online gateway name -> Gateway;
 * everything else (incl. manual UPI confirmations, null) -> UPI. Documented in
 * the spec-conformance design doc.
 */
export const classifyOnline = (
  gateway: string | null | undefined,
): Extract<SpecPaymentMode, "UPI" | "Gateway"> => {
  if (gateway && /razorpay|stripe|cashfree|payu|paytm|gateway|online|card/i.test(gateway)) {
    return "Gateway";
  }
  return "UPI";
};

/**
 * Canonical per-booking collected amounts. The single source of truth for
 * "amount_paid" across all reports.
 */
export const getPaidByBooking = async (
  bookingIds: number[],
): Promise<Map<number, PaidAmounts>> => {
  const result = new Map<number, PaidAmounts>();
  if (bookingIds.length === 0) return result;

  const txns = await prisma.paymentTransaction.findMany({
    where: {
      bookingId: { in: bookingIds },
      status: { in: COLLECTED_PAYMENT_STATUSES },
      purpose: { in: REVENUE_PAYMENT_PURPOSES },
    },
    select: {
      bookingId: true,
      totalAmount: true,
      cashAmount: true,
      onlineAmount: true,
      onlineGateway: true,
    },
  });

  for (const t of txns) {
    const entry = result.get(t.bookingId) ?? empty();
    const total = Number(t.totalAmount);
    const cash = Number(t.cashAmount);
    const online = Number(t.onlineAmount);
    entry.total += total;
    entry.cash += cash;
    entry.online += online;
    if (online > 0) {
      if (classifyOnline(t.onlineGateway) === "Gateway") entry.gateway += online;
      else entry.upi += online;
    }
    result.set(t.bookingId, entry);
  }

  return result;
};

export interface CollectionTxn {
  bookingId: number;
  collectedAt: Date;
  total: number;
  cash: number;
  online: number;
  upi: number;
  gateway: number;
  onlineGateway: string | null;
  onlineTransactionRef: string | null;
  collectedById: number | null;
}

/**
 * Collections (money actually received) within a date range, anchored on the
 * payment date (collectedAt, fallback createdAt). Used by Collection, Receipt,
 * Daily Summary and Fleet Executive reports.
 */
export const getCollections = async (opts: {
  branchPublicId?: string | null;
  from: Date;
  to: Date;
  collectedById?: number | null;
}): Promise<CollectionTxn[]> => {
  const { branchPublicId, from, to, collectedById } = opts;

  const where: Prisma.PaymentTransactionWhereInput = {
    status: { in: COLLECTED_PAYMENT_STATUSES },
    purpose: { in: REVENUE_PAYMENT_PURPOSES },
    // Payment-date anchor: collectedAt when present, else createdAt.
    OR: [
      { collectedAt: { gte: from, lte: to } },
      { collectedAt: null, createdAt: { gte: from, lte: to } },
    ],
  };

  if (branchPublicId && branchPublicId !== "all") {
    where.branch = { publicId: branchPublicId };
  }
  if (collectedById) {
    where.collectedById = collectedById;
  }

  const txns = await prisma.paymentTransaction.findMany({
    where,
    select: {
      bookingId: true,
      collectedAt: true,
      createdAt: true,
      totalAmount: true,
      cashAmount: true,
      onlineAmount: true,
      onlineGateway: true,
      onlineTransactionRef: true,
      collectedById: true,
    },
    orderBy: [{ collectedAt: "desc" }, { createdAt: "desc" }],
  });

  return txns.map((t) => {
    const online = Number(t.onlineAmount);
    const isGateway = classifyOnline(t.onlineGateway) === "Gateway";
    return {
      bookingId: t.bookingId,
      collectedAt: t.collectedAt ?? t.createdAt,
      total: Number(t.totalAmount),
      cash: Number(t.cashAmount),
      online,
      upi: online > 0 && !isGateway ? online : 0,
      gateway: online > 0 && isGateway ? online : 0,
      onlineGateway: t.onlineGateway,
      onlineTransactionRef: t.onlineTransactionRef,
      collectedById: t.collectedById,
    };
  });
};

/**
 * Safety deposit at drop (Oct 2026 TODO #6).
 *
 * The refundable safety deposit taken at pickup goes back to the customer at
 * drop. Staff choose how:
 *   SET_OFF (default)  — the deposit is credited against the drop charges;
 *                        charges above it are collected (cash / UPI / split /
 *                        credit), a deposit above them is refunded.
 *   REFUND_IN_FULL     — the whole deposit is refunded and the charges are
 *                        collected on their own.
 *
 * Unified Payments (drop bill): both are ledger lines on the RETURN session —
 * the DEPOSIT credit line (−held, PAYMENT) and, for REFUND_IN_FULL, a REFUND
 * line (+held) that is paid out with the session's `depositRefund` choice.
 *
 * Legacy branches (no drop bill): the choice is recorded at the drop on
 * Booking.pricingSnapshot.safetyDepositHandling (+ Booking.safetyDepositSetOff)
 * and honoured by the branch manager's settlement (computeBookingOwed): with
 * SET_OFF the held deposit counts as credited against the charges; with
 * REFUND_IN_FULL it counts as credited only once refunded through
 * POST /branchManager/payment/settlements/:id/refund-deposit (PaymentTransaction
 * idempotencyKey prefix `sdr:`).
 */
import { prisma } from "@repo/database/client";
import type { Prisma } from "@repo/database/client";
import { SAFETY_DEPOSIT_HANDLING, type SafetyDepositHandling } from "@repo/schemas";
import { StatusCode } from "../../types/statusCode.js";

export type { SafetyDepositHandling };

/** Drop-bill line crediting the held deposit back (DEPOSIT, PAYMENT classification). */
export const SAFETY_DEPOSIT_CREDIT_REF = "SAFETY_DEPOSIT_CREDIT";
/** Drop-bill line paying the whole deposit back (REFUND, PAYMENT classification) — REFUND_IN_FULL. */
export const SAFETY_DEPOSIT_REFUND_REF = "SAFETY_DEPOSIT_REFUND";
/** idempotencyKey prefix of a legacy (settlement) deposit refund PaymentTransaction. */
export const LEGACY_DEPOSIT_REFUND_KEY_PREFIX = "sdr:";

export class SafetyDepositHandlingError extends Error {
  readonly status = StatusCode.BAD_REQUEST;
  readonly code = "INVALID_SAFETY_DEPOSIT_HANDLING";
  constructor() {
    super("safetyDepositHandling must be SET_OFF (set off against charges) or REFUND_IN_FULL (refund in full).");
    this.name = "SafetyDepositHandlingError";
  }
  toJSON() {
    return { success: false, code: this.code, message: this.message };
  }
}

/** Omitted / null → null (caller defaults to SET_OFF); anything else must be a known value. */
export function parseSafetyDepositHandling(raw: unknown): SafetyDepositHandling | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "string" && (SAFETY_DEPOSIT_HANDLING as readonly string[]).includes(raw)) {
    return raw as SafetyDepositHandling;
  }
  throw new SafetyDepositHandlingError();
}

export interface StoredDepositHandling {
  mode: SafetyDepositHandling;
  /** LEGACY = recorded at a legacy drop, settled by the BM; DROP_BILL = settled on the drop bill */
  flow: "LEGACY" | "DROP_BILL";
  decidedAt: string;
  decidedById: number;
}

/** The deposit choice stored on a booking's pricing snapshot, if any. */
export function readDepositHandling(pricingSnapshot: unknown): StoredDepositHandling | null {
  const raw = (pricingSnapshot as { safetyDepositHandling?: unknown } | null)?.safetyDepositHandling as
    | Partial<StoredDepositHandling>
    | undefined;
  if (!raw || typeof raw !== "object") return null;
  if (!raw.mode || !(SAFETY_DEPOSIT_HANDLING as readonly string[]).includes(raw.mode)) return null;
  return {
    mode: raw.mode,
    flow: raw.flow === "DROP_BILL" ? "DROP_BILL" : "LEGACY",
    decidedAt: String(raw.decidedAt ?? ""),
    decidedById: Number(raw.decidedById ?? 0),
  };
}

/** The legacy-drop choice the BM settlement honours, or null. */
export function readLegacyDepositHandling(pricingSnapshot: unknown): SafetyDepositHandling | null {
  const stored = readDepositHandling(pricingSnapshot);
  return stored && stored.flow === "LEGACY" ? stored.mode : null;
}

/**
 * Stores the choice on the booking (pricing snapshot + safetyDepositSetOff).
 * Runs inside the caller's transaction.
 */
export async function recordDepositHandling(
  tx: Prisma.TransactionClient | typeof prisma,
  bookingId: number,
  mode: SafetyDepositHandling,
  flow: StoredDepositHandling["flow"],
  actorId: number,
): Promise<void> {
  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { pricingSnapshot: true },
  });
  const snapshot = (booking.pricingSnapshot ?? {}) as Record<string, unknown>;
  const stored: StoredDepositHandling = {
    mode,
    flow,
    decidedAt: new Date().toISOString(),
    decidedById: actorId,
  };
  await tx.booking.update({
    where: { id: bookingId },
    data: {
      safetyDepositSetOff: mode === "SET_OFF",
      pricingSnapshot: { ...snapshot, safetyDepositHandling: stored } as unknown as Prisma.InputJsonValue,
    },
  });
}

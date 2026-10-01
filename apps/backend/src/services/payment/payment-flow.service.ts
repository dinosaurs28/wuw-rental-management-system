import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";

/**
 * Customer self-serve payment plan (website + app bookings only — Fleet
 * walk-ins are always paid in full at the counter).
 *
 * BranchPaymentConfig.customerPaymentMode decides which plans a branch offers;
 * the amounts decide whether the advance plan is usable at all: the advance
 * must be > 0 and strictly below the full payable total (rental after duration
 * and coupon discounts + GST + refundable deposit). The server is the source of
 * truth — a requested plan the branch or the amounts don't allow is converted
 * (never rejected) and the response says so.
 */

export type CustomerPaymentMode = "ADVANCE_ONLY" | "FULL_ONLY" | "BOTH";
export type PaymentFlow = "FULL" | "ADVANCE";
export type PaymentFlowReason =
  | "BRANCH_FULL_ONLY"
  | "BRANCH_ADVANCE_ONLY"
  | "NO_ADVANCE_CONFIGURED"
  | "ADVANCE_NOT_BELOW_TOTAL";

export const DEFAULT_CUSTOMER_PAYMENT_MODE: CustomerPaymentMode = "ADVANCE_ONLY";

export const PAYMENT_FLOW_REASON_MESSAGES: Record<PaymentFlowReason, string> = {
  BRANCH_FULL_ONLY: "This branch takes the full amount when you book.",
  BRANCH_ADVANCE_ONLY: "This branch takes an advance now and the rest at pickup.",
  NO_ADVANCE_CONFIGURED: "Paying an advance isn't available for this vehicle, so the full amount is charged now.",
  ADVANCE_NOT_BELOW_TOTAL: "The advance would cover the whole amount, so the full amount is charged now.",
};

export interface PaymentOptions {
  /** Branch setting (ADVANCE_ONLY when the branch has no payment config). */
  mode: CustomerPaymentMode;
  /** Configured advance (sum of the vehicles' advancePayAmount). */
  advanceAmount: number;
  /** Full amount payable in FULL mode incl. GST and deposit; null when no dates were given. */
  payableTotal: number | null;
  /**
   * Amount check only: advance > 0 and advance < payableTotal. null when there is
   * no total yet (no dates) — then only advance > 0 was checked.
   */
  advanceEligible: boolean | null;
  /** Plans the customer may pick, in display order. One entry = no chooser. */
  allowedFlows: PaymentFlow[];
  /** Plan to preselect (FULL when both are allowed). */
  defaultFlow: PaymentFlow;
  /** Why ADVANCE is not offered (or is forced), null when nothing is restricted. */
  reason: PaymentFlowReason | null;
  reasonMessage: string | null;
  /** What is due at pickup on the advance plan (payableTotal − advance), when it applies. */
  remainingAfterAdvance: number | null;
}

const round2 = (n: Decimal) => Number(n.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());

export function normalizePaymentMode(mode: string | null | undefined): CustomerPaymentMode {
  return mode === "FULL_ONLY" || mode === "BOTH" || mode === "ADVANCE_ONLY"
    ? mode
    : DEFAULT_CUSTOMER_PAYMENT_MODE;
}

/** The branch's customer payment mode (ADVANCE_ONLY when no config row exists). */
export async function getCustomerPaymentMode(branchId: number): Promise<CustomerPaymentMode> {
  const config = await prisma.branchPaymentConfig.findUnique({
    where: { branchId },
    select: { customerPaymentMode: true },
  });
  return normalizePaymentMode(config?.customerPaymentMode);
}

export function resolvePaymentOptions(input: {
  mode: CustomerPaymentMode | string | null | undefined;
  advanceAmount: Decimal | number | string | null | undefined;
  payableTotal: Decimal | number | string | null | undefined;
}): PaymentOptions {
  const mode = normalizePaymentMode(input.mode as string | null | undefined);
  const advance = new Decimal(input.advanceAmount?.toString() ?? "0");
  const total = input.payableTotal == null ? null : new Decimal(input.payableTotal.toString());

  const advanceConfigured = advance.gt(0);
  const advanceEligible: boolean | null =
    total == null ? (advanceConfigured ? null : false) : advanceConfigured && advance.lt(total);
  // With no total yet the advance is offered on the strength of advance > 0
  const advanceUsable = advanceEligible ?? advanceConfigured;
  const amountReason: PaymentFlowReason | null = !advanceConfigured
    ? "NO_ADVANCE_CONFIGURED"
    : advanceEligible === false
      ? "ADVANCE_NOT_BELOW_TOTAL"
      : null;

  let allowedFlows: PaymentFlow[];
  let defaultFlow: PaymentFlow;
  let reason: PaymentFlowReason | null;
  if (mode === "FULL_ONLY") {
    allowedFlows = ["FULL"];
    defaultFlow = "FULL";
    reason = "BRANCH_FULL_ONLY";
  } else if (mode === "ADVANCE_ONLY") {
    allowedFlows = advanceUsable ? ["ADVANCE"] : ["FULL"];
    defaultFlow = allowedFlows[0]!;
    reason = advanceUsable ? "BRANCH_ADVANCE_ONLY" : amountReason;
  } else {
    allowedFlows = advanceUsable ? ["FULL", "ADVANCE"] : ["FULL"];
    defaultFlow = "FULL";
    reason = advanceUsable ? null : amountReason;
  }

  return {
    mode,
    advanceAmount: round2(advance),
    payableTotal: total == null ? null : round2(total),
    advanceEligible,
    allowedFlows,
    defaultFlow,
    reason,
    reasonMessage: reason ? PAYMENT_FLOW_REASON_MESSAGES[reason] : null,
    remainingAfterAdvance:
      total != null && allowedFlows.includes("ADVANCE") ? round2(total.sub(advance)) : null,
  };
}

export interface CustomerPaymentSummary {
  /** Amount the customer has paid for the booking (0 until the payment succeeds). */
  paid: number;
  /** Balance still owed on an advance booking (0 when nothing is due). */
  balanceDue: number;
  /** When the balance is collected: PICKUP before handover, DROP once picked up. */
  balanceDueAt: "PICKUP" | "DROP" | null;
  dueAtPickup: number;
  dueAtDrop: number;
}

/**
 * What a customer has paid and still owes, for booking lists/details. A HOLD,
 * expired, failed or refunded booking shows nothing paid; an advance booking
 * owes its remaining balance until it is collected (at pickup, or at drop once
 * the vehicle is out).
 */
export function customerPaymentSummary(b: {
  status: string;
  paymentStatus: string;
  isAdvancePayment: boolean;
  advanceAmount: { toString(): string } | number | null;
  remainingBalance: { toString(): string } | number | null;
  remainingPaidAt: Date | null;
  totalFinal: { toString(): string } | number;
}): CustomerPaymentSummary {
  const toN = (v: { toString(): string } | number | null) => round2(new Decimal(v?.toString() ?? "0"));
  const succeeded = b.paymentStatus === "SUCCESS";
  const balanceOpen = succeeded && b.isAdvancePayment && !b.remainingPaidAt;
  const paid = !succeeded ? 0 : balanceOpen ? toN(b.advanceAmount) : toN(b.totalFinal);
  const live = b.status === "CONFIRMED" || b.status === "PICKED_UP";
  const balanceDue = balanceOpen && live ? Math.max(0, toN(b.remainingBalance)) : 0;
  const balanceDueAt = balanceDue > 0 ? (b.status === "PICKED_UP" ? "DROP" : "PICKUP") : null;
  return {
    paid,
    balanceDue,
    balanceDueAt,
    dueAtPickup: balanceDueAt === "PICKUP" ? balanceDue : 0,
    dueAtDrop: balanceDueAt === "DROP" ? balanceDue : 0,
  };
}

export interface EffectiveFlow {
  flow: PaymentFlow;
  adjusted: boolean;
  reason: PaymentFlowReason | null;
  message: string | null;
}

/** Convert a requested plan into the one the branch and amounts allow. */
export function resolveEffectiveFlow(requested: PaymentFlow, options: PaymentOptions): EffectiveFlow {
  const flow = options.allowedFlows.includes(requested) ? requested : options.defaultFlow;
  const adjusted = flow !== requested;
  let reason: PaymentFlowReason | null = null;
  if (adjusted) {
    reason =
      options.mode === "FULL_ONLY"
        ? "BRANCH_FULL_ONLY"
        : flow === "ADVANCE"
          ? "BRANCH_ADVANCE_ONLY"
          : options.reason ?? "NO_ADVANCE_CONFIGURED";
  }
  return { flow, adjusted, reason, message: reason ? PAYMENT_FLOW_REASON_MESSAGES[reason] : null };
}

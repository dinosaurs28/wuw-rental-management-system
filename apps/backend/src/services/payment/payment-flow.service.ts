import Decimal from "decimal.js";
import type { DiscountRule } from "@repo/database/client";
import { couponValidationService } from "../discount/coupon-validation.service.js";

/**
 * Customer self-serve payment plan (website + app bookings only — Fleet
 * walk-ins are always paid in full at the counter).
 *
 * Item 18 (Oct 2026) — ADVANCE PAYMENT ONLY: a customer booking always pays
 * the vehicle's advance online and the balance at pickup. The branch's
 * BranchPaymentConfig.customerPaymentMode column is kept but no longer read —
 * every branch reports and enforces ADVANCE_ONLY. The amounts still decide
 * whether the advance is usable: it must be > 0 and strictly below the full
 * payable total (rental after duration and coupon discounts + GST + refundable
 * deposit); otherwise the booking is paid in FULL and says why. The server is
 * the source of truth — a requested plan is converted (never rejected) and the
 * response says so.
 */

export type CustomerPaymentMode = "ADVANCE_ONLY" | "FULL_ONLY" | "BOTH";
export type PaymentFlow = "FULL" | "ADVANCE";
export type PaymentFlowReason =
  | "BRANCH_FULL_ONLY"
  | "BRANCH_ADVANCE_ONLY"
  | "NO_ADVANCE_CONFIGURED"
  | "ADVANCE_NOT_BELOW_TOTAL";

/** The one customer payment mode (item 18) — the branch setting is ignored. */
export const CUSTOMER_PAYMENT_MODE: CustomerPaymentMode = "ADVANCE_ONLY";
export const DEFAULT_CUSTOMER_PAYMENT_MODE: CustomerPaymentMode = CUSTOMER_PAYMENT_MODE;

export const PAYMENT_FLOW_REASON_MESSAGES: Record<PaymentFlowReason, string> = {
  // No longer produced (item 18); kept so the reason type stays complete.
  BRANCH_FULL_ONLY: "This booking is paid in full now.",
  BRANCH_ADVANCE_ONLY: "You pay an advance now and the rest at pickup.",
  NO_ADVANCE_CONFIGURED: "Paying an advance isn't available for this vehicle, so the full amount is charged now.",
  ADVANCE_NOT_BELOW_TOTAL: "The advance would cover the whole amount, so the full amount is charged now.",
};

export interface PaymentOptions {
  /** Always ADVANCE_ONLY (item 18); the branch's stored mode is ignored. */
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
  /** The one plan this booking is paid with (item 18: never a choice). */
  allowedFlows: PaymentFlow[];
  /** = allowedFlows[0]. */
  defaultFlow: PaymentFlow;
  /** BRANCH_ADVANCE_ONLY on the advance plan; on FULL, why the advance can't apply. */
  reason: PaymentFlowReason | null;
  reasonMessage: string | null;
  /** What is due at pickup on the advance plan (payableTotal − advance), when it applies. */
  remainingAfterAdvance: number | null;
  /**
   * "Pay ₹X now · ₹Y at pickup": X = the advance (ADVANCE) or the full payable
   * total (FULL; null until dates are known)…
   */
  payNowAmount: number | null;
  /** …and Y = payableTotal − advance (ADVANCE; null without dates) or 0 (FULL). */
  dueAtPickup: number | null;
}

const round2 = (n: Decimal) => Number(n.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());

/** A stored/sent mode value as a known mode (unknown → ADVANCE_ONLY). */
export function normalizePaymentMode(mode: string | null | undefined): CustomerPaymentMode {
  return mode === "FULL_ONLY" || mode === "BOTH" || mode === "ADVANCE_ONLY"
    ? mode
    : DEFAULT_CUSTOMER_PAYMENT_MODE;
}

/**
 * The customer payment mode for a branch — fixed to ADVANCE_ONLY (item 18).
 * BranchPaymentConfig.customerPaymentMode is no longer read; the branch id is
 * kept in the signature for the existing callers.
 */
export async function getCustomerPaymentMode(_branchId?: number): Promise<CustomerPaymentMode> {
  return CUSTOMER_PAYMENT_MODE;
}

/**
 * The plan a customer booking is paid with: ADVANCE when 0 < advance <
 * payable total (no dates yet: when an advance is configured), else FULL with
 * the reason. `mode` is accepted for the existing callers and ignored.
 */
export function resolvePaymentOptions(input: {
  mode?: CustomerPaymentMode | string | null;
  advanceAmount: Decimal | number | string | null | undefined;
  payableTotal: Decimal | number | string | null | undefined;
}): PaymentOptions {
  const mode = CUSTOMER_PAYMENT_MODE;
  const advance = new Decimal(input.advanceAmount?.toString() ?? "0");
  const total = input.payableTotal == null ? null : new Decimal(input.payableTotal.toString());

  const advanceConfigured = advance.gt(0);
  const advanceEligible: boolean | null =
    total == null ? (advanceConfigured ? null : false) : advanceConfigured && advance.lt(total);
  // With no total yet the advance is offered on the strength of advance > 0
  const advanceUsable = advanceEligible ?? advanceConfigured;
  const flow: PaymentFlow = advanceUsable ? "ADVANCE" : "FULL";
  const reason: PaymentFlowReason = advanceUsable
    ? "BRANCH_ADVANCE_ONLY"
    : !advanceConfigured
      ? "NO_ADVANCE_CONFIGURED"
      : "ADVANCE_NOT_BELOW_TOTAL";

  const remainingAfterAdvance =
    total != null && flow === "ADVANCE" ? round2(total.sub(advance)) : null;
  return {
    mode,
    advanceAmount: round2(advance),
    payableTotal: total == null ? null : round2(total),
    advanceEligible,
    allowedFlows: [flow],
    defaultFlow: flow,
    reason,
    reasonMessage: PAYMENT_FLOW_REASON_MESSAGES[reason],
    remainingAfterAdvance,
    payNowAmount: flow === "ADVANCE" ? round2(advance) : total == null ? null : round2(total),
    dueAtPickup: flow === "ADVANCE" ? remainingAfterAdvance : 0,
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
  /**
   * Part of balanceDue left owed at the counter on credit (#11) — not paid yet;
   * the branch collects it against the collateral it holds. 0 when none.
   */
  balanceOnCredit: number;
}

/**
 * What a customer has paid and still owes, for booking lists/details. A HOLD,
 * expired, failed or refunded booking shows nothing paid; an advance booking
 * owes its remaining balance until it is collected (at pickup, or at drop once
 * the vehicle is out).
 *
 * `creditPending` = the booking's CustomerCreditEntry.pendingAmount (#11): money
 * the counter put on credit. The flags read it as paid (a walk-in on credit is
 * SUCCESS, a balance on credit sets remainingPaidAt), so it comes off `paid` and
 * stays in `balanceDue` until the branch manager clears it.
 */
export function customerPaymentSummary(
  b: {
    status: string;
    paymentStatus: string;
    isAdvancePayment: boolean;
    advanceAmount: { toString(): string } | number | null;
    remainingBalance: { toString(): string } | number | null;
    remainingPaidAt: Date | null;
    totalFinal: { toString(): string } | number;
  },
  creditPending: { toString(): string } | number | null = 0,
): CustomerPaymentSummary {
  const toN = (v: { toString(): string } | number | null) => round2(new Decimal(v?.toString() ?? "0"));
  const succeeded = b.paymentStatus === "SUCCESS";
  const balanceOpen = succeeded && b.isAdvancePayment && !b.remainingPaidAt;
  const flaggedPaid = !succeeded ? 0 : balanceOpen ? toN(b.advanceAmount) : toN(b.totalFinal);
  const live = b.status === "CONFIRMED" || b.status === "PICKED_UP";
  // Still owed on credit — on a booking that went ahead (a cancelled one's credit is voided)
  const onCredit = succeeded && (live || b.status === "RETURNED")
    ? Math.min(Math.max(0, toN(creditPending)), flaggedPaid)
    : 0;
  const paid = round2(new Decimal(flaggedPaid).sub(onCredit));
  const balanceOpenDue = balanceOpen && live ? Math.max(0, toN(b.remainingBalance)) : 0;
  const balanceDue = round2(new Decimal(balanceOpenDue).add(onCredit));
  const balanceDueAt = balanceDue > 0 ? (b.status === "CONFIRMED" ? "PICKUP" : "DROP") : null;
  return {
    paid,
    balanceDue,
    balanceDueAt,
    dueAtPickup: balanceDueAt === "PICKUP" ? balanceDue : 0,
    dueAtDrop: balanceDueAt === "DROP" ? balanceDue : 0,
    balanceOnCredit: onCredit,
  };
}

export interface EffectiveFlow {
  flow: PaymentFlow;
  adjusted: boolean;
  reason: PaymentFlowReason | null;
  message: string | null;
}

/**
 * The plan charged (always the options' one plan — item 18) and whether that
 * is an adjustment. A plan the client sent is "adjusted" when it differs (an
 * old build asking for FULL is charged the advance); with no plan sent, the
 * FULL fallback is the adjustment (the policy is ADVANCE), with its reason.
 */
export function resolveEffectiveFlow(
  requested: PaymentFlow | null | undefined,
  options: PaymentOptions,
): EffectiveFlow {
  const flow = requested && options.allowedFlows.includes(requested) ? requested : options.defaultFlow;
  const adjusted = requested ? flow !== requested : flow !== "ADVANCE";
  let reason: PaymentFlowReason | null = null;
  if (adjusted) {
    reason = flow === "ADVANCE" ? "BRANCH_ADVANCE_ONLY" : options.reason ?? "NO_ADVANCE_CONFIGURED";
  }
  return { flow, adjusted, reason, message: reason ? PAYMENT_FLOW_REASON_MESSAGES[reason] : null };
}

export type CustomerCouponPlanCheck =
  | { valid: true }
  | { valid: false; code: "COUPON_PAYMENT_PLAN_MISMATCH"; message: string };

/**
 * A coupon's payment-plan rules (applicablePaymentPlans, allowPartialPayment,
 * minAdvanceAfterDiscount) for a customer booking (item 18). A coupon limited
 * to full payment (its plans exclude ADVANCE, or it forbids part payment) can't
 * be used on ANY customer booking — online bookings are advance-only, even
 * when one falls back to FULL because the vehicle has no usable advance — and
 * the message says why. Every other rule is checked against the plan the
 * booking is actually charged. Same text for the coupon preview and booking
 * create; walk-in and counter coupons don't come through here.
 */
export function checkCustomerCouponPlan(rule: DiscountRule, options: PaymentOptions): CustomerCouponPlanCheck {
  const flow = options.defaultFlow;
  const fail = (message: string): CustomerCouponPlanCheck => ({
    valid: false,
    code: "COUPON_PAYMENT_PLAN_MISMATCH",
    message,
  });
  if (!couponValidationService.checkPaymentPlan(rule, "ADVANCE").valid) {
    return fail(
      flow === "ADVANCE"
        ? "This coupon is only for bookings paid in full upfront. Online bookings are paid with an " +
            "advance now and the balance at pickup, so it can't be used."
        : "This coupon is only for bookings paid in full upfront, a plan online bookings no longer " +
            "use (they are paid with an advance and the balance at pickup), so it can't be used online.",
    );
  }
  const planCheck = couponValidationService.checkPaymentPlan(rule, flow);
  if (!planCheck.valid) {
    return fail(
      options.reason === "ADVANCE_NOT_BELOW_TOTAL"
        ? "This coupon only works with an advance payment, and this booking is paid in full now because the advance would cover the whole amount."
        : "This coupon only works with an advance payment, and this vehicle has no advance, so the booking is paid in full now.",
    );
  }
  const minAdvance = rule.minAdvanceAfterDiscount;
  if (flow === "ADVANCE" && minAdvance != null && new Decimal(options.advanceAmount).lt(minAdvance.toString())) {
    return fail(
      `This coupon needs an advance of at least ₹${new Decimal(minAdvance.toString()).toFixed(2)}; ` +
        `this booking's advance is ₹${new Decimal(options.advanceAmount).toFixed(2)}, so it can't be used.`,
    );
  }
  return { valid: true };
}

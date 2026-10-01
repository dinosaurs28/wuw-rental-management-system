/**
 * Customer self-serve payment plan (#6) — what the server says the customer may
 * pay now. The server decides (branch customerPaymentMode + amounts) and sends
 * `paymentOptions` on the vehicle/group detail, the coupon preview and the
 * booking-create responses; the UI only renders it. The local resolver below is
 * a mirror of apps/backend/src/services/payment/payment-flow.service.ts, used
 * only for detail payloads cached before `paymentOptions` existed (≤ 60 s).
 */

export type PaymentFlow = "FULL" | "ADVANCE";
export type CustomerPaymentMode = "ADVANCE_ONLY" | "FULL_ONLY" | "BOTH";
export type PaymentFlowReason =
  | "BRANCH_FULL_ONLY"
  | "BRANCH_ADVANCE_ONLY"
  | "NO_ADVANCE_CONFIGURED"
  | "ADVANCE_NOT_BELOW_TOTAL";

export interface PaymentOptions {
  mode: CustomerPaymentMode;
  /** Configured advance (vehicle / group representative). */
  advanceAmount: number;
  /** FULL-plan total: rental after discounts + GST + refundable deposit; null without dates. */
  payableTotal: number | null;
  /** 0 < advance < payableTotal (null = no dates yet, only advance > 0 was checked). */
  advanceEligible: boolean | null;
  /** Plans the customer may pick — show a chooser only when there are two. */
  allowedFlows: PaymentFlow[];
  /** Plan to preselect (FULL when both are allowed). */
  defaultFlow: PaymentFlow;
  reason: PaymentFlowReason | null;
  /** Human text for `reason` — rendered under the plan. */
  reasonMessage: string | null;
  /** payableTotal − advance when ADVANCE is allowed (due at pickup). */
  remainingAfterAdvance: number | null;
}

const REASON_MESSAGES: Record<PaymentFlowReason, string> = {
  BRANCH_FULL_ONLY: "This branch takes the full amount when you book.",
  BRANCH_ADVANCE_ONLY: "This branch takes an advance now and the rest at pickup.",
  NO_ADVANCE_CONFIGURED: "Paying an advance isn't available for this vehicle, so the full amount is charged now.",
  ADVANCE_NOT_BELOW_TOTAL: "The advance would cover the whole amount, so the full amount is charged now.",
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Rupees rounded to the paisa (display sums of server amounts). */
export const roundMoney = round2;

const normalizeMode = (mode: string | null | undefined): CustomerPaymentMode =>
  mode === "FULL_ONLY" || mode === "BOTH" || mode === "ADVANCE_ONLY" ? mode : "ADVANCE_ONLY";

/** Mirror of the server's resolvePaymentOptions — fallback for stale cached payloads only. */
export function resolvePaymentOptionsLocal(input: {
  mode: string | null | undefined;
  advanceAmount: number | string | null | undefined;
  payableTotal: number | null;
}): PaymentOptions {
  const mode = normalizeMode(input.mode);
  const advance = Number(input.advanceAmount ?? 0) || 0;
  const total = input.payableTotal;
  const advanceConfigured = advance > 0;
  const advanceEligible: boolean | null =
    total == null ? (advanceConfigured ? null : false) : advanceConfigured && advance < total;
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
    reasonMessage: reason ? REASON_MESSAGES[reason] : null,
    remainingAfterAdvance:
      total != null && allowedFlows.includes("ADVANCE") ? round2(total - advance) : null,
  };
}

/**
 * The server's paymentOptions for a vehicle/group detail, or the local mirror
 * when the payload predates the field. payableTotal = rental total + deposit.
 */
export function paymentOptionsFor(detail: {
  paymentOptions?: PaymentOptions | null;
  customerPaymentMode?: string | null;
  advancePayAmount?: number | string | null;
  deposit?: number | null;
  pricingDetails?: { finalTotal: number } | null;
}): PaymentOptions {
  if (detail.paymentOptions) return detail.paymentOptions;
  return resolvePaymentOptionsLocal({
    mode: detail.customerPaymentMode,
    advanceAmount: detail.advancePayAmount,
    payableTotal: detail.pricingDetails
      ? round2(Number(detail.pricingDetails.finalTotal) + Number(detail.deposit ?? 0))
      : null,
  });
}

/** The requested plan if the options allow it, else the default plan. */
export function clampPaymentFlow(flow: PaymentFlow, options: PaymentOptions | null): PaymentFlow {
  if (!options) return flow;
  return options.allowedFlows.includes(flow) ? flow : options.defaultFlow;
}

/**
 * "Weekly discount (10%)" for a duration slab. A FLAT slab is ₹ off per vehicle,
 * so it shows no percent. Falls back to "Duration discount".
 */
export function durationDiscountTitle(
  label: string | null | undefined,
  percent?: number | null,
  type?: "PERCENTAGE" | "FLAT" | null,
): string {
  const name = label?.trim()
    ? /discount/i.test(label) ? label.trim() : `${label.trim()} discount`
    : "Duration discount";
  if (type === "FLAT" || percent == null || !(percent > 0)) return name;
  return `${name} (${Number(percent.toFixed(2))}%)`;
}

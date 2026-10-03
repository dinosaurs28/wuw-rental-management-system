/**
 * Customer self-serve payment plan — what the server says the customer pays
 * now. Advance only (item 18): the vehicle's advance online and the balance at
 * pickup; FULL only when no advance is set or it would cover the whole amount
 * (the reason says so). There is no plan picker — the server decides from the
 * amounts (the branch's customerPaymentMode is ignored) and sends
 * `paymentOptions` on the vehicle/group detail, the coupon preview and the
 * booking-create responses; the UI renders "Pay ₹X now · ₹Y at pickup". The
 * local resolver below mirrors apps/backend/src/services/payment/payment-flow.service.ts,
 * used only for detail payloads cached before `paymentOptions` existed.
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
  /** Charged online now: the advance, or the full total on FULL (null until dates are known). Item 18 servers. */
  payNowAmount?: number | null;
  /** Collected at pickup: payableTotal − advance, or 0 on FULL (null without dates). Item 18 servers. */
  dueAtPickup?: number | null;
}

const REASON_MESSAGES: Record<PaymentFlowReason, string> = {
  BRANCH_FULL_ONLY: "This booking is paid in full now.",
  BRANCH_ADVANCE_ONLY: "You pay an advance now and the rest at pickup.",
  NO_ADVANCE_CONFIGURED: "Paying an advance isn't available for this vehicle, so the full amount is charged now.",
  ADVANCE_NOT_BELOW_TOTAL: "The advance would cover the whole amount, so the full amount is charged now.",
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Rupees rounded to the paisa (display sums of server amounts). */
export const roundMoney = round2;

/**
 * Mirror of the server's resolvePaymentOptions — fallback for stale cached
 * payloads only. Advance only (item 18): `mode` is accepted and ignored.
 */
export function resolvePaymentOptionsLocal(input: {
  mode?: string | null;
  advanceAmount: number | string | null | undefined;
  payableTotal: number | null;
}): PaymentOptions {
  const mode: CustomerPaymentMode = "ADVANCE_ONLY";
  const advance = Number(input.advanceAmount ?? 0) || 0;
  const total = input.payableTotal;
  const advanceConfigured = advance > 0;
  const advanceEligible: boolean | null =
    total == null ? (advanceConfigured ? null : false) : advanceConfigured && advance < total;
  const advanceUsable = advanceEligible ?? advanceConfigured;
  const flow: PaymentFlow = advanceUsable ? "ADVANCE" : "FULL";
  const reason: PaymentFlowReason = advanceUsable
    ? "BRANCH_ADVANCE_ONLY"
    : !advanceConfigured
      ? "NO_ADVANCE_CONFIGURED"
      : "ADVANCE_NOT_BELOW_TOTAL";
  const remainingAfterAdvance = total != null && flow === "ADVANCE" ? round2(total - advance) : null;

  return {
    mode,
    advanceAmount: round2(advance),
    payableTotal: total == null ? null : round2(total),
    advanceEligible,
    allowedFlows: [flow],
    defaultFlow: flow,
    reason,
    reasonMessage: REASON_MESSAGES[reason],
    remainingAfterAdvance,
    payNowAmount: flow === "ADVANCE" ? round2(advance) : total == null ? null : round2(total),
    dueAtPickup: flow === "ADVANCE" ? remainingAfterAdvance : 0,
  };
}

/** What the customer pays now and at pickup (item 18); null = not known yet (no dates). */
export interface PayNowSplit {
  flow: PaymentFlow;
  payNow: number | null;
  atPickup: number | null;
  /** Why the booking is paid in full (FULL only), else null. */
  fullReason: string | null;
}

/**
 * The fixed plan as "Pay ₹X now · ₹Y at pickup". Uses the server's
 * payNowAmount / dueAtPickup, derived for payloads from before item 18.
 * `payableTotal` overrides the options' total (e.g. the post-coupon total).
 */
export function payNowSplit(options: PaymentOptions, payableTotal?: number | null): PayNowSplit {
  const flow = options.defaultFlow;
  const total = payableTotal ?? options.payableTotal;
  if (flow === "ADVANCE") {
    const serverAtPickup =
      payableTotal == null ? options.dueAtPickup ?? options.remainingAfterAdvance : null;
    const atPickup =
      serverAtPickup ?? (total == null ? null : round2(Math.max(0, total - options.advanceAmount)));
    return { flow, payNow: options.payNowAmount ?? options.advanceAmount, atPickup, fullReason: null };
  }
  return {
    flow,
    payNow: payableTotal == null && options.payNowAmount != null ? options.payNowAmount : total,
    atPickup: 0,
    fullReason: options.reasonMessage,
  };
}

/** "Pay ₹1,000 now · ₹2,450 at pickup" — the pickup part is left out until it's known. */
export function payNowLine(split: PayNowSplit, fmt: (amount: number) => string): string {
  if (split.payNow == null) return "";
  return split.atPickup == null
    ? `Pay ${fmt(split.payNow)} now`
    : `Pay ${fmt(split.payNow)} now · ${fmt(split.atPickup)} at pickup`;
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

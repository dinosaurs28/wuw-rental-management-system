// Customer payment plan — advance only (item 18): the vehicle's advance is
// paid online now and the rest at pickup; the full amount only when no
// advance is set or it would cover the whole amount (the reason says so).
// There is no plan picker. The server is the source of truth — it decides
// from the amounts (the branch's customerPaymentMode is ignored), sends
// `paymentOptions`, and converts (never rejects) any other plan sent.
// Screens show "Pay ₹X now · ₹Y at pickup".
//
// The local resolver mirrors apps/backend/src/services/payment/payment-flow.service.ts
// and is only used when a server response carries no `paymentOptions`.

import type { CustomerPaymentMode, PaymentFlow, PaymentFlowReason, PaymentOptions } from '../types/api';

export const PAYMENT_FLOW_REASON_MESSAGES: Record<PaymentFlowReason, string> = {
  BRANCH_FULL_ONLY: 'This booking is paid in full now.',
  BRANCH_ADVANCE_ONLY: 'You pay an advance now and the rest at pickup.',
  NO_ADVANCE_CONFIGURED: "Paying an advance isn't available for this vehicle, so the full amount is charged now.",
  ADVANCE_NOT_BELOW_TOTAL: 'The advance would cover the whole amount, so the full amount is charged now.',
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Same rule as the server: ADVANCE when 0 < advance < payable total (no total
 * yet: when an advance is set), else FULL with the reason. `mode` is ignored.
 */
export function resolvePaymentOptions(
  _mode: CustomerPaymentMode | null | undefined,
  advanceAmount: number,
  payableTotal: number | null,
): PaymentOptions {
  const advance = Number.isFinite(advanceAmount) ? advanceAmount : 0;
  const advanceConfigured = advance > 0;
  const advanceEligible: boolean | null =
    payableTotal == null ? (advanceConfigured ? null : false) : advanceConfigured && advance < payableTotal;
  const advanceUsable = advanceEligible ?? advanceConfigured;
  const flow: PaymentFlow = advanceUsable ? 'ADVANCE' : 'FULL';
  const reason: PaymentFlowReason = advanceUsable
    ? 'BRANCH_ADVANCE_ONLY'
    : !advanceConfigured
      ? 'NO_ADVANCE_CONFIGURED'
      : 'ADVANCE_NOT_BELOW_TOTAL';
  const remainingAfterAdvance =
    payableTotal != null && flow === 'ADVANCE' ? r2(payableTotal - advance) : null;

  return {
    mode: 'ADVANCE_ONLY',
    advanceAmount: r2(advance),
    payableTotal: payableTotal == null ? null : r2(payableTotal),
    advanceEligible,
    allowedFlows: [flow],
    defaultFlow: flow,
    reason,
    reasonMessage: PAYMENT_FLOW_REASON_MESSAGES[reason],
    remainingAfterAdvance,
    payNowAmount: flow === 'ADVANCE' ? r2(advance) : payableTotal == null ? null : r2(payableTotal),
    dueAtPickup: flow === 'ADVANCE' ? remainingAfterAdvance : 0,
  };
}

/** A usable server `paymentOptions`, or null (absent / malformed — older server). */
export function serverPaymentOptions(raw: unknown): PaymentOptions | null {
  const o = raw as PaymentOptions | null | undefined;
  if (!o || !Array.isArray(o.allowedFlows) || o.allowedFlows.length === 0) return null;
  return {
    ...o,
    advanceAmount: Number(o.advanceAmount ?? 0),
    payableTotal: o.payableTotal == null ? null : Number(o.payableTotal),
    remainingAfterAdvance: o.remainingAfterAdvance == null ? null : Number(o.remainingAfterAdvance),
    payNowAmount: o.payNowAmount == null ? null : Number(o.payNowAmount),
    dueAtPickup: o.dueAtPickup == null ? null : Number(o.dueAtPickup),
  };
}

/** The server's options when it sent them, else the local mirror of the same rule. */
export function paymentOptionsFor(
  server: PaymentOptions | null | undefined,
  fallback: { mode?: CustomerPaymentMode | null; advanceAmount: number; payableTotal: number | null },
): PaymentOptions {
  return server ?? resolvePaymentOptions(fallback.mode, fallback.advanceAmount, fallback.payableTotal);
}

/** The plan to charge: the one the options allow (`choice` only if it is that plan). */
export function pickFlow(choice: PaymentFlow | null | undefined, options: PaymentOptions): PaymentFlow {
  return choice && options.allowedFlows.includes(choice) ? choice : options.defaultFlow;
}

/** What the customer pays now and at pickup (item 18); null = not known yet. */
export type PayNowSplit = {
  flow: PaymentFlow;
  payNow: number | null;
  atPickup: number | null;
  /** Why the booking is paid in full (FULL only), else null. */
  fullReason: string | null;
};

/**
 * The fixed plan as "Pay ₹X now · ₹Y at pickup": the server's payNowAmount /
 * dueAtPickup, derived for an older payload. `payableTotal` (e.g. the
 * post-coupon total) overrides the options' own total.
 */
export function payNowSplit(options: PaymentOptions, payableTotal?: number | null): PayNowSplit {
  const flow = options.defaultFlow;
  const total = payableTotal ?? options.payableTotal;
  if (flow === 'ADVANCE') {
    const serverAtPickup = payableTotal == null ? options.dueAtPickup ?? options.remainingAfterAdvance : null;
    const atPickup = serverAtPickup ?? (total == null ? null : r2(Math.max(0, total - options.advanceAmount)));
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
export function payNowText(split: PayNowSplit, fmt: (amount: number) => string): string {
  if (split.payNow == null) return '';
  return split.atPickup == null
    ? `Pay ${fmt(split.payNow)} now`
    : `Pay ${fmt(split.payNow)} now · ${fmt(split.atPickup)} at pickup`;
}

// Customer payment plan (#6): pay the advance now and the rest at pickup, or
// pay in full. The server is the source of truth — it decides from the
// branch's customerPaymentMode and the amounts, sends `paymentOptions`, and
// converts (never rejects) a plan it doesn't allow. Screens show exactly the
// plans in `allowedFlows`.
//
// The local resolver mirrors apps/backend/src/services/payment/payment-flow.service.ts
// and is only used when a server response carries no `paymentOptions`.

import type { CustomerPaymentMode, PaymentFlow, PaymentFlowReason, PaymentOptions } from '../types/api';

export const PAYMENT_FLOW_REASON_MESSAGES: Record<PaymentFlowReason, string> = {
  BRANCH_FULL_ONLY: 'This branch takes the full amount when you book.',
  BRANCH_ADVANCE_ONLY: 'This branch takes an advance now and the rest at pickup.',
  NO_ADVANCE_CONFIGURED: "Paying an advance isn't available for this vehicle, so the full amount is charged now.",
  ADVANCE_NOT_BELOW_TOTAL: 'The advance would cover the whole amount, so the full amount is charged now.',
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Same rules as the server: FULL_ONLY → FULL; ADVANCE_ONLY → ADVANCE when usable; BOTH → both when usable. */
export function resolvePaymentOptions(
  mode: CustomerPaymentMode,
  advanceAmount: number,
  payableTotal: number | null,
): PaymentOptions {
  const advance = Number.isFinite(advanceAmount) ? advanceAmount : 0;
  const advanceConfigured = advance > 0;
  const advanceEligible: boolean | null =
    payableTotal == null ? (advanceConfigured ? null : false) : advanceConfigured && advance < payableTotal;
  const advanceUsable = advanceEligible ?? advanceConfigured;
  const amountReason: PaymentFlowReason | null = !advanceConfigured
    ? 'NO_ADVANCE_CONFIGURED'
    : advanceEligible === false
      ? 'ADVANCE_NOT_BELOW_TOTAL'
      : null;

  let allowedFlows: PaymentFlow[];
  let defaultFlow: PaymentFlow;
  let reason: PaymentFlowReason | null;
  if (mode === 'FULL_ONLY') {
    allowedFlows = ['FULL'];
    defaultFlow = 'FULL';
    reason = 'BRANCH_FULL_ONLY';
  } else if (mode === 'ADVANCE_ONLY') {
    allowedFlows = advanceUsable ? ['ADVANCE'] : ['FULL'];
    defaultFlow = allowedFlows[0]!;
    reason = advanceUsable ? 'BRANCH_ADVANCE_ONLY' : amountReason;
  } else {
    allowedFlows = advanceUsable ? ['FULL', 'ADVANCE'] : ['FULL'];
    defaultFlow = 'FULL';
    reason = advanceUsable ? null : amountReason;
  }

  return {
    mode,
    advanceAmount: r2(advance),
    payableTotal: payableTotal == null ? null : r2(payableTotal),
    advanceEligible,
    allowedFlows,
    defaultFlow,
    reason,
    reasonMessage: reason ? PAYMENT_FLOW_REASON_MESSAGES[reason] : null,
    remainingAfterAdvance:
      payableTotal != null && allowedFlows.includes('ADVANCE') ? r2(payableTotal - advance) : null,
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
  };
}

/**
 * The server's options when it sent them, else the local mirror. An older
 * server didn't enforce the branch mode, so an unknown mode offers both plans
 * the amounts allow (what it would accept).
 */
export function paymentOptionsFor(
  server: PaymentOptions | null | undefined,
  fallback: { mode?: CustomerPaymentMode | null; advanceAmount: number; payableTotal: number | null },
): PaymentOptions {
  return server ?? resolvePaymentOptions(fallback.mode ?? 'BOTH', fallback.advanceAmount, fallback.payableTotal);
}

/** The plan to charge: the customer's pick when it's allowed, else the default. */
export function pickFlow(choice: PaymentFlow | null | undefined, options: PaymentOptions): PaymentFlow {
  return choice && options.allowedFlows.includes(choice) ? choice : options.defaultFlow;
}

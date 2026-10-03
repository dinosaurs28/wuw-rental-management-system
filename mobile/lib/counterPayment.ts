/**
 * Counter money (Oct 2026 TODO #3 / #6 / #11 / #12). Mirrors
 * packages/schemas/src/counter-payment.ts by hand — the app doesn't import
 * @repo/schemas. Keep the two in step.
 *
 *  - UPI at the counter (the branch's merchant QR) is backed by a PHOTO of the
 *    customer's payment-success screen: uploaded first, its id sent as
 *    `proof_file_id`. The UTR box is gone from this app (the server still
 *    accepts a UTR from older builds).
 *  - CREDIT = the amount stays owed by the customer against a note of the
 *    collateral held, until the branch manager clears it.
 *  - Safety deposit at drop: SET_OFF (default) credits it against the drop
 *    charges; REFUND_IN_FULL pays it all back and the charges are collected
 *    on their own.
 */

/** Payment methods a Fleet Executive can pick at the counter. */
export const COUNTER_PAYMENT_METHODS = ['CASH', 'UPI', 'SPLIT', 'CREDIT'] as const;
export type CounterPaymentMethod = (typeof COUNTER_PAYMENT_METHODS)[number];

/** Counter methods plus Razorpay checkout ("Online") where a screen offers it. */
export type PaymentMethodKey = CounterPaymentMethod | 'ONLINE';

export const COUNTER_PAYMENT_METHOD_LABELS: Record<PaymentMethodKey, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  SPLIT: 'Split (cash + UPI)',
  CREDIT: 'Credit',
  ONLINE: 'Online',
};

export const COLLATERAL_MIN_LENGTH = 3;
export const COLLATERAL_MAX_LENGTH = 300;

export const COLLATERAL_REQUIRED_MESSAGE =
  'Note what was taken from the customer as collateral (for example “Original Aadhaar card”) until the credit is cleared.';
export const COLLATERAL_TOO_LONG_MESSAGE = `Keep the collateral note under ${COLLATERAL_MAX_LENGTH} characters.`;
export const COLLATERAL_HELPER = 'What was taken from the customer until it is paid (e.g. Original Aadhaar card)';

export const CREDIT_NOT_FOR_DEPOSIT_MESSAGE =
  "A safety deposit can't be put on credit. Remove the safety deposit from this bill (the collateral covers it) or take the payment in cash, UPI or split.";

export const PAYMENT_PROOF_REQUIRED_MESSAGE = "Add a photo of the customer's UPI payment-success screen.";
export const PAYMENT_PROOF_LABEL = "Photo of the customer's payment screen";
export const PAYMENT_PROOF_HELPER =
  'Photograph the payment-success screen on the customer’s phone — amount, date and reference visible.';
export const DUPLICATE_PAYMENT_PROOF_MESSAGE =
  "This payment photo is already attached to another payment. Take a photo of this payment's success screen.";

/** Largest payment-proof photo the upload endpoint accepts. */
export const PAYMENT_PROOF_MAX_BYTES = 10 * 1024 * 1024;

/** How the safety deposit taken at pickup is returned at drop. */
export const SAFETY_DEPOSIT_HANDLING = ['SET_OFF', 'REFUND_IN_FULL'] as const;
export type SafetyDepositHandling = (typeof SAFETY_DEPOSIT_HANDLING)[number];

export const SAFETY_DEPOSIT_HANDLING_LABELS: Record<SafetyDepositHandling, string> = {
  SET_OFF: 'Set off against charges',
  REFUND_IN_FULL: 'Refund in full',
};

/** Methods a deposit refund / remainder refund can be paid out with. */
export const COUNTER_REFUND_METHODS = ['CASH', 'UPI'] as const;
export type CounterRefundMethod = (typeof COUNTER_REFUND_METHODS)[number];

export const DEPOSIT_REFUND_METHOD_REQUIRED_MESSAGE =
  'Choose how the safety deposit is refunded to the customer (cash or UPI).';

/** POST / GET …/payment/proof → data. `url` is presigned for `expiresIn` s (900). */
export interface PaymentProof {
  proofFileId: string;
  publicId: string;
  url: string;
  mime: string;
  size: number;
  capturedAt: string;
  expiresIn: number;
}

/** A proof photo on this screen: the local shot, then the server's copy. */
export type ProofShot =
  | { status: 'uploading'; localUri: string; width: number }
  | { status: 'failed'; localUri: string; width: number; error: string }
  | { status: 'ready'; localUri: string; width: number; proof: PaymentProof };

/** Field-level problems shown under the picker. */
export interface CounterPaymentErrors {
  method?: string;
  split?: string;
  proof?: string;
  collateral?: string;
}

/** What the picker resolved to — each screen maps it onto its endpoint's body. */
export type CounterPaymentChoice =
  | { method: 'CASH'; amount: number }
  | { method: 'UPI'; amount: number; proofFileId: string }
  | { method: 'SPLIT'; amount: number; cashAmount: number; upiAmount: number; proofFileId: string }
  | { method: 'CREDIT'; amount: number; collateral: string }
  | { method: 'ONLINE'; amount: number };

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const inrCounter = (n: number) =>
  `₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** The cash part typed for a split, as a 2-dp number (NaN when not a number). */
export function parseCashPart(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? round2(n) : NaN;
}

/** UPI part of a split: the rest of the amount after the cash part. */
export function splitUpiPart(amount: number, cashText: string): number {
  const cash = parseCashPart(cashText);
  if (!Number.isFinite(cash)) return 0;
  return Math.max(0, round2(amount - cash));
}

/** Why a proof photo can't back a payment yet, or null when it's ready. */
export function proofProblem(shot: ProofShot | null, required = true): string | null {
  if (!shot) return required ? PAYMENT_PROOF_REQUIRED_MESSAGE : null;
  if (shot.status === 'uploading') return 'Wait for the payment photo to finish uploading.';
  if (shot.status === 'failed') return "The payment photo didn't upload — retry or retake it.";
  return null;
}

export function collateralProblem(text: string): string | null {
  const t = text.trim();
  if (t.length < COLLATERAL_MIN_LENGTH) return COLLATERAL_REQUIRED_MESSAGE;
  if (t.length > COLLATERAL_MAX_LENGTH) return COLLATERAL_TOO_LONG_MESSAGE;
  return null;
}

/**
 * Checks what staff entered for `amount` (> 0). Returns the choice, or the
 * errors to show (nothing is sent then).
 */
export function resolveCounterPayment(
  amount: number,
  input: { method: PaymentMethodKey; cash: string; proof: ProofShot | null; collateral: string },
): { ok: true; choice: CounterPaymentChoice } | { ok: false; errors: CounterPaymentErrors } {
  const total = round2(amount);
  switch (input.method) {
    case 'CASH':
      return { ok: true, choice: { method: 'CASH', amount: total } };
    case 'ONLINE':
      return { ok: true, choice: { method: 'ONLINE', amount: total } };
    case 'UPI': {
      const problem = proofProblem(input.proof);
      if (problem || input.proof?.status !== 'ready') return { ok: false, errors: { proof: problem ?? PAYMENT_PROOF_REQUIRED_MESSAGE } };
      return { ok: true, choice: { method: 'UPI', amount: total, proofFileId: input.proof.proof.proofFileId } };
    }
    case 'SPLIT': {
      const cash = parseCashPart(input.cash);
      const errors: CounterPaymentErrors = {};
      if (!Number.isFinite(cash) || cash <= 0) {
        errors.split = `Enter the cash part — the rest of ${inrCounter(total)} is paid by UPI.`;
      } else if (cash >= total) {
        errors.split = `The cash part must be less than ${inrCounter(total)} — choose Cash to take it all in cash.`;
      }
      const problem = proofProblem(input.proof);
      if (problem) errors.proof = problem;
      if (errors.split || errors.proof || input.proof?.status !== 'ready') return { ok: false, errors };
      return {
        ok: true,
        choice: {
          method: 'SPLIT',
          amount: total,
          cashAmount: cash,
          upiAmount: round2(total - cash),
          proofFileId: input.proof.proof.proofFileId,
        },
      };
    }
    case 'CREDIT': {
      const problem = collateralProblem(input.collateral);
      if (problem) return { ok: false, errors: { collateral: problem } };
      return { ok: true, choice: { method: 'CREDIT', amount: total, collateral: input.collateral.trim() } };
    }
  }
}

/** Server codes that belong to the payment picker (shown under its fields). */
export type CounterPaymentErrorCode =
  | 'PAYMENT_PROOF_REQUIRED'
  | 'INVALID_PAYMENT_PROOF'
  | 'DUPLICATE_PAYMENT_PROOF'
  | 'INVALID_UTR'
  | 'DUPLICATE_UTR'
  | 'COLLATERAL_REQUIRED'
  | 'SPLIT_AMOUNT_MISMATCH'
  | 'CREDIT_NOT_FOR_DEPOSIT'
  | 'NOTHING_TO_CREDIT';

/**
 * Maps a refused payment onto the picker's fields. `dropProof` = the photo can
 * never back this payment (unknown / other branch / already used) — retake it.
 * Null when the error isn't about the payment method.
 */
export function counterPaymentServerError(
  err: any,
): { errors: CounterPaymentErrors; dropProof: boolean } | null {
  const body = err?.response?.data;
  const code = body?.code as string | undefined;
  const message: string | undefined = typeof body?.message === 'string' && body.message ? body.message : undefined;
  switch (code) {
    case 'PAYMENT_PROOF_REQUIRED':
      return { errors: { proof: message ?? PAYMENT_PROOF_REQUIRED_MESSAGE }, dropProof: false };
    case 'INVALID_PAYMENT_PROOF':
      return {
        errors: { proof: message ?? "The payment photo wasn't found. Take the photo of the customer's payment screen again." },
        dropProof: true,
      };
    case 'DUPLICATE_PAYMENT_PROOF':
      return { errors: { proof: message ?? DUPLICATE_PAYMENT_PROOF_MESSAGE }, dropProof: true };
    // Only from a UTR-backed payment (an older build's hold); a reused photo comes
    // back as DUPLICATE_PAYMENT_PROOF, the walk-in confirm poll included. This app
    // only sends photos, so either way a new photo is what fixes it.
    case 'INVALID_UTR':
    case 'DUPLICATE_UTR':
      return { errors: { proof: DUPLICATE_PAYMENT_PROOF_MESSAGE }, dropProof: true };
    case 'COLLATERAL_REQUIRED':
      return { errors: { collateral: message ?? COLLATERAL_REQUIRED_MESSAGE }, dropProof: false };
    case 'SPLIT_AMOUNT_MISMATCH':
      return { errors: { split: message ?? 'The cash and UPI parts must add up to the amount due.' }, dropProof: false };
    case 'CREDIT_NOT_FOR_DEPOSIT':
      return { errors: { method: message ?? CREDIT_NOT_FOR_DEPOSIT_MESSAGE }, dropProof: false };
    case 'NOTHING_TO_CREDIT':
      return { errors: { method: message ?? 'Nothing is due, so there is nothing to put on credit.' }, dropProof: false };
    default:
      return null;
  }
}

/** Short label for a success line, e.g. "UPI" or "Cash ₹500 + UPI ₹300". */
export function counterChoiceLabel(choice: CounterPaymentChoice): string {
  switch (choice.method) {
    case 'CASH': return 'Cash';
    case 'UPI': return 'UPI';
    case 'ONLINE': return 'Online';
    case 'SPLIT': return `Cash ${inrCounter(choice.cashAmount)} + UPI ${inrCounter(choice.upiAmount)}`;
    case 'CREDIT': return `On credit (collateral: ${choice.collateral})`;
  }
}

// ── Drop bill safety deposit (#6) ──────────────────────────────────────────

/** `deposit` block of the drop-bill compute / GET return session (2-dp strings). */
export interface DropDeposit {
  handling: SafetyDepositHandling;
  held: string;
  /** SET_OFF: part of the deposit used against the charges. */
  setOff: string;
  /** Deposit going back (SET_OFF: the remainder; REFUND_IN_FULL: all of it). */
  refund: string;
  /** Drop charges (bill.total). */
  charges: string;
  /** What the customer still pays. */
  toCollect: string;
  /** RECORD_REFUND: settle with record-refund · PAYMENT_DEPOSIT_REFUND: send depositRefund on record-payment. */
  refundVia: 'RECORD_REFUND' | 'PAYMENT_DEPOSIT_REFUND' | null;
}

/** Drop-bill ledger line crediting the held deposit back (−held). */
export const SAFETY_DEPOSIT_CREDIT_REF = 'SAFETY_DEPOSIT_CREDIT';
/** Drop-bill ledger line paying the whole deposit back (+held) — "Refund in full". */
export const SAFETY_DEPOSIT_REFUND_REF = 'SAFETY_DEPOSIT_REFUND';

type DropLedgerLine = { referenceType?: string | null; amount: string; isVoided: boolean };

/** The deposit a drop bill credits back and the part it refunds in full, from its ledger lines. */
export function dropBillDeposit(entries: DropLedgerLine[] | null | undefined): { credited: number; refundedInFull: number } {
  let credited = 0;
  let refundedInFull = 0;
  for (const e of entries ?? []) {
    if (e.isVoided) continue;
    const amt = Math.abs(Number(e.amount) || 0);
    if (e.referenceType === SAFETY_DEPOSIT_CREDIT_REF) credited += amt;
    else if (e.referenceType === SAFETY_DEPOSIT_REFUND_REF) refundedInFull += amt;
  }
  return { credited: round2(credited), refundedInFull: round2(refundedInFull) };
}

/**
 * The line under a drop bill's net amount, right for either deposit choice.
 * With "Refund in full" the net is just the charges — ₹0 means no charges, not
 * that the deposit covered them.
 */
export function dropBillNetNote(net: number, entries: DropLedgerLine[] | null | undefined): string | null {
  const { credited, refundedInFull } = dropBillDeposit(entries);
  const settled = Math.abs(net) < 0.005;
  if (refundedInFull > 0) {
    return settled
      ? `No charges to collect — the ${inrCounter(refundedInFull)} deposit is refunded to the customer in full.`
      : `Collect the charges. The ${inrCounter(refundedInFull)} deposit is refunded to the customer in full.`;
  }
  if (settled) {
    return credited > 0 ? 'Security deposit covers all charges — nothing to collect.' : 'Nothing to collect.';
  }
  if (net < 0) return 'Refund the difference to the customer to complete the return.';
  return null;
}

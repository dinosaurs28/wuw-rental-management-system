import { z } from "zod";

/**
 * Counter money (Oct 2026 TODO #3 / #6 / #11 / #12) — shared by the backend
 * and the web app. The mobile app mirrors these values by hand.
 *
 *  - UPI at the counter (the branch's merchant QR) is backed by a PHOTO of the
 *    customer's payment-success screen, uploaded first and sent as
 *    `proof_file_id`. A 12-digit UTR is still accepted from older app builds.
 *  - CREDIT = the amount stays owed by the customer. It needs a note of the
 *    collateral held until the branch manager clears it on the Customer Credit
 *    page (which records the payment when the money arrives).
 *  - Safety deposit at drop: SET_OFF (default) credits the deposit against the
 *    drop charges; REFUND_IN_FULL gives it all back and the charges are
 *    collected on their own.
 */

/** Payment methods a Fleet Executive can pick at the counter. */
export const COUNTER_PAYMENT_METHODS = ["CASH", "UPI", "SPLIT", "CREDIT"] as const;
export type CounterPaymentMethod = (typeof COUNTER_PAYMENT_METHODS)[number];

export const COUNTER_PAYMENT_METHOD_LABELS: Record<CounterPaymentMethod, string> = {
  CASH: "Cash",
  UPI: "UPI",
  SPLIT: "Split (cash + UPI)",
  CREDIT: "Credit",
};

export const COLLATERAL_MIN_LENGTH = 3;
export const COLLATERAL_MAX_LENGTH = 300;

export const COLLATERAL_REQUIRED_MESSAGE =
  "Note what was taken from the customer as collateral (for example “Original Aadhaar card”) until the credit is cleared.";

/** The "collateral held" note that must accompany a CREDIT payment. */
export const collateralSchema = z
  .string({ required_error: COLLATERAL_REQUIRED_MESSAGE, invalid_type_error: COLLATERAL_REQUIRED_MESSAGE })
  .trim()
  .min(COLLATERAL_MIN_LENGTH, COLLATERAL_REQUIRED_MESSAGE)
  .max(COLLATERAL_MAX_LENGTH, `Keep the collateral note under ${COLLATERAL_MAX_LENGTH} characters.`);

export const CREDIT_NOT_FOR_DEPOSIT_MESSAGE =
  "A safety deposit can't be put on credit. Remove the safety deposit from this bill (the collateral covers it) or take the payment in cash, UPI or split.";

export const PAYMENT_PROOF_REQUIRED_MESSAGE =
  "Add a photo of the customer's UPI payment-success screen.";

/** Largest payment-proof photo the upload endpoint accepts. */
export const PAYMENT_PROOF_MAX_BYTES = 10 * 1024 * 1024;

/** How the safety deposit taken at pickup is returned at drop. */
export const SAFETY_DEPOSIT_HANDLING = ["SET_OFF", "REFUND_IN_FULL"] as const;
export type SafetyDepositHandling = (typeof SAFETY_DEPOSIT_HANDLING)[number];

export const SAFETY_DEPOSIT_HANDLING_LABELS: Record<SafetyDepositHandling, string> = {
  SET_OFF: "Set off against charges",
  REFUND_IN_FULL: "Refund in full",
};

/** Methods a deposit refund / remainder refund can be paid out with. */
export const COUNTER_REFUND_METHODS = ["CASH", "UPI"] as const;
export type CounterRefundMethod = (typeof COUNTER_REFUND_METHODS)[number];

export const DEPOSIT_REFUND_METHOD_REQUIRED_MESSAGE =
  "Choose how the safety deposit is refunded to the customer (cash or UPI).";

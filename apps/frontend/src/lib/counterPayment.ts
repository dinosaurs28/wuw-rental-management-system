import {
  COLLATERAL_MAX_LENGTH,
  COLLATERAL_MIN_LENGTH,
  COLLATERAL_REQUIRED_MESSAGE,
  COUNTER_PAYMENT_METHODS,
  COUNTER_PAYMENT_METHOD_LABELS,
  PAYMENT_PROOF_MAX_BYTES,
  PAYMENT_PROOF_REQUIRED_MESSAGE,
  round2,
  type CounterPaymentMethod,
  type CounterRefundMethod,
} from "@repo/schemas";
import { compressImage } from "@/lib/utils";

/**
 * Counter money (Oct 2026 TODO #3 / #11 / #12) — what a Fleet Executive (or the
 * branch manager clearing a credit) picks at the counter, and how each request
 * shape is built from it:
 *  - CASH
 *  - UPI: the customer paid the branch's merchant QR; a PHOTO of their
 *    payment-success screen is required (uploaded first → `proof_file_id`)
 *  - SPLIT: a cash part + the UPI part (the rest), the UPI part backed by a photo
 *  - CREDIT: nothing is paid now; the amount stays owed against the collateral
 *    noted until the branch manager clears it
 */
export { COUNTER_PAYMENT_METHODS, COUNTER_PAYMENT_METHOD_LABELS, COLLATERAL_MAX_LENGTH };
export type { CounterPaymentMethod, CounterRefundMethod };

/** The uploaded payment-screen photo kept by a payment form. */
export interface CounterProof {
  proofFileId: string;
  url: string;
  mime: string;
  capturedAt: string;
}

export interface CounterPaymentValue {
  method: CounterPaymentMethod;
  /** UPI, or the UPI part of a split. */
  proof: CounterProof | null;
  /** SPLIT: the cash part as typed (the UPI part is the rest). */
  splitCash: string;
  /** CREDIT: what was taken from the customer until it is cleared. */
  collateral: string;
}

export const emptyCounterPayment = (method: CounterPaymentMethod = "CASH"): CounterPaymentValue => ({
  method,
  proof: null,
  splitCash: "",
  collateral: "",
});

export const COLLATERAL_LABEL = "Collateral held";
export const COLLATERAL_HELPER =
  "What was taken from the customer until it is paid (e.g. Original Aadhaar card)";
export const PAYMENT_PROOF_LABEL = "Photo of the customer's payment screen";
export const PAYMENT_PROOF_HELPER =
  "After the customer pays the branch UPI QR, photograph the payment-success screen on their phone.";
export const PAYMENT_PROOF_ACCEPT = "image/*";
export { COLLATERAL_REQUIRED_MESSAGE, PAYMENT_PROOF_REQUIRED_MESSAGE };

/** Cash and UPI parts a payment form stands for (CREDIT: both 0). */
export function counterPaymentParts(
  value: CounterPaymentValue,
  amount: number | null,
): { cash: number; upi: number } {
  const total = amount == null ? null : round2(amount);
  switch (value.method) {
    case "CASH":
      return { cash: total ?? 0, upi: 0 };
    case "UPI":
      return { cash: 0, upi: total ?? 0 };
    case "SPLIT": {
      const cash = round2(Math.max(0, parseFloat(value.splitCash) || 0));
      return { cash, upi: total == null ? 0 : round2(Math.max(0, total - cash)) };
    }
    default:
      return { cash: 0, upi: 0 };
  }
}

/**
 * Why the form can't be submitted yet (null = ready). `amount` null means the
 * total is only known to the server (walk-in create): a split then only needs a
 * positive cash part and the server checks it is below the total.
 */
export function counterPaymentProblem(value: CounterPaymentValue, amount: number | null): string | null {
  switch (value.method) {
    case "CASH":
      return null;
    case "UPI":
      return value.proof ? null : PAYMENT_PROOF_REQUIRED_MESSAGE;
    case "SPLIT": {
      const { cash, upi } = counterPaymentParts(value, amount);
      if (cash <= 0) return "Enter the cash part of the split.";
      if (amount != null && upi <= 0) {
        return `The cash part must be less than ₹${round2(amount).toFixed(2)} — the rest is paid by UPI.`;
      }
      return value.proof ? null : PAYMENT_PROOF_REQUIRED_MESSAGE;
    }
    case "CREDIT": {
      const note = value.collateral.trim();
      if (note.length < COLLATERAL_MIN_LENGTH) return COLLATERAL_REQUIRED_MESSAGE;
      if (note.length > COLLATERAL_MAX_LENGTH) {
        return `Keep the collateral note under ${COLLATERAL_MAX_LENGTH} characters.`;
      }
      return null;
    }
    default:
      return null;
  }
}

/** Cash, UPI and split take money now, so they need the executive's open shift. */
export const counterMethodTakesMoney = (method: CounterPaymentMethod) => method !== "CREDIT";

// ── Payment sessions (pickup / drop bill) ────────────────────────────────────

type SessionEntryLike = {
  entryType: string;
  classification: string;
  referenceType: string | null;
  amount: string;
  isVoided: boolean;
};

/** The bill charges a safety deposit (pickup) — it can't go on credit. Mirrors the server. */
export function chargesSafetyDeposit(session: { entries: SessionEntryLike[] }): boolean {
  return session.entries.some(
    (e) => !e.isVoided && e.entryType === "DEPOSIT" && e.classification === "NON_TAXABLE",
  );
}

/** The safety deposit a "Refund in full" drop bill pays back (0 = none, #6). Mirrors the server. */
export function depositRefundOnSession(session: { entries: SessionEntryLike[] }): number {
  return round2(
    session.entries
      .filter((e) => !e.isVoided && e.entryType === "REFUND" && e.referenceType === "SAFETY_DEPOSIT_REFUND")
      .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0),
  );
}

// ── Request shapes ───────────────────────────────────────────────────────────

const proofId = (value: CounterPaymentValue) => value.proof?.proofFileId;

/** POST /employee/sessions/:id/record-payment (pickup / drop bill). */
export function sessionPaymentFields(value: CounterPaymentValue, amount: number) {
  const { cash, upi } = counterPaymentParts(value, amount);
  switch (value.method) {
    case "UPI":
      return { method: "UPI" as const, proof_file_id: proofId(value) };
    case "SPLIT":
      return { method: "SPLIT" as const, cashAmount: cash, onlineAmount: upi, onlineGateway: "UPI", proof_file_id: proofId(value) };
    case "CREDIT":
      return { method: "CREDIT" as const, collateral: value.collateral.trim() };
    default:
      return { method: "CASH" as const };
  }
}

/** POST /employee/extensions/:id/collect. */
export function extensionCollectFields(value: CounterPaymentValue, amount: number) {
  const { cash, upi } = counterPaymentParts(value, amount);
  switch (value.method) {
    case "UPI":
      return { method: "UPI" as const, proof_file_id: proofId(value) };
    case "SPLIT":
      return { method: "SPLIT" as const, cashAmount: cash, onlineAmount: upi, proof_file_id: proofId(value) };
    case "CREDIT":
      return { method: "CREDIT" as const, collateral: value.collateral.trim() };
    default:
      return { method: "CASH" as const };
  }
}

/** POST /employee/{pickup|return}/:id/initiate-remaining-payment. */
export function remainingPaymentFields(value: CounterPaymentValue, amount: number) {
  const { cash, upi } = counterPaymentParts(value, amount);
  switch (value.method) {
    case "UPI":
      return { method: "UPI" as const, proof_file_id: proofId(value) };
    case "SPLIT":
      return { method: "SPLIT" as const, cashAmount: cash, onlineAmount: upi, proof_file_id: proofId(value) };
    case "CREDIT":
      return { method: "CREDIT" as const, collateral: value.collateral.trim() };
    default:
      return { method: "CASH" as const };
  }
}

/** POST /employee/booking/create — the server works out the UPI part of a split. */
export function walkInPaymentFields(value: CounterPaymentValue) {
  switch (value.method) {
    case "UPI":
      return { payment_type: "UPI" as const, proof_file_id: proofId(value) };
    case "SPLIT":
      return {
        payment_type: "SPLIT" as const,
        cash_amount: counterPaymentParts(value, null).cash,
        proof_file_id: proofId(value),
      };
    case "CREDIT":
      return { payment_type: "CREDIT" as const, collateral: value.collateral.trim() };
    default:
      return { payment_type: "CASH" as const };
  }
}

/** POST /branchManager/ledger/entry/:id/clear — credit clearance takes no CREDIT. */
export function creditClearanceFields(value: CounterPaymentValue, amount: number) {
  const { cash, upi } = counterPaymentParts(value, amount);
  switch (value.method) {
    case "UPI":
      return { paymentMethod: "UPI" as const, proof_file_id: proofId(value) };
    case "SPLIT":
      return { paymentMethod: "SPLIT" as const, cashAmount: cash, onlineAmount: upi, proof_file_id: proofId(value) };
    default:
      return { paymentMethod: "CASH" as const };
  }
}

// ── Server errors ────────────────────────────────────────────────────────────

type ApiErrorLike = { response?: { status?: number; data?: { code?: unknown; message?: unknown } } };

export const apiCode = (err: unknown): string | undefined => {
  const code = (err as ApiErrorLike | undefined)?.response?.data?.code;
  return typeof code === "string" ? code : undefined;
};

/** The photo is missing, unknown or already backs another payment — take a new one. */
export const PROOF_ERROR_CODES = new Set([
  "PAYMENT_PROOF_REQUIRED",
  "INVALID_PAYMENT_PROOF",
  "DUPLICATE_PAYMENT_PROOF",
]);

/** Which field of the payment form a server error belongs to (null = show it as a general error). */
export function counterPaymentErrorField(err: unknown): "proof" | "collateral" | "split" | null {
  const code = apiCode(err);
  if (!code) return null;
  if (PROOF_ERROR_CODES.has(code) || code === "INVALID_UTR" || code === "DUPLICATE_UTR") return "proof";
  if (code === "COLLATERAL_REQUIRED") return "collateral";
  if (code === "SPLIT_AMOUNT_MISMATCH") return "split";
  return null;
}

export interface CounterFieldErrors {
  proof?: string | null;
  collateral?: string | null;
  split?: string | null;
}

/** Server message placed at the field it concerns. */
export function counterFieldErrors(err: unknown): CounterFieldErrors {
  const field = counterPaymentErrorField(err);
  if (!field) return {};
  const message = (err as ApiErrorLike | undefined)?.response?.data?.message;
  return { [field]: typeof message === "string" ? message : "Check this and try again." };
}

// ── Photo file ───────────────────────────────────────────────────────────────

/** Formats the browser can redraw smaller (HEIC can't be decoded in most browsers). */
const DOWNSCALABLE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Validates the picked photo and returns the one to upload. Over 10 MB it is
 * downscaled once (the server re-encodes it anyway).
 */
export async function preparePaymentProofFile(file: File): Promise<{ file: File } | { error: string }> {
  // Some phones hand over HEIC with an empty type — let the server decide then.
  if (file.type && !file.type.startsWith("image/")) {
    return { error: "Choose a photo (JPG, PNG, WebP or HEIC)." };
  }
  if (file.size <= PAYMENT_PROOF_MAX_BYTES) return { file };
  if (!DOWNSCALABLE_TYPES.includes(file.type)) {
    return { error: "The photo is larger than 10 MB. Please retake it." };
  }
  const smaller = await compressImage(file);
  if (smaller.size > PAYMENT_PROOF_MAX_BYTES) {
    return { error: "The photo is larger than 10 MB. Please retake it." };
  }
  return { file: smaller };
}

/** Upload error → message (a 413 from a proxy has no JSON body). */
export function paymentProofUploadMessage(err: unknown): string {
  const response = (err as ApiErrorLike | undefined)?.response;
  if (typeof response?.data?.message === "string") return response.data.message;
  if (response?.status === 413) return "The photo is larger than 10 MB. Please retake it.";
  if (!response) return "Couldn't reach the server. Check the connection and try again.";
  return "Couldn't save the payment photo. Please try again.";
}

export const formatRupees = (amount: number) =>
  `₹${round2(amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

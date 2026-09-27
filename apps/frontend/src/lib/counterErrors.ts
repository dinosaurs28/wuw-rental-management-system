/**
 * Error codes the backend attaches (`{ message, code }`) when a counter rule
 * blocks an action. See apps/backend/src/services/payment/counter-guard.service.ts.
 */
export type CounterErrorCode = "SHIFT_REQUIRED" | "INVALID_UTR" | "DUPLICATE_UTR";

type ApiErrorLike = { response?: { data?: { code?: unknown; message?: unknown } } };

export function counterErrorCode(err: unknown): CounterErrorCode | undefined {
  const code = (err as ApiErrorLike | undefined)?.response?.data?.code;
  return code === "SHIFT_REQUIRED" || code === "INVALID_UTR" || code === "DUPLICATE_UTR"
    ? code
    : undefined;
}

export function apiErrorMessage(err: unknown, fallback: string): string {
  const message = (err as ApiErrorLike | undefined)?.response?.data?.message;
  return typeof message === "string" ? message : fallback;
}

export const SHIFT_REQUIRED_MESSAGE =
  "Open your cash shift before taking bookings or collecting payments.";

/** A UPI UTR is 12 digits. Spaces and dashes typed by staff are ignored. */
export function cleanUtr(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

export function isValidUtr(raw: string): boolean {
  return /^\d{12}$/.test(cleanUtr(raw));
}

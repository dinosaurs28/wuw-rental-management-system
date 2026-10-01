import {
  CUSTOMER_PROFILE_FIELD_LABELS,
  type CustomerProfileField,
} from "@repo/schemas";

/**
 * Customer profile completeness (#1): DL + Aadhaar numbers are required before
 * any booking. The backend reports the empty fields as `missingFields`.
 */

/** Customer booking gate (403) — the profile is missing required fields. */
export const PROFILE_INCOMPLETE = "PROFILE_INCOMPLETE";
/** Staff booking create (422) — the customer's profile is missing fields. */
export const CUSTOMER_PROFILE_INCOMPLETE = "CUSTOMER_PROFILE_INCOMPLETE";

type ApiErrorLike = {
  response?: { status?: number; data?: { code?: unknown; message?: unknown } };
};

/** The `code` of an API error body, if any. */
export function apiErrorCode(err: unknown): string | undefined {
  const code = (err as ApiErrorLike | undefined)?.response?.data?.code;
  return typeof code === "string" ? code : undefined;
}

/** Walk-in complete (403) — the customer's phone OTP was never verified. */
export const VERIFICATION_PENDING = "VERIFICATION_PENDING";
/** Walk-in complete (403) — staff tried to replace a customer's real email. */
export const EMAIL_CHANGE_NOT_ALLOWED = "EMAIL_CHANGE_NOT_ALLOWED";

/**
 * POST /employee/walkin/complete refused because the phone OTP step was never
 * done. Older servers sent the 403 without a code, so fall back to the message.
 */
export function isVerificationPendingError(err: unknown): boolean {
  const res = (err as ApiErrorLike | undefined)?.response;
  if (apiErrorCode(err) === VERIFICATION_PENDING) return true;
  const message = res?.data?.message;
  return (
    res?.status === 403 &&
    !apiErrorCode(err) &&
    typeof message === "string" &&
    /verification pending/i.test(message)
  );
}

/** "Driving Licence number and Aadhaar number" — for banners and hints. */
export function describeMissingProfileFields(
  missing: readonly string[] | null | undefined,
): string {
  const labels = (missing ?? []).map(
    (f) => CUSTOMER_PROFILE_FIELD_LABELS[f as CustomerProfileField] ?? f,
  );
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** Digits only, max 12, grouped in fours ("2341 2341 2346") while typing. */
export function formatAadhaarInput(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "").slice(0, 12);
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** DL numbers are stored uppercase; show what the customer types in caps. */
export function formatDrivingLicenceInput(raw: string | null | undefined): string {
  return String(raw ?? "").toUpperCase();
}

import { z } from "zod";

/**
 * Driving licence and Aadhaar numbers. Keep in sync with mobile/lib/identity.ts.
 * Values are stored normalised: DL uppercase without spaces, '-' or '/';
 * Aadhaar as 12 digits.
 */

export const DL_REQUIRED_MESSAGE = "Driving Licence number is required";
export const DL_INVALID_MESSAGE = "Enter a valid Driving Licence number (e.g. KA01 20110012345)";
export const AADHAAR_REQUIRED_MESSAGE = "Aadhaar number is required";
export const AADHAAR_LENGTH_MESSAGE = "Aadhaar number must be 12 digits";
export const AADHAAR_INVALID_MESSAGE = "Enter a valid Aadhaar number";

export function normalizeDrivingLicence(value: string): string {
  return String(value ?? "").toUpperCase().replace(/[\s\-/]/g, "");
}

/** Lenient: state code + 8–18 alphanumerics, which covers old and new formats. */
export function isValidDrivingLicence(value: string): boolean {
  return /^[A-Z]{2}[0-9A-Z]{8,18}$/.test(normalizeDrivingLicence(value));
}

export function normalizeAadhaar(value: string): string {
  return String(value ?? "").replace(/[\s-]/g, "");
}

// Verhoeff checksum tables (UIDAI uses Verhoeff for the last digit).
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

function verhoeffValid(digits: string): boolean {
  let c = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = VERHOEFF_D[c]![VERHOEFF_P[i % 8]![Number(reversed[i])]!]!;
  }
  return c === 0;
}

export function isValidAadhaar(value: string): boolean {
  const n = normalizeAadhaar(value);
  return /^[2-9][0-9]{11}$/.test(n) && verhoeffValid(n);
}

/** "XXXX XXXX 1234" — for lists, reports, logs and audit metadata. */
export function maskAadhaar(value: string | null | undefined): string {
  const n = normalizeAadhaar(value ?? "");
  if (n.length < 4) return "";
  return `XXXX XXXX ${n.slice(-4)}`;
}

export const drivingLicenceNumberSchema = z
  .string({ required_error: DL_REQUIRED_MESSAGE, invalid_type_error: DL_REQUIRED_MESSAGE })
  .trim()
  .min(1, DL_REQUIRED_MESSAGE)
  .transform(normalizeDrivingLicence)
  .refine((v) => /^[A-Z]{2}[0-9A-Z]{8,18}$/.test(v), DL_INVALID_MESSAGE);

export const aadhaarNumberSchema = z
  .string({ required_error: AADHAAR_REQUIRED_MESSAGE, invalid_type_error: AADHAAR_REQUIRED_MESSAGE })
  .trim()
  .min(1, AADHAAR_REQUIRED_MESSAGE)
  .transform(normalizeAadhaar)
  .refine((v) => /^[0-9]{12}$/.test(v), AADHAAR_LENGTH_MESSAGE)
  .refine((v) => isValidAadhaar(v), AADHAAR_INVALID_MESSAGE);

// ── Placeholder emails ───────────────────────────────────────────────────────
// User.email is NOT NULL + unique, so customers without one get a reserved
// (RFC 2606 `.invalid`) placeholder. None can reach a real inbox; never show
// or print one — render displayEmail(email) ?? "—" (or omit the row).

/** Placeholder for a walk-in created without an email. */
export function walkinPlaceholderEmail(userPublicId: string): string {
  return `walkin-${userPublicId}@walkin.invalid`;
}

/** Walk-in placeholders, current (`@walkin.invalid`) and legacy (`walkin_*@temp.com`). */
export function isWalkinPlaceholderEmail(email: string | null | undefined): boolean {
  const e = String(email ?? "").trim().toLowerCase();
  return e.endsWith("@walkin.invalid") || /^walkin_[^@]+@temp\.com$/.test(e);
}

/** Walk-in placeholders plus account-deletion tombstones (`@deleted.invalid`). */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  const e = String(email ?? "").trim().toLowerCase();
  return isWalkinPlaceholderEmail(e) || e.endsWith("@deleted.invalid");
}

/** The email to show or print, or null when there is no real one. */
export function displayEmail(email: string | null | undefined): string | null {
  const e = String(email ?? "").trim();
  if (!e || isPlaceholderEmail(e)) return null;
  return e;
}

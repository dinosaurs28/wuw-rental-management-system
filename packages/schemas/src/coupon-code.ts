import { z } from "zod";

// ─── Coupon code ──────────────────────────────────────────────────────────────
//
// The code a branch manager or admin types for a coupon. Stored (and looked up
// at checkout) trimmed + uppercased, so a customer can type it in any case.

export const COUPON_CODE_MIN_LENGTH = 4;
export const COUPON_CODE_MAX_LENGTH = 20;

/** Canonical form of a coupon code: trimmed, uppercase. */
export const normalizeCouponCode = (raw: string): string => raw.trim().toUpperCase();

/**
 * Why a (normalised) coupon code isn't allowed, or null when it is fine:
 * 4–20 characters, A–Z 0–9 and hyphens, not starting or ending with a hyphen.
 */
export function couponCodeIssue(code: string): string | null {
  if (code.length < COUPON_CODE_MIN_LENGTH) {
    return `Coupon code must be at least ${COUPON_CODE_MIN_LENGTH} characters`;
  }
  if (code.length > COUPON_CODE_MAX_LENGTH) {
    return `Coupon code can't be longer than ${COUPON_CODE_MAX_LENGTH} characters`;
  }
  if (!/^[A-Z0-9-]+$/.test(code)) return "Coupon code can only use letters, numbers and hyphens";
  if (code.startsWith("-") || code.endsWith("-")) return "Coupon code can't start or end with a hyphen";
  return null;
}

/** A typed coupon code — normalised, then checked with couponCodeIssue. */
export const couponCodeSchema = z
  .string()
  .transform(normalizeCouponCode)
  .superRefine((code, ctx) => {
    const issue = couponCodeIssue(code);
    if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
  });

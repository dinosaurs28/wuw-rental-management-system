// Indian mobile numbers are stored as typed: mostly the bare 10 digits (sign-up,
// profile, staff forms), sometimes with a +91 / 91 / 0 prefix (walk-in form).
// These helpers reduce any of those to the 10-digit national number so a
// lookup matches every stored spelling, and build the MSG91 form (91 + 10).

const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/**
 * "+91 98765-43210", "919876543210", "09876543210", "9876543210" → "9876543210".
 * Returns null for anything that isn't a valid Indian mobile number.
 */
export function normalizeIndianMobile(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  // Only separators may sit between the digits; letters mean it isn't a number.
  if (!/^\+?[\d\s\-().]+$/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return INDIAN_MOBILE.test(digits) ? digits : null;
}

/** Every stored spelling of a 10-digit number, for `phone: { in: [...] }` lookups. */
export function indianMobileLookupVariants(mobile10: string): string[] {
  return [mobile10, `91${mobile10}`, `+91${mobile10}`, `0${mobile10}`, `+91 ${mobile10}`];
}

/** MSG91 expects the country code without "+". */
export function toMsg91Mobile(mobile10: string): string {
  return `91${mobile10}`;
}

/** "+91 98XXXXXX10" — for messages that confirm where something was sent. */
export function maskIndianMobile(mobile10: string): string {
  return `+91 ${mobile10.slice(0, 2)}XXXXXX${mobile10.slice(-2)}`;
}

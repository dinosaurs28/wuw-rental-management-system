import {
  CUSTOMER_PROFILE_FIELD_LABELS,
  CUSTOMER_PROFILE_REQUIRED_FIELDS,
  effectiveCustomerAge,
  hasCustomerAgeRequirement,
  type CustomerProfileField,
} from "@repo/schemas";

/**
 * Customer profile completeness (#1, revised Oct 2026) and placeholder-email
 * helpers.
 *
 * A profile is complete when every CUSTOMER_PROFILE_REQUIRED_FIELDS value is
 * non-empty. The Driving Licence number, Aadhaar number and date of birth are
 * no longer required; "age" is met by a stored age, a date of birth, or both
 * identity numbers (profiles completed under the earlier rules / old app
 * builds — see hasCustomerAgeRequirement). Every write path stores the result
 * in Customer.isProfileCompleted, and every read path reports it through these
 * helpers so the two never disagree.
 */

export type { CustomerProfileField };
export { effectiveCustomerAge };

/** Name and phone live on User; the rest on Customer. */
export interface ProfileFieldSource {
  name?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  age?: number | null;
  dob?: string | null;
  drivingLicenceNumber?: string | null;
  aadhaarNumber?: string | null;
}

/**
 * Merge a User row and its (optional) Customer row into one source. `age` and
 * `dob` are required keys so every query that feeds this selects them.
 */
export function profileFieldsOf(
  user: { name?: string | null; phone?: string | null },
  customer?:
    | (Omit<ProfileFieldSource, "name" | "phone" | "age" | "dob"> & { age: number | null; dob: string | null })
    | null,
): ProfileFieldSource {
  return {
    name: user.name,
    phone: user.phone,
    addressLine1: customer?.addressLine1,
    city: customer?.city,
    state: customer?.state,
    zipCode: customer?.zipCode,
    country: customer?.country,
    age: customer?.age,
    dob: customer?.dob,
    drivingLicenceNumber: customer?.drivingLicenceNumber,
    aadhaarNumber: customer?.aadhaarNumber,
  };
}

export function getMissingProfileFields(source: ProfileFieldSource): CustomerProfileField[] {
  return CUSTOMER_PROFILE_REQUIRED_FIELDS.filter((field) =>
    field === "age" ? !hasCustomerAgeRequirement(source) : !String(source[field] ?? "").trim(),
  );
}

export function isCustomerProfileComplete(source: ProfileFieldSource): boolean {
  return getMissingProfileFields(source).length === 0;
}

function joinLabels(fields: CustomerProfileField[]): string {
  const labels = fields.map((f) => CUSTOMER_PROFILE_FIELD_LABELS[f]);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * Human message for a blocked booking. `audience` is "self" for the customer's
 * own request and "staff" for a counter booking made on their behalf.
 */
export function profileIncompleteMessage(
  missing: CustomerProfileField[],
  audience: "self" | "staff",
): string {
  const onlyAge = missing.length === 1 && missing[0] === "age";
  if (audience === "self") {
    return onlyAge
      ? "Add your age to your profile before booking."
      : `Complete your profile before booking. Missing: ${joinLabels(missing)}.`;
  }
  return onlyAge
    ? "Add the customer's age before creating a booking."
    : `Complete the customer's profile before creating a booking. Missing: ${joinLabels(missing)}.`;
}

// ── Placeholder emails ───────────────────────────────────────────────────────
// Shared with the web app via @repo/schemas (identity.ts): walk-ins without an
// email get `walkin-<publicId>@walkin.invalid` (legacy `walkin_*@temp.com`),
// deleted accounts `deleted-<publicId>@deleted.invalid`. Never show or print one.
export {
  displayEmail,
  isPlaceholderEmail,
  isWalkinPlaceholderEmail,
  walkinPlaceholderEmail,
} from "@repo/schemas";

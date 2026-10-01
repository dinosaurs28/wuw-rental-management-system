import {
  CUSTOMER_PROFILE_FIELD_LABELS,
  CUSTOMER_PROFILE_REQUIRED_FIELDS,
  type CustomerProfileField,
} from "@repo/schemas";

/**
 * Customer profile completeness (#1) and placeholder-email helpers.
 *
 * A profile is complete when every CUSTOMER_PROFILE_REQUIRED_FIELDS value is
 * non-empty — that now includes the Driving Licence and Aadhaar numbers. Every
 * write path stores the result in Customer.isProfileCompleted, and every read
 * path reports it through these helpers so the two never disagree.
 */

export type { CustomerProfileField };

/** Name and phone live on User; the rest on Customer. */
export interface ProfileFieldSource {
  name?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  drivingLicenceNumber?: string | null;
  aadhaarNumber?: string | null;
}

/** Merge a User row and its (optional) Customer row into one source. */
export function profileFieldsOf(
  user: { name?: string | null; phone?: string | null },
  customer?: Omit<ProfileFieldSource, "name" | "phone"> | null,
): ProfileFieldSource {
  return {
    name: user.name,
    phone: user.phone,
    addressLine1: customer?.addressLine1,
    city: customer?.city,
    state: customer?.state,
    zipCode: customer?.zipCode,
    country: customer?.country,
    drivingLicenceNumber: customer?.drivingLicenceNumber,
    aadhaarNumber: customer?.aadhaarNumber,
  };
}

export function getMissingProfileFields(source: ProfileFieldSource): CustomerProfileField[] {
  return CUSTOMER_PROFILE_REQUIRED_FIELDS.filter(
    (field) => !String(source[field] ?? "").trim(),
  );
}

export function isCustomerProfileComplete(source: ProfileFieldSource): boolean {
  return getMissingProfileFields(source).length === 0;
}

const IDENTITY_FIELDS: CustomerProfileField[] = ["drivingLicenceNumber", "aadhaarNumber"];

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
  const onlyIdentity = missing.length > 0 && missing.every((f) => IDENTITY_FIELDS.includes(f));
  if (audience === "self") {
    return onlyIdentity
      ? `Add your ${joinLabels(missing)} to your profile before booking.`
      : `Complete your profile before booking. Missing: ${joinLabels(missing)}.`;
  }
  return onlyIdentity
    ? `Add the customer's ${joinLabels(missing)} before creating a booking.`
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

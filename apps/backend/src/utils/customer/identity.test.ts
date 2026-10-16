/**
 * Pure checks of customer profile completeness after the Oct 2026 change: no
 * Driving Licence / Aadhaar number or date of birth on the form — an age
 * instead. Older customers stay complete through a date of birth, or both
 * identity numbers (profiles completed under the earlier rules / old builds).
 * No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGE_UNDER_MIN_MESSAGE,
  ageFromDob,
  customerAgeError,
  updateProfileSchema,
  completeWalkinProfileSchema,
} from "@repo/schemas";
import {
  effectiveCustomerAge,
  getMissingProfileFields,
  isCustomerProfileComplete,
  profileFieldsOf,
  profileIncompleteMessage,
} from "./identity.js";

const base = {
  name: "Asha Rao",
  phone: "9876543210",
  addressLine1: "12 MG Road",
  city: "Manipal",
  state: "Karnataka",
  zipCode: "576104",
  country: "India",
};
const now = new Date(2026, 9, 18); // 18 Oct 2026, local

test("new customer: age alone completes the profile (no DL, Aadhaar or date of birth)", () => {
  assert.deepEqual(getMissingProfileFields({ ...base, age: 24 }), []);
  assert.equal(isCustomerProfileComplete({ ...base, age: 24, drivingLicenceNumber: null, aadhaarNumber: null }), true);
});

test("old customer with a date of birth stays complete; age is derived from it", () => {
  const src = profileFieldsOf(
    { name: base.name, phone: base.phone },
    { ...base, age: null, dob: "2000-05-20", drivingLicenceNumber: null, aadhaarNumber: null },
  );
  assert.equal(isCustomerProfileComplete(src), true);
  assert.equal(ageFromDob("2000-05-20", now), 26);
  assert.equal(ageFromDob("2000-10-19", now), 25); // birthday tomorrow
  assert.equal(effectiveCustomerAge({ age: null, dob: "2000-05-20" }, now), 26);
  assert.equal(effectiveCustomerAge({ age: 31, dob: "2000-05-20" }, now), 31); // entered age wins
});

test("old customer with neither age nor date of birth", () => {
  // completed under the earlier rules (both identity numbers) → still complete
  assert.equal(
    isCustomerProfileComplete({ ...base, age: null, dob: null, drivingLicenceNumber: "KA0120110012345", aadhaarNumber: "234123412346" }),
    true,
  );
  // nothing to go on → asked for an age, nothing else
  const missing = getMissingProfileFields({ ...base, age: null, dob: "", drivingLicenceNumber: "KA0120110012345", aadhaarNumber: null });
  assert.deepEqual(missing, ["age"]);
  assert.equal(profileIncompleteMessage(missing, "self"), "Add your age to your profile before booking.");
  assert.equal(profileIncompleteMessage(missing, "staff"), "Add the customer's age before creating a booking.");
  assert.equal(effectiveCustomerAge({ age: null, dob: null }), null);
});

test("other profile fields are still required", () => {
  assert.deepEqual(getMissingProfileFields({ ...base, city: "", age: 30 }), ["city"]);
});

test("age on the form: whole years, 18–99", () => {
  assert.equal(customerAgeError(18), null);
  assert.equal(customerAgeError("45"), null);
  assert.equal(customerAgeError(99), null);
  assert.equal(customerAgeError(17), AGE_UNDER_MIN_MESSAGE);
  assert.equal(customerAgeError(""), "Age is required");
  assert.notEqual(customerAgeError(100), null);
  assert.notEqual(customerAgeError(20.5), null);
  assert.notEqual(customerAgeError("abc"), null);
});

test("profile form schema: age required, no DL / Aadhaar / date of birth", () => {
  const form = { ...base, alternatePhone: "" };
  assert.equal(updateProfileSchema.safeParse({ ...form, age: "27" }).success, true);
  const noAge = updateProfileSchema.safeParse(form);
  assert.equal(noAge.success, false);
  const parsed = updateProfileSchema.parse({ ...form, age: 27, drivingLicenceNumber: "x", dob: "2000-01-01" });
  assert.equal("drivingLicenceNumber" in parsed, false);
  assert.equal("dob" in parsed, false);
});

test("walk-in form: DL / Aadhaar optional (validated when filled in), age required", () => {
  const walkin = { customer_public_id: "c1", ...base, age: 30 };
  assert.equal(completeWalkinProfileSchema.safeParse(walkin).success, true);
  assert.equal(completeWalkinProfileSchema.safeParse({ ...walkin, drivingLicenceNumber: "", aadhaarNumber: "" }).success, true);
  assert.equal(completeWalkinProfileSchema.safeParse({ ...walkin, aadhaarNumber: "1234" }).success, false);
  assert.equal(completeWalkinProfileSchema.safeParse({ ...walkin, age: 16 }).success, false);
});

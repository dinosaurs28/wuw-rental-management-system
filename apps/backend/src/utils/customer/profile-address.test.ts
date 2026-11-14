/**
 * Nov 2026 client bugs: "Customer can't enter the Address" / "can't enter the
 * country as India". The profile schema now accepts the spellings the app and
 * web forms actually send: a +91-prefixed phone (walk-in customers), "IN" /
 * "india" for the country, a spaced PIN code. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCountryInput, normalizeIndianMobileInput, updateProfileSchema } from "@repo/schemas";

const form = {
  name: "Asha Rao",
  phone: "9876543210",
  age: 27,
  addressLine1: "12 MG Road",
  city: "Manipal",
  state: "Karnataka",
  zipCode: "576104",
  country: "India",
  alternatePhone: "",
};

test("prefixed phone numbers are reduced to 10 digits instead of rejected", () => {
  for (const phone of ["+919876543210", "+91 98765 43210", "919876543210", "09876543210", " 9876543210 "]) {
    const r = updateProfileSchema.safeParse({ ...form, phone, alternatePhone: phone });
    assert.equal(r.success, true, phone);
    if (r.success) {
      assert.equal(r.data.phone, "9876543210");
      assert.equal(r.data.alternatePhone, "9876543210");
    }
  }
  assert.equal(updateProfileSchema.safeParse({ ...form, phone: "12345" }).success, false);
  assert.equal(updateProfileSchema.safeParse({ ...form, phone: "" }).success, false);
  assert.equal(updateProfileSchema.safeParse({ ...form, alternatePhone: "" }).success, true);
  assert.equal(normalizeIndianMobileInput("abc"), "abc");
});

test("country: India, IN, india, IND all save as India; other countries kept", () => {
  for (const country of ["India", "IN", "in", "india", " India ", "IND", "Bharat"]) {
    const r = updateProfileSchema.safeParse({ ...form, country });
    assert.equal(r.success, true, country);
    if (r.success) assert.equal(r.data.country, "India");
  }
  assert.equal(normalizeCountryInput("Nepal"), "Nepal");
  assert.equal(updateProfileSchema.safeParse({ ...form, country: "  " }).success, false);
});

test("address fields are trimmed; blank ones are still required; PIN spaces removed", () => {
  const r = updateProfileSchema.safeParse({ ...form, addressLine1: "  12 MG Road  ", zipCode: "576 104" });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.addressLine1, "12 MG Road");
    assert.equal(r.data.zipCode, "576104");
  }
  assert.equal(updateProfileSchema.safeParse({ ...form, addressLine1: "   " }).success, false);
  assert.equal(updateProfileSchema.safeParse({ ...form, city: "" }).success, false);
});

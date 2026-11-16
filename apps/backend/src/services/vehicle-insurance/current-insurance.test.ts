/**
 * Admin and branch manager show the same insurance (Nov 16 2026). No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { currentInsurance, newestRecord } from "./current-insurance.js";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

test("a BM correction to an earlier date wins over the older row with the later date", () => {
  const rows = [
    { id: 1, policyNumber: "OLD-1", provider: "Acko", validTill: d("2036-03-01") }, // typo'd year
    { id: 2, policyNumber: "NEW-2", provider: "ICICI", validTill: d("2026-03-01") }, // the correction
  ];
  const latest = newestRecord(rows);
  assert.equal(latest?.id, 2);
  assert.deepEqual(currentInsurance({ insuranceExpiry: d("2026-03-01") }, latest), {
    expiry: d("2026-03-01"),
    policyNumber: "NEW-2",
    provider: "ICICI",
  });
});

test("the expiry always follows Vehicle.insuranceExpiry (what bookings check)", () => {
  const r = currentInsurance({ insuranceExpiry: d("2027-01-10") }, { policyNumber: "P", provider: "X", validTill: d("2029-01-01") });
  assert.deepEqual(r.expiry, d("2027-01-10"));
});

test("no records: the vehicle date with blank policy and provider", () => {
  assert.deepEqual(currentInsurance({ insuranceExpiry: d("2027-01-10") }, null), {
    expiry: d("2027-01-10"),
    policyNumber: null,
    provider: null,
  });
  assert.equal(newestRecord([]), null);
});

/**
 * Pickup other charges (Nov 15 2026) — pure rules: parsing, replace-not-append
 * comparison, the session view, and how they count in what a booking owes,
 * in revenue, and in Financials' payment types. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import {
  PickupChargeError,
  parsePickupOtherCharges,
  pickupChargeLines,
  pickupChargesTotal,
  pickupChargesView,
  sameCharges,
} from "./pickup-other-charges.js";
import { assembleBookingOwed, tallyOwedEntries, type OwedLedgerEntry } from "../payment/booking-owed.service.js";
import { typeForLedgerLine } from "../financials/payment-type.js";
import { revenueOf } from "../reporting/finance/booking-finance.js";

const line = (publicId: string, description: string, amount: string, extra: Partial<Record<string, unknown>> = {}) => ({
  publicId,
  description,
  amount,
  entryType: "DAMAGE",
  referenceType: "OTHER_CHARGE",
  isVoided: false,
  ...extra,
});

test("parses the set: absent = unchanged, null / [] = none, labels trimmed, 2 dp", () => {
  assert.equal(parsePickupOtherCharges(undefined), undefined);
  assert.deepEqual(parsePickupOtherCharges(null), []);
  assert.deepEqual(parsePickupOtherCharges([]), []);
  const out = parsePickupOtherCharges([
    { label: "  Child   seat ", amount: 250 },
    { reason: "Cleaning", amount: "99.5" },
    { description: "Delivery", amount: "1200.25" },
  ])!;
  assert.deepEqual(out.map((c) => [c.label, c.amount.toFixed(2)]), [
    ["Child seat", "250.00"],
    ["Cleaning", "99.50"],
    ["Delivery", "1200.25"],
  ]);
});

test("refuses bad lines with PICKUP_CHARGES_INVALID and the line index", () => {
  const bad: unknown[] = [
    "nope",
    [{ label: "", amount: 10 }],
    [{ label: "x", amount: 0 }],
    [{ label: "x", amount: -5 }],
    [{ label: "x", amount: "10.123" }],
    [{ label: "x", amount: "abc" }],
    [{ label: "x", amount: Number.NaN }],
    [{ label: "x", amount: 600000 }],
    [{ label: "x".repeat(121), amount: 10 }],
    Array.from({ length: 21 }, () => ({ label: "x", amount: 1 })),
  ];
  for (const raw of bad) {
    assert.throws(() => parsePickupOtherCharges(raw), (err: unknown) => {
      assert.ok(err instanceof PickupChargeError);
      assert.equal(err.status, 400);
      assert.equal(err.toJSON().code, "PICKUP_CHARGES_INVALID");
      return true;
    });
  }
  try {
    parsePickupOtherCharges([{ label: "ok", amount: 5 }, { label: "", amount: 5 }]);
  } catch (err) {
    assert.equal((err as PickupChargeError).index, 1);
  }
});

test("the same set again is no change (replace, never append); any difference replaces", () => {
  const current = [line("a", "Child seat", "250.00"), line("b", "Cleaning", "99.50")];
  const same = parsePickupOtherCharges([{ label: "Child seat", amount: "250" }, { label: "Cleaning", amount: 99.5 }])!;
  assert.equal(sameCharges(current, same), true);
  assert.equal(sameCharges(current, same.slice(0, 1)), false);
  assert.equal(sameCharges(current, [same[1]!, same[0]!]), false);
  assert.equal(sameCharges(current, [same[0]!, { label: "Cleaning", amount: new Decimal("100") }]), false);
  assert.equal(sameCharges([], []), true);
});

test("only live OTHER_CHARGE damage lines are pickup charges; view and total", () => {
  const entries = [
    { publicId: "base", description: "Remaining balance due at pickup", amount: "5000.00", entryType: "BOOKING_BASE", referenceType: "BOOKING_REMAINING" },
    line("a", "Child seat", "250.00"),
    line("old", "Child seat", "200.00", { isVoided: true }),
    { publicId: "dmg", description: "Damage", amount: "900.00", entryType: "DAMAGE", referenceType: "DROP_DAMAGE" },
    line("b", "Cleaning", "99.50"),
  ];
  assert.deepEqual(pickupChargeLines(entries).map((e) => e.publicId), ["a", "b"]);
  assert.equal(pickupChargesTotal(pickupChargeLines(entries)).toFixed(2), "349.50");
  assert.deepEqual(pickupChargesView(entries), {
    otherCharges: [
      { publicId: "a", label: "Child seat", amount: "250.00" },
      { publicId: "b", label: "Cleaning", amount: "99.50" },
    ],
    otherChargesTotal: "349.50",
  });
  assert.deepEqual(pickupChargesView([]), { otherCharges: [], otherChargesTotal: "0.00" });
});

const owedEntry = (sessionType: string, status: string, entryType: string, amount: number, referenceType: string | null): OwedLedgerEntry => ({
  entryType,
  classification: entryType === "DEPOSIT" ? "NON_TAXABLE" : "NON_TAXABLE",
  amount,
  gstAmount: 0,
  referenceType,
  referenceId: null,
  session: { sessionType, status },
});

test("owed: pickup other charges sit beside the rent (not drop charges, no GST)", () => {
  const entries = [
    owedEntry("PICKUP", "COMPLETED", "DAMAGE", 250, "OTHER_CHARGE"),
    owedEntry("PICKUP", "COMPLETED", "DAMAGE", 99.5, "OTHER_CHARGE"),
    // the pickup's rent line is in totalFinal already — never counted again
    owedEntry("PICKUP", "COMPLETED", "BOOKING_BASE", 5000, "BOOKING_REMAINING"),
    owedEntry("PICKUP", "COMPLETED", "DEPOSIT", 2000, "SAFETY_DEPOSIT"),
    owedEntry("RETURN", "COMPLETED", "DAMAGE", 400, "OTHER_CHARGE"),
  ];
  const tally = tallyOwedEntries(entries);
  assert.equal(tally.pickupCharges.toFixed(2), "349.50");
  assert.equal(tally.dropBillCharges.toFixed(2), "400.00");
  assert.equal(tally.safetyDepositCharged.toFixed(2), "2000.00");
  const owed = assembleBookingOwed({
    totalFinal: 10000,
    pricingSnapshot: null,
    entries,
    legacyReturnCharges: new Decimal(0),
    dropDamages: [],
    standaloneDeposits: [],
    legacyDepositRefunds: [],
    goodwill: 0,
  });
  assert.equal(owed.pickupCharges.toFixed(2), "349.50");
  assert.equal(owed.returnCharges.toFixed(2), "400.00");
  // 10000 rent + 400 drop + 349.50 pickup + 2000 deposit held
  assert.equal(owed.totalOwed.toFixed(2), "12749.50");
});

test("Financials / revenue: a pickup other charge is an Extra charge, revenue extras include it", () => {
  assert.equal(typeForLedgerLine("DAMAGE", "OTHER_CHARGE"), "EXTRA_CHARGES");
  const r = revenueOf(
    { status: "PICKED_UP", totalFinal: 5000, totalDeposit: 0 },
    { returnCharges: new Decimal(0), pickupCharges: new Decimal("349.50"), refundsGoodwill: new Decimal(0) },
  );
  assert.equal(r.extras, 349.5);
  assert.equal(r.revenue, 5349.5);
  // older callers without the field are unchanged
  assert.equal(revenueOf({ status: "PICKED_UP", totalFinal: 5000, totalDeposit: 0 }, { returnCharges: new Decimal(10), refundsGoodwill: new Decimal(0) }).extras, 10);
});

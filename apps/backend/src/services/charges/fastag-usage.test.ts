/**
 * Pure checks of the FASTag usage billed at the drop (Oct 15 2026 client
 * item): no swap, mid-rental swaps, a recharged tag, cars without a FASTag,
 * missing readings (manual fallback), the state before the drop, and the
 * balance request field. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { z } from "zod";
import { fastagBalanceSchema } from "@repo/schemas";
import {
  FASTAG_RECHARGED_NOTE,
  fastagBalanceField,
  calculateFastagUsage,
  fastagBeforeDrop,
  fastagBillStale,
  type FastagLeg,
} from "./fastag-usage.js";
import { dropReadingsSignature } from "./drop-readings.js";

const d = (n: number | null) => (n == null ? null : new Decimal(n));
const leg = (
  start: number | null,
  end: number | null,
  overrides: Partial<FastagLeg> = {},
): FastagLeg => ({
  regNo: "KA20AB1234",
  hasFastag: true,
  startBalance: d(start),
  endBalance: d(end),
  endedBySwapPublicId: null,
  ...overrides,
});

test("no swap: pickup balance − balance at the drop", () => {
  const u = calculateFastagUsage([leg(480, 215)]);
  assert.equal(u.status, "COMPUTED");
  assert.equal(u.amount.toFixed(2), "265.00");
  assert.equal(u.label, "FASTag usage: ₹480 → ₹215");
  assert.equal(u.recharged, false);
  assert.deepEqual(u.notes, []);
});

test("no swap: paise are kept and printed with 2 decimals", () => {
  const u = calculateFastagUsage([leg(480.5, 215.25)]);
  assert.equal(u.amount.toFixed(2), "265.25");
  assert.equal(u.label, "FASTag usage: ₹480.50 → ₹215.25");
});

test("no swap: unchanged balance is a ₹0 usage", () => {
  const u = calculateFastagUsage([leg(300, 300)]);
  assert.equal(u.status, "COMPUTED");
  assert.equal(u.amount.toFixed(2), "0.00");
});

test("recharged tag: the balance went up — ₹0 for that leg, with a note", () => {
  const u = calculateFastagUsage([leg(200, 700)]);
  assert.equal(u.status, "COMPUTED");
  assert.equal(u.amount.toFixed(2), "0.00");
  assert.equal(u.recharged, true);
  assert.deepEqual(u.notes, [FASTAG_RECHARGED_NOTE]);
  assert.equal(u.legs[0]!.recharged, true);
});

test("swaps: usage summed over the cars, each car's own readings", () => {
  const u = calculateFastagUsage([
    leg(480, 300, { regNo: "KA20A1", endedBySwapPublicId: "swap1" }),
    leg(900, 850, { regNo: "KA20B2", endedBySwapPublicId: "swap2" }),
    leg(150, 100, { regNo: "KA20C3" }),
  ]);
  assert.equal(u.status, "COMPUTED");
  assert.equal(u.amount.toFixed(2), "280.00"); // 180 + 50 + 50
  assert.equal(u.label, "FASTag usage: KA20A1 ₹480 → ₹300, KA20B2 ₹900 → ₹850, KA20C3 ₹150 → ₹100");
});

test("swaps: a recharged leg counts 0, the others still bill", () => {
  const u = calculateFastagUsage([
    leg(480, 300, { regNo: "KA20A1", endedBySwapPublicId: "swap1" }),
    leg(100, 600, { regNo: "KA20B2" }),
  ]);
  assert.equal(u.amount.toFixed(2), "180.00");
  assert.equal(u.recharged, true);
  assert.deepEqual(u.notes, [FASTAG_RECHARGED_NOTE]);
});

test("swaps: a car without a FASTag adds nothing and needs no readings", () => {
  const u = calculateFastagUsage([
    leg(null, null, { regNo: "KA20A1", hasFastag: false, endedBySwapPublicId: "swap1" }),
    leg(500, 420, { regNo: "KA20B2" }),
  ]);
  assert.equal(u.status, "COMPUTED");
  assert.equal(u.amount.toFixed(2), "80.00");
  assert.equal(u.label, "FASTag usage: ₹500 → ₹420");
});

test("no car with a FASTag: NO_FASTAG, nothing billed", () => {
  const u = calculateFastagUsage([leg(null, null, { hasFastag: false })]);
  assert.equal(u.status, "NO_FASTAG");
  assert.equal(u.amount.toFixed(2), "0.00");
  assert.equal(u.label, null);
});

test("missing readings fall back to the manual charge for the whole booking", () => {
  // Old booking / legacy pickup: no pickup balance
  assert.equal(calculateFastagUsage([leg(null, 215)]).status, "READINGS_MISSING");
  // Drop on an older app build: no drop balance
  assert.equal(calculateFastagUsage([leg(480, null)]).status, "READINGS_MISSING");
  // A swap recorded without readings (older app build), even though the other legs have them
  const u = calculateFastagUsage([
    leg(480, null, { endedBySwapPublicId: "swap1" }),
    leg(null, 100),
  ]);
  assert.equal(u.status, "READINGS_MISSING");
  assert.equal(u.amount.toFixed(2), "0.00");
  assert.equal(u.label, null);
});

test("before the drop: READINGS with the current car's start balance and prior usage", () => {
  const none = fastagBeforeDrop([leg(480, null)]);
  assert.equal(none.mode, "READINGS");
  assert.equal(none.currentHasFastag, true);
  assert.equal(none.currentStartBalance?.toFixed(2), "480.00");
  assert.equal(none.priorUsage.toFixed(2), "0.00");
  assert.equal(none.swapCount, 0);

  const swapped = fastagBeforeDrop([
    leg(480, 300, { endedBySwapPublicId: "swap1" }),
    leg(900, null),
  ]);
  assert.equal(swapped.mode, "READINGS");
  assert.equal(swapped.priorUsage.toFixed(2), "180.00");
  assert.equal(swapped.currentStartBalance?.toFixed(2), "900.00");
  assert.equal(swapped.swapCount, 1);
});

test("before the drop: swapped onto a car without a FASTag — usage is already known", () => {
  const s = fastagBeforeDrop([
    leg(480, 300, { endedBySwapPublicId: "swap1" }),
    leg(null, null, { hasFastag: false }),
  ]);
  assert.equal(s.mode, "READINGS");
  assert.equal(s.currentHasFastag, false);
  assert.equal(s.priorUsage.toFixed(2), "180.00");
  // …and the drop bills it without a drop reading
  assert.equal(calculateFastagUsage([
    leg(480, 300, { endedBySwapPublicId: "swap1" }),
    leg(null, null, { hasFastag: false }),
  ]).amount.toFixed(2), "180.00");
});

test("before the drop: MANUAL when an earlier reading is missing, NONE without a FASTag", () => {
  assert.equal(fastagBeforeDrop([leg(null, null)]).mode, "MANUAL");
  assert.equal(fastagBeforeDrop([leg(480, null, { endedBySwapPublicId: "s" }), leg(900, null)]).mode, "MANUAL");
  assert.equal(fastagBeforeDrop([leg(480, 300, { endedBySwapPublicId: "s" }), leg(null, null)]).mode, "MANUAL");
  assert.equal(fastagBeforeDrop([leg(null, null, { hasFastag: false })]).mode, "NONE");
});

test("balance field: optional, 0 … 1,00,000, at most 2 decimals (server field and shared schema agree)", () => {
  for (const schema of [fastagBalanceField, fastagBalanceSchema]) {
    assert.equal(schema.parse(undefined), undefined);
    assert.equal(schema.parse(null), undefined);
    assert.equal(schema.parse(""), undefined);
    assert.equal(schema.parse("480.50"), 480.5);
    assert.equal(schema.parse(0), 0);
    assert.equal(schema.parse(100000), 100000);
    assert.equal(schema.safeParse(-1).success, false);
    assert.equal(schema.safeParse(100000.01).success, false);
    assert.equal(schema.safeParse(10.555).success, false);
    assert.equal(schema.safeParse("abc").success, false);
  }
  // Absent from a request body (older app builds)
  assert.deepEqual(z.object({ returnFastagBalance: fastagBalanceField }).parse({}), {});
});

test("stale bill: the pickup balance changed after the drop bill was computed", () => {
  // Bills computed before FASTag readings existed carry no metadata.fastag
  assert.equal(fastagBillStale(null, new Decimal(480)), false);
  assert.equal(fastagBillStale({ status: "COMPUTED" }, new Decimal(480)), false);
  assert.equal(fastagBillStale({ pickupBalance: "480.00" }, new Decimal("480")), false);
  assert.equal(fastagBillStale({ pickupBalance: null }, null), false);
  assert.equal(fastagBillStale({ pickupBalance: "480.00" }, new Decimal(500)), true);
  // Computed on the manual fallback, then the pickup balance was entered
  assert.equal(fastagBillStale({ pickupBalance: null }, new Decimal(480)), true);
});

test("drop readings signature: changes when a pickup / swap reading changes", () => {
  const km = { complete: true, priorKm: 0, currentStartOdometer: 12000, swapCount: 0 };
  const base = dropReadingsSignature(km, [leg(480, 215)]);
  assert.equal(dropReadingsSignature({ ...km }, [leg(480, 215)]), base);
  // Pickup odometer corrected
  assert.notEqual(dropReadingsSignature({ ...km, currentStartOdometer: 12050 }, [leg(480, 215)]), base);
  // Pickup FASTag balance entered / corrected
  assert.notEqual(dropReadingsSignature(km, [leg(500, 215)]), base);
  assert.notEqual(dropReadingsSignature(km, [leg(null, 215)]), base);
  // A swap recorded in between
  assert.notEqual(
    dropReadingsSignature({ ...km, swapCount: 1, priorKm: 40 }, [leg(480, 300, { endedBySwapPublicId: "s1" }), leg(900, 215)]),
    base,
  );
  // Old builds without an end odometer: only FASTag is compared
  assert.equal(dropReadingsSignature(null, [leg(480, 215)]), dropReadingsSignature(null, [leg(480, 215)]));
});

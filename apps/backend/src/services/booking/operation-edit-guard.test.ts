/**
 * Pure checks of the completed pickup / return edit rules (client item 1):
 * km worked out with the allowance the drop billed with, the corrected pickup
 * reading across mid-rental swaps, reading bounds, an open drop bill going
 * stale, photo minimums / required slots and the audit before/after. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import type { OdometerSegments } from "../charges/km-allowance.service.js";
import {
  billedKmAllowance,
  billedKmCharge,
  changedFields,
  emptiedRequiredSlots,
  endOdometerProblem,
  odometerBillStale,
  photosEmptied,
  pickupOdometerProblem,
  withPickupOdometer,
} from "./operation-edit-guard.js";

const noSwap = (start: number | null): OdometerSegments => ({
  swapCount: 0,
  swapsMissingReadings: 0,
  complete: true,
  priorKm: 0,
  currentStartOdometer: start,
  currentStartFuelLevel: null,
  segments: [],
});

// Picked up at 1000, swapped at 1150 (old car) → new car started at 5000.
const oneSwap = (pickup: number | null, oldEnd: number | null = 1150, newStart: number | null = 5000): OdometerSegments => {
  const km = oldEnd == null ? null : pickup == null ? 0 : Math.max(0, oldEnd - pickup);
  const complete = oldEnd != null && newStart != null;
  return {
    swapCount: 1,
    swapsMissingReadings: complete ? 0 : 1,
    complete,
    priorKm: complete ? km ?? 0 : 0,
    currentStartOdometer: newStart,
    currentStartFuelLevel: null,
    segments: [{ endedBySwapPublicId: "swap1", startOdometer: pickup, endOdometer: oldEnd, km }],
  };
};

test("withPickupOdometer moves the first segment after a swap with readings", () => {
  const before = oneSwap(1000);
  assert.equal(before.priorKm, 150);
  const after = withPickupOdometer(before, 1100);
  assert.equal(after.priorKm, 50);
  assert.equal(after.segments[0]!.startOdometer, 1100);
  assert.equal(after.segments[0]!.km, 50);
  // The current (replacement) car still starts where the swap recorded it
  assert.equal(after.currentStartOdometer, 5000);
  // No swap: the corrected reading is the current start
  assert.equal(withPickupOdometer(noSwap(1000), 1200).currentStartOdometer, 1200);
  // The input isn't changed
  assert.equal(before.segments[0]!.startOdometer, 1000);
});

test("reading bounds", () => {
  assert.match(pickupOdometerProblem(noSwap(1000), 1200, 1150)!, /drop reading \(1150 km\)/);
  assert.equal(pickupOdometerProblem(noSwap(1000), 1100, 1150), null);
  assert.equal(pickupOdometerProblem(noSwap(1000), 5000, null), null);
  assert.match(pickupOdometerProblem(oneSwap(1000), 1200, 5100)!, /swapped \(1150 km\)/);
  assert.equal(pickupOdometerProblem(oneSwap(1000), 1100, 5100), null);

  assert.match(endOdometerProblem(noSwap(1000), 999)!, /pickup reading \(1000 km\)/);
  assert.equal(endOdometerProblem(noSwap(1000), 1000), null);
  assert.match(endOdometerProblem(oneSwap(1000), 4999)!, /replacement vehicle's reading at the swap \(5000 km\)/);
  assert.equal(endOdometerProblem(oneSwap(1000, null, null), 10), null);
  assert.equal(endOdometerProblem(noSwap(null), 10), null);
});

test("km is worked out with the allowance the drop billed with, not today's pricing", () => {
  const segments = noSwap(1000);
  // Billed: 100 free km @ ₹10 — 1000 → 1150 = ₹500 (pricing later raised to 200 free km: not used)
  const billed = billedKmAllowance({
    billKm: { includedKm: 100, extraKmRate: "10.00", extraKmEnabled: true, startOdometer: 1000 },
    freeKmLimit: 100,
    extraKmCharged: 50,
    legacyExtraKmRate: null,
  });
  assert.equal(billedKmCharge(billed, segments, 1150).charge!.toFixed(2), "500.00");
  assert.equal(billedKmCharge(billed, segments, 1110).charge!.toFixed(2), "100.00");
  assert.deepEqual(billedKmCharge(billed, segments, 1090), { measured: true, kmDriven: 90, extraKm: 0, charge: new Decimal(0) });
  // 5.5 × 81 = 445.5 → rounded up
  const odd = billedKmAllowance({ billKm: { includedKm: 100, extraKmRate: "5.5", extraKmEnabled: true }, freeKmLimit: null, extraKmCharged: null, legacyExtraKmRate: null });
  assert.equal(billedKmCharge(odd, segments, 1181).charge!.toFixed(2), "446.00");
  // After a swap with readings: km on the old car + the replacement from its start
  assert.equal(billedKmCharge(billed, oneSwap(1000), 5000).kmDriven, 150);

  // Legacy drop: free km from the booking, rate from the extra-km charge row
  const legacy = billedKmAllowance({ billKm: null, freeKmLimit: 100, extraKmCharged: 50, legacyExtraKmRate: "8.5" });
  assert.deepEqual(legacy, { includedKm: 100, extraKmRate: new Decimal("8.5"), extraKmEnabled: true });
  assert.equal(billedKmCharge(legacy, segments, 1150).charge!.toFixed(2), "425.00");
  // Legacy, extra km recorded but no charge row: not charged on that plan — ₹0 whatever the reading
  const notCharged = billedKmAllowance({ billKm: null, freeKmLimit: 100, extraKmCharged: 50, legacyExtraKmRate: null });
  assert.equal(notCharged.extraKmEnabled, false);
  assert.equal(billedKmCharge(notCharged, segments, 1300).charge!.toFixed(2), "0.00");
  // Legacy, nothing extra and no rate recorded: a reading past the free km can't be priced from the drop
  const unknown = billedKmAllowance({ billKm: null, freeKmLimit: 100, extraKmCharged: 0, legacyExtraKmRate: null });
  assert.equal(billedKmCharge(unknown, segments, 1090).charge!.toFixed(2), "0.00");
  assert.equal(billedKmCharge(unknown, segments, 1150).charge, null);
  // No free km recorded at all (old app build, no drop reading)
  const none = billedKmAllowance({ billKm: null, freeKmLimit: null, extraKmCharged: null, legacyExtraKmRate: null });
  assert.equal(billedKmCharge(none, segments, 1010).charge, null);
  // Swap without readings: km not measured, readings don't move the charge
  assert.equal(billedKmCharge(billed, oneSwap(1000, null, null), 9999).measured, false);
});

test("odometerBillStale: an open drop bill goes stale when the pickup reading is corrected", () => {
  assert.equal(odometerBillStale({ pickupOdometer: 1000 }, 1000), false);
  assert.equal(odometerBillStale({ pickupOdometer: 1000 }, 1010), true);
  // Bills computed before pickupOdometer was stored: the km data's start reading …
  assert.equal(odometerBillStale({ km: { startOdometer: 1000, swapCount: 0, segments: [] } }, 1010), true);
  assert.equal(odometerBillStale({ km: { startOdometer: 1000, swapCount: 0, segments: [] } }, 1000), false);
  // … or, after a swap, the first segment's start
  assert.equal(odometerBillStale({ km: { startOdometer: 5000, swapCount: 1, segments: [{ startOdometer: 1000 }] } }, 1000), false);
  assert.equal(odometerBillStale({ km: { startOdometer: 5000, swapCount: 1, segments: [{ startOdometer: 1000 }] } }, 1100), true);
  // Nothing recorded: never stale for this
  assert.equal(odometerBillStale({}, 1000), false);
  assert.equal(odometerBillStale(null, 1000), false);
  assert.equal(odometerBillStale({ pickupOdometer: null }, null), false);
});

test("photosEmptied: photos can be replaced, not all taken away", () => {
  assert.equal(photosEmptied(3, 0), true);
  assert.equal(photosEmptied(3, 1), false);
  assert.equal(photosEmptied(0, 0), false); // older drops saved without photos
});

test("emptiedRequiredSlots: a required slot can't be left empty by an edit", () => {
  assert.deepEqual(emptiedRequiredSlots(["Front", "Odometer"], ["Front", "Odometer", null], ["Odometer", null]), ["Front"]);
  // Replaced (removed + retaken): still filled
  assert.deepEqual(emptiedRequiredSlots(["Front"], ["Front"], ["Front"]), []);
  // Never had one (older pickup): not forced now
  assert.deepEqual(emptiedRequiredSlots(["Front", "Back"], ["Front"], ["Front"]), []);
});

test("changedFields keeps only what changes", () => {
  const out = changedFields(
    { odometer: 1000, fuelLevel: "8", dlStatus: "COLLECTED", photos: ["a", "b"] },
    { odometer: 1010, fuelLevel: "8", dlStatus: undefined, photos: ["a", "b"] },
  );
  assert.deepEqual(out.fields, ["odometer"]);
  assert.deepEqual(out.before, { odometer: 1000 });
  assert.deepEqual(out.after, { odometer: 1010 });
  assert.deepEqual(changedFields({ photos: ["a"] }, { photos: ["a", "c"] }).fields, ["photos"]);
  assert.deepEqual(changedFields({ fuelLevel: null as string | null }, { fuelLevel: "4" }).after, { fuelLevel: "4" });
});

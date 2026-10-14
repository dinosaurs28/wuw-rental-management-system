/**
 * Pure checks of the completed pickup / return edit rules (client item 1):
 * the "edit changes charges" money safeguard (km and fuel), the corrected
 * pickup reading across mid-rental swaps, reading bounds, required photo slots
 * and the audit before/after. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import type { OdometerSegments } from "../charges/km-allowance.service.js";
import { calculateFastagUsage, type FastagLeg } from "../charges/fastag-usage.js";
import {
  billedKmAllowance,
  billedKmCharge,
  changedFields,
  emptiedRequiredSlots,
  endOdometerProblem,
  fastagEditChangesCharges,
  fuelDeficitBars,
  fuelEditChangesCharges,
  hasFuelDeficit,
  kmEditChangesCharges,
  odometerBillStale,
  photosEmptied,
  pickupOdometerProblem,
  withPickupOdometer,
  type KmChargeOf,
} from "./operation-edit-guard.js";

// Same formula as calculateKmCharge: 100 free km, ₹5.5 / extra km, rounded up.
const INCLUDED = 100;
const RATE = new Decimal("5.5");
const chargeOf: KmChargeOf = (segments, end) => {
  if (!segments.complete) return new Decimal(0); // swap without readings: not measured
  const start = segments.currentStartOdometer;
  const driven = segments.priorKm + Math.max(0, end - (start ?? end));
  return RATE.mul(Math.max(0, driven - INCLUDED)).ceil();
};
const noChargeOf: KmChargeOf = () => new Decimal(0); // extra km not charged on this plan

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

test("pickup reading before any drop reading never changes charges", () => {
  const before = noSwap(1000);
  assert.equal(
    kmEditChangesCharges(
      { segmentsBefore: before, segmentsAfter: withPickupOdometer(before, 1300), endBefore: null, endAfter: null },
      chargeOf,
    ),
    false,
  );
});

test("pickup reading after the drop measured km: refused only when the extra km charge moves", () => {
  const before = noSwap(1000);
  // 1000 → 1150 = 150 km, 50 extra = ₹275. A start of 1010 gives 140 km = ₹220.
  assert.equal(
    kmEditChangesCharges(
      { segmentsBefore: before, segmentsAfter: withPickupOdometer(before, 1010), endBefore: 1150, endAfter: 1150 },
      chargeOf,
    ),
    true,
  );
  // Within the free km either way (1000 → 1080 vs 1010 → 1080): ₹0 both — allowed.
  assert.equal(
    kmEditChangesCharges(
      { segmentsBefore: before, segmentsAfter: withPickupOdometer(before, 1010), endBefore: 1080, endAfter: 1080 },
      chargeOf,
    ),
    false,
  );
  // Plan without extra-km charging: any correction leaves ₹0.
  assert.equal(
    kmEditChangesCharges(
      { segmentsBefore: before, segmentsAfter: withPickupOdometer(before, 900), endBefore: 1500, endAfter: 1500 },
      noChargeOf,
    ),
    false,
  );
});

test("drop reading: same charge allowed, different charge refused", () => {
  const segments = noSwap(1000);
  // 1180 vs 1181: 80 vs 81 extra km → ₹440 vs ₹446 (5.5 × 81 = 445.5 → 446)
  assert.equal(kmEditChangesCharges({ segmentsBefore: segments, segmentsAfter: segments, endBefore: 1180, endAfter: 1181 }, chargeOf), true);
  // 1050 vs 1090: both inside the 100 free km
  assert.equal(kmEditChangesCharges({ segmentsBefore: segments, segmentsAfter: segments, endBefore: 1050, endAfter: 1090 }, chargeOf), false);
  // No drop reading recorded (old app build): adding one that bills extra km is refused …
  assert.equal(kmEditChangesCharges({ segmentsBefore: segments, segmentsAfter: segments, endBefore: null, endAfter: 1300 }, chargeOf), true);
  // … one inside the free km is fine
  assert.equal(kmEditChangesCharges({ segmentsBefore: segments, segmentsAfter: segments, endBefore: null, endAfter: 1060 }, chargeOf), false);
});

test("swap without readings: km isn't measured, so readings never move the charge", () => {
  const segments = oneSwap(1000, null, null);
  assert.equal(segments.complete, false);
  assert.equal(
    kmEditChangesCharges(
      { segmentsBefore: segments, segmentsAfter: withPickupOdometer(segments, 400), endBefore: 9000, endAfter: 9999 },
      chargeOf,
    ),
    false,
  );
});

test("withPickupOdometer moves the first segment after a swap with readings", () => {
  const before = oneSwap(1000);
  assert.equal(before.priorKm, 150);
  const after = withPickupOdometer(before, 1100);
  assert.equal(after.priorKm, 50);
  assert.equal(after.segments[0]!.startOdometer, 1100);
  assert.equal(after.segments[0]!.km, 50);
  // The current (replacement) car still starts where the swap recorded it
  assert.equal(after.currentStartOdometer, 5000);
  // 150 km on the old car + 5000 → 5000 = 150 km → ₹275; with 1100: 50 km → ₹0
  assert.equal(
    kmEditChangesCharges({ segmentsBefore: before, segmentsAfter: after, endBefore: 5000, endAfter: 5000 }, chargeOf),
    true,
  );
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

test("fuel levels change money only when a fuel charge was worked out from them", () => {
  assert.equal(hasFuelDeficit("8", "5"), true);
  assert.equal(hasFuelDeficit("5", "5"), false);
  assert.equal(hasFuelDeficit("10", "9"), true);
  assert.equal(hasFuelDeficit(null, "5"), false);
  assert.equal(hasFuelDeficit("8", null), false);
  assert.equal(fuelDeficitBars("8", "5"), 3);
  assert.equal(fuelDeficitBars("5", "8"), 0);
  assert.equal(fuelDeficitBars(null, "8"), 0);

  const billed = { pickupLevel: "8", returnLevel: "5" }; // 3 bars short, billed on the drop bill's FUEL line
  // Return fuel 5 → 8 after the fuel charge was settled: the deficit is gone — refused
  assert.equal(fuelEditChangesCharges({ levelBasedFuelCharge: true, before: billed, after: { pickupLevel: "8", returnLevel: "8" } }), true);
  // 5 → 6: 2 bars short instead of 3 — refused
  assert.equal(fuelEditChangesCharges({ levelBasedFuelCharge: true, before: billed, after: { pickupLevel: "8", returnLevel: "6" } }), true);
  // Both moved by one: still 3 bars short — allowed
  assert.equal(fuelEditChangesCharges({ levelBasedFuelCharge: true, before: billed, after: { pickupLevel: "9", returnLevel: "6" } }), false);
  // No fuel charge on the bill: levels are free to change
  assert.equal(fuelEditChangesCharges({ levelBasedFuelCharge: false, before: billed, after: { pickupLevel: "5", returnLevel: "9" } }), false);
});

test("km is compared with the allowance the drop billed with, not today's pricing", () => {
  const segments = noSwap(1000);
  // Billed: 100 free km @ ₹10 — 1000 → 1150 = ₹500 (pricing later raised to 200 free km: not used)
  const billed = billedKmAllowance({
    billKm: { includedKm: 100, extraKmRate: "10.00", extraKmEnabled: true, startOdometer: 1000 },
    freeKmLimit: 100,
    extraKmCharged: 50,
    legacyExtraKmRate: null,
  });
  const chargeOf: KmChargeOf = (s, end) => billedKmCharge(billed, s, end).charge;
  assert.equal(billedKmCharge(billed, segments, 1150).charge!.toFixed(2), "500.00");
  // End reading 1150 → 1110: ₹100 instead of ₹500 — refused
  assert.equal(kmEditChangesCharges({ segmentsBefore: segments, segmentsAfter: segments, endBefore: 1150, endAfter: 1110 }, chargeOf), true);
  // 1080 → 1090: inside the billed 100 free km — allowed, and the km written follow the billed allowance
  assert.equal(kmEditChangesCharges({ segmentsBefore: segments, segmentsAfter: segments, endBefore: 1080, endAfter: 1090 }, chargeOf), false);
  assert.deepEqual(billedKmCharge(billed, segments, 1090), { measured: true, kmDriven: 90, extraKm: 0, charge: new Decimal(0) });

  // Legacy drop: free km from the booking, rate from the extra-km charge row
  const legacy = billedKmAllowance({ billKm: null, freeKmLimit: 100, extraKmCharged: 50, legacyExtraKmRate: "8.5" });
  assert.deepEqual(legacy, { includedKm: 100, extraKmRate: new Decimal("8.5"), extraKmEnabled: true });
  assert.equal(billedKmCharge(legacy, segments, 1150).charge!.toFixed(2), "425.00");
  // Legacy, extra km recorded but no charge row: not charged on that plan — ₹0 whatever the reading
  const notCharged = billedKmAllowance({ billKm: null, freeKmLimit: 100, extraKmCharged: 50, legacyExtraKmRate: null });
  assert.equal(notCharged.extraKmEnabled, false);
  assert.equal(billedKmCharge(notCharged, segments, 1300).charge!.toFixed(2), "0.00");
  // Legacy, nothing extra and no rate recorded: a reading past the free km can't be priced — refused
  const unknown = billedKmAllowance({ billKm: null, freeKmLimit: 100, extraKmCharged: 0, legacyExtraKmRate: null });
  const unknownOf: KmChargeOf = (s, end) => billedKmCharge(unknown, s, end).charge;
  assert.equal(billedKmCharge(unknown, segments, 1090).charge!.toFixed(2), "0.00");
  assert.equal(kmEditChangesCharges({ segmentsBefore: segments, segmentsAfter: segments, endBefore: 1050, endAfter: 1090 }, unknownOf), false);
  assert.equal(kmEditChangesCharges({ segmentsBefore: segments, segmentsAfter: segments, endBefore: 1050, endAfter: 1150 }, unknownOf), true);
  // No free km recorded at all (old app build, no drop reading): nothing can be shown equal
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

test("FASTag balances change money only when the worked-out FASTag charge moves", () => {
  const leg = (start: number | null, end: number | null, hasFastag = true): FastagLeg => ({
    regNo: "KA01AB1234",
    hasFastag,
    startBalance: start == null ? null : new Decimal(start),
    endBalance: end == null ? null : new Decimal(end),
    endedBySwapPublicId: null,
  });
  const usage = (...legs: FastagLeg[]) => calculateFastagUsage(legs);

  // ₹480 → ₹215 billed ₹265; a corrected pickup balance of ₹500 bills ₹285 — refused
  assert.equal(fastagEditChangesCharges(usage(leg(480, 215)), usage(leg(500, 215))), true);
  // Drop balance corrected but the tag was recharged both ways (₹0 either way) — allowed
  assert.equal(fastagEditChangesCharges(usage(leg(200, 300)), usage(leg(200, 350))), false);
  // Same usage from different readings — allowed
  assert.equal(fastagEditChangesCharges(usage(leg(480, 215)), usage(leg(500, 235))), false);
  // The drop had no pickup reading (typed charge); adding one would bill from readings — refused
  assert.equal(fastagEditChangesCharges(usage(leg(null, 215)), usage(leg(480, 215))), true);
  // Another car still misses a reading: the typed charge stays — allowed
  assert.equal(
    fastagEditChangesCharges(usage(leg(480, 300), leg(null, 100)), usage(leg(500, 300), leg(null, 100))),
    false,
  );
  // Car without a FASTag: nothing billed either way
  assert.equal(fastagEditChangesCharges(usage(leg(null, null, false)), usage(leg(100, 50, false))), false);
});

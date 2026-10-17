/**
 * The returning car's km at a mid-rental swap (segment-km.ts): the snapshot a
 * swap records and the live preview must be that car's line of the drop's one
 * pooled km charge — the same totals the drop bills, never billed twice. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import type { OdometerSegments } from "./km-allowance.service.js";
import { billedKmCharge, withPickupOdometer } from "../booking/operation-edit-guard.js";
import { segmentKm, segmentKmShares, swapKmRecorded, swapKmSnapshot, type SegmentKmAllowance } from "./segment-km.js";

const allowance = (includedKm: number, rate: number | string, extraKmEnabled = true): SegmentKmAllowance => ({
  includedKm,
  extraKmRate: new Decimal(rate),
  extraKmEnabled,
});

/** The drop's charge (calculateKmCharge's formula, via billedKmCharge) for cars driven `kms` km in turn. */
function dropCharge(kms: number[], a: SegmentKmAllowance) {
  // Odometer segments as getOdometerSegments returns them: each car starts at 10 000
  const finished = kms.slice(0, -1);
  const segments: OdometerSegments = {
    swapCount: finished.length,
    swapsMissingReadings: 0,
    complete: true,
    priorKm: finished.reduce((s, k) => s + k, 0),
    currentStartOdometer: 10_000,
    currentStartFuelLevel: null,
    segments: finished.map((km, i) => ({
      endedBySwapPublicId: `swap-${i}`,
      startOdometer: 10_000,
      endOdometer: 10_000 + km,
      km,
    })),
  };
  return billedKmCharge(
    { includedKm: a.includedKm, extraKmRate: a.extraKmRate, extraKmEnabled: a.extraKmEnabled },
    segments,
    10_000 + kms.at(-1)!,
  );
}

test("one swap: the returning car's km over the free km is its extra km", () => {
  const snap = swapKmSnapshot({
    priorSegmentKms: [],
    segmentStartOdometer: 1000,
    endOdometer: 1350,
    allowance: allowance(300, 10),
  });
  assert.deepEqual(snap, {
    segmentKmDriven: 350,
    segmentIncludedKm: 300,
    segmentAllowanceKm: 300,
    segmentExtraKm: 50,
    segmentExtraKmRate: "10.00",
    segmentExtraKmCharge: "500.00",
    segmentExtraKmEnabled: true,
  });
});

test("within the free km: no extra km, the rest of the allowance is left for the replacement", () => {
  const snap = swapKmSnapshot({
    priorSegmentKms: [],
    segmentStartOdometer: 5000,
    endOdometer: 5120,
    allowance: allowance(300, 10),
  })!;
  assert.equal(snap.segmentKmDriven, 120);
  assert.equal(snap.segmentExtraKm, 0);
  assert.equal(snap.segmentExtraKmCharge, "0.00");
  // The replacement then has 180 free km left
  const [, next] = segmentKmShares([120, 250], allowance(300, 10));
  assert.equal(next!.allowanceKm, 180);
  assert.equal(next!.extraKm, 70);
});

test("multi-swap: each car uses the free km the earlier cars left; the shares add up to the drop's charge", () => {
  const a = allowance(300, 10);
  // Car 1: 200 km (swap 1), car 2: 250 km (swap 2), car 3: 40 km (handed back at drop)
  const first = swapKmSnapshot({ priorSegmentKms: [], segmentStartOdometer: 1000, endOdometer: 1200, allowance: a })!;
  const second = swapKmSnapshot({ priorSegmentKms: [200], segmentStartOdometer: 7000, endOdometer: 7250, allowance: a })!;
  assert.equal(first.segmentExtraKm, 0);
  assert.equal(second.segmentAllowanceKm, 100);
  assert.equal(second.segmentExtraKm, 150);
  assert.equal(second.segmentExtraKmCharge, "1500.00");

  const shares = segmentKmShares([200, 250, 40], a);
  // What each swap recorded is the line the drop bills for that car
  assert.equal(shares[0]!.extraKm, first.segmentExtraKm);
  assert.equal(shares[0]!.extraKmCharge.toFixed(2), first.segmentExtraKmCharge);
  assert.equal(shares[1]!.extraKm, second.segmentExtraKm);
  assert.equal(shares[1]!.extraKmCharge.toFixed(2), second.segmentExtraKmCharge);
  assert.equal(shares[2]!.allowanceKm, 0);
  assert.equal(shares[2]!.extraKm, 40);

  const drop = dropCharge([200, 250, 40], a);
  assert.equal(drop.kmDriven, 490);
  assert.equal(shares.reduce((s, x) => s + x.extraKm, 0), drop.extraKm);
  assert.equal(shares.reduce((s, x) => s.plus(x.extraKmCharge), new Decimal(0)).toFixed(2), drop.charge!.toFixed(2));
});

test("the shares always add up to the drop's km charge, and a car's share never depends on the cars after it", () => {
  const rates = ["7.5", "12", "0.33", "9.99"];
  const cases: number[][] = [
    [0, 0],
    [10, 290, 1],
    [301, 0, 5],
    [120, 120, 120, 120],
    [999],
    [33, 67, 199, 1, 0, 450],
  ];
  for (const included of [0, 150, 300, 1000]) {
    for (const rate of rates) {
      for (const kms of cases) {
        for (const enabled of [true, false]) {
          const a = allowance(included, rate, enabled);
          const shares = segmentKmShares(kms, a);
          const drop = dropCharge(kms, a);
          const label = `${included} km @ ₹${rate} ${enabled ? "on" : "off"}: ${kms.join(",")}`;
          assert.equal(shares.reduce((s, x) => s + x.kmDriven, 0), drop.kmDriven, label);
          assert.equal(shares.reduce((s, x) => s + x.extraKm, 0), drop.extraKm, label);
          assert.equal(
            shares.reduce((s, x) => s.plus(x.extraKmCharge), new Decimal(0)).toFixed(2),
            drop.charge!.toFixed(2),
            label,
          );
          // Prefix: the shares of the first n cars are the same whatever comes after
          for (let n = 1; n <= kms.length; n++) {
            const prefix = segmentKmShares(kms.slice(0, n), a);
            assert.deepEqual(
              prefix.map((x) => [x.allowanceKm, x.extraKm, x.extraKmCharge.toFixed(2)]),
              shares.slice(0, n).map((x) => [x.allowanceKm, x.extraKm, x.extraKmCharge.toFixed(2)]),
              label,
            );
          }
        }
      }
    }
  }
});

test("a fractional rate is rounded up once, on the running total — never per car on top", () => {
  const a = allowance(0, "7.5");
  const shares = segmentKmShares([1, 1, 1], a);
  // 7.5 → 8, 15 → 15, 22.5 → 23
  assert.deepEqual(shares.map((s) => s.extraKmCharge.toFixed(2)), ["8.00", "7.00", "8.00"]);
  assert.equal(dropCharge([1, 1, 1], a).charge!.toFixed(2), "23.00");
});

test("extra km billing off: the extra km is shown, the charge is 0", () => {
  const snap = swapKmSnapshot({
    priorSegmentKms: [],
    segmentStartOdometer: 0,
    endOdometer: 500,
    allowance: allowance(300, 10, false),
  })!;
  assert.equal(snap.segmentExtraKm, 200);
  assert.equal(snap.segmentExtraKmCharge, "0.00");
  assert.equal(snap.segmentExtraKmEnabled, false);
});

test("no snapshot when km can't be measured or the allowance is unknown", () => {
  assert.equal(
    swapKmSnapshot({ priorSegmentKms: [120, null], segmentStartOdometer: 100, endOdometer: 200, allowance: allowance(300, 10) }),
    null,
  );
  assert.equal(swapKmSnapshot({ priorSegmentKms: [], segmentStartOdometer: 100, endOdometer: 200, allowance: null }), null);
});

test("a missing start reading counts as no km driven, as at the drop", () => {
  assert.equal(segmentKm(null, 5000), 0);
  assert.equal(segmentKm(4800, 5000), 200);
  assert.equal(segmentKm(5100, 5000), 0);
  const snap = swapKmSnapshot({ priorSegmentKms: [], segmentStartOdometer: null, endOdometer: 5000, allowance: allowance(0, 10) })!;
  assert.equal(snap.segmentKmDriven, 0);
  assert.equal(snap.segmentExtraKm, 0);
});

test("a corrected pickup reading re-records the swaps' km with their own free km and rate", () => {
  const a = allowance(300, 10);
  const segments: OdometerSegments = {
    swapCount: 2,
    swapsMissingReadings: 0,
    complete: true,
    priorKm: 450,
    currentStartOdometer: 9000,
    currentStartFuelLevel: null,
    segments: [
      { endedBySwapPublicId: "s1", startOdometer: 1000, endOdometer: 1200, km: 200 },
      { endedBySwapPublicId: "s2", startOdometer: 7000, endOdometer: 7250, km: 250 },
    ],
  };
  // Pickup reading corrected from 1000 to 950: car 1 drove 250 km
  const corrected = withPickupOdometer(segments, 950);
  const kms = corrected.segments.map((s) => s.km);
  const first = swapKmSnapshot({ priorSegmentKms: [], segmentStartOdometer: 950, endOdometer: 1200, allowance: a })!;
  const second = swapKmSnapshot({ priorSegmentKms: kms.slice(0, 1), segmentStartOdometer: 7000, endOdometer: 7250, allowance: a })!;
  assert.equal(first.segmentKmDriven, 250);
  assert.equal(second.segmentAllowanceKm, 50);
  assert.equal(second.segmentExtraKm, 200);
  // …and they still add up to what Edit Pickup re-bills
  const drop = billedKmCharge(a, corrected, 9040);
  assert.equal(first.segmentExtraKm + second.segmentExtraKm + 40, drop.extraKm);
});

test("a stored snapshot reads back as clients get it", () => {
  assert.equal(
    swapKmRecorded({
      segmentKmDriven: null,
      segmentIncludedKm: null,
      segmentAllowanceKm: null,
      segmentExtraKm: null,
      segmentExtraKmRate: null,
      segmentExtraKmCharge: null,
      segmentExtraKmEnabled: null,
    }),
    null,
  );
  assert.deepEqual(
    swapKmRecorded({
      segmentKmDriven: 350,
      segmentIncludedKm: 300,
      segmentAllowanceKm: 300,
      segmentExtraKm: 50,
      segmentExtraKmRate: new Decimal("10"),
      segmentExtraKmCharge: new Decimal("500"),
      segmentExtraKmEnabled: true,
    }),
    {
      kmDriven: 350,
      includedKm: 300,
      allowanceKm: 300,
      extraKm: 50,
      extraKmRate: "10.00",
      extraKmCharge: "500.00",
      extraKmEnabled: true,
    },
  );
});

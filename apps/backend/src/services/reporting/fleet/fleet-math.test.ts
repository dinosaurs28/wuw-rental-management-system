/**
 * Fleet report math (utilization, downtime, profit, km, document expiry). Pure.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAY_MS,
  clipIntervals,
  docStatus,
  mergeIntervals,
  profitRow,
  rentalSegments,
  statusIntervals,
  subtractIntervals,
  sumTimelines,
  totalMs,
  tripKmByVehicle,
  vehicleTimeline,
} from "./fleet-math.js";

const T0 = Date.UTC(2026, 9, 1); // 1 Oct 2026 00:00 UTC
const d = (days: number) => T0 + days * DAY_MS;
const iv = (a: number, b: number) => ({ start: d(a), end: d(b) });

test("merge / clip / subtract intervals", () => {
  assert.deepEqual(mergeIntervals([iv(3, 5), iv(0, 2), iv(1, 3), iv(7, 7)]), [iv(0, 5)]);
  assert.deepEqual(clipIntervals([iv(-2, 1), iv(5, 12)], iv(0, 10)), [iv(0, 1), iv(5, 10)]);
  assert.deepEqual(subtractIntervals([iv(0, 10)], [iv(2, 3), iv(5, 6)]), [iv(0, 2), iv(3, 5), iv(6, 10)]);
  assert.deepEqual(subtractIntervals([iv(0, 4)], [iv(-1, 5)]), []);
  assert.equal(totalMs([iv(0, 2), iv(1, 3)]), 3 * DAY_MS);
});

test("status history → intervals; knownFrom = first change", () => {
  const { knownFrom, intervals } = statusIntervals(
    [
      { toStatus: "MAINTENANCE", changedAt: new Date(d(4)) },
      { toStatus: "AVAILABLE", changedAt: new Date(d(1)) },
      { toStatus: "AVAILABLE", changedAt: new Date(d(6)) },
    ],
    d(10),
  );
  assert.equal(knownFrom, d(1));
  assert.deepEqual(intervals, [
    { ...iv(1, 4), status: "AVAILABLE" },
    { ...iv(4, 6), status: "MAINTENANCE" },
    { ...iv(6, 10), status: "AVAILABLE" },
  ]);
  assert.equal(statusIntervals([], d(10)).knownFrom, null);
});

test("rental segments split at mid-rental swaps only", () => {
  const segs = rentalSegments(
    {
      bookingId: 1,
      status: "RETURNED",
      pickedUpAt: new Date(d(0)),
      endedAt: new Date(d(6)),
      itemVehicleIds: [30],
      swaps: [
        // before pickup: ignored
        { swappedAt: new Date(d(-1)), originalVehicleId: 5, newVehicleId: 10, bookingStatusAtSwap: "CONFIRMED" },
        { swappedAt: new Date(d(2)), originalVehicleId: 10, newVehicleId: 20, bookingStatusAtSwap: "PICKED_UP" },
        // legacy row after pickup counts
        { swappedAt: new Date(d(4)), originalVehicleId: 20, newVehicleId: 30, bookingStatusAtSwap: null },
      ],
    },
    d(100),
  );
  assert.deepEqual(
    segs.map((s) => [s.vehicleId, (s.end - s.start) / DAY_MS]),
    [
      [10, 2],
      [20, 2],
      [30, 2],
    ],
  );
  // active rental runs to now; not picked up ⇒ nothing
  const active = rentalSegments(
    { bookingId: 2, status: "PICKED_UP", pickedUpAt: new Date(d(0)), endedAt: null, itemVehicleIds: [7], swaps: [] },
    d(3),
  );
  assert.deepEqual(active.map((s) => [s.vehicleId, (s.end - s.start) / DAY_MS]), [[7, 3]]);
  assert.deepEqual(
    rentalSegments({ bookingId: 3, status: "PICKED_UP", pickedUpAt: null, endedAt: null, itemVehicleIds: [7], swaps: [] }, d(3)),
    [],
  );
});

test("utilization = rented ÷ (range − downtime); rented time is never downtime", () => {
  // 10-day window; rented 0–3; maintenance 2–5 (overlap 2–3 is rented ⇒ downtime 3–5 = 2d);
  // lock 4–6 overlaps maintenance 4–5 ⇒ union downtime 3–6 = 3 days.
  const t = vehicleTimeline({
    window: iv(0, 10),
    rented: [iv(0, 3)],
    downtime: { MAINTENANCE: [iv(2, 5)], BOOKING_LOCK: [iv(4, 6)] },
    historyKnownFrom: d(0),
  });
  assert.equal(t.rangeDays, 10);
  assert.equal(t.rentedDays, 3);
  assert.equal(t.byKind.MAINTENANCE, 2);
  assert.equal(t.byKind.BOOKING_LOCK, 2);
  assert.equal(t.downtimeDays, 3);
  assert.equal(t.availableDays, 7);
  assert.equal(t.utilizationPct, 42.86);
  assert.equal(t.utilizationInclDowntimePct, 30);
  assert.equal(t.untrackedDays, 0);
});

test("untracked status history is counted as available and reported", () => {
  const t = vehicleTimeline({ window: iv(0, 10), rented: [iv(1, 2)], downtime: {}, historyKnownFrom: d(4) });
  assert.equal(t.untrackedDays, 4);
  assert.equal(t.availableDays, 10);
  assert.equal(t.utilizationPct, 10);
  const none = vehicleTimeline({ window: iv(0, 10), rented: [], downtime: {}, historyKnownFrom: null });
  assert.equal(none.untrackedDays, 10);
  assert.equal(none.utilizationPct, 0);
});

test("fully down ⇒ utilization null; groups sum days then divide", () => {
  const down = vehicleTimeline({ window: iv(0, 10), rented: [], downtime: { INACTIVE: [iv(-5, 20)] }, historyKnownFrom: d(-5) });
  assert.equal(down.availableDays, 0);
  assert.equal(down.utilizationPct, null);
  const busy = vehicleTimeline({ window: iv(0, 10), rented: [iv(0, 5)], downtime: {}, historyKnownFrom: d(0) });
  const g = sumTimelines([down, busy]);
  assert.equal(g.vehicles, 2);
  assert.equal(g.rangeDays, 20);
  assert.equal(g.availableDays, 10);
  assert.equal(g.rentedDays, 5);
  assert.equal(g.utilizationPct, 50); // not the mean of (null, 50%)
});

test("profit = revenue − recorded costs; costs-not-captured flag", () => {
  const p = profitRow({ revenue: 10000, costs: { maintenance: 1500, repair: 2000.5, other: 499.5 }, costEntries: 3 });
  assert.equal(p.totalCost, 4000);
  assert.equal(p.profit, 6000);
  assert.equal(p.marginPct, 60);
  assert.equal(p.costsCaptured, true);
  const none = profitRow({ revenue: 0, costs: { maintenance: 0, repair: 0, other: 0 }, costEntries: 0 });
  assert.equal(none.costsCaptured, false);
  assert.equal(none.marginPct, null);
});

test("trip km per vehicle across swap segments", () => {
  assert.deepEqual(tripKmByVehicle(300, 3, [{ originalVehicleId: 1, km: 100 }, { originalVehicleId: 2, km: 50 }]), [
    { vehicleId: 1, km: 100 },
    { vehicleId: 2, km: 50 },
    { vehicleId: 3, km: 150 },
  ]);
  assert.deepEqual(tripKmByVehicle(120, 9, []), [{ vehicleId: 9, km: 120 }]);
  // a swap without readings ⇒ last car unknown
  assert.deepEqual(tripKmByVehicle(null, 3, [{ originalVehicleId: 1, km: null }]), [
    { vehicleId: 1, km: null },
    { vehicleId: 3, km: null },
  ]);
});

test("document status by IST calendar day", () => {
  // now = 31 Oct 2026 20:00 IST (14:30 UTC)
  const now = new Date(Date.UTC(2026, 9, 31, 14, 30));
  const at = (iso: string) => new Date(iso);
  assert.deepEqual(docStatus(at("2026-10-30T18:29:00Z"), now), { daysLeft: -1, status: "EXPIRED" }); // 30 Oct 23:59 IST
  assert.deepEqual(docStatus(at("2026-10-30T18:31:00Z"), now), { daysLeft: 0, status: "EXPIRING_7" }); // 31 Oct 00:01 IST
  assert.deepEqual(docStatus(at("2026-11-07T06:00:00Z"), now), { daysLeft: 7, status: "EXPIRING_7" });
  assert.deepEqual(docStatus(at("2026-11-08T06:00:00Z"), now), { daysLeft: 8, status: "EXPIRING_30" });
  assert.deepEqual(docStatus(at("2026-11-30T06:00:00Z"), now), { daysLeft: 30, status: "EXPIRING_30" });
  assert.deepEqual(docStatus(at("2026-12-01T06:00:00Z"), now), { daysLeft: 31, status: "VALID" });
});

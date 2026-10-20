/**
 * Pure checks of the Fleet queue search-bar filters (Oct 20 2026): param
 * parsing / validation, the vehicle match, the time ranges and the
 * filter → Prisma where builder. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import {
  EMPTY_QUEUE_FILTERS,
  QUEUE_FILTER_MAX_VALUES,
  balanceDueWhere,
  buildQueueFilterWhere,
  completedDayFor,
  hasAnyQueueFilter,
  hasTimeFilter,
  hasVehicleFilters,
  parseQueueFilters,
  paymentWhere,
  queueGroupKey,
  queueTimeRanges,
  timeWhere,
  vehicleMatchesQueueFilters,
  type QueueFilters,
} from "./queueFilters.js";

// 20 Oct 2026 15:30 IST
const NOW = DateTime.fromISO("2026-10-20T15:30:00", { zone: "Asia/Kolkata" });
const ist = (iso: string) => DateTime.fromISO(iso, { zone: "Asia/Kolkata" }).toJSDate();

const parse = (query: Record<string, unknown>): QueueFilters => {
  const r = parseQueueFilters(query);
  assert.equal(r.ok, true, r.ok ? "" : r.message);
  return (r as { ok: true; filters: QueueFilters }).filters;
};
const f = (patch: Partial<QueueFilters>): QueueFilters => ({ ...EMPTY_QUEUE_FILTERS, ...patch });

const swift = {
  make: "Maruti",
  model: "Swift  Dzire",
  useCases: ["LOCAL"],
  category: { publicId: "cat_hatch", typeClass: "FOUR_WHEELER" },
};
const activa = {
  make: "Honda",
  model: "Activa",
  useCases: ["HIGHWAY"], // legacy tag = Out of Udupi
  category: { publicId: "cat_scooter", typeClass: "TWO_WHEELER" },
};

test("no params: no filters at all (old builds unchanged)", () => {
  const filters = parse({ date: "2026-10-20", type: "DAILY", includeCompleted: "1", q: "KA20" });
  assert.deepEqual(filters, EMPTY_QUEUE_FILTERS);
  assert.equal(hasAnyQueueFilter(filters), false);
  assert.deepEqual(buildQueueFilterWhere("PICKUP", filters, { now: NOW }), {});
});

test("lists: repeated, [] arrays and comma strings; trimmed, deduped, enums case-insensitive", () => {
  assert.deepEqual(parse({ typeClass: "two_wheeler, FOUR_WHEELER,two_wheeler" }).typeClass, ["TWO_WHEELER", "FOUR_WHEELER"]);
  assert.deepEqual(parse({ typeClass: ["TWO_WHEELER", "OTHER"] }).typeClass, ["TWO_WHEELER", "OTHER"]);
  assert.deepEqual(parse({ category: ["cat_a", "cat_b,cat_c"] }).category, ["cat_a", "cat_b", "cat_c"]);
  assert.deepEqual(parse({ when: "Today,OVERDUE" }).when, ["today", "overdue"]);
  assert.deepEqual(parse({ payment: "BALANCE_DUE" }).payment, ["balance_due"]);
  assert.deepEqual(parse({ typeClass: "", category: [] }).typeClass, []);
  // more than 20 repeated values reach the controller as {"0": …, "1": …}
  const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [String(i), `MAKE__MODEL ${i}`]));
  assert.equal(parse({ groupKey: many }).groupKey.length, 25);
});

test("groupKey: never split on commas, normalised like queueGroupKey", () => {
  assert.deepEqual(parse({ groupKey: "maruti__swift  dzire" }).groupKey, ["MARUTI__SWIFT DZIRE"]);
  assert.deepEqual(parse({ groupKey: ["Tata__Nexon, EV", "HONDA__ACTIVA"] }).groupKey, ["TATA__NEXON, EV", "HONDA__ACTIVA"]);
  assert.equal(queueGroupKey(" Maruti ", "Swift   Dzire"), "MARUTI__SWIFT DZIRE");
});

test("tripType: legacy tags read as OUT_OF_UDUPI, deduped", () => {
  assert.deepEqual(parse({ tripType: "LOCAL" }).tripType, ["LOCAL"]);
  assert.deepEqual(parse({ tripType: "HIGHWAY,out_of_udupi,LONG_DRIVE" }).tripType, ["OUT_OF_UDUPI"]);
});

test("invalid values are rejected with the field named", () => {
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ typeClass: "THREE_WHEELER" }, "typeClass"],
    [{ when: "yesterday" }, "when"],
    [{ payment: "unpaid" }, "payment"],
    [{ tripType: "BEACH" }, "tripType"],
    [{ from: "20-10-2026" }, "from"],
    [{ to: "2026-02-30" }, "to"],
    [{ from: "2026-10-22", to: "2026-10-20" }, "from"],
    [{ category: Array.from({ length: QUEUE_FILTER_MAX_VALUES + 1 }, (_, i) => `c${i}`) }, "category"],
    [{ typeClass: { a: 1 } }, "typeClass"],
  ];
  for (const [query, field] of bad) {
    const r = parseQueueFilters(query);
    assert.equal(r.ok, false, JSON.stringify(query));
    if (!r.ok) assert.match(r.message, new RegExp(`^Invalid ${field}`), r.message);
  }
});

test("from / to: either end may be open; blank ends are ignored", () => {
  const filters = parse({ from: "2026-10-21", to: "" });
  assert.equal(filters.from, "2026-10-21");
  assert.equal(filters.to, null);
  assert.equal(hasTimeFilter(filters), true);
  assert.equal(hasTimeFilter(parse({ from: " " })), false);
});

test("vehicle match: AND across filters, OR within one", () => {
  assert.equal(vehicleMatchesQueueFilters(swift, f({ typeClass: ["FOUR_WHEELER"] })), true);
  assert.equal(vehicleMatchesQueueFilters(activa, f({ typeClass: ["FOUR_WHEELER"] })), false);
  assert.equal(vehicleMatchesQueueFilters(activa, f({ typeClass: ["FOUR_WHEELER", "TWO_WHEELER"] })), true);
  assert.equal(vehicleMatchesQueueFilters(swift, f({ category: ["cat_scooter", "cat_hatch"] })), true);
  assert.equal(vehicleMatchesQueueFilters(swift, f({ groupKey: ["MARUTI__SWIFT DZIRE"] })), true);
  assert.equal(vehicleMatchesQueueFilters(activa, f({ groupKey: ["MARUTI__SWIFT DZIRE"] })), false);
  // trip type: legacy stored tag matches OUT_OF_UDUPI
  assert.equal(vehicleMatchesQueueFilters(activa, f({ tripType: ["OUT_OF_UDUPI"] })), true);
  assert.equal(vehicleMatchesQueueFilters(swift, f({ tripType: ["OUT_OF_UDUPI"] })), false);
  // AND: four-wheeler AND out-of-Udupi → the Swift fails, nothing else checked
  assert.equal(vehicleMatchesQueueFilters(swift, f({ typeClass: ["FOUR_WHEELER"], tripType: ["OUT_OF_UDUPI"] })), false);
  assert.equal(vehicleMatchesQueueFilters(swift, f({ typeClass: ["FOUR_WHEELER"], tripType: ["LOCAL"] })), true);
  // no category (should not happen) never matches a type / category filter
  assert.equal(vehicleMatchesQueueFilters({ ...swift, category: null }, f({ typeClass: ["FOUR_WHEELER"] })), false);
  assert.equal(vehicleMatchesQueueFilters({ ...swift, category: null }, f({})), true);
  assert.equal(hasVehicleFilters(f({ when: ["today"], payment: ["paid"] })), false);
});

test("time ranges: IST days for today / tomorrow / from–to, before-now for overdue", () => {
  assert.deepEqual(queueTimeRanges(f({ when: ["today"] }), NOW), [
    { gte: ist("2026-10-20T00:00:00"), lte: ist("2026-10-20T23:59:59.999") },
  ]);
  assert.deepEqual(queueTimeRanges(f({ when: ["tomorrow"] }), NOW), [
    { gte: ist("2026-10-21T00:00:00"), lte: ist("2026-10-21T23:59:59.999") },
  ]);
  assert.deepEqual(queueTimeRanges(f({ when: ["overdue"] }), NOW), [{ lt: NOW.toJSDate() }]);
  assert.deepEqual(queueTimeRanges(f({ from: "2026-10-22", to: "2026-10-25" }), NOW), [
    { gte: ist("2026-10-22T00:00:00"), lte: ist("2026-10-25T23:59:59.999") },
  ]);
  assert.deepEqual(queueTimeRanges(f({ to: "2026-10-25" }), NOW), [{ lte: ist("2026-10-25T23:59:59.999") }]);
  assert.deepEqual(queueTimeRanges(f({}), NOW), []);
});

test("time where: startAt for pickups, endAt for returns; several values OR'd", () => {
  assert.deepEqual(timeWhere("PICKUP", f({ when: ["overdue"] }), NOW), { startAt: { lt: NOW.toJSDate() } });
  assert.deepEqual(timeWhere("RETURN", f({ when: ["overdue"] }), NOW), { endAt: { lt: NOW.toJSDate() } });
  const both = timeWhere("RETURN", f({ when: ["today", "overdue"] }), NOW) as { OR: unknown[] };
  assert.equal(both.OR.length, 2);
  assert.equal(timeWhere("PICKUP", f({}), NOW), null);
});

test("payment where: one value filters, both (or none) don't", () => {
  assert.deepEqual(paymentWhere(f({ payment: ["balance_due"] })), balanceDueWhere);
  assert.deepEqual(paymentWhere(f({ payment: ["paid"] })), { NOT: balanceDueWhere });
  assert.equal(paymentWhere(f({ payment: ["paid", "balance_due"] })), null);
  assert.equal(paymentWhere(f({})), null);
  assert.equal(hasAnyQueueFilter(f({ payment: ["paid", "balance_due"] })), false);
});

test("where builder: vehicle ids, time and payment ANDed; a single part is not wrapped", () => {
  assert.deepEqual(buildQueueFilterWhere("PICKUP", f({}), { now: NOW, vehicleIds: [3, 4] }), {
    items: { some: { vehicleId: { in: [3, 4] } } },
  });
  // an empty id list (nothing matched) still filters — to nothing
  assert.deepEqual(buildQueueFilterWhere("PICKUP", f({}), { now: NOW, vehicleIds: [] }), {
    items: { some: { vehicleId: { in: [] } } },
  });
  assert.deepEqual(
    buildQueueFilterWhere("RETURN", f({ when: ["overdue"], payment: ["balance_due"] }), { now: NOW, vehicleIds: [7] }),
    {
      AND: [
        { items: { some: { vehicleId: { in: [7] } } } },
        { endAt: { lt: NOW.toJSDate() } },
        balanceDueWhere,
      ],
    },
  );
  assert.deepEqual(buildQueueFilterWhere("PICKUP", f({ payment: ["paid"] }), { now: NOW }), { NOT: balanceDueWhere });
});

test("completed days: fallback without a time filter, span with one, none for overdue alone", () => {
  const fallback = { gte: ist("2026-10-20T00:00:00"), lte: ist("2026-10-20T23:59:59.999") };
  assert.equal(completedDayFor(f({ payment: ["paid"] }), NOW, fallback), fallback);
  assert.deepEqual(completedDayFor(f({ when: ["tomorrow"] }), NOW, fallback), {
    gte: ist("2026-10-21T00:00:00"),
    lte: ist("2026-10-21T23:59:59.999"),
  });
  assert.deepEqual(completedDayFor(f({ when: ["today", "tomorrow"] }), NOW, fallback), {
    gte: ist("2026-10-20T00:00:00"),
    lte: ist("2026-10-21T23:59:59.999"),
  });
  assert.deepEqual(completedDayFor(f({ when: ["overdue", "today"] }), NOW, fallback), fallback);
  assert.equal(completedDayFor(f({ when: ["overdue"] }), NOW, fallback), null);
  // open end: the fallback day's edge
  assert.deepEqual(completedDayFor(f({ from: "2026-10-18" }), NOW, fallback), {
    gte: ist("2026-10-18T00:00:00"),
    lte: fallback.lte,
  });
  // a from after the fallback day with an open end is empty → none
  assert.equal(completedDayFor(f({ from: "2026-10-25" }), NOW, fallback), null);
});

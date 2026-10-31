/**
 * Shared report framework (spec §9): filter parsing, previous-period math,
 * deltas and CSV formatting. Pure — no database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import {
  parseReportFilters,
  ReportFilterError,
  previousPeriod,
  resolvePresetDays,
  computeDelta,
  buildCsv,
  csvMoney,
  csvIstDate,
  csvIstDateTime,
  csvIsoDate,
  escapeCsvCell,
  vehicleWhereFromFilters,
  bookingWhereFromFilters,
} from "./index.js";

const NOW = DateTime.fromISO("2026-10-15T10:30:00", { zone: "Asia/Kolkata" }); // Thursday

// ---------------- previous period ----------------

test("single day -> previous day, labelled", () => {
  const p = previousPeriod({ from: "2026-10-15", to: "2026-10-15", now: NOW });
  assert.equal(p.kind, "day");
  assert.equal(p.from, "2026-10-14");
  assert.equal(p.to, "2026-10-14");
  assert.equal(p.label, "vs yesterday");
  assert.equal(p.currentLabel, "Today");
});

test("day boundaries are IST midnight", () => {
  const p = previousPeriod({ from: "2026-10-15", to: "2026-10-15", now: NOW });
  assert.equal(p.start.toISOString(), "2026-10-13T18:30:00.000Z");
  assert.equal(p.end.toISOString(), "2026-10-14T18:29:59.999Z");
});

test("full Monday week -> previous full week", () => {
  const p = previousPeriod({ from: "2026-10-05", to: "2026-10-11" });
  assert.equal(p.kind, "week");
  assert.deepEqual([p.from, p.to, p.days], ["2026-09-28", "2026-10-04", 7]);
  assert.match(p.label, /previous week/);
});

test("week-to-date -> same weekdays last week", () => {
  const p = previousPeriod({ from: "2026-10-12", to: "2026-10-15" });
  assert.equal(p.kind, "week");
  assert.deepEqual([p.from, p.to], ["2026-10-05", "2026-10-08"]);
  assert.match(p.label, /same days last week/);
});

test("month-to-date -> same day count of previous month", () => {
  const p = previousPeriod({ from: "2026-10-01", to: "2026-10-15" });
  assert.equal(p.kind, "month");
  assert.deepEqual([p.from, p.to], ["2026-09-01", "2026-09-15"]);
});

test("month-to-date clipped to a shorter previous month", () => {
  const p = previousPeriod({ from: "2026-03-01", to: "2026-03-31" });
  assert.deepEqual([p.from, p.to], ["2026-02-01", "2026-02-28"]); // full month -> full Feb
  const q = previousPeriod({ from: "2026-03-01", to: "2026-03-30" });
  assert.deepEqual([q.from, q.to], ["2026-02-01", "2026-02-28"]); // clipped
  const leap = previousPeriod({ from: "2028-03-01", to: "2028-03-30" });
  assert.deepEqual([leap.from, leap.to], ["2028-02-01", "2028-02-29"]);
});

test("full month -> full previous month (31 vs 30 days)", () => {
  const p = previousPeriod({ from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual([p.from, p.to, p.days], ["2026-09-01", "2026-09-30", 30]);
  assert.equal(p.label, "vs Sep 2026");
  assert.equal(p.currentLabel, "Oct 2026");
});

test("January -> December of previous year", () => {
  const p = previousPeriod({ from: "2027-01-01", to: "2027-01-10" });
  assert.deepEqual([p.from, p.to], ["2026-12-01", "2026-12-10"]);
});

test("custom range -> same-length window immediately before", () => {
  const p = previousPeriod({ from: "2026-10-10", to: "2026-10-19" });
  assert.equal(p.kind, "custom");
  assert.deepEqual([p.from, p.to, p.days], ["2026-09-30", "2026-10-09", 10]);
  assert.match(p.label, /previous 10 days/);
});

test("range crossing a month boundary is custom", () => {
  const p = previousPeriod({ from: "2026-09-25", to: "2026-10-05" });
  assert.equal(p.kind, "custom");
  assert.deepEqual([p.from, p.to], ["2026-09-14", "2026-09-24"]);
});

test("explicit custom preset overrides auto-detection", () => {
  const p = previousPeriod({ from: "2026-10-01", to: "2026-10-15", preset: "custom" });
  assert.equal(p.kind, "custom");
  assert.deepEqual([p.from, p.to], ["2026-09-16", "2026-09-30"]);
});

test("presets resolve to IST days (ISO weeks)", () => {
  assert.deepEqual(resolvePresetDays("today", NOW), { from: "2026-10-15", to: "2026-10-15" });
  assert.deepEqual(resolvePresetDays("yesterday", NOW), { from: "2026-10-14", to: "2026-10-14" });
  assert.deepEqual(resolvePresetDays("thisWeek", NOW), { from: "2026-10-12", to: "2026-10-15" });
  assert.deepEqual(resolvePresetDays("lastWeek", NOW), { from: "2026-10-05", to: "2026-10-11" });
  assert.deepEqual(resolvePresetDays("thisMonth", NOW), { from: "2026-10-01", to: "2026-10-15" });
  assert.deepEqual(resolvePresetDays("lastMonth", NOW), { from: "2026-09-01", to: "2026-09-30" });
});

test("late-night UTC still resolves 'today' in IST", () => {
  const lateUtc = DateTime.fromISO("2026-10-15T20:00:00Z"); // 01:30 IST on the 16th
  assert.deepEqual(resolvePresetDays("today", lateUtc), { from: "2026-10-16", to: "2026-10-16" });
});

// ---------------- delta ----------------

test("delta: absolute and percentage", () => {
  assert.deepEqual(computeDelta(150, 100), { current: 150, previous: 100, abs: 50, pct: 50, direction: "up" });
  assert.deepEqual(computeDelta(75, 100), { current: 75, previous: 100, abs: -25, pct: -25, direction: "down" });
  assert.equal(computeDelta(100, 100).direction, "flat");
  assert.equal(computeDelta(1, 3).pct, -66.7);
});

test("delta: null-safe when previous is 0 or missing", () => {
  assert.deepEqual(computeDelta(500, 0), { current: 500, previous: 0, abs: 500, pct: null, direction: "up" });
  assert.equal(computeDelta(0, 0).pct, null);
  assert.equal(computeDelta(0, 0).direction, "flat");
  assert.deepEqual(computeDelta(null, 10), { current: null, previous: 10, abs: null, pct: null, direction: null });
  assert.equal(computeDelta(10, undefined).abs, null);
  assert.equal(computeDelta(-50, -100).pct, 50); // less negative = up
});

// ---------------- filter parsing ----------------

test("filters: default is this month in IST, previous = same period last month", () => {
  const f = parseReportFilters({}, { now: NOW });
  assert.equal(f.preset, "thisMonth");
  assert.deepEqual([f.from, f.to, f.days], ["2026-10-01", "2026-10-15", 15]);
  assert.equal(f.start.toISOString(), "2026-09-30T18:30:00.000Z");
  assert.equal(f.end.toISOString(), "2026-10-15T18:29:59.999Z");
  assert.deepEqual([f.previous.from, f.previous.to], ["2026-09-01", "2026-09-15"]);
  assert.equal(f.branchPublicId, null);
  assert.deepEqual(f.categoryPublicIds, []);
  assert.equal(f.compare, false);
  assert.equal(f.exportCsv, false);
  assert.equal(f.groupBy, "day");
});

test("filters: explicit range + all dimensions combine", () => {
  const f = parseReportFilters(
    {
      from: "2026-08-01",
      to: "2026-10-15",
      branchId: "br_A",
      categories: "cat1,cat2,cat1",
      vehicleId: "veh_9",
      compare: "1",
      export: "csv",
    },
    { now: NOW },
  );
  assert.equal(f.preset, null);
  assert.equal(f.days, 76);
  assert.equal(f.branchPublicId, "br_A");
  assert.deepEqual(f.categoryPublicIds, ["cat1", "cat2"]);
  assert.equal(f.vehiclePublicId, "veh_9");
  assert.equal(f.compare, true);
  assert.equal(f.exportCsv, true);
  assert.equal(f.groupBy, "week");
  assert.equal(f.previous.kind, "custom");
});

test("filters: legacy aliases branch / categoryId and repeated params", () => {
  const f = parseReportFilters({ branch: "br_B", categoryId: ["c1", "c2"] }, { now: NOW });
  assert.equal(f.branchPublicId, "br_B");
  assert.deepEqual(f.categoryPublicIds, ["c1", "c2"]);
  const all = parseReportFilters({ branchId: "all", categories: "all" }, { now: NOW });
  assert.equal(all.branchPublicId, null);
  assert.deepEqual(all.categoryPublicIds, []);
});

test("filters: preset overrides from/to", () => {
  const f = parseReportFilters({ preset: "lastWeek", from: "2020-01-01", to: "2020-01-02" }, { now: NOW });
  assert.deepEqual([f.from, f.to], ["2026-10-05", "2026-10-11"]);
  assert.equal(f.previous.kind, "week");
  assert.deepEqual([f.previous.from, f.previous.to], ["2026-09-28", "2026-10-04"]);
});

test("filters: today preset compares with yesterday", () => {
  const f = parseReportFilters({ preset: "today" }, { now: NOW });
  assert.equal(f.previous.label, "vs yesterday");
  assert.equal(f.previous.from, "2026-10-14");
});

test("filters: validation errors are ReportFilterError (400)", () => {
  const bad: Record<string, unknown>[] = [
    { from: "2026-10-01" },
    { to: "2026-10-01" },
    { from: "01-10-2026", to: "2026-10-05" },
    { from: "2026-02-30", to: "2026-03-01" },
    { from: "2026-10-05", to: "2026-10-01" },
    { from: "2024-01-01", to: "2026-01-01" },
    { preset: "nextYear" },
    { preset: "custom" },
    { branchId: "x'; drop table" },
    { export: "xlsx" },
  ];
  for (const q of bad) {
    assert.throws(() => parseReportFilters(q, { now: NOW }), (e: unknown) => {
      assert.ok(e instanceof ReportFilterError, `expected ReportFilterError for ${JSON.stringify(q)}`);
      assert.equal((e as ReportFilterError).status, 400);
      return true;
    });
  }
});

test("filters: defaultPreset option", () => {
  const f = parseReportFilters({}, { now: NOW, defaultPreset: "today" });
  assert.deepEqual([f.from, f.to], ["2026-10-15", "2026-10-15"]);
});

test("filters -> prisma where builders", () => {
  const f = parseReportFilters({ branchId: "br_A", categories: "c1", vehicleId: "v1" }, { now: NOW });
  const vw = vehicleWhereFromFilters(f);
  assert.deepEqual(vw.branch, { publicId: "br_A" });
  assert.deepEqual(vw.category, { publicId: { in: ["c1"] } });
  assert.equal(vw.publicId, "v1");
  const bw = bookingWhereFromFilters(f) as { AND: unknown[] };
  assert.ok(Array.isArray(bw.AND) && bw.AND.length === 2);
  const prev = bookingWhereFromFilters(f, { range: f.previous }) as { AND: { startAt?: { gte: Date } }[] };
  assert.equal(prev.AND[0]!.startAt!.gte.toISOString(), f.previous.start.toISOString());
  const noVehicle = bookingWhereFromFilters(parseReportFilters({}, { now: NOW })) as Record<string, unknown>;
  assert.equal(noVehicle.AND, undefined);
});

// ---------------- CSV ----------------

test("csv: plain numbers, IST + ISO dates", () => {
  assert.equal(csvMoney(123456.789), "123456.79");
  assert.equal(csvMoney(0), "0");
  assert.equal(csvMoney(null), "");
  const d = new Date("2026-10-14T20:15:00Z"); // 15 Oct 01:45 IST
  assert.equal(csvIstDate(d), "15-10-2026");
  assert.equal(csvIstDateTime(d), "15-10-2026 01:45");
  assert.equal(csvIsoDate(d), "2026-10-15");
});

test("csv: BOM, headers, quoting, CRLF, formula guard", () => {
  const csv = buildCsv(
    [
      { header: "Customer", value: (r: { n: string; a: number; d: Date; ok: boolean }) => r.n },
      { header: "Amount", value: (r) => r.a, type: "money" },
      { header: "Date", value: (r) => r.d, type: "isoDate" },
      { header: "Paid", value: (r) => r.ok, type: "bool" },
    ],
    [{ n: 'Ravi "R", Jr', a: 1500, d: new Date("2026-10-01T00:00:00Z"), ok: true }],
    [{ Customer: "Total", Amount: 1500 }],
  );
  assert.ok(csv.startsWith("﻿Customer,Amount,Date,Paid\r\n"));
  assert.ok(csv.includes('"Ravi ""R"", Jr",1500,2026-10-01,Yes\r\n'));
  assert.ok(csv.endsWith("Total,1500,,\r\n"));
  assert.equal(escapeCsvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(escapeCsvCell("-250"), "-250");
  assert.ok(!csv.includes("₹"));
});

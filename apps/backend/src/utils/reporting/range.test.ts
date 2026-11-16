/**
 * resolveReportRange must cut days at IST midnight whatever the process TZ is
 * (the VPS runs in UTC). Run under several TZs:
 *   TZ=UTC pnpm test ; TZ=Asia/Kolkata pnpm test ; TZ=America/Los_Angeles pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveReportRange, istDayIndex } from "./range.js";

/** Instant of an IST wall-clock time, e.g. ist("2026-11-16T00:10"). */
const ist = (wall: string): Date => new Date(`${wall}:00+05:30`);
const iso = (d: Date) => d.toISOString();

// 00:10 IST on Mon 16 Nov 2026 is still 15 Nov in UTC.
const EARLY = ist("2026-11-16T00:10");
// 23:50 IST on 16 Nov 2026 is 18:20 UTC the same day.
const LATE = ist("2026-11-16T23:50");

for (const [label, now] of [
  ["00:10 IST", EARLY],
  ["23:50 IST", LATE],
] as const) {
  test(`today @ ${label} -> 16 Nov IST, previous = 15 Nov IST`, () => {
    const r = resolveReportRange({ preset: "today", now });
    assert.equal(iso(r.start), iso(ist("2026-11-16T00:00")));
    assert.equal(iso(r.end), "2026-11-16T18:29:59.999Z");
    assert.equal(r.days, 1);
    assert.equal(r.from, "2026-11-16");
    assert.equal(r.to, "2026-11-16");
    assert.equal(iso(r.prevStart), iso(ist("2026-11-15T00:00")));
    assert.equal(iso(r.prevEnd), "2026-11-15T18:29:59.999Z");
  });

  test(`last7 @ ${label} -> 10–16 Nov IST`, () => {
    const r = resolveReportRange({ preset: "last7", now });
    assert.equal(iso(r.start), iso(ist("2026-11-10T00:00")));
    assert.equal(iso(r.end), "2026-11-16T18:29:59.999Z");
    assert.equal(r.days, 7);
    assert.equal(iso(r.prevStart), iso(ist("2026-11-03T00:00")));
    assert.equal(iso(r.prevEnd), "2026-11-09T18:29:59.999Z");
  });

  test(`last30 (and default) @ ${label} -> 18 Oct–16 Nov IST`, () => {
    for (const r of [
      resolveReportRange({ preset: "last30", now }),
      resolveReportRange({ now }),
    ]) {
      assert.equal(iso(r.start), iso(ist("2026-10-18T00:00")));
      assert.equal(iso(r.end), "2026-11-16T18:29:59.999Z");
      assert.equal(r.days, 30);
      assert.equal(iso(r.prevStart), iso(ist("2026-09-18T00:00")));
      assert.equal(iso(r.prevEnd), "2026-10-17T18:29:59.999Z");
    }
  });

  test(`thisMonth @ ${label} -> 1–16 Nov IST`, () => {
    const r = resolveReportRange({ preset: "thisMonth", now });
    assert.equal(iso(r.start), iso(ist("2026-11-01T00:00")));
    assert.equal(iso(r.end), "2026-11-16T18:29:59.999Z");
    assert.equal(r.days, 16);
    assert.equal(iso(r.prevStart), iso(ist("2026-10-16T00:00")));
    assert.equal(iso(r.prevEnd), "2026-10-31T18:29:59.999Z");
  });

  test(`lastMonth @ ${label} -> 1–31 Oct IST`, () => {
    const r = resolveReportRange({ preset: "lastMonth", now });
    assert.equal(iso(r.start), iso(ist("2026-10-01T00:00")));
    assert.equal(iso(r.end), "2026-10-31T18:29:59.999Z");
    assert.equal(r.days, 31);
    assert.equal(r.from, "2026-10-01");
    assert.equal(r.to, "2026-10-31");
    assert.equal(iso(r.prevStart), iso(ist("2026-08-31T00:00")));
    assert.equal(iso(r.prevEnd), "2026-09-30T18:29:59.999Z");
  });

  test(`custom single day @ ${label} covers 00:00–23:59 IST`, () => {
    const r = resolveReportRange({
      startDate: "2026-11-16",
      endDate: "2026-11-16",
      now,
    });
    assert.equal(iso(r.start), "2026-11-15T18:30:00.000Z");
    assert.equal(iso(r.end), "2026-11-16T18:29:59.999Z");
    assert.equal(r.days, 1);
    // A payment at 00:10 IST and one at 23:50 IST both fall inside.
    assert.ok(EARLY >= r.start && EARLY <= r.end);
    assert.ok(LATE >= r.start && LATE <= r.end);
    // 05:29 IST on the next day (the old UTC-boundary bug) does not.
    assert.ok(ist("2026-11-17T05:29") > r.end);
  });
}

test("custom range via from/to and preset=custom", () => {
  const r = resolveReportRange({
    preset: "custom",
    from: "2026-01-01",
    to: "2026-01-10",
    now: LATE,
  });
  assert.equal(iso(r.start), iso(ist("2026-01-01T00:00")));
  assert.equal(iso(r.end), "2026-01-10T18:29:59.999Z");
  assert.equal(r.days, 10);
  assert.equal(iso(r.prevStart), iso(ist("2025-12-22T00:00")));
  assert.equal(iso(r.prevEnd), "2025-12-31T18:29:59.999Z");
});

test("full timestamp input resolves to the IST day of that instant", () => {
  // 2026-11-15T20:00Z is 01:30 IST on 16 Nov.
  const r = resolveReportRange({
    startDate: "2026-11-15T20:00:00.000Z",
    endDate: "2026-11-15T20:00:00.000Z",
    now: LATE,
  });
  assert.equal(r.from, "2026-11-16");
  assert.equal(r.to, "2026-11-16");
});

test("only one explicit date falls back to last 30 days", () => {
  const r = resolveReportRange({ startDate: "2026-11-01", now: EARLY });
  assert.equal(r.days, 30);
  assert.equal(r.to, "2026-11-16");
});

test("istDayIndex buckets by IST calendar day", () => {
  const { start } = resolveReportRange({
    startDate: "2026-11-15",
    endDate: "2026-11-16",
    now: LATE,
  });
  assert.equal(istDayIndex(ist("2026-11-15T00:00"), start), 0);
  assert.equal(istDayIndex(ist("2026-11-15T23:59"), start), 0);
  assert.equal(istDayIndex(EARLY, start), 1);
  assert.equal(istDayIndex(LATE, start), 1);
  assert.equal(istDayIndex(ist("2026-11-14T23:59"), start), -1);
  assert.equal(istDayIndex(ist("2026-11-17T00:00"), start), 2);
});

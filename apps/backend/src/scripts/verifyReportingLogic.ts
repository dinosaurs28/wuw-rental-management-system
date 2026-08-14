/**
 * Pure-logic self-check for the shared reporting core. No DB required.
 *
 *   npx tsx src/scripts/verifyReportingLogic.ts
 *
 * Verifies the date-range resolution (presets + previous-period math) and the
 * UPI/Gateway online-payment classification — the deterministic pieces that the
 * numeric report invariants depend on.
 */
import { resolveReportRange } from "../utils/reporting/range.js";
import { classifyOnline } from "../utils/reporting/payments.js";

let failures = 0;
const eq = (name: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.error(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`);
  } else {
    console.log(`ok   ${name}`);
  }
};

const iso = (d: Date) => d.toISOString();
// Fixed "now" so the test is deterministic: Fri 2026-05-15 10:30 local.
const now = new Date(2026, 4, 15, 10, 30, 0);

// --- Last 30 days (default) ---
{
  const r = resolveReportRange({ now });
  eq("last30 days count", r.days, 30);
  eq("last30 start", iso(r.start), iso(new Date(2026, 3, 16, 0, 0, 0, 0)));
  eq("last30 end", iso(r.end), iso(new Date(2026, 4, 15, 23, 59, 59, 999)));
  // previous = same duration immediately before
  eq("last30 prevEnd", iso(r.prevEnd), iso(new Date(2026, 3, 15, 23, 59, 59, 999)));
  eq("last30 prevStart", iso(r.prevStart), iso(new Date(2026, 2, 17, 0, 0, 0, 0)));
}

// --- Today ---
{
  const r = resolveReportRange({ preset: "today", now });
  eq("today count", r.days, 1);
  eq("today start", iso(r.start), iso(new Date(2026, 4, 15, 0, 0, 0, 0)));
  eq("today prevEnd is yesterday end", iso(r.prevEnd), iso(new Date(2026, 4, 14, 23, 59, 59, 999)));
  eq("today prevStart is yesterday start", iso(r.prevStart), iso(new Date(2026, 4, 14, 0, 0, 0, 0)));
}

// --- This month ---
{
  const r = resolveReportRange({ preset: "thisMonth", now });
  eq("thisMonth start", iso(r.start), iso(new Date(2026, 4, 1, 0, 0, 0, 0)));
  eq("thisMonth count (15 days)", r.days, 15);
}

// --- Last month ---
{
  const r = resolveReportRange({ preset: "lastMonth", now });
  eq("lastMonth start", iso(r.start), iso(new Date(2026, 3, 1, 0, 0, 0, 0)));
  eq("lastMonth end", iso(r.end), iso(new Date(2026, 3, 30, 23, 59, 59, 999)));
  eq("lastMonth count (April=30)", r.days, 30);
}

// --- Custom explicit range ---
{
  const r = resolveReportRange({ startDate: "2026-01-01", endDate: "2026-01-10", now });
  eq("custom count", r.days, 10);
  eq("custom prev count equals range", r.prevStart < r.prevEnd, true);
  eq("custom prevEnd is day before start", iso(r.prevEnd), iso(new Date(2025, 11, 31, 23, 59, 59, 999)));
  eq("custom prevStart", iso(r.prevStart), iso(new Date(2025, 11, 22, 0, 0, 0, 0)));
}

// --- Online classification heuristic ---
eq("razorpay -> Gateway", classifyOnline("razorpay"), "Gateway");
eq("RAZORPAY caps -> Gateway", classifyOnline("RAZORPAY"), "Gateway");
eq("stripe -> Gateway", classifyOnline("stripe"), "Gateway");
eq("upi -> UPI", classifyOnline("upi"), "UPI");
eq("manual-upi label -> UPI", classifyOnline("MANUAL_UPI"), "UPI");
eq("null -> UPI", classifyOnline(null), "UPI");
eq("empty -> UPI", classifyOnline(""), "UPI");

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll reporting-logic self-checks passed.");

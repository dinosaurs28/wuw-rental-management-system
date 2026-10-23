/**
 * BM Financials (Oct 2026): query string → filter → SQL (financials-query.ts).
 * Checks the generated SQL text and bound values; no database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import {
  aggregateSql,
  likePattern,
  modeWhereSql,
  orderBySql,
  parseFinancialsQuery,
  rowsSql,
  transactionWhereSql,
  typeWhereSql,
  type FinancialsFilter,
} from "./financials-query.js";

// 23 Oct 2026, 01:30 IST = 22 Oct 20:00 UTC — "today" must be the IST day
const NOW = DateTime.fromISO("2026-10-22T20:00:00Z");

const ok = (q: Record<string, unknown>): FinancialsFilter => {
  const r = parseFinancialsQuery(q, 7, NOW);
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.filter;
};

test("defaults: today (IST), all types, all modes, newest first, page 1 of 25", () => {
  const f = ok({});
  assert.equal(f.from, "2026-10-23");
  assert.equal(f.to, "2026-10-23");
  assert.equal(f.start.toISOString(), "2026-10-22T18:30:00.000Z");
  assert.equal(f.end.toISOString(), "2026-10-23T18:29:59.999Z");
  assert.deepEqual(f.types, []);
  assert.deepEqual(f.modes, []);
  assert.equal(f.sort, "date");
  assert.equal(f.dir, "desc");
  assert.equal(f.page, 1);
  assert.equal(f.pageSize, 25);
  assert.equal(f.branchId, 7);
});

test("date range uses IST day boundaries; one end alone is refused", () => {
  const f = ok({ from: "2026-10-01", to: "2026-10-31" });
  assert.equal(f.start.toISOString(), "2026-09-30T18:30:00.000Z");
  assert.equal(f.end.toISOString(), "2026-10-31T18:29:59.999Z");
  const one = parseFinancialsQuery({ from: "2026-10-05" }, 7, NOW);
  // Only one end sent: refused (the client always sends both)
  assert.equal(one.ok, false);
});

test("To before From and over a year are refused", () => {
  const r = parseFinancialsQuery({ from: "2026-10-10", to: "2026-10-01" }, 7, NOW);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.code, "INVALID_PERIOD_RANGE");
  const r2 = parseFinancialsQuery({ from: "2025-01-01", to: "2026-10-01" }, 7, NOW);
  assert.equal(!r2.ok && r2.code, "PERIOD_RANGE_TOO_LONG");
  // exactly a year is fine
  assert.ok(parseFinancialsQuery({ from: "2025-10-23", to: "2026-10-23" }, 7, NOW).ok);
});

test("types / modes lists: comma or repeated, case-insensitive, 'all' = none; bad values refused", () => {
  assert.deepEqual(ok({ types: "late_fee,RENT" }).types, ["LATE_FEE", "RENT"]);
  assert.deepEqual(ok({ types: ["DAMAGES", "DAMAGES"] }).types, ["DAMAGES"]);
  assert.deepEqual(ok({ types: "all" }).types, []);
  assert.deepEqual(ok({ modes: "cash,upi" }).modes, ["CASH", "UPI"]);
  assert.equal(parseFinancialsQuery({ types: "REFUND" }, 7, NOW).ok, false);
  assert.equal(parseFinancialsQuery({ modes: "CHEQUE" }, 7, NOW).ok, false);
  assert.equal(parseFinancialsQuery({ pageSize: "500" }, 7, NOW).ok, false);
  assert.equal(parseFinancialsQuery({ sort: "customer" }, 7, NOW).ok, false);
  assert.equal(ok({ shiftStatus: "closed" }).shiftStatus, "CLOSED");
  assert.equal(ok({ shiftStatus: "all" }).shiftStatus, null);
});

test("transaction WHERE: own branch, collected statuses / purposes, collected-date range", () => {
  const f = ok({ from: "2026-10-01", to: "2026-10-02" });
  const w = transactionWhereSql(f);
  assert.match(w.sql, /t\."branchId" = \?/);
  assert.match(w.sql, /t\.status::text IN \('COLLECTED', 'CONFIRMED'\)/);
  assert.match(w.sql, /t\.purpose::text IN \('ADVANCE', 'FULL_PAYMENT', 'EXTENSION', 'SAFETY_DEPOSIT', 'DAMAGE_FEE', 'REMAINING_BALANCE'\)/);
  assert.doesNotMatch(w.sql, /REFUND|VOIDED/);
  assert.match(w.sql, /COALESCE\(t\."collectedAt", t\."createdAt"\) >= \?/);
  assert.deepEqual(w.values, [7, f.start, f.end]);
});

test("collector, shift status and search filters bind their values (no SQL injection)", () => {
  const w1 = transactionWhereSql(ok({ collectedBy: "usr_abc" }));
  assert.match(w1.sql, /t\."collectedById" = \(SELECT u\.id FROM "User" u WHERE u\."publicId" = \?\)/);
  assert.ok(w1.values.includes("usr_abc"));
  assert.match(transactionWhereSql(ok({ collectedBy: "ONLINE" })).sql, /t\."collectedById" IS NULL/);
  assert.match(transactionWhereSql(ok({ shiftStatus: "OPEN" })).sql, /cs\.status::text = 'OPEN'/);
  assert.match(transactionWhereSql(ok({ shiftStatus: "CLOSED" })).sql, /cs\.status::text <> 'OPEN'/);
  assert.match(transactionWhereSql(ok({ shiftStatus: "NONE" })).sql, /t\."cashShiftId" IS NULL/);

  const s = transactionWhereSql(ok({ search: "KA 20' OR 1=1" }));
  assert.match(s.sql, /sb\."publicId" ILIKE \?/);
  assert.match(s.sql, /su\.phone ILIKE \?/);
  assert.match(s.sql, /sv\."regNo" ILIKE \?/);
  assert.doesNotMatch(s.sql, /OR 1=1/);
  assert.ok(s.values.includes("%KA 20' OR 1=1%"));
  assert.ok(s.values.includes("%KA20'OR1=1%"));
});

test("LIKE wildcards in a search are escaped", () => {
  assert.equal(likePattern("50%_off"), "%50\\%\\_off%");
});

test("mode / type filters and sort", () => {
  assert.equal(modeWhereSql(ok({})).sql, "TRUE");
  assert.equal(modeWhereSql(ok({ modes: "CASH,UPI,GATEWAY" })).sql, "TRUE");
  assert.equal(modeWhereSql(ok({ modes: "CASH" })).sql, "(cash_part > 0)");
  assert.equal(
    modeWhereSql(ok({ modes: "UPI,GATEWAY" })).sql,
    "((total - cash_part > 0 AND NOT is_gateway) OR (total - cash_part > 0 AND is_gateway))",
  );
  assert.equal(typeWhereSql(ok({})).sql, "TRUE");
  assert.equal(typeWhereSql(ok({ types: "LATE_FEE,DAMAGES" })).sql, "type IN ('LATE_FEE', 'DAMAGES')");
  assert.equal(orderBySql(ok({})).sql, "paid_at DESC, id DESC, type_ord ASC");
  assert.equal(orderBySql(ok({ sort: "amount", dir: "asc" }), "pg.").sql, "pg.amount ASC, pg.paid_at DESC, pg.id DESC, pg.type_ord ASC");
  assert.equal(orderBySql(ok({ sort: "type" })).sql, "type_ord DESC, paid_at DESC, id DESC");
});

test("aggregate ignores the type filter (per-type counts); rows apply it with paging", () => {
  const f = ok({ types: "LATE_FEE", page: "3", pageSize: "10" });
  const agg = aggregateSql(f);
  assert.match(agg.sql, /FROM alloc GROUP BY type/);
  assert.doesNotMatch(agg.sql, /type IN \('LATE_FEE'\)/);
  const rows = rowsSql(f, f.pageSize, (f.page - 1) * f.pageSize);
  assert.match(rows.sql, /WHERE type IN \('LATE_FEE'\) ORDER BY paid_at DESC/);
  assert.match(rows.sql, /LIMIT \? OFFSET \?/);
  assert.deepEqual(rows.values.slice(-2), [10, 20]);
  // allocation path: ledger PAYMENT key link, completed drop bill, legacy charges
  assert.match(rows.sql, /le\."idempotencyKey" = SUBSTRING\(b\.idem FROM 4\)/);
  assert.match(rows.sql, /s\."sessionType"::text = 'RETURN'/);
  assert.match(rows.sql, /"ChargeEntry" ce/);
  // view only: nothing but SELECTs
  assert.doesNotMatch(rows.sql, /\b(INSERT|UPDATE|DELETE)\b/);
});

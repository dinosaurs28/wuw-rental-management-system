/**
 * Pure checks of the cash shift rules (Oct 2026: the branch manager closes
 * shifts): the expected-cash computation, the close validation (note required,
 * already closed, expected moved, who may close), one open shift per executive,
 * and no payment without a shift. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import {
  CashShiftError,
  FE_CLOSE_MESSAGE,
  assertCanCloseShift,
  assertNoOpenShift,
  countsInShift,
  decideClose,
  expectedCash,
  isOneOpenShiftViolation,
  shiftDurationLabel,
  shiftFigures,
  shiftForPayment,
} from "./cash-shift-rules.js";

const row = (purpose: string, status: string, cash: number, online = 0, voidedAfterClose = false) => ({
  purpose,
  status,
  cashAmount: cash.toFixed(2),
  onlineAmount: online.toFixed(2),
  voidedAfterClose,
});

const throwsCode = (fn: () => unknown, code: string, status?: number) =>
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof CashShiftError, "a CashShiftError");
    assert.equal(e.code, code);
    if (status !== undefined) assert.equal(e.status, status);
    return true;
  });

// ── Expected cash ────────────────────────────────────────────────────────────

test("expected cash = opening float + cash collected − cash refunded", () => {
  assert.equal(expectedCash({ openingCash: 500, cashCollected: 18000, cashRefunded: 0 }).toFixed(2), "18500.00");
  assert.equal(expectedCash({ openingCash: "0", cashCollected: "1000.50", cashRefunded: "200.25" }).toFixed(2), "800.25");
});

test("shiftFigures: cash / UPI / split / refunds, only live money counts", () => {
  const f = shiftFigures("500.00", [
    row("FULL_PAYMENT", "COLLECTED", 10000), // cash, awaiting the handover
    row("REMAINING_BALANCE", "CONFIRMED", 0, 4000), // UPI
    row("EXTENSION", "COLLECTED", 3000, 2000), // split
    row("SAFETY_DEPOSIT", "CONFIRMED", 5000),
    row("OVERPAYMENT_REFUND", "CONFIRMED", 1000), // cash paid out of the drawer
    row("CANCELLATION_REFUND", "CONFIRMED", 0, 700), // UPI refund
    row("FULL_PAYMENT", "REJECTED", 999), // manager rejected: not in the drawer
    row("FULL_PAYMENT", "VOIDED", 888), // voided while the shift was open
    row("FULL_PAYMENT", "FAILED", 777),
    row("OVERPAYMENT_REFUND", "VOIDED", 666),
  ]);
  assert.equal(f.cashCollected.toFixed(2), "18000.00");
  assert.equal(f.cashRefunded.toFixed(2), "1000.00");
  assert.equal(f.expectedCash.toFixed(2), "17500.00"); // 500 + 18000 − 1000
  assert.equal(f.nonCashCollected.toFixed(2), "6000.00");
  assert.equal(f.nonCashRefunded.toFixed(2), "700.00");
  assert.equal(f.paymentCount, 6);
});

test("shiftFigures: a row voided after the close still counts (closed figures never move)", () => {
  assert.equal(countsInShift(row("FULL_PAYMENT", "VOIDED", 100, 0, true)), true);
  assert.equal(countsInShift(row("FULL_PAYMENT", "VOIDED", 100, 0, false)), false);
  const f = shiftFigures(0, [row("FULL_PAYMENT", "VOIDED", 100, 50, true)]);
  assert.equal(f.cashCollected.toFixed(2), "100.00");
  assert.equal(f.nonCashCollected.toFixed(2), "50.00");
});

test("shiftFigures: an empty shift expects its opening float", () => {
  const f = shiftFigures("250.00", []);
  assert.equal(f.expectedCash.toFixed(2), "250.00");
  assert.equal(f.paymentCount, 0);
});

// ── Close validation ─────────────────────────────────────────────────────────

const figs = (expected: number) => ({
  expectedCash: new Decimal(expected),
  openingCash: new Decimal(0),
  cashCollected: new Decimal(expected),
  cashRefunded: new Decimal(0),
});

test("close: matched — no note needed, status CLOSED", () => {
  const d = decideClose({ status: "OPEN", figures: figs(18500), cashReceived: 18500 });
  assert.equal(d.matched, true);
  assert.equal(d.status, "CLOSED");
  assert.equal(d.difference.toFixed(2), "0.00");
  assert.equal(d.note, null);
});

test("close: a difference needs a note (blank is not a note)", () => {
  throwsCode(() => decideClose({ status: "OPEN", figures: figs(18500), cashReceived: 18000 }), "DISCREPANCY_EXPLANATION_REQUIRED", 400);
  throwsCode(() => decideClose({ status: "OPEN", figures: figs(18500), cashReceived: 18000, note: "   " }), "DISCREPANCY_EXPLANATION_REQUIRED", 400);
  const d = decideClose({ status: "OPEN", figures: figs(18500), cashReceived: 18000, note: " Short ₹500, will pay tomorrow " });
  assert.equal(d.matched, false);
  assert.equal(d.status, "DISCREPANCY_FLAGGED");
  assert.equal(d.difference.toFixed(2), "-500.00");
  assert.equal(d.note, "Short ₹500, will pay tomorrow");
  const over = decideClose({ status: "OPEN", figures: figs(100), cashReceived: 100.5, note: "Extra coin" });
  assert.equal(over.difference.toFixed(2), "0.50");
});

test("close: an already-closed shift is refused (409), whatever the figures", () => {
  throwsCode(() => decideClose({ status: "CLOSED", figures: figs(10), cashReceived: 10 }), "SHIFT_NOT_OPEN", 409);
  throwsCode(() => decideClose({ status: "DISCREPANCY_FLAGGED", figures: figs(10), cashReceived: 10 }), "SHIFT_NOT_OPEN", 409);
});

test("close: the expected cash the manager saw must still be the expected cash", () => {
  throwsCode(
    () => decideClose({ status: "OPEN", figures: figs(18500), cashReceived: 18500, expectedSeen: 18000 }),
    "EXPECTED_CASH_CHANGED",
    409,
  );
  const d = decideClose({ status: "OPEN", figures: figs(18500), cashReceived: 18500, expectedSeen: "18500.00" });
  assert.equal(d.matched, true);
});

test("close: only the branch's manager or an admin — never a Fleet Executive", () => {
  assert.throws(
    () => assertCanCloseShift({ role: "STAFF", branchId: 1 }, { branchId: 1 }),
    (e: unknown) => e instanceof CashShiftError && e.code === "SHIFT_CLOSE_MANAGER_ONLY" && e.status === 403 && e.message === FE_CLOSE_MESSAGE,
  );
  throwsCode(() => assertCanCloseShift({ role: "MANAGER", branchId: 2 }, { branchId: 1 }), "SHIFT_OTHER_BRANCH", 403);
  assert.doesNotThrow(() => assertCanCloseShift({ role: "MANAGER", branchId: 1 }, { branchId: 1 }));
  assert.doesNotThrow(() => assertCanCloseShift({ role: "ADMIN", branchId: null }, { branchId: 1 }));
  throwsCode(() => assertCanCloseShift({ role: "USER", branchId: 1 }, { branchId: 1 }), "SHIFT_CLOSE_MANAGER_ONLY", 403);
});

// ── One open shift per executive ─────────────────────────────────────────────

test("one open shift: a second open shift is refused (409 SHIFT_ALREADY_OPEN)", () => {
  assert.doesNotThrow(() => assertNoOpenShift(null));
  throwsCode(() => assertNoOpenShift({ id: 7 }), "SHIFT_ALREADY_OPEN", 409);
});

test("one open shift: the partial unique index violation is recognised", () => {
  assert.equal(isOneOpenShiftViolation({ code: "P2002", meta: { target: ["employeeId"] } }), true);
  assert.equal(isOneOpenShiftViolation({ code: "P2002", meta: { target: "CashShift_one_open_per_employee" } }), true);
  assert.equal(
    isOneOpenShiftViolation({ message: 'duplicate key value violates unique constraint "CashShift_one_open_per_employee"' }),
    true,
  );
  assert.equal(isOneOpenShiftViolation({ code: "P2002", meta: { target: ["publicId"] } }), false);
  assert.equal(isOneOpenShiftViolation(null), false);
});

// ── No payment without a shift ───────────────────────────────────────────────

test("no payment without a shift: a Fleet Executive needs one for every payment", () => {
  assert.deepEqual(shiftForPayment("STAFF", null), { shift: null, required: true, missing: true });
  assert.deepEqual(shiftForPayment("STAFF", { id: 3 }), { shift: { id: 3 }, required: true, missing: false });
});

test("no payment without a shift: managers and admins link their own shift only if open", () => {
  assert.deepEqual(shiftForPayment("MANAGER", null), { shift: null, required: false, missing: false });
  assert.deepEqual(shiftForPayment("ADMIN", { id: 9 }), { shift: { id: 9 }, required: false, missing: false });
});

test("duration label", () => {
  const t0 = Date.UTC(2026, 9, 23, 3, 0);
  assert.equal(shiftDurationLabel(t0, t0 + (6 * 60 + 20) * 60_000), "6h 20m");
  assert.equal(shiftDurationLabel(t0, t0 + 45 * 60_000), "45m");
  assert.equal(shiftDurationLabel(t0, t0 + (51 * 60) * 60_000), "2d 3h");
  assert.equal(shiftDurationLabel(t0, t0 - 1000), "0m");
});

/**
 * Fleet Executive self-close eligibility (Nov 2026): an executive may close
 * their own shift only when it never held cash. Pure — no database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CashShiftError,
  SELF_CLOSE_CASH_MESSAGE,
  assertSelfClosable,
  selfCloseEligibility,
  shiftFigures,
} from "./cash-shift-rules.js";

const row = (purpose: string, status: string, cash: number, online = 0) => ({
  purpose,
  status,
  cashAmount: cash.toFixed(2),
  onlineAmount: online.toFixed(2),
});
const elig = (opening: number, rows: ReturnType<typeof row>[], status = "OPEN") =>
  selfCloseEligibility({ status, figures: shiftFigures(opening, rows) });

test("no payments, no float → may self-close", () => {
  const e = elig(0, []);
  assert.equal(e.canSelfClose, true);
  assert.equal(e.reason, "OK");
  assert.equal(e.message, "");
  assert.equal(e.cashToHandOver, "0.00");
});

test("only UPI / card / bank payments (COLLECTED or CONFIRMED) → may self-close", () => {
  const e = elig(0, [row("FULL_PAYMENT", "CONFIRMED", 0, 1200), row("EXTENSION", "COLLECTED", 0, 500), row("SAFETY_DEPOSIT", "CONFIRMED", 0, 2000)]);
  assert.equal(e.canSelfClose, true);
});

test("a non-cash refund does not block", () => {
  assert.equal(elig(0, [row("FULL_PAYMENT", "CONFIRMED", 0, 1000), row("OVERPAYMENT_REFUND", "CONFIRMED", 0, 200)]).canSelfClose, true);
});

test("any cash collected (COLLECTED or CONFIRMED) → manager", () => {
  for (const status of ["COLLECTED", "CONFIRMED"]) {
    const e = elig(0, [row("FULL_PAYMENT", status, 300)]);
    assert.equal(e.canSelfClose, false, status);
    assert.equal(e.reason, "CASH_COLLECTED");
    assert.equal(e.message, SELF_CLOSE_CASH_MESSAGE);
    assert.equal(e.cashToHandOver, "300.00");
  }
});

test("a split's cash part blocks", () => {
  const e = elig(0, [row("FULL_PAYMENT", "COLLECTED", 0.5, 999.5)]);
  assert.equal(e.reason, "CASH_COLLECTED");
  assert.equal(e.cashCollected, "0.50");
});

test("voided / rejected / failed / initiated cash rows count nowhere → may self-close", () => {
  for (const status of ["VOIDED", "REJECTED", "FAILED", "INITIATED", "REFUNDED"]) {
    assert.equal(elig(0, [row("FULL_PAYMENT", status, 800)]).canSelfClose, true, status);
  }
});

test("a cash refund paid out of the shift → manager", () => {
  const e = elig(0, [row("CANCELLATION_REFUND", "CONFIRMED", 400)]);
  assert.equal(e.canSelfClose, false);
  assert.equal(e.reason, "CASH_REFUNDED");
  assert.equal(e.cashToHandOver, "-400.00");
  // a voided cash refund doesn't
  assert.equal(elig(0, [row("CANCELLATION_REFUND", "VOIDED", 400)]).canSelfClose, true);
});

test("a non-zero opening float → manager, even with no payments", () => {
  const e = elig(500, []);
  assert.equal(e.canSelfClose, false);
  assert.equal(e.reason, "OPENING_FLOAT");
  assert.equal(e.openingCash, "500.00");
  assert.equal(e.cashToHandOver, "500.00");
  assert.equal(elig(0.01, []).reason, "OPENING_FLOAT");
});

test("cash collected wins over the float as the reason", () => {
  assert.equal(elig(500, [row("FULL_PAYMENT", "CONFIRMED", 100)]).reason, "CASH_COLLECTED");
});

test("a closed shift is not closable", () => {
  for (const status of ["CLOSED", "DISCREPANCY_FLAGGED"]) {
    const e = elig(0, [], status);
    assert.equal(e.canSelfClose, false);
    assert.equal(e.reason, "NOT_OPEN");
  }
});

test("assertSelfClosable: 403 SHIFT_CLOSE_MANAGER_ONLY with the reason; 409 when closed; passes when allowed", () => {
  assert.doesNotThrow(() => assertSelfClosable(elig(0, [])));
  assert.throws(
    () => assertSelfClosable(elig(0, [row("FULL_PAYMENT", "CONFIRMED", 100)])),
    (e: unknown) => {
      assert.ok(e instanceof CashShiftError);
      assert.equal(e.status, 403);
      assert.equal(e.code, "SHIFT_CLOSE_MANAGER_ONLY");
      assert.equal(e.message, SELF_CLOSE_CASH_MESSAGE);
      const j = e.toJSON() as Record<string, unknown>;
      assert.equal(j.reason, "CASH_COLLECTED");
      assert.equal(j.cashToHandOver, "100.00");
      return true;
    },
  );
  assert.throws(
    () => assertSelfClosable(elig(0, [], "CLOSED")),
    (e: unknown) => e instanceof CashShiftError && e.status === 409 && e.code === "SHIFT_NOT_OPEN",
  );
});

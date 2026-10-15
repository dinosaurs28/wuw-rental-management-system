/**
 * Pure checks of the branch manager's manual cancel (Fleet tab, Oct 2026):
 * which rents can be cancelled, what can be refunded, the request body (an
 * active rent needs the car back and its status) and how a refund is recorded.
 * No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import {
  ManualCancelError,
  cancelRefusalFor,
  cashShiftRefusal,
  committedRefunds,
  dropInProgressRefusal,
  isRazorpayCapture,
  manualCancelStage,
  moneyRefusal,
  odometerProblem,
  originalPaymentCap,
  originalPaymentProblem,
  parseManualCancelBody,
  parseRupees,
  razorpayCapturedAmount,
  refundAmountProblem,
  refundRecordFor,
  refundableAmount,
  remainingPaymentRefusal,
} from "./manual-cancel-rules.js";

const d = (v: number | string) => new Decimal(v);

function expectError(fn: () => unknown, code: string, field?: string) {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof ManualCancelError, "a ManualCancelError");
    assert.equal(err.code, code);
    if (field) assert.equal(err.extra.field, field);
    return true;
  });
}

// ── State rules ──────────────────────────────────────────────────────────────

test("stage: CONFIRMED is upcoming, PICKED_UP active, everything else none", () => {
  assert.equal(manualCancelStage("CONFIRMED"), "UPCOMING");
  assert.equal(manualCancelStage("PICKED_UP"), "ACTIVE");
  for (const s of ["HOLD", "RETURNED", "CANCELLED", "HOLD_EXPIRED"]) assert.equal(manualCancelStage(s), null);
});

test("upcoming and active rents can be cancelled", () => {
  assert.equal(cancelRefusalFor({ status: "CONFIRMED", requiresManagerConfirmation: false }), null);
  assert.equal(cancelRefusalFor({ status: "PICKED_UP", requiresManagerConfirmation: false }), null);
});

test("a pickup waiting for the manager's confirmation can still be cancelled", () => {
  assert.equal(cancelRefusalFor({ status: "CONFIRMED", requiresManagerConfirmation: true }), null);
});

test("an active rent whose return awaits the manager's confirmation is refused", () => {
  const err = cancelRefusalFor({ status: "PICKED_UP", requiresManagerConfirmation: true });
  assert.ok(err);
  assert.equal(err.code, "RETURN_PENDING_CONFIRMATION");
  assert.equal(err.status, 409);
  assert.match(err.message, /Confirm the return/);
});

test("HOLD, RETURNED, CANCELLED and HOLD_EXPIRED are refused with BOOKING_NOT_CANCELLABLE", () => {
  for (const status of ["HOLD", "RETURNED", "CANCELLED", "HOLD_EXPIRED"]) {
    const err = cancelRefusalFor({ status, requiresManagerConfirmation: false });
    assert.ok(err, status);
    assert.equal(err.code, "BOOKING_NOT_CANCELLABLE");
    assert.equal(err.extra.bookingStatus, status);
  }
  assert.match(cancelRefusalFor({ status: "CANCELLED", requiresManagerConfirmation: false })!.message, /already cancelled/);
});

// ── Money ────────────────────────────────────────────────────────────────────

test("refundable = paid − committed refunds, never below zero", () => {
  assert.equal(refundableAmount({ paid: d(2500), refunded: d(0) }).toFixed(2), "2500.00");
  assert.equal(refundableAmount({ paid: d(2500), refunded: d(750.5) }).toFixed(2), "1749.50");
  assert.equal(refundableAmount({ paid: d(1000), refunded: d(1200) }).toFixed(2), "0.00");
  assert.equal(refundableAmount({ paid: d(0), refunded: d(0) }).toFixed(2), "0.00");
});

test("committed refunds: the larger of refund rows and refund requests, never both added", () => {
  // ₹8,000 paid, ₹1,000 cash refunded at the counter: a CONFIRMED refund row AND a
  // PENDING_APPROVAL request for the same ₹1,000 → ₹1,000 committed, cap ₹7,000
  const committed = committedRefunds(d(1000), d(1000));
  assert.equal(committed.toFixed(2), "1000.00");
  assert.equal(refundableAmount({ paid: d(8000), refunded: committed }).toFixed(2), "7000.00");
  // An approved online refund not paid out yet (request only) still counts
  assert.equal(committedRefunds(d(0), d(500)).toFixed(2), "500.00");
  // Refund rows without a request (older data) count too
  assert.equal(committedRefunds(d(300), d(0)).toFixed(2), "300.00");
  assert.equal(committedRefunds(d(1000), d(1500)).toFixed(2), "1500.00");
});

test("Razorpay captures: the gateway or a Razorpay order / payment ref; cash and counter UPI excluded", () => {
  assert.equal(isRazorpayCapture({ onlineGateway: "RAZORPAY", onlineTransactionRef: null }), true);
  assert.equal(isRazorpayCapture({ onlineGateway: "Razorpay", onlineTransactionRef: null }), true);
  assert.equal(isRazorpayCapture({ onlineGateway: null, onlineTransactionRef: "order_Abc123" }), true);
  assert.equal(isRazorpayCapture({ onlineGateway: "Other", onlineTransactionRef: "pay_Xyz" }), true);
  assert.equal(isRazorpayCapture({ onlineGateway: "UPI", onlineTransactionRef: "412345678901" }), false);
  assert.equal(isRazorpayCapture({ onlineGateway: null, onlineTransactionRef: null }), false);
  const rows = [
    { purpose: "FULL_PAYMENT", status: "CONFIRMED", onlineAmount: "3000.00", onlineGateway: "RAZORPAY", onlineTransactionRef: "order_1" },
    { purpose: "REMAINING_BALANCE", status: "CONFIRMED", onlineAmount: "0.00", onlineGateway: null, onlineTransactionRef: null }, // cash
    { purpose: "REMAINING_BALANCE", status: "CONFIRMED", onlineAmount: "2000.00", onlineGateway: "UPI", onlineTransactionRef: "UTR1" },
    { purpose: "EXTENSION", status: "COLLECTED", onlineAmount: "500.00", onlineGateway: "RAZORPAY", onlineTransactionRef: "order_2" },
    { purpose: "FULL_PAYMENT", status: "REFUNDED", onlineAmount: "900.00", onlineGateway: "RAZORPAY", onlineTransactionRef: "order_3" },
    { purpose: "CANCELLATION_REFUND", status: "CONFIRMED", onlineAmount: "100.00", onlineGateway: "RAZORPAY", onlineTransactionRef: null },
  ];
  assert.equal(razorpayCapturedAmount(rows).toFixed(2), "3000.00");
});

test("original online payment: capped at refundable and at what Razorpay captured", () => {
  assert.equal(originalPaymentCap(d(5000), d(3000)).toFixed(2), "3000.00");
  assert.equal(originalPaymentCap(d(2000), d(3000)).toFixed(2), "2000.00");
  assert.equal(originalPaymentCap(d(2000), d(0)).toFixed(2), "0.00");
  assert.equal(originalPaymentProblem(d(3000), d(3000)), null);
  assert.match(originalPaymentProblem(d("3000.01"), d(3000))!, /Only ₹3000\.00 was paid online/);
  assert.match(originalPaymentProblem(d(1), d(0))!, /Nothing on this booking was paid online/);
});

test("refund records: cash / UPI / bank paid out now; original payment completed later", () => {
  assert.equal(refundRecordFor("CASH").paidOutNow, true);
  assert.equal(refundRecordFor("UPI").paidOutNow, true);
  assert.equal(refundRecordFor("BANK_TRANSFER").paidOutNow, true);
  assert.equal(refundRecordFor("ORIGINAL_PAYMENT").paidOutNow, false);
});

test("a cash refund needs the manager's open cash shift", () => {
  assert.equal(cashShiftRefusal("CASH", true), null);
  assert.equal(cashShiftRefusal("UPI", false), null);
  assert.equal(cashShiftRefusal("BANK_TRANSFER", false), null);
  assert.equal(cashShiftRefusal("ORIGINAL_PAYMENT", false), null);
  assert.equal(cashShiftRefusal(null, false), null);
  const err = cashShiftRefusal("CASH", false);
  assert.equal(err?.code, "CASH_SHIFT_REQUIRED");
  assert.equal(err?.status, 409);
  assert.equal(err?.message, "Open a cash shift to refund cash, or choose UPI or bank transfer.");
});

test("a drop in progress (open drop bill or drop damage awaiting review) refuses the cancel", () => {
  assert.equal(dropInProgressRefusal({ openReturnSession: false, pendingDropDamage: false }), null);
  for (const state of [
    { openReturnSession: true, pendingDropDamage: false },
    { openReturnSession: false, pendingDropDamage: true },
  ]) {
    const err = dropInProgressRefusal(state);
    assert.equal(err?.code, "DROP_IN_PROGRESS");
    assert.equal(err?.status, 409);
    assert.match(err!.message, /finish the drop instead/);
  }
});

test("a legacy online balance payment: captured / pending / unknown block, failed allows", () => {
  assert.equal(remainingPaymentRefusal({ state: "FAILED" }), null);
  for (const [gateway, pattern] of [
    [{ state: "SUCCESS" as const }, /went through/],
    [{ state: "PENDING" as const }, /paying the balance online/],
    [null, /Couldn't check/],
  ] as const) {
    const err = remainingPaymentRefusal(gateway);
    assert.equal(err?.code, "PAYMENT_IN_PROGRESS");
    assert.match(err!.message, pattern);
  }
});

test("cash awaiting confirmation blocks the cancel", () => {
  assert.equal(moneyRefusal({ pendingCash: d(0) }), null);
  const err = moneyRefusal({ pendingCash: d(800) });
  assert.ok(err);
  assert.equal(err.code, "CASH_AWAITING_CONFIRMATION");
  assert.equal(err.extra.pendingCash, "800.00");
});

test("refund amount: 0 up to what can be refunded", () => {
  assert.equal(refundAmountProblem(d(0), d(1500)), null);
  assert.equal(refundAmountProblem(d(1500), d(1500)), null);
  assert.equal(refundAmountProblem(d("1499.99"), d(1500)), null);
  assert.match(refundAmountProblem(d("1500.01"), d(1500))!, /at most ₹1500\.00/);
  assert.equal(refundAmountProblem(d(0), d(0)), null);
  assert.match(refundAmountProblem(d(1), d(0))!, /must be ₹0/);
  assert.match(refundAmountProblem(d(-1), d(100))!, /negative/);
});

test("parseRupees: numbers or numeric strings ≥ 0 with at most 2 decimals", () => {
  assert.equal(parseRupees(0)?.toFixed(2), "0.00");
  assert.equal(parseRupees(1250.5)?.toFixed(2), "1250.50");
  assert.equal(parseRupees("99.99")?.toFixed(2), "99.99");
  assert.equal(parseRupees(" 100 ")?.toFixed(2), "100.00");
  for (const bad of [-1, 10.123, "abc", "", "-5", "1e3", NaN, Infinity, null, undefined, {}, true]) {
    assert.equal(parseRupees(bad), null, String(bad));
  }
});

test("refund methods map onto the cash / online refund records", () => {
  assert.deepEqual(refundRecordFor("CASH"), { method: "CASH", onlineGateway: null, paidOutNow: true });
  assert.deepEqual(refundRecordFor("UPI"), { method: "ONLINE", onlineGateway: "UPI", paidOutNow: true });
  assert.deepEqual(refundRecordFor("BANK_TRANSFER"), { method: "ONLINE", onlineGateway: "BANK_TRANSFER", paidOutNow: true });
  assert.deepEqual(refundRecordFor("ORIGINAL_PAYMENT"), { method: "ONLINE", onlineGateway: "RAZORPAY", paidOutNow: false });
});

// ── Request body ─────────────────────────────────────────────────────────────

test("upcoming: reason + refund; no vehicle fields needed", () => {
  const parsed = parseManualCancelBody(
    { reason: "  Customer called to cancel  ", refund: { amount: 1500, method: "UPI", note: " sent to 98xxxx " } },
    "UPCOMING",
  );
  assert.equal(parsed.reason, "Customer called to cancel");
  assert.equal(parsed.refund.amount.toFixed(2), "1500.00");
  assert.equal(parsed.refund.method, "UPI");
  assert.equal(parsed.refund.note, "sent to 98xxxx");
  assert.equal(parsed.vehicleStatus, null);
  assert.equal(parsed.odometer, null);
});

test("reason is required, 3–500 characters", () => {
  expectError(() => parseManualCancelBody({ refund: { amount: 0 } }, "UPCOMING"), "VALIDATION_ERROR", "reason");
  expectError(() => parseManualCancelBody({ reason: " ab ", refund: { amount: 0 } }, "UPCOMING"), "VALIDATION_ERROR", "reason");
  expectError(
    () => parseManualCancelBody({ reason: "x".repeat(501), refund: { amount: 0 } }, "UPCOMING"),
    "VALIDATION_ERROR",
    "reason",
  );
  assert.equal(parseManualCancelBody({ reason: "abc", refund: { amount: 0 } }, "UPCOMING").reason, "abc");
});

test("refund amount is required (₹0 allowed); a method only when money goes back", () => {
  expectError(() => parseManualCancelBody({ reason: "No show" }, "UPCOMING"), "VALIDATION_ERROR", "refund.amount");
  expectError(
    () => parseManualCancelBody({ reason: "No show", refund: { amount: -5, method: "CASH" } }, "UPCOMING"),
    "VALIDATION_ERROR",
    "refund.amount",
  );
  expectError(
    () => parseManualCancelBody({ reason: "No show", refund: { amount: 10.555, method: "CASH" } }, "UPCOMING"),
    "VALIDATION_ERROR",
    "refund.amount",
  );
  expectError(
    () => parseManualCancelBody({ reason: "No show", refund: { amount: 100 } }, "UPCOMING"),
    "VALIDATION_ERROR",
    "refund.method",
  );
  expectError(
    () => parseManualCancelBody({ reason: "No show", refund: { amount: 100, method: "CHEQUE" } }, "UPCOMING"),
    "VALIDATION_ERROR",
    "refund.method",
  );
  const none = parseManualCancelBody({ reason: "No show", refund: { amount: 0, method: "CHEQUE" } }, "UPCOMING");
  assert.equal(none.refund.method, null);
  assert.equal(none.refund.amount.toFixed(2), "0.00");
});

test("refund note: optional, at most 500 characters", () => {
  expectError(
    () => parseManualCancelBody({ reason: "No show", refund: { amount: 0, note: "n".repeat(501) } }, "UPCOMING"),
    "VALIDATION_ERROR",
    "refund.note",
  );
  assert.equal(parseManualCancelBody({ reason: "No show", refund: { amount: 0, note: "   " } }, "UPCOMING").refund.note, null);
});

test("active: the vehicle must be confirmed back at the branch", () => {
  const base = { reason: "Car broke down", refund: { amount: 0 }, vehicleStatus: "MAINTENANCE" };
  expectError(() => parseManualCancelBody(base, "ACTIVE"), "VEHICLE_NOT_RETURNED", "vehicleReturned");
  expectError(() => parseManualCancelBody({ ...base, vehicleReturned: false }, "ACTIVE"), "VEHICLE_NOT_RETURNED");
  expectError(() => parseManualCancelBody({ ...base, vehicleReturned: "true" }, "ACTIVE"), "VEHICLE_NOT_RETURNED");
  const ok = parseManualCancelBody({ ...base, vehicleReturned: true }, "ACTIVE");
  assert.equal(ok.vehicleStatus, "MAINTENANCE");
  assert.equal(ok.odometer, null);
});

test("active: the vehicle status must be Available or Maintenance", () => {
  const base = { reason: "Customer returned early", refund: { amount: 0 }, vehicleReturned: true };
  expectError(() => parseManualCancelBody(base, "ACTIVE"), "VALIDATION_ERROR", "vehicleStatus");
  expectError(() => parseManualCancelBody({ ...base, vehicleStatus: "OUT_FOR_RENTAL" }, "ACTIVE"), "VALIDATION_ERROR", "vehicleStatus");
  expectError(() => parseManualCancelBody({ ...base, vehicleStatus: "INACTIVE" }, "ACTIVE"), "VALIDATION_ERROR", "vehicleStatus");
  assert.equal(parseManualCancelBody({ ...base, vehicleStatus: "AVAILABLE" }, "ACTIVE").vehicleStatus, "AVAILABLE");
});

test("active: optional odometer, a whole number of km", () => {
  const base = { reason: "Customer returned early", refund: { amount: 0 }, vehicleReturned: true, vehicleStatus: "AVAILABLE" };
  assert.equal(parseManualCancelBody({ ...base, odometer: 45210 }, "ACTIVE").odometer, 45210);
  assert.equal(parseManualCancelBody({ ...base, odometer: "45210" }, "ACTIVE").odometer, 45210);
  assert.equal(parseManualCancelBody({ ...base, odometer: "" }, "ACTIVE").odometer, null);
  expectError(() => parseManualCancelBody({ ...base, odometer: 12.5 }, "ACTIVE"), "VALIDATION_ERROR", "odometer");
  expectError(() => parseManualCancelBody({ ...base, odometer: -1 }, "ACTIVE"), "VALIDATION_ERROR", "odometer");
  expectError(() => parseManualCancelBody({ ...base, odometer: "abc" }, "ACTIVE"), "VALIDATION_ERROR", "odometer");
});

test("upcoming ignores vehicle fields sent by mistake", () => {
  const parsed = parseManualCancelBody(
    { reason: "Plans changed", refund: { amount: 0 }, vehicleReturned: false, vehicleStatus: "MAINTENANCE", odometer: 5 },
    "UPCOMING",
  );
  assert.equal(parsed.vehicleStatus, null);
  assert.equal(parsed.odometer, null);
});

test("odometer can't go below the car's last reading; one-vehicle rents only", () => {
  assert.equal(odometerProblem(45210, 45000, 1), null);
  assert.equal(odometerProblem(45000, 45000, 1), null);
  assert.match(odometerProblem(44999, 45000, 1)!, /45000 km/);
  assert.match(odometerProblem(45210, 45000, 2)!, /one vehicle/);
});

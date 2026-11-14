/**
 * Pure checks of how a Razorpay order is read (Nov 2026 "paid but not
 * confirmed" / "some payments failed"): retries within one order, authorized
 * payments that still need a capture, the late-payment sweep's back-off and
 * which bookings it may confirm. No database, no SDK.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RECONCILE_WINDOW_MS,
  isAlreadyCapturedError,
  isReconcilableOnlineHold,
  reconcileBackoffSeconds,
  resolveOrderState,
} from "./razorpay-order-state.js";

const pay = (id: string, status: string, amount = 150000) => ({ id, status, amount, method: "upi" });

test("a captured payment settles the order even after failed attempts (Checkout retry)", () => {
  const r = resolveOrderState("paid", [pay("pay_1", "failed"), pay("pay_2", "captured")]);
  assert.equal(r.state, "SUCCESS");
  assert.equal(r.payment?.id, "pay_2");
  assert.equal(r.needsCapture, false);
});

test("an authorized-only payment is SUCCESS but must be captured first", () => {
  const r = resolveOrderState("attempted", [pay("pay_1", "authorized")]);
  assert.equal(r.state, "SUCCESS");
  assert.equal(r.payment?.id, "pay_1");
  assert.equal(r.needsCapture, true);
});

test("captured wins over authorized — no needless capture call", () => {
  const r = resolveOrderState("paid", [pay("pay_a", "authorized"), pay("pay_c", "captured")]);
  assert.equal(r.payment?.id, "pay_c");
  assert.equal(r.needsCapture, false);
});

test("an order with only failed attempts is still payable: PENDING, never FAILED (no cancel)", () => {
  const r = resolveOrderState("attempted", [pay("pay_1", "failed"), pay("pay_2", "failed")]);
  assert.equal(r.state, "PENDING");
  assert.equal(r.needsCapture, false);
});

test("a fresh order with no attempt is PENDING", () => {
  assert.equal(resolveOrderState("created", []).state, "PENDING");
});

test("a payment still in flight is PENDING and named", () => {
  const r = resolveOrderState("attempted", [pay("pay_1", "failed"), pay("pay_2", "created")]);
  assert.equal(r.state, "PENDING");
  assert.equal(r.payment?.id, "pay_2");
});

test("only a paid order with nothing settled (e.g. refunded) reads FAILED", () => {
  const r = resolveOrderState("paid", [pay("pay_1", "refunded")]);
  assert.equal(r.state, "FAILED");
  assert.equal(resolveOrderState("paid", [pay("pay_1", "failed")]).payment?.id, "pay_1");
});

test("Razorpay's 'already captured' refusal counts as captured", () => {
  assert.equal(isAlreadyCapturedError("This payment has already been captured"), true);
  assert.equal(isAlreadyCapturedError("Payment already captured"), true);
  assert.equal(isAlreadyCapturedError("The amount must match the authorized amount"), false);
  assert.equal(isAlreadyCapturedError(undefined), false);
});

test("sweep back-off: every sweep in the first hour, then 30 min, then 3 h, stops after 72 h", () => {
  const min = 60_000;
  assert.equal(reconcileBackoffSeconds(5 * min), 300);
  assert.equal(reconcileBackoffSeconds(59 * min), 300);
  assert.equal(reconcileBackoffSeconds(61 * min), 1800);
  assert.equal(reconcileBackoffSeconds(5 * 60 * min), 1800);
  assert.equal(reconcileBackoffSeconds(7 * 60 * min), 3 * 3600);
  assert.equal(reconcileBackoffSeconds(RECONCILE_WINDOW_MS), 3 * 3600);
  assert.equal(reconcileBackoffSeconds(RECONCILE_WINDOW_MS + 1), null);
  // Clock skew (createdAt slightly in the future) still checks
  assert.equal(reconcileBackoffSeconds(-1000), 300);
});

test("only unpaid online holds (HOLD / HOLD_EXPIRED with an order_ id) are reconciled", () => {
  const b = (over: Partial<{ status: string; paymentStatus: string; transactionId: string | null }>) => ({
    status: "HOLD_EXPIRED",
    paymentStatus: "CREATED",
    transactionId: "order_abc" as string | null,
    ...over,
  });
  assert.equal(isReconcilableOnlineHold(b({})), true);
  assert.equal(isReconcilableOnlineHold(b({ status: "HOLD" })), true);
  // Already settled
  assert.equal(isReconcilableOnlineHold(b({ status: "CONFIRMED", paymentStatus: "SUCCESS" })), false);
  assert.equal(isReconcilableOnlineHold(b({ paymentStatus: "SUCCESS" })), false);
  // Cancelled bookings go to the refund path, never auto-confirmed
  assert.equal(isReconcilableOnlineHold(b({ status: "CANCELLED", paymentStatus: "FAILED" })), false);
  // Counter payments have no gateway order
  assert.equal(isReconcilableOnlineHold(b({ transactionId: "UPI_123" })), false);
  assert.equal(isReconcilableOnlineHold(b({ transactionId: "CASH_123" })), false);
  assert.equal(isReconcilableOnlineHold(b({ transactionId: null })), false);
});

/**
 * Pure checks of "Refund to customer" (Oct 2026): the request body, the
 * "more than received" confirmation, how the refund splits into money owed back
 * and goodwill (its effect on the booking's balance and money totals), how it
 * is recorded, and the cash-shift link. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import {
  CUSTOMER_REFUND_KEY_PREFIX,
  CustomerRefundError,
  cashShiftLink,
  customerRefundKey,
  customerRefundNote,
  customerRefundRecord,
  isCashRefundOutsideShift,
  isCustomerRefundKey,
  netPayableAfterRefund,
  netReceived,
  overReceivedBy,
  overReceivedRefusal,
  owedBack,
  parseCustomerRefundBody,
  splitCustomerRefund,
} from "./customer-refund-rules.js";
import { summarizeBookingMoney } from "../payment/booking-owed.service.js";

const d = (v: number | string) => new Decimal(v);

function expectError(fn: () => unknown, code: string, field?: string) {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof CustomerRefundError, "a CustomerRefundError");
    assert.equal(err.code, code);
    if (field) assert.equal(err.extra.field, field);
    return true;
  });
}

const valid = { amount: 500, method: "CASH", reason: "Customer complaint" };

// ── Body ─────────────────────────────────────────────────────────────────────

test("parse: a valid cash refund", () => {
  const p = parseCustomerRefundBody(valid);
  assert.equal(p.amount.toFixed(2), "500.00");
  assert.equal(p.method, "CASH");
  assert.equal(p.reason, "Customer complaint");
  assert.equal(p.reference, null);
  assert.equal(p.proofFileId, null);
  assert.equal(p.confirmOverReceived, false);
  assert.equal(p.requestId, null);
});

test("parse: amount must be above ₹0 with at most 2 decimals", () => {
  expectError(() => parseCustomerRefundBody({ ...valid, amount: 0 }), "VALIDATION_ERROR", "amount");
  expectError(() => parseCustomerRefundBody({ ...valid, amount: -5 }), "VALIDATION_ERROR", "amount");
  expectError(() => parseCustomerRefundBody({ ...valid, amount: "12.345" }), "VALIDATION_ERROR", "amount");
  expectError(() => parseCustomerRefundBody({ ...valid, amount: "abc" }), "VALIDATION_ERROR", "amount");
  expectError(() => parseCustomerRefundBody({ ...valid, amount: undefined }), "VALIDATION_ERROR", "amount");
  expectError(() => parseCustomerRefundBody({ ...valid, amount: "100000000" }), "VALIDATION_ERROR", "amount");
  assert.equal(parseCustomerRefundBody({ ...valid, amount: "0.01" }).amount.toFixed(2), "0.01");
  // No cap at money received: any amount is valid here
  assert.equal(parseCustomerRefundBody({ ...valid, amount: 99999 }).amount.toFixed(2), "99999.00");
});

test("parse: method must be cash, UPI or bank transfer", () => {
  expectError(() => parseCustomerRefundBody({ ...valid, method: "ORIGINAL_PAYMENT" }), "VALIDATION_ERROR", "method");
  expectError(() => parseCustomerRefundBody({ ...valid, method: undefined }), "VALIDATION_ERROR", "method");
  assert.equal(parseCustomerRefundBody({ ...valid, method: "UPI" }).method, "UPI");
  assert.equal(parseCustomerRefundBody({ ...valid, method: "BANK_TRANSFER" }).method, "BANK_TRANSFER");
});

test("parse: a reason is required (3–500 characters, trimmed)", () => {
  expectError(() => parseCustomerRefundBody({ ...valid, reason: undefined }), "VALIDATION_ERROR", "reason");
  expectError(() => parseCustomerRefundBody({ ...valid, reason: "  ab  " }), "VALIDATION_ERROR", "reason");
  expectError(() => parseCustomerRefundBody({ ...valid, reason: "x".repeat(501) }), "VALIDATION_ERROR", "reason");
  assert.equal(parseCustomerRefundBody({ ...valid, reason: "  ok!  " }).reason, "ok!");
});

test("parse: reference and photo are kept for UPI / bank, ignored for cash", () => {
  const upi = parseCustomerRefundBody({ ...valid, method: "UPI", reference: " 123456789012 ", proofFileId: "abc123" });
  assert.equal(upi.reference, "123456789012");
  assert.equal(upi.proofFileId, "abc123");
  const bank = parseCustomerRefundBody({ ...valid, method: "BANK_TRANSFER", reference: "NEFT/HDFC-0001" });
  assert.equal(bank.reference, "NEFT/HDFC-0001");
  const cash = parseCustomerRefundBody({ ...valid, reference: "123", proofFileId: "abc" });
  assert.equal(cash.reference, null);
  assert.equal(cash.proofFileId, null);
  // Optional: blank is none
  assert.equal(parseCustomerRefundBody({ ...valid, method: "UPI", reference: "  " }).reference, null);
  expectError(
    () => parseCustomerRefundBody({ ...valid, method: "UPI", reference: "x".repeat(65) }),
    "VALIDATION_ERROR",
    "reference",
  );
  expectError(() => parseCustomerRefundBody({ ...valid, method: "UPI", reference: "<script>" }), "VALIDATION_ERROR", "reference");
  expectError(() => parseCustomerRefundBody({ ...valid, method: "UPI", proofFileId: 12 }), "VALIDATION_ERROR", "proofFileId");
});

test("parse: confirmation tick only when exactly true; requestId format", () => {
  assert.equal(parseCustomerRefundBody({ ...valid, confirmOverReceived: true }).confirmOverReceived, true);
  assert.equal(parseCustomerRefundBody({ ...valid, confirmOverReceived: "true" }).confirmOverReceived, false);
  assert.equal(parseCustomerRefundBody({ ...valid, requestId: "abcDEF12_-" }).requestId, "abcDEF12_-");
  expectError(() => parseCustomerRefundBody({ ...valid, requestId: "short" }), "VALIDATION_ERROR", "requestId");
  expectError(() => parseCustomerRefundBody({ ...valid, requestId: "has space!" }), "VALIDATION_ERROR", "requestId");
});

// ── More than received: a warning that needs the tick ─────────────────────────

test("over received: within the net money received needs no tick", () => {
  assert.equal(overReceivedRefusal(d(500), d(500), false), null);
  assert.equal(overReceivedBy(d(500), d(800)).toFixed(2), "0.00");
});

test("over received: beyond it is refused without the tick and allowed with it", () => {
  const refusal = overReceivedRefusal(d(1200), d(1000), false);
  assert.ok(refusal);
  assert.equal(refusal!.code, "CONFIRM_OVER_RECEIVED");
  assert.equal(refusal!.status, 409);
  assert.equal(refusal!.extra.overBy, "200.00");
  assert.equal(refusal!.extra.netReceived, "1000.00");
  assert.equal(overReceivedRefusal(d(1200), d(1000), true), null);
});

test("over received: nothing (or less than nothing) received counts as ₹0", () => {
  assert.equal(overReceivedBy(d(300), d(0)).toFixed(2), "300.00");
  assert.equal(overReceivedBy(d(300), d(-150)).toFixed(2), "300.00");
  const refusal = overReceivedRefusal(d(300), d(-150), false);
  assert.ok(refusal);
  assert.match(refusal!.message, /Nothing received/);
});

test("net received = confirmed money in − refunds paid out", () => {
  assert.equal(netReceived(d(5000), d(1200)).toFixed(2), "3800.00");
  assert.equal(netReceived(d(1000), d(1500)).toFixed(2), "-500.00");
});

// ── Ledger effect: owed back first, goodwill beyond it ───────────────────────

test("split: refund within what is owed back is a plain refund", () => {
  const s = splitCustomerRefund(d(300), d(500));
  assert.equal(s.covered.toFixed(2), "300.00");
  assert.equal(s.goodwill.toFixed(2), "0.00");
});

test("split: beyond what is owed back is goodwill", () => {
  const s = splitCustomerRefund(d(800), d(500));
  assert.equal(s.covered.toFixed(2), "500.00");
  assert.equal(s.goodwill.toFixed(2), "300.00");
  const none = splitCustomerRefund(d(800), d(0));
  assert.equal(none.covered.toFixed(2), "0.00");
  assert.equal(none.goodwill.toFixed(2), "800.00");
});

test("owed back = what the booking was paid beyond what it owes", () => {
  assert.equal(owedBack(d(-500)).toFixed(2), "500.00");
  assert.equal(owedBack(d(0)).toFixed(2), "0.00");
  assert.equal(owedBack(d(1200)).toFixed(2), "0.00");
});

test("balance: a settled booking stays settled after a goodwill refund (no new balance due)", () => {
  // Completed and fully paid (netPayable 0): ₹700 back as goodwill
  assert.equal(netPayableAfterRefund(d(0), d(700)).toFixed(2), "0.00");
});

test("balance: an over-payment refunded clears it, and the rest is goodwill", () => {
  // Paid ₹500 more than owed (netPayable −500)
  assert.equal(netPayableAfterRefund(d(-500), d(300)).toFixed(2), "-200.00");
  assert.equal(netPayableAfterRefund(d(-500), d(500)).toFixed(2), "0.00");
  assert.equal(netPayableAfterRefund(d(-500), d(900)).toFixed(2), "0.00");
});

test("balance: an upcoming rent's balance due doesn't grow", () => {
  // ₹4000 still due at pickup; refunding ₹1000 of the advance leaves ₹4000 due
  assert.equal(netPayableAfterRefund(d(4000), d(1000)).toFixed(2), "4000.00");
});

test("money totals: the refund row counts once as money paid back, never as money in", () => {
  const txns = [
    { purpose: "ADVANCE", status: "CONFIRMED", totalAmount: "1000.00" },
    { purpose: "REMAINING_BALANCE", status: "CONFIRMED", totalAmount: "4000.00" },
    // "Refund to customer" row (OVERPAYMENT_REFUND, key ctr:)
    { purpose: "OVERPAYMENT_REFUND", status: "CONFIRMED", totalAmount: "700.00" },
  ];
  const m = summarizeBookingMoney(txns);
  assert.equal(m.confirmed.toFixed(2), "5000.00");
  assert.equal(m.refundedOut.toFixed(2), "700.00");
  assert.equal(m.netConfirmed.toFixed(2), "4300.00");
  assert.equal(netReceived(m.confirmed, m.refundedOut).toFixed(2), "4300.00");
});

// ── Recording ────────────────────────────────────────────────────────────────

test("record: cash is CASH; UPI and bank transfer are ONLINE with their gateway", () => {
  assert.deepEqual(customerRefundRecord("CASH"), { method: "CASH", onlineGateway: null });
  assert.deepEqual(customerRefundRecord("UPI"), { method: "ONLINE", onlineGateway: "UPI" });
  assert.deepEqual(customerRefundRecord("BANK_TRANSFER"), { method: "ONLINE", onlineGateway: "BANK_TRANSFER" });
});

test("record: idempotency key per booking and submission, recognised as a customer refund", () => {
  const key = customerRefundKey("BK123", "req-abc-123");
  assert.equal(key, `${CUSTOMER_REFUND_KEY_PREFIX}BK123:req-abc-123`);
  assert.equal(isCustomerRefundKey(key), true);
  assert.equal(isCustomerRefundKey("ovr:BK123:x"), false);
  assert.equal(isCustomerRefundKey("sdr:BK123:x"), false);
  assert.equal(isCustomerRefundKey(null), false);
});

test("record: note names the method, flags cash outside a shift, keeps the reason", () => {
  assert.equal(
    customerRefundNote({ method: "CASH", reason: "Goodwill" }, false),
    "Refund to customer (Cash): Goodwill",
  );
  assert.equal(
    customerRefundNote({ method: "CASH", reason: "Goodwill" }, true),
    "Refund to customer (Cash, no cash shift open): Goodwill",
  );
  assert.equal(customerRefundNote({ method: "UPI", reason: "x" }, false), "Refund to customer (UPI transfer): x");
});

// ── Cash shift ───────────────────────────────────────────────────────────────

test("shift: cash goes on the actor's open shift", () => {
  assert.deepEqual(cashShiftLink("CASH", { id: 7, publicId: "SH7" }), {
    cashShiftId: 7,
    cashShiftPublicId: "SH7",
    cashOutsideShift: false,
  });
});

test("shift: cash with no shift open is still recorded, outside a shift", () => {
  assert.deepEqual(cashShiftLink("CASH", null), { cashShiftId: null, cashShiftPublicId: null, cashOutsideShift: true });
});

test("shift: UPI / bank transfer never touch a shift", () => {
  assert.deepEqual(cashShiftLink("UPI", { id: 7, publicId: "SH7" }), {
    cashShiftId: null,
    cashShiftPublicId: null,
    cashOutsideShift: false,
  });
  assert.equal(cashShiftLink("BANK_TRANSFER", null).cashOutsideShift, false);
});

test("shift: a cash refund row with no shift reads as outside a shift", () => {
  assert.equal(isCashRefundOutsideShift({ purpose: "OVERPAYMENT_REFUND", cashAmount: "500.00", cashShiftId: null }), true);
  assert.equal(isCashRefundOutsideShift({ purpose: "OVERPAYMENT_REFUND", cashAmount: "500.00", cashShiftId: 3 }), false);
  assert.equal(isCashRefundOutsideShift({ purpose: "OVERPAYMENT_REFUND", cashAmount: "0.00", cashShiftId: null }), false);
  // Money in is never a "refund outside a shift"
  assert.equal(isCashRefundOutsideShift({ purpose: "ADVANCE", cashAmount: "500.00", cashShiftId: null }), false);
});

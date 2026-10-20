/**
 * Pure checks of voiding a payment (Oct 2026): what can be voided, the request
 * body, the paired RefundRequest of a voided refund, the closed-shift flag, the
 * period report's voids section, and that a VOIDED row drops out of the money
 * totals (booking money, cash refunded outside a shift). No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import {
  ONLINE_PAYMENT_VOID_MESSAGE,
  PaymentVoidError,
  isOnlineGatewayPayment,
  pairedRefundRequest,
  parsePaymentVoidBody,
  summarizeVoids,
  voidEffectNote,
  voidEligibility,
  voidRefusal,
  voidShiftClosed,
  voidView,
} from "./payment-void-rules.js";
import { summarizeBookingMoney } from "./booking-owed.service.js";
import { isCashRefundOutsideShift } from "../booking/customer-refund-rules.js";

const row = (over: Partial<Parameters<typeof voidEligibility>[0]> = {}) => ({
  status: "CONFIRMED",
  purpose: "REMAINING_BALANCE",
  method: "CASH",
  totalAmount: "1500.00",
  onlineAmount: "0.00",
  onlineGateway: null as string | null,
  idempotencyKey: "pt:abc" as string | null,
  notes: null as string | null,
  ...over,
});

test("confirmed manual entries can be voided: cash, counter UPI, bank transfer, split, refunds", () => {
  assert.deepEqual(voidEligibility(row()), { voidable: true });
  assert.equal(voidEligibility(row({ method: "ONLINE", onlineAmount: "1500.00", cashAmount: "0", onlineGateway: "UPI" } as any)).voidable, true);
  assert.equal(voidEligibility(row({ method: "ONLINE", onlineAmount: "1500.00", onlineGateway: "BANK_TRANSFER" })).voidable, true);
  assert.equal(voidEligibility(row({ method: "SPLIT", onlineAmount: "500.00", onlineGateway: "UPI" })).voidable, true);
  // a counter online payment with only a typed ref (no gateway)
  assert.equal(voidEligibility(row({ method: "ONLINE", onlineAmount: "1500.00", onlineGateway: null })).voidable, true);
  // "Refund to customer", manual cancel refund, deposit refund, extension, deposit, credit clearance
  assert.equal(voidEligibility(row({ purpose: "OVERPAYMENT_REFUND", idempotencyKey: "ctr:BK1:req12345" })).voidable, true);
  assert.equal(voidEligibility(row({ purpose: "CANCELLATION_REFUND", idempotencyKey: "mcr:BK1" })).voidable, true);
  assert.equal(voidEligibility(row({ purpose: "OVERPAYMENT_REFUND", idempotencyKey: "sdr:BK1:x" })).voidable, true);
  assert.equal(voidEligibility(row({ purpose: "EXTENSION", idempotencyKey: "ext:collect:9" })).voidable, true);
  assert.equal(voidEligibility(row({ purpose: "SAFETY_DEPOSIT", idempotencyKey: "pt:k:deposit" })).voidable, true);
  assert.equal(voidEligibility(row({ method: "ONLINE", onlineAmount: "1500.00", onlineGateway: "MANUAL_MANAGER_OVERRIDE" })).voidable, true);
});

test("online gateway payments are refused with the Refund message", () => {
  const cases = [
    row({ method: "ONLINE", onlineAmount: "1500.00", onlineGateway: "RAZORPAY", idempotencyKey: "initial:order_1" }),
    row({ method: "ONLINE", onlineAmount: "1500.00", onlineGateway: "razorpay" }),
    row({ method: "ONLINE", onlineAmount: "1500.00", onlineGateway: "PHONEPE" }),
    row({ method: "ONLINE", onlineAmount: "1500.00", onlineGateway: null, notes: "razorpay_payment_id=pay_123" }),
    row({ method: "ONLINE", onlineAmount: "1500.00", onlineGateway: null, idempotencyKey: "recheck:gateway:order_1" }),
    row({ method: "ONLINE", onlineAmount: "800.00", onlineGateway: null, idempotencyKey: "ext:razorpay:order_2" }),
    row({ method: "ONLINE", onlineAmount: "800.00", onlineGateway: null, idempotencyKey: "remaining:razorpay:BK1" }),
    // the BM damage settlement's Razorpay row (no gateway name, confirmed by the status check)
    row({ purpose: "DAMAGE_FEE", method: "ONLINE", onlineAmount: "900.00", onlineGateway: null, idempotencyKey: "damage-online:DR1" }),
    // a manual-cancel refund sent back through Razorpay
    row({ purpose: "CANCELLATION_REFUND", method: "ONLINE", onlineAmount: "500.00", onlineGateway: "RAZORPAY" }),
  ];
  for (const c of cases) {
    const e = voidEligibility(c);
    assert.equal(e.voidable, false, JSON.stringify(c));
    if (!e.voidable) {
      assert.equal(e.code, "ONLINE_PAYMENT");
      assert.equal(e.message, ONLINE_PAYMENT_VOID_MESSAGE);
    }
  }
  assert.equal(ONLINE_PAYMENT_VOID_MESSAGE, "Online payments can't be voided — use Refund");
  // the gateway markers don't matter on a row with no online part
  assert.equal(isOnlineGatewayPayment(row({ notes: "razorpay_payment_id=pay_1" })), false);
});

test("already voided → ALREADY_VOIDED (409); not confirmed → NOT_VOIDABLE", () => {
  const v = voidRefusal(row({ status: "VOIDED" }));
  assert.ok(v instanceof PaymentVoidError);
  assert.equal(v!.status, 409);
  assert.equal(v!.code, "ALREADY_VOIDED");
  // already voided wins over every other reason
  assert.equal(voidRefusal(row({ status: "VOIDED", onlineGateway: "RAZORPAY", onlineAmount: "5" }))!.code, "ALREADY_VOIDED");
  for (const status of ["COLLECTED", "INITIATED", "FAILED", "REJECTED", "REFUNDED"]) {
    const e = voidEligibility(row({ status }));
    assert.equal(e.voidable, false);
    if (!e.voidable) assert.equal(e.code, "NOT_VOIDABLE");
  }
  const collected = voidEligibility(row({ status: "COLLECTED" }));
  assert.ok(!collected.voidable && /reject it instead/.test(collected.message));
  assert.equal(voidEligibility(row({ totalAmount: "0.00" })).voidable, false);
  assert.equal(voidRefusal(row()), null);
});

test("void body: a reason of 3–500 characters, trimmed", () => {
  assert.deepEqual(parsePaymentVoidBody({ reason: "  Entered twice  " }), { reason: "Entered twice" });
  for (const bad of [undefined, null, {}, { reason: 5 }, { reason: "  " }, { reason: "ab" }, { reason: "x".repeat(501) }]) {
    assert.throws(() => parsePaymentVoidBody(bad), (e: any) => e instanceof PaymentVoidError && e.status === 400 && e.code === "VALIDATION_ERROR");
  }
});

test("closed-shift flag: cash in a shift that is no longer open", () => {
  assert.equal(voidShiftClosed({ cashAmount: "500" }, { status: "CLOSED" }), true);
  assert.equal(voidShiftClosed({ cashAmount: "500" }, { status: "DISCREPANCY_FLAGGED" }), true);
  assert.equal(voidShiftClosed({ cashAmount: "500" }, { status: "OPEN" }), false);
  assert.equal(voidShiftClosed({ cashAmount: "500" }, null), false);
  assert.equal(voidShiftClosed({ cashAmount: "0" }, { status: "CLOSED" }), false);
});

test("a voided refund takes its paired RefundRequest (same amount, same moment, reason = notes first)", () => {
  const at = new Date("2026-10-20T10:00:00Z");
  const refund = { totalAmount: "700.00", notes: "Refund to customer (Cash): wrong", createdAt: at };
  const reqs = [
    { id: 1, amount: "700.00", status: "COMPLETED", reason: "other", createdAt: new Date(at.getTime() + 1) },
    { id: 2, amount: "700.00", status: "COMPLETED", reason: "Refund to customer (Cash): wrong", createdAt: new Date(at.getTime() + 5) },
    { id: 3, amount: "700.00", status: "VOIDED", reason: "Refund to customer (Cash): wrong", createdAt: at },
    { id: 4, amount: "701.00", status: "COMPLETED", reason: "Refund to customer (Cash): wrong", createdAt: at },
    { id: 5, amount: "700.00", status: "COMPLETED", reason: "Refund to customer (Cash): wrong", createdAt: new Date(at.getTime() + 60_000) },
  ];
  assert.equal(pairedRefundRequest(refund, reqs)?.id, 2);
  // no reason match → closest in time
  assert.equal(pairedRefundRequest({ ...refund, notes: null }, reqs)?.id, 1);
  assert.equal(pairedRefundRequest(refund, reqs.filter((r) => r.id >= 3)), null);
});

test("voids summary for the period report", () => {
  const s = summarizeVoids([
    { purpose: "REMAINING_BALANCE", totalAmount: "1000.00", cashAmount: "1000.00", voidShiftClosed: false },
    { purpose: "EXTENSION", totalAmount: "250.50", cashAmount: "0.00", voidShiftClosed: false },
    { purpose: "OVERPAYMENT_REFUND", totalAmount: "300.00", cashAmount: "300.00", voidShiftClosed: true },
    { purpose: "SAFETY_DEPOSIT", totalAmount: "2000.00", cashAmount: "2000.00", voidShiftClosed: true },
  ]);
  assert.deepEqual(s, {
    count: 4,
    payments: { count: 3, amount: 3250.5 },
    refunds: { count: 1, amount: 300 },
    shiftClosed: { count: 2, cashAmount: 2300 },
  });
  assert.deepEqual(summarizeVoids([]).payments, { count: 0, amount: 0 });
});

test("a VOIDED row is excluded from the booking money totals", () => {
  const base = [
    { purpose: "FULL_PAYMENT", status: "CONFIRMED", totalAmount: "3000.00" },
    { purpose: "REMAINING_BALANCE", status: "COLLECTED", totalAmount: "400.00" },
    { purpose: "OVERPAYMENT_REFUND", status: "CONFIRMED", totalAmount: "200.00" },
  ];
  const before = summarizeBookingMoney(base);
  const after = summarizeBookingMoney([
    ...base,
    { purpose: "REMAINING_BALANCE", status: "VOIDED", totalAmount: "999.00" },
    { purpose: "OVERPAYMENT_REFUND", status: "VOIDED", totalAmount: "555.00" },
  ]);
  assert.ok(after.confirmed.eq(before.confirmed));
  assert.ok(after.pending.eq(before.pending));
  assert.ok(after.refundedOut.eq(before.refundedOut));
  assert.ok(after.netConfirmed.eq(new Decimal("2800")));
  // voiding the confirmed payment itself → it owes that amount again
  const voided = summarizeBookingMoney(base.map((t) => (t.purpose === "FULL_PAYMENT" ? { ...t, status: "VOIDED" } : t)));
  assert.ok(voided.netConfirmed.eq(new Decimal("-200")));
  // voiding the refund → the customer is owed it again (net paid rises)
  const refundVoided = summarizeBookingMoney(base.map((t) => (t.purpose === "OVERPAYMENT_REFUND" ? { ...t, status: "VOIDED" } : t)));
  assert.ok(refundVoided.netConfirmed.eq(new Decimal("3000")));
});

test("a voided cash refund is no longer 'outside a shift'", () => {
  const t = { purpose: "OVERPAYMENT_REFUND", cashAmount: "300.00", cashShiftId: null };
  assert.equal(isCashRefundOutsideShift(t), true);
  assert.equal(isCashRefundOutsideShift({ ...t, status: "CONFIRMED" }), true);
  assert.equal(isCashRefundOutsideShift({ ...t, status: "VOIDED" }), false);
});

test("effect note and view", () => {
  assert.match(voidEffectNote({ purpose: "REMAINING_BALANCE", totalAmount: "1500" }), /owes ₹1500\.00 again/);
  assert.match(voidEffectNote({ purpose: "OVERPAYMENT_REFUND", totalAmount: "500", goodwillAmount: "200" }), /₹300\.00 is owed to the customer again and the ₹200\.00 goodwill is undone/);
  const v = voidView({ ...row({ status: "VOIDED" }), voidedAt: new Date("2026-10-20T10:00:00Z"), voidReason: "dup", voidShiftClosed: true, voidedBy: { name: "BM" } });
  assert.deepEqual(v, {
    voided: true, voidedAt: "2026-10-20T10:00:00.000Z", voidedBy: "BM", voidReason: "dup", voidShiftClosed: true, voidable: false, voidBlockedReason: null,
  });
  const online = voidView({ ...row({ method: "ONLINE", onlineAmount: "10", onlineGateway: "RAZORPAY" }), voidedAt: null, voidReason: null, voidShiftClosed: false });
  assert.equal(online.voidable, false);
  assert.equal(online.voidBlockedReason, ONLINE_PAYMENT_VOID_MESSAGE);
});

/**
 * Pure checks of the Admin Reports finance rules (2.1–2.5). No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { agingBucket, dueOf, istAgeDays, modeSplitOf, revenueOf } from "./booking-finance.js";
import { sumRevenue } from "./revenue.js";
import { summariseCollections, type CollectionRow } from "./collections.js";
import { depositSplitOf } from "./deposits.js";
import { bookingTimeLayers, refundKindOf, sumRefunds, type RefundRow } from "./discounts-refunds.js";
import { assembleBookingOwed } from "../../payment/booking-owed.service.js";

const d = (n: number) => new Decimal(n);

test("revenue = totalFinal − category deposit + drop extras − goodwill", () => {
  const r = revenueOf({ status: "RETURNED", totalFinal: 5000, totalDeposit: 1000 }, { returnCharges: d(700), refundsGoodwill: d(200) }, 610);
  assert.deepEqual(r, { rent: 4000, extras: 700, deposit: 1000, goodwill: 200, revenue: 4500, bookingValue: 5000, gst: 610 });
});

test("cancelled / hold bookings carry no revenue but keep their booking value", () => {
  const r = revenueOf({ status: "CANCELLED", totalFinal: 3000, totalDeposit: 0 }, { returnCharges: d(0), refundsGoodwill: d(0) });
  assert.equal(r.revenue, 0);
  assert.equal(r.bookingValue, 3000);
});

test("sumRevenue adds up and reconciles with booking value", () => {
  const rows = [
    revenueOf({ status: "CONFIRMED", totalFinal: 1000, totalDeposit: 0 }, null),
    revenueOf({ status: "RETURNED", totalFinal: 2000.5, totalDeposit: 500 }, { returnCharges: d(300.25), refundsGoodwill: d(0) }),
  ];
  const t = sumRevenue(rows);
  assert.equal(t.total, 2800.75);
  assert.equal(t.bookingValue, 3000.5);
  assert.equal(t.bookingValue - t.deposit + t.extras - t.goodwill, t.total);
  assert.equal(t.bookings, 2);
  assert.equal(t.averagePerBooking, 1400.38);
});

test("aging buckets: 0–7, 8–30, 31+", () => {
  assert.equal(agingBucket(0), "0-7");
  assert.equal(agingBucket(7), "0-7");
  assert.equal(agingBucket(8), "8-30");
  assert.equal(agingBucket(30), "8-30");
  assert.equal(agingBucket(31), "31+");
});

test("age counts IST calendar days", () => {
  // 23:30 IST on the 1st → 00:30 IST on the 2nd is one day
  assert.equal(istAgeDays(new Date("2026-10-01T18:00:00Z"), new Date("2026-10-01T19:00:00Z")), 1);
  assert.equal(istAgeDays(new Date("2026-10-01T05:00:00Z"), new Date("2026-10-01T15:00:00Z")), 0);
  assert.equal(istAgeDays(new Date("2026-10-10T05:00:00Z"), new Date("2026-10-01T05:00:00Z")), 0);
});

const now = new Date("2026-10-31T06:30:00Z");
const day = (s: string) => new Date(`${s}T06:30:00Z`);

test("due = max(0, owed − net confirmed); pending cash not yet paid", () => {
  const r = dueOf(
    { status: "PICKED_UP", startAt: day("2026-10-21"), endAt: day("2026-11-02"), returnedAt: null },
    { totalOwed: d(5000), returnCharges: d(0) },
    { netConfirmed: 3000, pending: 500 },
    now,
  );
  assert.equal(r.due, 2000);
  assert.equal(r.pendingConfirmation, 500);
  assert.equal(r.counted, true);
  assert.equal(r.dueFromBasis, "PICKUP");
  assert.equal(r.ageDays, 10);
  assert.equal(r.bucket, "8-30");
});

test("returned with only drop charges unpaid ages from the return", () => {
  const r = dueOf(
    { status: "RETURNED", startAt: day("2026-09-01"), endAt: day("2026-10-27"), returnedAt: day("2026-10-28") },
    { totalOwed: d(5800), returnCharges: d(800) },
    { netConfirmed: 5200, pending: 0 },
    now,
  );
  assert.equal(r.due, 600);
  assert.equal(r.dueFromBasis, "RETURN");
  assert.equal(r.ageDays, 3);
  assert.equal(r.bucket, "0-7");
});

test("returned with rent unpaid ages from the pickup", () => {
  const r = dueOf(
    { status: "RETURNED", startAt: day("2026-09-01"), endAt: day("2026-09-03"), returnedAt: null },
    { totalOwed: d(5800), returnCharges: d(800) },
    { netConfirmed: 1000, pending: 0 },
    now,
  );
  assert.equal(r.dueFromBasis, "PICKUP");
  assert.equal(r.bucket, "31+");
});

test("future confirmed booking is not yet due; cancelled never due; overpaid is 0", () => {
  const future = dueOf({ status: "CONFIRMED", startAt: day("2026-11-05"), endAt: day("2026-11-06"), returnedAt: null }, { totalOwed: d(2000), returnCharges: d(0) }, { netConfirmed: 500, pending: 0 }, now);
  assert.equal(future.counted, false);
  assert.equal(future.notYetDue, true);
  const cancelled = dueOf({ status: "CANCELLED", startAt: day("2026-10-01"), endAt: day("2026-10-02"), returnedAt: null }, { totalOwed: d(2000), returnCharges: d(0) }, { netConfirmed: 0, pending: 0 }, now);
  assert.equal(cancelled.counted, false);
  const over = dueOf({ status: "RETURNED", startAt: day("2026-10-01"), endAt: day("2026-10-02"), returnedAt: null }, { totalOwed: d(2000), returnCharges: d(0) }, { netConfirmed: 2500, pending: 0 }, now);
  assert.equal(over.due, 0);
  assert.equal(over.counted, false);
});

test("mode split: cash / UPI / bank transfer / gateway", () => {
  assert.deepEqual(modeSplitOf({ method: "SPLIT", totalAmount: 1000, cashAmount: 400, onlineAmount: 600, onlineGateway: "UPI" }), { CASH: 400, UPI: 600, BANK_TRANSFER: 0, GATEWAY: 0 });
  assert.deepEqual(modeSplitOf({ method: "ONLINE", totalAmount: 900, cashAmount: 0, onlineAmount: 900, onlineGateway: "RAZORPAY" }), { CASH: 0, UPI: 0, BANK_TRANSFER: 0, GATEWAY: 900 });
  assert.deepEqual(modeSplitOf({ method: "ONLINE", totalAmount: 300, cashAmount: 0, onlineAmount: 300, onlineGateway: "BANK_TRANSFER" }), { CASH: 0, UPI: 0, BANK_TRANSFER: 300, GATEWAY: 0 });
  // legacy rows with both parts 0 take the method's side
  assert.deepEqual(modeSplitOf({ method: "CASH", totalAmount: 250, cashAmount: 0, onlineAmount: 0, onlineGateway: null }), { CASH: 250, UPI: 0, BANK_TRANSFER: 0, GATEWAY: 0 });
  assert.deepEqual(modeSplitOf({ method: "ONLINE", totalAmount: 250, cashAmount: 0, onlineAmount: 0, onlineGateway: null }), { CASH: 0, UPI: 250, BANK_TRANSFER: 0, GATEWAY: 0 });
});

const crow = (o: Partial<CollectionRow>): CollectionRow => ({
  publicId: "x",
  paidAt: now,
  bookingPublicId: "b",
  customerName: "c",
  branchName: "br",
  purpose: "ADVANCE",
  purposeLabel: "Advance",
  direction: "IN",
  status: "CONFIRMED",
  counted: true,
  amount: 0,
  modes: { CASH: 0, UPI: 0, BANK_TRANSFER: 0, GATEWAY: 0 },
  modeLabel: "",
  onlineGateway: null,
  reference: null,
  collectedBy: "s",
  confirmedBy: null,
  confirmedAt: null,
  shift: null,
  voidReason: null,
  rejectionReason: null,
  notes: null,
  ...o,
});

test("collections: counted rows only; deposits apart; refunds net off", () => {
  const t = summariseCollections([
    crow({ amount: 1000, modes: { CASH: 1000, UPI: 0, BANK_TRANSFER: 0, GATEWAY: 0 } }),
    crow({ amount: 500, status: "COLLECTED", modes: { CASH: 500, UPI: 0, BANK_TRANSFER: 0, GATEWAY: 0 } }),
    crow({ amount: 2000, purpose: "SAFETY_DEPOSIT", modes: { CASH: 0, UPI: 2000, BANK_TRANSFER: 0, GATEWAY: 0 } }),
    crow({ amount: 700, status: "VOIDED", counted: false, modes: { CASH: 700, UPI: 0, BANK_TRANSFER: 0, GATEWAY: 0 } }),
    crow({ amount: 300, direction: "OUT", purpose: "OVERPAYMENT_REFUND", modes: { CASH: 300, UPI: 0, BANK_TRANSFER: 0, GATEWAY: 0 } }),
  ]);
  assert.equal(t.collected, 3500);
  assert.equal(t.confirmed, 3000);
  assert.equal(t.awaitingConfirmation, 500);
  assert.equal(t.securityDeposits, 2000);
  assert.equal(t.rentalCollections, 1500);
  assert.equal(t.refundsPaidOut, 300);
  assert.equal(t.net, 3200);
  assert.equal(t.transactions, 3);
  assert.deepEqual(t.modes, { CASH: 1500, UPI: 2000, BANK_TRANSFER: 0, GATEWAY: 0 });
  assert.equal(t.modes.CASH + t.modes.UPI + t.modes.BANK_TRANSFER + t.modes.GATEWAY, t.collected);
});

const owedBase = {
  safetyDepositCharged: d(0),
  safetyDepositHeld: d(0),
  safetyDepositHandling: null,
  legacyDepositSetOff: d(0),
  legacyDepositRefunded: d(0),
  returnCharges: d(0),
};

test("deposit: drop bill set-off and refund reconcile to taken", () => {
  const s = depositSplitOf({ ...owedBase, safetyDepositCharged: d(3000), returnCharges: d(800) }, { setOff: 800, refund: 2200, handling: "SET_OFF" });
  assert.deepEqual(s, { taken: 3000, deducted: 800, refunded: 2200, held: 0, unreconciled: 0, flow: "DROP_BILL", handling: "SET_OFF" });
});

test("deposit: still held before the drop; legacy set-off capped at charges", () => {
  const held = depositSplitOf({ ...owedBase, safetyDepositCharged: d(2000), safetyDepositHeld: d(2000) }, null);
  assert.equal(held.held, 2000);
  assert.equal(held.unreconciled, 0);
  assert.equal(held.flow, "NOT_RETURNED");
  const legacy = depositSplitOf(
    { ...owedBase, safetyDepositCharged: d(2000), safetyDepositHandling: "SET_OFF", legacyDepositSetOff: d(2000), legacyDepositRefunded: d(1500), returnCharges: d(500) },
    null,
  );
  assert.equal(legacy.deducted, 500);
  assert.equal(legacy.refunded, 1500);
  assert.equal(legacy.unreconciled, 0);
});

test("booking-time discount layers; unexplained remainder shown, not spread", () => {
  assert.deepEqual(bookingTimeLayers(0, null), []);
  assert.deepEqual(bookingTimeLayers(250, null), [{ source: "BOOKING_UNSPECIFIED", amount: 250 }]);
  assert.deepEqual(bookingTimeLayers(300, { duration: 100, coupon: 200, manual: 0 }), [
    { source: "DURATION", amount: 100 },
    { source: "COUPON", amount: 200 },
  ]);
  assert.deepEqual(bookingTimeLayers(350, { duration: 100, coupon: 200, manual: 0 }).at(-1), { source: "BOOKING_UNSPECIFIED", amount: 50 });
});

test("refund kind from the key prefix", () => {
  assert.equal(refundKindOf("ctr:B1:x", "OVERPAYMENT_REFUND"), "CUSTOMER_REFUND");
  assert.equal(refundKindOf("mcr:B1", "CANCELLATION_REFUND"), "MANUAL_CANCEL");
  assert.equal(refundKindOf("sdr:B1:x", "OVERPAYMENT_REFUND"), "DEPOSIT_LEGACY");
  assert.equal(refundKindOf("ovr:B1:x", "OVERPAYMENT_REFUND"), "DROP_OVERPAYMENT");
  assert.equal(refundKindOf("pt:abc", "OVERPAYMENT_REFUND"), "SESSION");
  assert.equal(refundKindOf("other", "CANCELLATION_REFUND"), "CANCELLATION");
});

test("refund totals exclude voided rows", () => {
  const base = { publicId: "r", paidAt: now, bookingPublicId: "b", bookingStatus: "CANCELLED", customerName: "c", branchName: "br", kindLabel: "", mode: "Cash", reference: null, proof: false, paidBy: "s", reason: null, voidReason: null, goodwill: 0 };
  const t = sumRefunds([
    { ...base, purpose: "CANCELLATION_REFUND", kind: "MANUAL_CANCEL", status: "CONFIRMED", counted: true, amount: 1000 },
    { ...base, purpose: "OVERPAYMENT_REFUND", kind: "CUSTOMER_REFUND", status: "CONFIRMED", counted: true, amount: 400, goodwill: 150 },
    { ...base, purpose: "OVERPAYMENT_REFUND", kind: "CUSTOMER_REFUND", status: "VOIDED", counted: false, amount: 999 },
  ] as RefundRow[]);
  assert.equal(t.paidOut, 1400);
  assert.equal(t.cancellation, 1000);
  assert.equal(t.goodwill, 150);
  assert.equal(t.voided, 999);
  assert.equal(t.count, 2);
});

test("assembleBookingOwed (batched path) matches the documented formula", () => {
  const o = assembleBookingOwed({
    totalFinal: "5000.004",
    pricingSnapshot: {},
    entries: [
      { entryType: "DEPOSIT", classification: "NON_TAXABLE", amount: 2000, gstAmount: 0, referenceType: null, referenceId: null, session: { sessionType: "PICKUP", status: "COMPLETED" } },
      { entryType: "EXTRA_KM", classification: "NON_TAXABLE", amount: 600, gstAmount: 0, referenceType: null, referenceId: null, session: { sessionType: "RETURN", status: "COMPLETED" } },
      { entryType: "DEPOSIT", classification: "PAYMENT", amount: -2000, gstAmount: 0, referenceType: null, referenceId: null, session: { sessionType: "RETURN", status: "COMPLETED" } },
    ],
    legacyReturnCharges: d(0),
    dropDamages: [{ publicId: "dm1", finalCost: null, estimatedCost: 400 }],
    standaloneDeposits: [],
    legacyDepositRefunds: [],
    goodwill: 100,
  });
  assert.equal(o.totalFinal.toFixed(2), "5000.00");
  assert.equal(o.returnCharges.toFixed(2), "1000.00");
  assert.equal(o.safetyDepositHeld.toFixed(2), "0.00");
  assert.equal(o.totalOwed.toFixed(2), "5900.00");
});

/**
 * Pure checks of the booking / customer / staff report definitions
 * (Admin Reports 3.1–3.5, 7.1, 8.2). No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actualDurationHours,
  average,
  bookedDurationHours,
  bookingSourceOf,
  classifyCancellation,
  customerTypeOf,
  estimatedRevenueLost,
  isFailedCheckout,
  isMissedPickup,
  isNoShowReason,
  isOverdueNow,
  lateMinutes,
  leadBucket,
  leadTimeHours,
  median,
  pctOf,
  pickHandoverPerformer,
  statusBucket,
} from "./definitions.js";

const d = (iso: string) => new Date(iso);

test("status buckets map the spec statuses; holds are not bookings", () => {
  assert.equal(statusBucket("CONFIRMED"), "UPCOMING");
  assert.equal(statusBucket("PICKED_UP"), "ACTIVE");
  assert.equal(statusBucket("RETURNED"), "COMPLETED");
  assert.equal(statusBucket("CANCELLED"), "CANCELLED");
  assert.equal(statusBucket("HOLD"), null);
  assert.equal(statusBucket("HOLD_EXPIRED"), null);
});

test("a failed online checkout is not a cancellation", () => {
  assert.equal(isFailedCheckout({ status: "CANCELLED", paymentStatus: "FAILED", cancelledAt: null }), true);
  assert.equal(isFailedCheckout({ status: "CANCELLED", paymentStatus: "FAILED", cancelledAt: d("2026-10-01") }), false);
  assert.equal(isFailedCheckout({ status: "CANCELLED", paymentStatus: "SUCCESS", cancelledAt: null }), false);
});

test("no-show: audit row or a no-show reason; else manager / displaced / other", () => {
  const base = { cancellationSource: null, cancellationReason: null, displacedByExtensionId: null, noShowAudit: false };
  assert.equal(classifyCancellation({ ...base, noShowAudit: true }), "NO_SHOW");
  assert.equal(
    classifyCancellation({ ...base, cancellationReason: "Auto-cancelled: Customer no-show (24h grace period elapsed)" }),
    "NO_SHOW",
  );
  assert.equal(classifyCancellation({ ...base, cancellationReason: "No Show" }), "NO_SHOW");
  assert.equal(classifyCancellation({ ...base, cancellationSource: "MANUAL_BM", cancellationReason: "Customer changed plans" }), "MANUAL_BM");
  // a manager cancel whose reason says no-show is a no-show
  assert.equal(classifyCancellation({ ...base, cancellationSource: "MANUAL_BM", cancellationReason: "no-show" }), "NO_SHOW");
  assert.equal(classifyCancellation({ ...base, displacedByExtensionId: 4 }), "DISPLACED");
  assert.equal(classifyCancellation(base), "OTHER");
  assert.equal(isNoShowReason("Showroom closed"), false);
  assert.equal(isNoShowReason("noshow"), true);
});

test("missed pickup = CONFIRMED and 24 h past startAt", () => {
  const now = d("2026-10-10T12:00:00Z");
  assert.equal(isMissedPickup({ status: "CONFIRMED", startAt: d("2026-10-09T12:00:00Z") }, now), true);
  assert.equal(isMissedPickup({ status: "CONFIRMED", startAt: d("2026-10-09T12:00:01Z") }, now), false);
  assert.equal(isMissedPickup({ status: "PICKED_UP", startAt: d("2026-10-01T00:00:00Z") }, now), false);
});

test("revenue lost = booked rent − rent kept (kept capped at the rent, never negative)", () => {
  // 3000 total incl. 1000 deposit → rent 2000; 500 advance forfeited
  assert.deepEqual(estimatedRevenueLost({ totalFinal: 3000, totalDeposit: 1000, moneyIn: 500, refundedOut: 0 }), {
    bookedRent: 2000,
    moneyKept: 500,
    rentKept: 500,
    lost: 1500,
  });
  // fully refunded → all lost
  assert.equal(estimatedRevenueLost({ totalFinal: 2000, totalDeposit: 0, moneyIn: 2000, refundedOut: 2000 }).lost, 2000);
  // kept more than the rent (deposit not refunded) → nothing lost
  assert.equal(estimatedRevenueLost({ totalFinal: 3000, totalDeposit: 1000, moneyIn: 3000, refundedOut: 0 }).lost, 0);
  // over-refunded (goodwill) → kept floors at 0
  assert.equal(estimatedRevenueLost({ totalFinal: 1000, totalDeposit: 0, moneyIn: 500, refundedOut: 700 }).moneyKept, 0);
});

test("source: customer-created = app, anyone else = walk-in", () => {
  assert.equal(bookingSourceOf("CUSTOMER"), "APP");
  assert.equal(bookingSourceOf("STAFF"), "WALK_IN");
  assert.equal(bookingSourceOf("MANAGER"), "WALK_IN");
  assert.equal(bookingSourceOf("ADMIN"), "WALK_IN");
  assert.equal(bookingSourceOf(null), "WALK_IN");
});

test("lead time createdAt → startAt, floored at 0, bucketed", () => {
  assert.equal(leadTimeHours(d("2026-10-01T10:00:00Z"), d("2026-10-03T10:00:00Z")), 48);
  assert.equal(leadTimeHours(d("2026-10-01T10:00:05Z"), d("2026-10-01T10:00:00Z")), 0);
  assert.equal(leadBucket(0), "UNDER_1H");
  assert.equal(leadBucket(5), "SAME_DAY");
  assert.equal(leadBucket(24), "D1_3");
  assert.equal(leadBucket(72), "D1_3");
  assert.equal(leadBucket(100), "D4_7");
  assert.equal(leadBucket(720), "D8_30");
  assert.equal(leadBucket(721), "D30_PLUS");
});

test("duration: booked = start → end; actual only for completed with returnedAt", () => {
  assert.equal(bookedDurationHours(d("2026-10-01T10:00:00Z"), d("2026-10-02T22:00:00Z")), 36);
  assert.equal(
    actualDurationHours({ status: "RETURNED", startAt: d("2026-10-01T10:00:00Z"), returnedAt: d("2026-10-01T16:30:00Z") }),
    6.5,
  );
  assert.equal(actualDurationHours({ status: "RETURNED", startAt: d("2026-10-01T10:00:00Z"), returnedAt: null }), null);
  assert.equal(actualDurationHours({ status: "PICKED_UP", startAt: d("2026-10-01T10:00:00Z"), returnedAt: d("2026-10-02") }), null);
});

test("late return = returned after endAt; overdue = picked up past endAt", () => {
  const endAt = d("2026-10-02T10:00:00Z");
  assert.equal(lateMinutes({ status: "RETURNED", endAt, returnedAt: d("2026-10-02T12:30:00Z") }), 150);
  assert.equal(lateMinutes({ status: "RETURNED", endAt, returnedAt: d("2026-10-02T09:00:00Z") }), 0);
  assert.equal(lateMinutes({ status: "RETURNED", endAt, returnedAt: endAt }), 0);
  assert.equal(lateMinutes({ status: "PICKED_UP", endAt, returnedAt: null }), 0);
  assert.equal(isOverdueNow({ status: "PICKED_UP", endAt }, d("2026-10-02T10:01:00Z")), true);
  assert.equal(isOverdueNow({ status: "RETURNED", endAt }, d("2026-10-05")), false);
});

test("new vs repeat: first-ever booking inside the period = new", () => {
  const start = d("2026-10-01T00:00:00+05:30");
  assert.equal(customerTypeOf(d("2026-10-05"), start), "NEW");
  assert.equal(customerTypeOf(start, start), "NEW");
  assert.equal(customerTypeOf(d("2026-09-30T18:00:00Z"), start), "REPEAT");
  assert.equal(customerTypeOf(null, start), "NEW");
});

test("handover performer: bill > legacy entry > sent for approval > manager > reading", () => {
  const t1 = d("2026-10-01T10:00:00Z");
  const t2 = d("2026-10-01T11:00:00Z");
  assert.deepEqual(
    pickHandoverPerformer([
      { kind: "RECORDED", at: t2, userId: 9 },
      { kind: "MANAGER_CONFIRMED", at: t2, userId: 2 },
      { kind: "SENT_TO_MANAGER", at: t1, userId: 5 },
    ]),
    { userId: 5, at: t1 },
  );
  assert.equal(pickHandoverPerformer([{ kind: "SESSION", at: t1, userId: 7 }, { kind: "COMPLETED", at: t2, userId: 8 }]).userId, 7);
  assert.equal(pickHandoverPerformer([{ kind: "SESSION", at: t1, userId: null }, { kind: "RECORDED", at: t2, userId: 3 }]).userId, 3);
  assert.deepEqual(pickHandoverPerformer([]), { userId: null, at: null });
});

test("average / median / pct", () => {
  assert.equal(average([]), null);
  assert.equal(average([1, 2, 4]), 2.33);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(pctOf(1, 3), 33.33);
  assert.equal(pctOf(1, 0), null);
});

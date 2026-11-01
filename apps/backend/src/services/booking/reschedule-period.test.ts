/**
 * Pure rules of "Reschedule rental period" (client TODO 4): the time checks,
 * the price difference and where it lands on the booking's balance. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import {
  RESCHEDULE_PERIOD_PAST_SLACK_MINUTES,
  applyItemDelta,
  balanceAfterReprice,
  itemDelta,
  periodTimeProblem,
  remainingKeySuffix,
  snapshotAfterReprice,
  sumDeltas,
  type PricedWindow,
} from "./reschedule-period.js";

const H = 3600000;
const now = new Date("2026-11-01T06:30:00.000Z"); // 12:00 IST
const current = { startAt: new Date(now.getTime() + 24 * H), endAt: new Date(now.getTime() + 48 * H) };
const check = (startAt: Date, endAt: Date, extra: { monthly?: boolean; clampedHalfDay?: boolean } = {}) =>
  periodTimeProblem({ now, current, startAt, endAt, monthly: false, clampedHalfDay: false, ...extra })?.code ?? null;

test("client example: booked tomorrow→day after, moved to now→tomorrow evening is fine", () => {
  assert.equal(check(now, new Date(now.getTime() + 30 * H)), null);
});

test("start may be a few minutes before the request (late-pickup slack), not more", () => {
  const slack = RESCHEDULE_PERIOD_PAST_SLACK_MINUTES * 60000;
  assert.equal(check(new Date(now.getTime() - slack + 1000), new Date(now.getTime() + 24 * H)), null);
  assert.equal(check(new Date(now.getTime() - slack - 60000), new Date(now.getTime() + 24 * H)), "RESCHEDULE_IN_PAST");
});

test("end in the past, end ≤ start, too short and no change are refused", () => {
  assert.equal(check(new Date(now.getTime() - 10 * 60000), new Date(now.getTime() - 9 * 60000)), "RESCHEDULE_IN_PAST");
  assert.equal(check(new Date(now.getTime() + 2 * H), new Date(now.getTime() - H)), "RESCHEDULE_END_IN_PAST");
  assert.equal(check(new Date(now.getTime() + 2 * H), new Date(now.getTime() + 2 * H)), "RESCHEDULE_END_NOT_AFTER_START");
  assert.equal(check(new Date(now.getTime() + 2 * H), new Date(now.getTime() + H)), "RESCHEDULE_END_NOT_AFTER_START");
  assert.equal(check(new Date(now.getTime() + 2 * H), new Date(now.getTime() + 10 * H)), "RESCHEDULE_PERIOD_TOO_SHORT");
  assert.equal(check(current.startAt, current.endAt), "RESCHEDULE_NO_CHANGE");
});

test("a held-to-closing 12-hour package may be shorter on the clock", () => {
  assert.equal(check(new Date(now.getTime() + 2 * H), new Date(now.getTime() + 10 * H), { clampedHalfDay: true }), null);
});

const priced = (final: number, opts: { coupon?: number; duration?: number } = {}): PricedWindow => {
  // GST 18 % inclusive: taxable = final / 1.18
  const gross = final + (opts.coupon ?? 0) + (opts.duration ?? 0);
  const taxableAfter = new Decimal(final).div(1.18).toDecimalPlaces(2);
  const taxableBefore = new Decimal(gross).div(1.18).toDecimalPlaces(2);
  const tax = new Decimal(final).sub(taxableAfter);
  const discount = taxableBefore.sub(taxableAfter);
  return {
    basePrice: taxableBefore,
    discountAmount: discount,
    durationDiscountAmount: opts.duration ? discount : 0,
    couponDiscountAmount: opts.coupon ? discount : 0,
    taxAmount: tax,
    cgstAmount: tax.div(2).toDecimalPlaces(2),
    sgstAmount: tax.sub(tax.div(2).toDecimalPlaces(2)),
    finalTotal: final,
    gross: {
      price: gross,
      durationDiscount: opts.duration ?? 0,
      couponDiscount: opts.coupon ?? 0,
      manualDiscount: 0,
      discount: (opts.coupon ?? 0) + (opts.duration ?? 0),
      total: final,
    },
    rentWithoutGst: taxableAfter,
  };
};

test("price difference: per item and summed; stored item keeps base − discount + tax = final", () => {
  const delta = itemDelta(priced(2500), priced(3000));
  assert.equal(delta.final.toFixed(2), "500.00");
  const item = { baseTotal: "2118.64", discountAmount: "0", taxAmount: "381.36", cgstAmount: "190.68", sgstAmount: "190.68", finalTotal: "4500.00" };
  const next = applyItemDelta(item, delta);
  assert.equal(next.finalTotal.toFixed(2), "5000.00"); // deposit 2000 kept inside finalTotal
  assert.equal(next.baseTotal.sub(next.discountAmount).add(next.taxAmount).add(2000).toFixed(2), next.finalTotal.toFixed(2));
  assert.equal(next.cgstAmount.add(next.sgstAmount).toFixed(2), next.taxAmount.toFixed(2));
  const total = sumDeltas([delta, itemDelta(priced(800), priced(800))]);
  assert.equal(total.final.toFixed(2), "500.00");
});

test("pure shift with the same mix: difference 0", () => {
  assert.ok(itemDelta(priced(2500), priced(2500)).final.isZero());
});

test("snapshot: item money + totals move by the difference, breakdown replaced, absent keys not added", () => {
  const snap = {
    e2e: true,
    items: [{ vehicleId: 7, finalTotal: 4500, rentInclGst: 2500, days: 1, pricingBreakdown: { billedAs: "1 day", freeKmLimit: 200, weekend: { x: 1 } } }],
    totals: { grandFinalTotal: 4500, grandRentInclGst: 2500 },
  };
  const out = snapshotAfterReprice(snap, [
    { vehicleId: 7, delta: itemDelta(priced(2500), priced(5000)), days: 2, breakdown: { billedAs: "2 days", freeKmLimit: 400 } },
  ]) as any;
  assert.equal(out.items[0].finalTotal, 7000);
  assert.equal(out.items[0].rentInclGst, 5000);
  assert.equal(out.items[0].days, 2);
  assert.deepEqual(out.items[0].pricingBreakdown, { billedAs: "2 days", freeKmLimit: 400 });
  assert.equal(out.totals.grandFinalTotal, 7000);
  assert.equal(out.totals.grandTaxTotal, undefined);
  assert.equal(out.e2e, true);
});

const advanceOpen = { isAdvancePayment: true, advanceAmount: 1000, remainingBalance: 3500, remainingPaidAt: null, totalFinal: 4500 };
const paidInFull = { isAdvancePayment: false, advanceAmount: 0, remainingBalance: 0, remainingPaidAt: null, totalFinal: 4500 };

test("open advance balance moves with the difference", () => {
  const up = balanceAfterReprice(advanceOpen, 500);
  assert.equal(up.kind, "OPEN_BALANCE_ADJUSTED");
  assert.equal(up.update.remainingBalance?.toFixed(2), "4000.00");
  assert.equal(up.newTotalFinal.toFixed(2), "5000.00");
  assert.equal(up.dueAtPickup.toFixed(2), "4000.00");
  const down = balanceAfterReprice(advanceOpen, -4000);
  assert.equal(down.kind, "OVERPAID");
  assert.equal(down.update.remainingBalance?.toFixed(2), "0.00");
  assert.equal(down.refundable.toFixed(2), "500.00");
});

test("paid in full: more re-opens a balance for the difference, less is refundable", () => {
  const up = balanceAfterReprice(paidInFull, 800);
  assert.equal(up.kind, "BALANCE_REOPENED");
  assert.equal(up.update.reopenBalance, true);
  assert.equal(up.update.isAdvancePayment, true);
  assert.equal(up.update.remainingBalance?.toFixed(2), "800.00");
  assert.equal(up.update.advanceAmount?.toFixed(2), "4500.00");
  assert.equal(up.dueAtPickup.toFixed(2), "800.00");
  const down = balanceAfterReprice(paidInFull, -1250);
  assert.equal(down.kind, "OVERPAID");
  assert.equal(down.refundable.toFixed(2), "1250.00");
  assert.equal(down.update.remainingBalance, undefined);
  const balanceCollected = { ...advanceOpen, remainingPaidAt: new Date() };
  assert.equal(balanceAfterReprice(balanceCollected, 300).update.remainingBalance?.toFixed(2), "300.00");
});

test("an earlier over-payment covers an increase first", () => {
  const covered = balanceAfterReprice(paidInFull, 300, 500);
  assert.equal(covered.kind, "COVERED_BY_OVERPAYMENT");
  assert.equal(covered.refundable.toFixed(2), "200.00");
  const partly = balanceAfterReprice(paidInFull, 800, 500);
  assert.equal(partly.update.remainingBalance?.toFixed(2), "300.00");
  assert.equal(partly.update.advanceAmount?.toFixed(2), "5000.00");
});

test("no difference: nothing but totalFinal (unchanged)", () => {
  const same = balanceAfterReprice(advanceOpen, 0);
  assert.equal(same.kind, "UNCHANGED");
  assert.equal(same.update.remainingBalance, undefined);
  assert.equal(same.newTotalFinal.toFixed(2), "4500.00");
});

test("remainingKeySuffix: a balance re-opened by a reschedule gets its own remaining-payment key", () => {
  assert.equal(remainingKeySuffix(null), "");
  assert.equal(remainingKeySuffix({}), "");
  assert.equal(remainingKeySuffix({ reschedules: [{ outcome: "OVERPAID" }] }), "");
  assert.equal(remainingKeySuffix({ reschedules: [{ outcome: "BALANCE_REOPENED", reopenedFrom: { isAdvancePayment: true } }] }), ":r1");
  assert.equal(
    remainingKeySuffix({ reschedules: [{ reopenedFrom: {} }, { outcome: "UNCHANGED" }, { reopenedFrom: {} }] }),
    ":r2",
  );
});

/**
 * The extension charge rule (extension-charge.ts — client, Oct 2026: "price
 * only the added time") with the free km it adds (extension-km.ts). Client
 * report: staff Extend Booking for a HYUNDAI I10 MT at Manipal, current return
 * Sat 17 Oct 11:00 → new return Sun 18 Oct 22:30 (+1 day 11 h 30 min), charged
 * ₹3,291.67 under the old delta-from-pickup method (a 10:00 pickup and the
 * 16–18 Oct festival); priced on the added window alone it is ₹1,600 + ₹1,100 =
 * ₹2,700 incl. GST, GST split out of it, never added on top. The engine is
 * stood in for by its slab rule (selectBasePrice, no discounts). No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { splitRentTotal } from "@repo/schemas";
import { selectBasePrice, type RateCard } from "../pricing/base-price-rule.js";
import { DurationCalculatorService } from "../pricing/duration-calculator.service.js";
import type { SpecialRule } from "../../utils/pricing/specialDateRule.js";
import {
  extensionCharge,
  extensionSpecialShare,
  extensionSpecialShareView,
  extensionWindows,
  type ExtensionChargeTerm,
} from "./extension-charge.js";
import { extensionFreeKm, extensionKmMinutes, extensionMinutes, type FreeKmRates } from "../charges/extension-km.js";

// The I10 MT's public rate card (GST-inclusive): 1,600 / day, 1,100 / 12 h, 300 / hour
const i10: RateCard = {
  hourlyRate: new Decimal(300),
  price12Hour: new Decimal(1100),
  price24Hour: new Decimal(1600),
  priceMonthly: null,
  freeKm12Hour: 80,
  freeKm24Hour: 250,
  freeKmMonthly: 0,
};
const i10Km: FreeKmRates = { freeKm12Hour: 80, freeKm24Hour: 250, hourlyRate: 300, price12Hour: 1100, price24Hour: 1600 };

const festival: SpecialRule = {
  id: 1,
  name: "Dussehra",
  startDate: "2026-10-16",
  endDate: "2026-10-18",
  percent: 0,
  flatAmount: 200,
  scope: "ALL",
  categoryIds: [],
  vehicleIds: [],
};

const rates = { cgstRate: 9, sgstRate: 9 };
const ist = (local: string) => DateTime.fromISO(local, { zone: "Asia/Kolkata" }).toJSDate();

interface Ctx {
  card?: RateCard;
  rules?: SpecialRule[];
  weekendDays?: number[];
  /** Post-discount share of the rent (a percentage coupon: 0.9 = 10% off) */
  afterDiscount?: number;
}

/** One engine pricing of [from, to] as a charge term (no discounts unless afterDiscount). */
function term(from: Date, to: Date, sign: 1 | -1, ctx: Ctx): ExtensionChargeTerm {
  const sel = selectBasePrice(
    ctx.card ?? i10,
    DurationCalculatorService.calculate(DateTime.fromJSDate(from), DateTime.fromJSDate(to)),
    { startAt: from, endAt: to, weekendDays: ctx.weekendDays ?? [], specialRules: ctx.rules ?? [] },
  );
  const grossTotal = sel.basePrice.mul(ctx.afterDiscount ?? 1).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { sign, grossPrice: sel.basePrice, grossTotal, weekend: sel.weekend, festival: sel.festival };
}

/** What extensionPricingService.recalculate does, with the engine stood in for. */
function priceExtension(
  booking: { startAt: Date; endAt: Date; monthly?: boolean; heldToClosing?: boolean },
  newEndAt: Date,
  ctx: Ctx = {},
  fromEndAt?: Date,
) {
  const { mode, terms } = extensionWindows(
    { startAt: booking.startAt, monthly: booking.monthly ?? false, heldToClosing: booking.heldToClosing ?? false },
    fromEndAt ?? booking.endAt,
    newEndAt,
  );
  const chargeTerms = terms.map((t) => term(t.from, t.to, t.sign, ctx));
  return { mode, ...extensionCharge(chargeTerms, rates), specialShare: extensionSpecialShare(chargeTerms) };
}

const reported = { startAt: ist("2026-10-16T10:00"), endAt: ist("2026-10-17T11:00") };
const newReturn = ist("2026-10-18T22:30");

test("the reported extension is ₹2,700 incl. GST: day rate + 12 h slab for the added 1 day 11 h 30 min", () => {
  const p = priceExtension(reported, newReturn);
  assert.equal(p.mode, "ADDED_TIME");
  assert.equal(p.additionalAmount.toFixed(2), "2700.00");
  // GST split out of it (PERCENT_OF_TOTAL 18%), never added on top
  assert.deepEqual(
    [p.taxableAmount, p.cgstAmount, p.sgstAmount, p.taxAmount].map((d) => d.toFixed(2)),
    ["2214.00", "243.00", "243.00", "486.00"],
  );
  assert.equal(p.taxableAmount.add(p.taxAmount).toFixed(2), "2700.00");
  assert.deepEqual(p.specialShare, []);
  // The pickup time no longer matters (the delta method gave ₹2,900 for a 10:00 pickup, ₹2,700 for 11:00)
  assert.equal(priceExtension({ ...reported, startAt: ist("2026-10-16T11:00") }, newReturn).additionalAmount.toFixed(2), "2700.00");
  // Same as a fresh booking of that window (the listing price)
  assert.equal(term(reported.endAt, newReturn, 1, {}).grossTotal.toFixed(2), "2700.00");
});

test("festival on the added time: the added window's festival price, and staff see the festival part", () => {
  // Day starting Sat 11:00 (1,600 + 200) + the 12 h block starting Sun 11:00 (1,100 + 100)
  const p = priceExtension(reported, newReturn, { rules: [festival] });
  assert.equal(p.additionalAmount.toFixed(2), "3000.00");
  assert.equal(splitRentTotal(3000, rates).gst, 540);
  assert.deepEqual(extensionSpecialShareView(p.specialShare), [{ label: "Dussehra pricing", amount: "300.00" }]);
  // Extended from the festival's last day into plain days: only the block starting on the 18th is a festival block
  const later = priceExtension({ ...reported, endAt: ist("2026-10-18T11:00") }, ist("2026-10-20T11:00"), { rules: [festival] });
  assert.equal(later.additionalAmount.toFixed(2), "3400.00");
});

test("weekend rents on the added time by the booking's weekend days, shown as the weekend part", () => {
  const card = { ...i10, weekendPrice24Hour: new Decimal(1800), weekendPrice12Hour: new Decimal(1200) };
  const p = priceExtension(reported, newReturn, { card, weekendDays: [6, 7] });
  assert.equal(p.additionalAmount.toFixed(2), "3000.00");
  assert.deepEqual(extensionSpecialShareView(p.specialShare), [{ label: "Weekend pricing", amount: "300.00" }]);
  // A booking made before weekend rates (no weekend days stored) keeps the weekday rents
  assert.equal(priceExtension(reported, newReturn, { card, weekendDays: [] }).additionalAmount.toFixed(2), "2700.00");
});

test("remainder ≤ 12 h → the 12 h slab (or by the hour when cheaper); > 12 h → the 24 h slab — free km follow", () => {
  const cases: [string, string, string, number, string][] = [
    // [current end, new end, charge, free km, km label]
    ["2026-10-21T11:00", "2026-10-21T13:00", "600.00", 0, "Extensions billed by the hour add no free km"],
    ["2026-10-21T11:00", "2026-10-21T16:00", "1100.00", 80, "80 km for 12 h"],
    ["2026-10-21T11:00", "2026-10-21T23:00", "1100.00", 80, "80 km for 12 h"],
    ["2026-10-21T11:00", "2026-10-22T01:00", "1600.00", 250, "250 km for 1 day"],
    ["2026-10-21T11:00", "2026-10-22T22:30", "2700.00", 330, "250 km for 1 day + 80 km for 12 h"],
    ["2026-10-21T11:00", "2026-10-22T23:30", "3200.00", 500, "500 km for 2 days"],
    ["2026-10-21T11:00", "2026-10-22T13:00", "2200.00", 250, "250 km for 1 day; no km for the other 2 h"],
  ];
  for (const [from, to, charge, km, label] of cases) {
    const p = priceExtension({ startAt: ist("2026-10-20T11:00"), endAt: ist(from) }, ist(to));
    assert.equal(p.additionalAmount.toFixed(2), charge, `${from} → ${to}`);
    const free = extensionFreeKm(extensionMinutes(ist(from), ist(to)), i10Km);
    assert.equal(free.km, km, `${from} → ${to} km`);
    assert.equal(free.label, label);
  }
  // Rates without prices keep the older minutes-only km rule
  assert.equal(extensionFreeKm(14 * 60, { freeKm12Hour: 80, freeKm24Hour: 250 }).km, 80);
});

test("a partial extension is priced for its own end, and the offer matches its commit", () => {
  const partialEnd = ist("2026-10-18T09:00"); // 22 h added: capped at the day rate
  const offer = priceExtension(reported, partialEnd);
  assert.equal(offer.additionalAmount.toFixed(2), "1600.00");
  assert.notEqual(offer.additionalAmount.toFixed(2), priceExtension(reported, newReturn).additionalAmount.toFixed(2));
  // The commit re-prices it before the booking moves (same current return) …
  const commit = priceExtension(reported, partialEnd);
  assert.deepEqual(commit, offer);
  // … and a committed extension, whose end the booking already holds, re-read from its oldEndAt
  const held = priceExtension({ ...reported, endAt: partialEnd }, partialEnd, {}, reported.endAt);
  assert.deepEqual(held, offer);
  assert.equal(extensionFreeKm(extensionMinutes(reported.endAt, partialEnd), i10Km).km, 250);
});

test("a percentage coupon takes the same percentage off the added time; GST is split from what is left", () => {
  const p = priceExtension(reported, newReturn, { afterDiscount: 0.9 });
  assert.equal(p.additionalAmount.toFixed(2), "2430.00");
  assert.equal(p.taxableAmount.toFixed(2), "1992.60");
  // discount in rent-without-GST terms: 2,214 − 1,992.60; base = taxable + discount
  assert.equal(p.discountAmount.toFixed(2), "221.40");
  assert.equal(p.baseAmount.toFixed(2), "2214.00");
});

test("monthly bookings keep the delta from pickup (a second month at the monthly rate); clamped at ₹0", () => {
  const monthly: RateCard = { ...i10, hourlyRate: null, priceMonthly: new Decimal(30000) };
  const booking = { startAt: ist("2026-10-01T10:00"), endAt: ist("2026-11-15T10:00"), monthly: true };
  const p = priceExtension(booking, ist("2026-11-30T10:00"), { card: monthly });
  assert.equal(p.mode, "DELTA");
  // 60 days = 2 months (60,000) less 1 month + 15 days (30,000 + 24,000)
  assert.equal(p.additionalAmount.toFixed(2), "6000.00");
  // The added 15 days alone would be 24,000
  assert.equal(priceExtension({ ...booking, monthly: false }, ist("2026-11-30T10:00"), { card: monthly }).additionalAmount.toFixed(2), "24000.00");
  // A longer monthly rental that comes out cheaper is never refunded here
  const cheaper = extensionCharge(
    [
      { sign: 1, grossPrice: new Decimal(30000), grossTotal: new Decimal(30000) },
      { sign: -1, grossPrice: new Decimal(31000), grossTotal: new Decimal(31000) },
    ],
    rates,
  );
  assert.equal(cheaper.additionalAmount.toFixed(2), "0.00");
});

test("a booking made as the 12-hour package held to closing has paid to pickup + 12 h: only the time after it is charged", () => {
  // Fri 23 Oct 18:00 → 22:30, billed as 12 h: paid until Sat 06:00
  const held = { startAt: ist("2026-10-23T18:00"), endAt: ist("2026-10-23T22:30"), heldToClosing: true };
  const snapshot = { pricingSnapshot: { heldToClosing: true }, rentalPeriodType: "HALF_DAY" };
  const cases: [string, string, number, number][] = [
    // [new end, charge, km minutes, free km]
    ["2026-10-24T05:00", "0.00", 0, 0], // within the paid 12 h
    ["2026-10-24T06:00", "0.00", 0, 0],
    ["2026-10-24T08:00", "600.00", 120, 0], // 06:00 → 08:00 by the hour (22:30 → 08:00 would be ₹1,100)
    ["2026-10-24T10:00", "1100.00", 240, 80], // 4 h: the 12 h slab is cheaper than 4 × ₹300
    ["2026-10-25T07:00", "1900.00", 1500, 250], // 1 day + 1 h (22:30 → 07:00 would be ₹2,700)
  ];
  for (const [to, charge, minutes, km] of cases) {
    const p = priceExtension(held, ist(to));
    assert.equal(p.additionalAmount.toFixed(2), charge, to);
    const kmMinutes = extensionKmMinutes({ startAt: held.startAt, ...snapshot }, held.endAt, ist(to));
    assert.equal(kmMinutes, minutes, `${to} km minutes`);
    assert.equal(extensionFreeKm(kmMinutes, i10Km).km, km, `${to} km`);
  }
  assert.equal(priceExtension(held, ist("2026-10-24T05:00")).taxAmount.toFixed(2), "0.00");
  // A later extension starts after the paid time anyway: from its own current return
  assert.equal(priceExtension({ ...held, endAt: ist("2026-10-24T10:00") }, ist("2026-10-24T12:00")).additionalAmount.toFixed(2), "600.00");
  // Not held: the added window starts at the current return
  assert.equal(priceExtension({ ...held, heldToClosing: false }, ist("2026-10-24T08:00")).additionalAmount.toFixed(2), "1100.00");
  assert.equal(extensionKmMinutes({ startAt: held.startAt }, held.endAt, ist("2026-10-24T08:00")), 570);
});

test("monthly bookings are unchanged by the held-to-closing rule (the delta from pickup)", () => {
  const start = ist("2026-10-01T10:00");
  const w = extensionWindows({ startAt: start, monthly: true, heldToClosing: true }, ist("2026-11-15T10:00"), ist("2026-11-30T10:00"));
  assert.equal(w.mode, "DELTA");
  assert.deepEqual(
    w.terms.map((t) => [t.from.toISOString(), t.to.toISOString(), t.sign]),
    [
      [start.toISOString(), ist("2026-11-30T10:00").toISOString(), 1],
      [start.toISOString(), ist("2026-11-15T10:00").toISOString(), -1],
    ],
  );
  assert.equal(
    extensionKmMinutes({ startAt: start, pricingSnapshot: { heldToClosing: true }, rentalPeriodType: "MONTHLY" }, ist("2026-11-15T10:00"), ist("2026-11-15T12:00")),
    120,
  );
});

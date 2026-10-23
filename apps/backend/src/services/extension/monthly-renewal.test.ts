/**
 * Monthly renewal pricing (client TODO 7–9, Oct 2026 — extension-charge.ts
 * MONTHLY_RENEWAL; free km extension-km.ts extensionFreeKmFor). A Fleet Member
 * renews an active MONTHLY booking by days, weeks, a month or to any return:
 * the added window's whole 30-day months at the vehicle's monthly price, the
 * remainder at the daily rate with the BM's duration slab for its length —
 * each part priced as a booking of that length on its own. GST is inside the
 * amounts (split out once, never added). The engine is stood in for by its
 * slab rule (selectBasePrice) and a duration slab table mirroring
 * duration-discount.service (full 24 h periods, the highest minDays wins).
 * No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { splitRentTotal } from "@repo/schemas";
import { selectBasePrice, type RateCard } from "../pricing/base-price-rule.js";
import { DurationCalculatorService } from "../pricing/duration-calculator.service.js";
import {
  extensionCharge,
  extensionSpecialShare,
  extensionWindows,
  renewalBreakdown,
  renewalLengthLabel,
  renewalSplit,
  renewalTermTotal,
  type ExtensionChargeTerm,
} from "./extension-charge.js";
import { extensionFreeKm, extensionFreeKmFor, extensionMinutes, type FreeKmRates } from "../charges/extension-km.js";

// GST-inclusive rents: ₹1,600 a day, ₹1,100 / 12 h, ₹30,000 a month (30 days)
const card: RateCard = {
  hourlyRate: null,
  price12Hour: new Decimal(1100),
  price24Hour: new Decimal(1600),
  priceMonthly: new Decimal(30000),
  freeKm12Hour: 80,
  freeKm24Hour: 250,
  freeKmMonthly: 1500,
};
const noMonthly: RateCard = { ...card, priceMonthly: null };
const km: FreeKmRates = { freeKm12Hour: 80, freeKm24Hour: 250, hourlyRate: null, price12Hour: 1100, price24Hour: 1600, priceMonthly: 30000, freeKmMonthly: 1500 };
const kmNoMonthly: FreeKmRates = { ...km, priceMonthly: null };

/** The BM's duration slabs (percentage), matched on full 24 h periods. */
interface Slab { minDays: number; maxDays: number | null; percent: number; label: string }
const slabs: Slab[] = [
  { minDays: 3, maxDays: 6, percent: 5, label: "3+ days 5% off" },
  { minDays: 7, maxDays: 29, percent: 10, label: "Weekly 10% off" },
];

const rates = { cgstRate: 9, sgstRate: 9 };
const ist = (local: string) => DateTime.fromISO(local, { zone: "Asia/Kolkata" }).toJSDate();
const DAY = 24 * 60 * 60 * 1000;
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

interface Ctx { card?: RateCard; slabs?: Slab[]; weekendDays?: number[] }

/** One engine pricing of [from, to]: the slab rule, then the duration slab for its length. */
function engine(from: Date, to: Date, ctx: Ctx) {
  const duration = DurationCalculatorService.calculate(DateTime.fromJSDate(from), DateTime.fromJSDate(to));
  const sel = selectBasePrice(ctx.card ?? card, duration, {
    startAt: from,
    endAt: to,
    weekendDays: ctx.weekendDays ?? [],
    specialRules: [],
  });
  const slabDays = Math.floor(duration.actualDuration / 24 + 1e-9);
  const slab = (ctx.slabs ?? slabs)
    .filter((s) => s.minDays <= slabDays && (s.maxDays == null || s.maxDays >= slabDays))
    .sort((a, b) => b.minDays - a.minDays)[0];
  const discount = slab ? sel.basePrice.mul(slab.percent).div(100).toDecimalPlaces(2) : new Decimal(0);
  return { sel, grossTotal: sel.basePrice.sub(discount), slabLabel: slab?.label ?? null };
}

/** What extensionPricingService.recalculate does for a booking, with the engine stood in for. */
function price(booking: { startAt: Date; endAt: Date; monthly: boolean }, newEndAt: Date, ctx: Ctx = {}, fromEndAt?: Date) {
  const from = fromEndAt ?? booking.endAt;
  const { mode, terms } = extensionWindows({ startAt: booking.startAt, monthly: booking.monthly }, from, newEndAt);
  const priced = terms.map((t) => {
    const e = engine(t.from, t.to, ctx);
    // Months at the monthly price: exactly that, no slab (renewalTermTotal)
    return { ...t, ...e, grossTotal: renewalTermTotal(t.part, e.sel.billedAsType, e.sel.basePrice, e.grossTotal) };
  });
  const chargeTerms: ExtensionChargeTerm[] = priced.map((p) => ({
    sign: p.sign,
    grossPrice: p.sel.basePrice,
    grossTotal: p.grossTotal,
    weekend: p.sel.weekend,
    festival: p.sel.festival,
  }));
  return {
    mode,
    ...extensionCharge(chargeTerms, rates),
    specialShare: extensionSpecialShare(chargeTerms),
    renewal:
      mode === "MONTHLY_RENEWAL"
        ? renewalBreakdown(
            from,
            newEndAt,
            priced.map((p) => ({
              part: p.part ?? "DAYS",
              from: p.from,
              to: p.to,
              billedAs: p.sel.billedAs,
              billedAsType: p.sel.billedAsType,
              grossPrice: p.sel.basePrice,
              grossTotal: p.grossTotal,
              durationDiscountLabel: p.slabLabel,
            })),
          )
        : undefined,
  };
}

// A monthly booking picked up 1 Oct, due back Tue 3 Nov 10:00
const booking = { startAt: ist("2026-10-01T10:00"), endAt: ist("2026-11-03T10:00"), monthly: true };
const renew = (ms: number, ctx?: Ctx) => price(booking, plus(booking.endAt, ms), ctx);
const freeKm = (ms: number, rates: FreeKmRates = km) =>
  extensionFreeKmFor(extensionMinutes(booking.endAt, plus(booking.endAt, ms)), rates, { monthly: true });

test("+3 days: the daily rate with the BM's 3-day slab, exactly as a 3-day daily booking", () => {
  const p = renew(3 * DAY);
  assert.equal(p.mode, "MONTHLY_RENEWAL");
  assert.equal(p.additionalAmount.toFixed(2), "4560.00"); // 3 × 1,600 − 5%
  assert.equal(p.renewal!.label, "3 days");
  assert.deepEqual(
    p.renewal!.parts.map((x) => [x.part, x.rate, x.label, x.price, x.discount, x.discountLabel, x.total]),
    [["DAYS", "DAILY", "3 days at the daily rate", "4800.00", "240.00", "3+ days 5% off", "4560.00"]],
  );
  // Same as a daily booking's extension of the same added time (ADDED_TIME)
  assert.equal(price({ ...booking, monthly: false }, plus(booking.endAt, 3 * DAY)).additionalAmount.toFixed(2), "4560.00");
  assert.equal(freeKm(3 * DAY).km, 750);
});

test("+2 weeks: 14 days at the daily rate with the weekly slab", () => {
  const p = renew(14 * DAY);
  assert.equal(p.additionalAmount.toFixed(2), "20160.00"); // 14 × 1,600 − 10%
  assert.equal(p.renewal!.label, "2 weeks");
  assert.equal(p.renewal!.parts[0]!.discountLabel, "Weekly 10% off");
  assert.equal(p.renewal!.months, 0);
  assert.equal(freeKm(14 * DAY).km, 3500);
});

test("+1 month (30 days): the vehicle's monthly price, no daily slab, monthly free km", () => {
  const p = renew(30 * DAY);
  assert.equal(p.additionalAmount.toFixed(2), "30000.00");
  assert.equal(p.renewal!.label, "1 month");
  assert.deepEqual(
    p.renewal!.parts.map((x) => [x.part, x.rate, x.label, x.total]),
    [["MONTHS", "MONTHLY", "1 month at the monthly price", "30000.00"]],
  );
  assert.equal(p.renewal!.monthlyPriceMissing, false);
  // Never weekend / festival: a full month is not a block
  const weekendCard = { ...card, weekendPrice24Hour: new Decimal(2000) };
  const w = renew(30 * DAY, { card: weekendCard, weekendDays: [6, 7] });
  assert.equal(w.additionalAmount.toFixed(2), "30000.00");
  assert.deepEqual(w.specialShare, []);
  const free = freeKm(30 * DAY);
  assert.equal(free.km, 1500);
  assert.equal(free.months, 1);
  assert.equal(free.label, "1500 km for 1 month");
  // A BM slab whose range covers 30 days never reduces the monthly price (user decision, Oct 23 2026)
  const monthSlabs = [...slabs, { minDays: 30, maxDays: null, percent: 15, label: "Monthly 15% off" }];
  const withMonthSlab = renew(30 * DAY, { slabs: monthSlabs });
  assert.equal(withMonthSlab.additionalAmount.toFixed(2), "30000.00");
  assert.equal(withMonthSlab.renewal!.parts[0]!.discount, "0.00");
  assert.equal(withMonthSlab.renewal!.parts[0]!.discountLabel, null);
  // … while the remainder of a mixed renewal keeps its own slab
  assert.equal(renew(45 * DAY, { slabs: monthSlabs }).additionalAmount.toFixed(2), "51600.00");
  // Without a monthly price the months are a daily booking of 30 days: the 30-day slab applies
  assert.equal(renew(30 * DAY, { card: noMonthly, slabs: monthSlabs }).additionalAmount.toFixed(2), "40800.00");
});

test("+45 days (mixed): 1 month at the monthly price + 15 days at the daily rate with their slab", () => {
  const p = renew(45 * DAY);
  assert.equal(p.additionalAmount.toFixed(2), "51600.00"); // 30,000 + (15 × 1,600 − 10%)
  assert.equal(p.renewal!.label, "1 month + 15 days");
  assert.deepEqual(
    p.renewal!.parts.map((x) => [x.part, x.rate, x.price, x.discount, x.total]),
    [
      ["MONTHS", "MONTHLY", "30000.00", "0.00", "30000.00"],
      ["DAYS", "DAILY", "24000.00", "2400.00", "21600.00"],
    ],
  );
  // The months end 30 × 24 h after the current return; the remainder starts there
  assert.equal(p.renewal!.parts[1]!.from, plus(booking.endAt, 30 * DAY).toISOString());
  // Weekend rents apply to the remainder's days only (the month is never a weekend block)
  const weekendCard = { ...card, weekendPrice24Hour: new Decimal(2000) };
  const w = renew(45 * DAY, { card: weekendCard, weekendDays: [6, 7] });
  // 3 Dec (Thu) 10:00 + 15 days: Sat 5, Sun 6, Sat 12, Sun 13 → 4 weekend days at +₹400
  assert.deepEqual(w.specialShare.map((s) => [s.label, s.amount.toFixed(2)]), [["Weekend pricing", "1600.00"]]);
  assert.equal(w.additionalAmount.toFixed(2), new Decimal(30000).add(new Decimal(25600).mul(0.9)).toFixed(2));
  // Free km: 1,500 for the month + 15 × 250
  const free = freeKm(45 * DAY);
  assert.equal(free.km, 5250);
  assert.equal(free.label, "1500 km for 1 month + 3750 km for 15 days");
  // Two months and a few hours: the hours as a block of the remainder
  assert.equal(renew(60 * DAY + 5 * 3_600_000).additionalAmount.toFixed(2), "61100.00");
  assert.equal(freeKm(60 * DAY + 5 * 3_600_000).km, 3080);
});

test("no monthly price: the months fall back to the daily rate (with the slab for their length), and the screen says so", () => {
  const month = renew(30 * DAY, { card: noMonthly });
  assert.equal(month.additionalAmount.toFixed(2), "48000.00"); // 30 × 1,600, no slab covers 30 days
  assert.equal(month.renewal!.monthlyPriceMissing, true);
  assert.deepEqual(
    month.renewal!.parts.map((x) => [x.rate, x.label]),
    [["DAILY", "30 days at the daily rate (no monthly price set)"]],
  );
  const mixed = renew(45 * DAY, { card: noMonthly });
  assert.equal(mixed.additionalAmount.toFixed(2), "69600.00"); // 48,000 + 21,600
  // Days and weeks are unaffected by the missing monthly price
  assert.equal(renew(14 * DAY, { card: noMonthly }).additionalAmount.toFixed(2), "20160.00");
  assert.equal(renew(14 * DAY, { card: noMonthly }).renewal!.monthlyPriceMissing, false);
  // Free km: the months earn the 24 h km a day, as they are billed by the day
  assert.equal(freeKm(30 * DAY, kmNoMonthly).km, 7500);
  assert.equal(freeKm(45 * DAY, kmNoMonthly).km, 11250);
  assert.equal(freeKm(45 * DAY, kmNoMonthly).label, "11250 km for 45 days");
});

test("GST is inside the renewal charge: split out once, never added", () => {
  const p = renew(45 * DAY);
  const s = splitRentTotal(51600, rates);
  assert.equal(p.taxableAmount.toFixed(2), new Decimal(s.taxable).toFixed(2));
  assert.equal(p.taxAmount.toFixed(2), new Decimal(s.gst).toFixed(2));
  assert.equal(p.cgstAmount.add(p.sgstAmount).toFixed(2), p.taxAmount.toFixed(2));
  assert.equal(p.taxableAmount.add(p.taxAmount).toFixed(2), "51600.00");
  // The slab's share in rent-without-GST terms: base − taxable
  assert.equal(p.baseAmount.sub(p.discountAmount).toFixed(2), p.taxableAmount.toFixed(2));
  assert.ok(p.discountAmount.gt(0));
  // +1 month alone: ₹30,000 incl. GST
  const m = renew(30 * DAY);
  assert.equal(m.taxableAmount.add(m.taxAmount).toFixed(2), "30000.00");
  assert.equal(m.discountAmount.toFixed(2), "0.00");
});

test("a partial renewal is priced for its own end; the offer, the commit re-price and the committed re-read agree", () => {
  const partialEnd = plus(booking.endAt, 33 * DAY); // car free 33 days, 45 asked
  const offer = price(booking, partialEnd);
  assert.equal(offer.additionalAmount.toFixed(2), "34560.00"); // 30,000 + 3 days − 5%
  assert.deepEqual(price(booking, partialEnd), offer);
  // Committed: the booking already holds the new end; re-read from the old end
  assert.deepEqual(price({ ...booking, endAt: partialEnd }, partialEnd, {}, booking.endAt), offer);
});

test("custom return times and lengths: minute-precise split and labels", () => {
  const split = renewalSplit(booking.endAt, plus(booking.endAt, 31 * DAY + 90 * 60_000));
  assert.equal(split.months, 1);
  assert.equal(split.remainderMs, DAY + 90 * 60_000);
  assert.equal(renewalLengthLabel(DAY / 60_000 + 90), "1 day 1 h 30 min");
  assert.equal(renewalLengthLabel(21 * 24 * 60), "3 weeks");
  assert.equal(renewalLengthLabel(10 * 24 * 60), "10 days");
  assert.equal(renew(31 * DAY + 90 * 60_000).renewal!.label, "1 month + 1 day 1 h 30 min");
  // Nothing added → no parts, ₹0
  const none = extensionWindows({ startAt: booking.startAt, monthly: true }, booking.endAt, booking.endAt);
  assert.deepEqual(none.terms, []);
});

test("daily (non-monthly) extensions are unchanged: the added window alone, km by its blocks", () => {
  const daily = { ...booking, monthly: false };
  const p = price(daily, plus(daily.endAt, 3 * DAY));
  assert.equal(p.mode, "ADDED_TIME");
  assert.equal(p.renewal, undefined);
  const w = extensionWindows({ startAt: daily.startAt, monthly: false }, daily.endAt, plus(daily.endAt, 3 * DAY));
  assert.deepEqual(w.terms.map((t) => t.part), [undefined]);
  // extensionFreeKmFor without `monthly` is extensionFreeKm, even past 30 days
  const minutes = extensionMinutes(daily.endAt, plus(daily.endAt, 30 * DAY));
  assert.deepEqual(extensionFreeKmFor(minutes, km), extensionFreeKm(minutes, km));
  assert.equal(extensionFreeKmFor(minutes, km).km, 7500);
  // A renewal under 30 days earns exactly the daily km
  assert.deepEqual(freeKm(3 * DAY), extensionFreeKm(3 * 24 * 60, km));
});

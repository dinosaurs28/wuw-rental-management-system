/**
 * Pure checks of weekend-wise rental pricing: the weekend-block rule
 * (weekendRule.ts) and how base-price-rule.ts bills weekend blocks — the 24 h
 * days, the remainder, a single block, the hourly cap, the 12-hour package and
 * monthly overflow days. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import {
  DEFAULT_WEEKEND_DAYS,
  isWeekendBlock,
  normalizeWeekendDays,
  weekendDaysOf,
  weekendMinutesIn,
  withItemWeekendBreakdowns,
} from "./weekendRule.js";
import { selectBasePrice, type RateCard } from "../../services/pricing/base-price-rule.js";
import { DurationCalculatorService } from "../../services/pricing/duration-calculator.service.js";

const ist = (local: string) => new Date(`${local}+05:30`);
const ms = (local: string) => ist(local).getTime();

// 2026-10-09 is a Friday, 10-10 Saturday, 10-11 Sunday, 10-12 Monday
const card = (overrides: Partial<RateCard> = {}): RateCard => ({
  hourlyRate: null,
  price12Hour: new Decimal(900),
  price24Hour: new Decimal(1300),
  priceMonthly: null,
  freeKm12Hour: 100,
  freeKm24Hour: 150,
  freeKmMonthly: 1500,
  weekendPrice24Hour: new Decimal(1600),
  ...overrides,
});

function price(rateCard: RateCard, from: string, to: string, weekendDays: readonly number[] = DEFAULT_WEEKEND_DAYS) {
  const startAt = ist(from);
  const duration = DurationCalculatorService.calculate(
    DateTime.fromJSDate(startAt),
    DateTime.fromJSDate(ist(to)),
  );
  return selectBasePrice(rateCard, duration, { startAt, endAt: ist(to), weekendDays });
}

/** A 12-hour package held to closing: billed pickup → pickup + 12 h, really back at `realReturn`. */
function priceHeld(rateCard: RateCard, from: string, realReturn: string) {
  const startAt = ist(from);
  const duration = DurationCalculatorService.calculate(
    DateTime.fromJSDate(startAt),
    DateTime.fromJSDate(startAt).plus({ hours: 12 }),
  );
  return selectBasePrice(rateCard, duration, { startAt, endAt: ist(realReturn), weekendDays: DEFAULT_WEEKEND_DAYS });
}

test("Fri 18:00 → Sat 18:00 has 18 of 24 h on Saturday: a weekend block", () => {
  assert.equal(weekendMinutesIn(ms("2026-10-09T18:00:00"), ms("2026-10-10T18:00:00"), [6, 7]), 18 * 60);
  assert.equal(isWeekendBlock(ms("2026-10-09T18:00:00"), ms("2026-10-10T18:00:00"), [6, 7]), true);
});

test("Fri 10:00 → Sat 10:00 has 10 of 24 h on Saturday: a weekday block", () => {
  assert.equal(isWeekendBlock(ms("2026-10-09T10:00:00"), ms("2026-10-10T10:00:00"), [6, 7]), false);
});

test("exactly half on the weekend counts as weekend", () => {
  // Sun 12:00 → Mon 12:00: 12 h Sunday, 12 h Monday
  assert.equal(isWeekendBlock(ms("2026-10-11T12:00:00"), ms("2026-10-12T12:00:00"), [6, 7]), true);
  // Thu 12:00 → Fri 12:00 with Friday + Saturday as the weekend
  assert.equal(isWeekendBlock(ms("2026-10-08T12:00:00"), ms("2026-10-09T12:00:00"), [5, 6]), true);
});

test("days are Asia/Kolkata calendar days, and no weekend days means no weekend", () => {
  // Fri 23:00 IST → Sat 05:00 IST: 5 of 6 h on Saturday (Friday in UTC throughout)
  assert.equal(weekendMinutesIn(ms("2026-10-09T23:00:00"), ms("2026-10-10T05:00:00"), [6]), 5 * 60);
  assert.equal(isWeekendBlock(ms("2026-10-10T10:00:00"), ms("2026-10-10T20:00:00"), []), false);
});

test("normalizeWeekendDays keeps distinct ISO weekdays, sorted", () => {
  assert.deepEqual(normalizeWeekendDays([7, 6, 6, 0, 8, 2.5, "1"]), [6, 7]);
  assert.deepEqual(normalizeWeekendDays(null), []);
});

test("weekendDaysOf: bookings made before weekend rates are re-priced without them", () => {
  assert.deepEqual(weekendDaysOf({ items: [], totals: {} }), []);
  assert.deepEqual(weekendDaysOf(null), []);
  assert.deepEqual(weekendDaysOf({ weekendDays: [6, 7] }), [6, 7]);
});

test("a single day across the weekend is billed at the weekend 24-hour rent", () => {
  const sel = price(card(), "2026-10-09T18:00:00", "2026-10-10T18:00:00");
  assert.equal(sel.basePrice.toNumber(), 1600);
  assert.equal(sel.freeKmLimit, 150);
  assert.equal(sel.billedAs, "1 day");
  assert.deepEqual(sel.weekend, {
    weekendBlocks: 1,
    weekdayBlocks: 0,
    weekendPrice12Hour: null,
    weekendPrice24Hour: 1600,
    weekendAmount: 1600,
    weekdayAmount: 1300,
    label: "Includes 1 weekend day at ₹1,600",
  });
});

test("weekday windows, no weekend rents, or no calendar context price exactly as before", () => {
  const weekday = price(card(), "2026-10-07T10:00:00", "2026-10-08T10:00:00");
  assert.equal(weekday.basePrice.toNumber(), 1300);
  assert.equal(weekday.weekend, undefined);

  const noRates = price(card({ weekendPrice24Hour: null }), "2026-10-10T10:00:00", "2026-10-11T10:00:00");
  assert.equal(noRates.basePrice.toNumber(), 1300);
  assert.equal(noRates.weekend, undefined);

  const sameRate = price(card({ weekendPrice24Hour: new Decimal(1300) }), "2026-10-10T10:00:00", "2026-10-11T10:00:00");
  assert.equal(sameRate.weekend, undefined);

  const noContext = selectBasePrice(
    card(),
    DurationCalculatorService.calculate(
      DateTime.fromJSDate(ist("2026-10-10T10:00:00")),
      DateTime.fromJSDate(ist("2026-10-11T10:00:00")),
    ),
  );
  assert.equal(noContext.basePrice.toNumber(), 1300);

  const oldBooking = price(card(), "2026-10-10T10:00:00", "2026-10-11T10:00:00", []);
  assert.equal(oldBooking.basePrice.toNumber(), 1300);
});

test("multi-day: each full 24 h block is weekday or weekend on its own", () => {
  // Thu 10:00 → Sun 10:00: Thu–Fri weekday, Fri–Sat (10 h Sat) weekday, Sat–Sun weekend
  const sel = price(card(), "2026-10-08T10:00:00", "2026-10-11T10:00:00");
  assert.equal(sel.basePrice.toNumber(), 1300 + 1300 + 1600);
  assert.equal(sel.freeKmLimit, 450);
  assert.equal(sel.billedAs, "3 days");
  assert.equal(sel.weekend?.weekendBlocks, 1);
  assert.equal(sel.weekend?.weekdayBlocks, 2);
  assert.equal(sel.weekend?.label, "Includes 1 weekend day at ₹1,600");
});

test("the remainder block takes the weekend 12-hour rent, falling back to the weekday one", () => {
  // Fri 10:00 → Sat 20:00: Fri–Sat 10:00 weekday day + Sat 10:00–20:00 (weekend) remainder
  const noWeekend12 = price(card(), "2026-10-09T10:00:00", "2026-10-10T20:00:00");
  assert.equal(noWeekend12.basePrice.toNumber(), 1300 + 900);
  assert.equal(noWeekend12.weekend, undefined);

  const withWeekend12 = price(card({ weekendPrice12Hour: new Decimal(1100) }), "2026-10-09T10:00:00", "2026-10-10T20:00:00");
  assert.equal(withWeekend12.basePrice.toNumber(), 1300 + 1100);
  assert.equal(withWeekend12.billedAs, "1 day + 12 hours");
  assert.equal(withWeekend12.weekend?.label, "Includes 12 weekend hours at ₹1,100");

  // Fri 18:00 → Sun 06:00: Fri–Sat 18:00 weekend day + Sat 18:00–Sun 06:00 weekend remainder
  const both = price(card({ weekendPrice12Hour: new Decimal(1100) }), "2026-10-09T18:00:00", "2026-10-11T06:00:00");
  assert.equal(both.basePrice.toNumber(), 1600 + 1100);
  assert.equal(both.weekend?.label, "Includes 1 weekend day at ₹1,600 + 12 weekend hours at ₹1,100");
});

test("the hourly rate is unchanged but capped at the weekend slab on a weekend block", () => {
  // Sat 08:00 → 22:00 (14 h), hourly ₹100: weekday min(1400, 1300); weekend min(1400, 1600)
  const hourly = card({ hourlyRate: new Decimal(100) });
  const weekend = price(hourly, "2026-10-10T08:00:00", "2026-10-10T22:00:00");
  assert.equal(weekend.basePrice.toNumber(), 1400);
  assert.equal(weekend.billedAs, "14 hours");
  // never fewer free km than the weekday day slab would give
  assert.equal(weekend.freeKmLimit, 150);
  assert.equal(weekend.weekend?.label, "Includes 14 weekend hours at ₹1,400");

  const weekday = price(hourly, "2026-10-07T08:00:00", "2026-10-07T22:00:00");
  assert.equal(weekday.basePrice.toNumber(), 1300);
  assert.equal(weekday.billedAs, "1 day");
});

test("a weekend block billed by the hour keeps the weekday block's free km", () => {
  // Sat 08:00–18:00, hourly ₹100, 12 h ₹900 / 100 km, weekend 12 h ₹1,100:
  // weekday 12 h slab ₹900 (100 km); weekend 10 × ₹100 = ₹1,000 by the hour (62 km → 100)
  const sel = price(
    card({ hourlyRate: new Decimal(100), weekendPrice12Hour: new Decimal(1100) }),
    "2026-10-10T08:00:00",
    "2026-10-10T18:00:00",
  );
  assert.equal(sel.basePrice.toNumber(), 1000);
  assert.equal(sel.billedAs, "10 hours");
  assert.equal(sel.freeKmLimit, 100);
});

test("a held 12-hour package is weekday / weekend by its real hours, billed as 12 hours", () => {
  const rates = card({ weekendPrice12Hour: new Decimal(1100) });
  // Fri 18:00 → 22:30: only Friday (pickup + 12 h would reach Sat 06:00, a 6 / 12 tie)
  const friday = priceHeld(rates, "2026-10-09T18:00:00", "2026-10-09T22:30:00");
  assert.equal(friday.basePrice.toNumber(), 900);
  assert.equal(friday.billedAs, "12 hours");
  assert.equal(friday.weekend, undefined);
  // Sun 19:00 → 22:30: only Sunday (pickup + 12 h would reach Mon 07:00, 5 of 12 h Sunday)
  const sunday = priceHeld(rates, "2026-10-11T19:00:00", "2026-10-11T22:30:00");
  assert.equal(sunday.basePrice.toNumber(), 1100);
  assert.equal(sunday.billedAs, "12 hours");
  assert.equal(sunday.freeKmLimit, 100);
  assert.equal(sunday.weekend?.label, "Includes 12 weekend hours at ₹1,100");
});

test("withItemWeekendBreakdowns sets or removes each item's weekend breakdown", () => {
  const breakdown = { weekendBlocks: 1, label: "Includes 1 weekend day at ₹1,600" };
  const snapshot = {
    weekendDays: [6, 7],
    totals: { grandFinalTotal: 1300 },
    items: [
      { vehicleId: 7, pricingBreakdown: { billedAs: "1 day" } },
      { vehicleId: 9, pricingBreakdown: { billedAs: "1 day", weekend: breakdown } },
    ],
  };
  const next = withItemWeekendBreakdowns(snapshot, [{ vehicleId: 9 }, { vehicleId: 7, weekend: breakdown }]);
  assert.deepEqual(next.items, [
    { vehicleId: 7, pricingBreakdown: { billedAs: "1 day", weekend: breakdown } },
    { vehicleId: 9, pricingBreakdown: { billedAs: "1 day" } },
  ]);
  assert.deepEqual(next.totals, snapshot.totals);
  assert.deepEqual(next.weekendDays, [6, 7]);
});

test("a weekend 12-hour package (held to closing, billed pickup + 12 h) uses the weekend 12-hour rent", () => {
  // Sat 14:00, billed to Sun 02:00 — every minute on the weekend
  const sel = price(card({ weekendPrice12Hour: new Decimal(1100) }), "2026-10-10T14:00:00", "2026-10-11T02:00:00");
  assert.equal(sel.basePrice.toNumber(), 1100);
  assert.equal(sel.billedAs, "12 hours");
  assert.equal(sel.freeKmLimit, 100);
});

test("monthly: full months keep the monthly rate, overflow days use the block rule", () => {
  const monthly = card({ priceMonthly: new Decimal(25000) });
  // Mon 2026-10-12 10:00 + 30 days = Wed 11-11 10:00; one overflow day to Thu → weekday
  const weekdayOverflow = price(monthly, "2026-10-12T10:00:00", "2026-11-12T10:00:00");
  assert.equal(weekdayOverflow.basePrice.toNumber(), 25000 + 1300);
  assert.equal(weekdayOverflow.weekend, undefined);
  // Thu 2026-10-08 10:00 + 30 days = Sat 11-07 10:00; the overflow day Sat–Sun is weekend
  const weekendOverflow = price(monthly, "2026-10-08T10:00:00", "2026-11-08T10:00:00");
  assert.equal(weekendOverflow.basePrice.toNumber(), 25000 + 1600);
  assert.equal(weekendOverflow.billedAs, "1 month + 1 day");
  assert.equal(weekendOverflow.weekend?.weekendBlocks, 1);
});

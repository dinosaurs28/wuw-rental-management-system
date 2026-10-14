/**
 * Pure checks of festival (special-date) pricing: the festival-block rule
 * (specialDateRule.ts) and how base-price-rule.ts bills festival blocks — days
 * across midnight, overlapping rules, festival discounts, rounding, the hourly
 * cap, the 12-hour package held to closing, monthly overflow days, weekend
 * rents underneath, and an extension's delta. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import {
  applySpecialPercent,
  applySpecialRule,
  festivalPriceFor,
  isFestivalBlock,
  mergeRulesForTime,
  normalizeSpecialRules,
  rescheduleChecksRent,
  rescheduleRuleSets,
  ruleCoversVehicle,
  ruleMinutesIn,
  rulesOverlapping,
  specialRulesOf,
  withItemFestivalBreakdowns,
  type SpecialRule,
} from "./specialDateRule.js";
import { selectBasePrice, type RateCard } from "../../services/pricing/base-price-rule.js";
import { DurationCalculatorService } from "../../services/pricing/duration-calculator.service.js";

const ist = (local: string) => new Date(`${local}+05:30`);
const ms = (local: string) => ist(local).getTime();

// 2026-10-20 is a Tuesday, 10-22 Thursday, 10-24 Saturday, 10-25 Sunday
const rule = (overrides: Partial<SpecialRule> = {}): SpecialRule => ({
  id: 1,
  name: "Dussehra",
  startDate: "2026-10-20",
  endDate: "2026-10-22",
  percent: 10,
  flatAmount: 0,
  scope: "ALL",
  categoryIds: [],
  vehicleIds: [],
  ...overrides,
});

const card = (overrides: Partial<RateCard> = {}): RateCard => ({
  hourlyRate: null,
  price12Hour: new Decimal(900),
  price24Hour: new Decimal(1300),
  priceMonthly: null,
  freeKm12Hour: 100,
  freeKm24Hour: 150,
  freeKmMonthly: 1500,
  ...overrides,
});

function price(
  rateCard: RateCard,
  from: string,
  to: string,
  specialRules: readonly SpecialRule[] = [rule()],
  weekendDays: readonly number[] = [],
) {
  const startAt = ist(from);
  const duration = DurationCalculatorService.calculate(DateTime.fromJSDate(startAt), DateTime.fromJSDate(ist(to)));
  return selectBasePrice(rateCard, duration, { startAt, endAt: ist(to), weekendDays, specialRules });
}

test("a day across midnight is a festival block when at least half of it is on the festival", () => {
  // 19 Oct 18:00 → 20 Oct 18:00: 18 of 24 h on the 20th
  assert.equal(ruleMinutesIn(ms("2026-10-19T18:00:00"), ms("2026-10-20T18:00:00"), rule()), 18 * 60);
  assert.equal(isFestivalBlock(ms("2026-10-19T18:00:00"), ms("2026-10-20T18:00:00"), rule()), true);
  // 22 Oct 20:00 → 23 Oct 20:00: 4 of 24 h on the last festival day
  assert.equal(isFestivalBlock(ms("2026-10-22T20:00:00"), ms("2026-10-23T20:00:00"), rule()), false);
  // exactly half counts: 19 Oct 12:00 → 20 Oct 12:00
  assert.equal(isFestivalBlock(ms("2026-10-19T12:00:00"), ms("2026-10-20T12:00:00"), rule()), true);
  // IST calendar days: 19 Oct 23:00 → 20 Oct 05:00 IST has 5 of 6 h on the 20th
  assert.equal(ruleMinutesIn(ms("2026-10-19T23:00:00"), ms("2026-10-20T05:00:00"), rule()), 5 * 60);
});

test("a one-day festival day across midnight is billed at the festival rent", () => {
  const sel = price(card(), "2026-10-19T18:00:00", "2026-10-20T18:00:00", [rule({ endDate: "2026-10-20" })]);
  assert.equal(sel.basePrice.toNumber(), 1430);
  assert.equal(sel.freeKmLimit, 150);
  assert.deepEqual(sel.festival, {
    festivalBlocks: 1,
    amount: 130,
    rules: [{ id: 1, name: "Dussehra", percent: 10, flatAmount: 0, blocks: 1, amount: 130 }],
    label: "Includes 1 festival day (Dussehra +10%)",
  });
});

test("three festival days: every day of the trip on the festival", () => {
  // 20 Oct 10:00 → 23 Oct 10:00: the last day has 14 of 24 h on the 22nd
  const sel = price(card(), "2026-10-20T10:00:00", "2026-10-23T10:00:00");
  assert.equal(sel.basePrice.toNumber(), 3 * 1430);
  assert.equal(sel.freeKmLimit, 450);
  assert.equal(sel.festival?.festivalBlocks, 3);
  assert.equal(sel.festival?.amount, 390);
  assert.equal(sel.festival?.label, "Includes 3 festival days (Dussehra +10%)");
});

test("outside the festival, without rules or without a calendar context nothing changes", () => {
  const before = price(card(), "2026-10-17T10:00:00", "2026-10-18T10:00:00");
  assert.equal(before.basePrice.toNumber(), 1300);
  assert.equal(before.festival, undefined);
  const noRules = price(card(), "2026-10-20T10:00:00", "2026-10-21T10:00:00", []);
  assert.equal(noRules.basePrice.toNumber(), 1300);
  assert.equal(noRules.festival, undefined);
  const noContext = selectBasePrice(
    card(),
    DurationCalculatorService.calculate(
      DateTime.fromJSDate(ist("2026-10-20T10:00:00")),
      DateTime.fromJSDate(ist("2026-10-21T10:00:00")),
    ),
  );
  assert.equal(noContext.basePrice.toNumber(), 1300);
});

test("overlapping rules: one rule per block, the one giving the highest rent", () => {
  const diwali = rule({ id: 2, name: "Diwali", startDate: "2026-10-21", endDate: "2026-10-21", percent: 25 });
  const offer = rule({ id: 3, name: "Festival offer", percent: -20 });
  // 20 → 22 Oct 10:00: day 1 Dussehra only, day 2 Dussehra / Diwali / offer → Diwali
  const sel = price(card(), "2026-10-20T10:00:00", "2026-10-22T10:00:00", [rule(), diwali, offer]);
  assert.equal(sel.basePrice.toNumber(), 1430 + 1625);
  assert.equal(sel.festival?.label, "Includes 1 festival day (Dussehra +10%) + 1 festival day (Diwali +25%)");
  assert.deepEqual(
    sel.festival?.rules.map((r) => [r.id, r.blocks, r.amount]),
    [
      [1, 1, 130],
      [2, 1, 325],
    ],
  );
  // two discounts: the smaller one wins (the higher rent)
  const discounts = festivalPriceFor(
    ms("2026-10-20T10:00:00"),
    ms("2026-10-21T10:00:00"),
    new Decimal(1300),
    [offer, rule({ id: 4, percent: -10 })],
  );
  assert.equal(discounts?.rule.id, 4);
  assert.equal(discounts?.price.toNumber(), 1170);
});

test("a negative percentage is a festival discount", () => {
  const sel = price(card(), "2026-10-20T10:00:00", "2026-10-21T10:00:00", [rule({ name: "Navratri offer", percent: -20 })]);
  assert.equal(sel.basePrice.toNumber(), 1040);
  assert.equal(sel.festival?.amount, -260);
  assert.equal(sel.festival?.label, "Includes 1 festival day (Navratri offer −20%)");
});

test("rents are rounded to the paisa, half-up", () => {
  assert.equal(applySpecialPercent(new Decimal(999), 7.5).toString(), "1073.93");
  assert.equal(applySpecialPercent(new Decimal(1333), 12.5).toString(), "1499.63");
  assert.equal(applySpecialPercent(new Decimal(1300), -90).toNumber(), 130);
  const sel = price(card({ price24Hour: new Decimal(999) }), "2026-10-20T10:00:00", "2026-10-21T10:00:00", [rule({ percent: 7.5 })]);
  assert.equal(sel.basePrice.toNumber(), 1073.93);
  assert.equal(sel.festival?.amount, 74.93);
  assert.equal(sel.festival?.label, "Includes 1 festival day (Dussehra +7.5%)");
});

test("the hourly cap applies first; free km never change", () => {
  // 20 Oct 08:00 → 13:00, hourly ₹100: 5 × ₹100 = ₹500 → ₹550
  const sel = price(card({ hourlyRate: new Decimal(100) }), "2026-10-20T08:00:00", "2026-10-20T13:00:00");
  assert.equal(sel.basePrice.toNumber(), 550);
  assert.equal(sel.billedAs, "5 hours");
  assert.equal(sel.freeKmLimit, Math.floor((5 * 150) / 24));
  assert.equal(sel.festival?.label, "Includes 5 festival hours (Dussehra +10%)");
  // 14 h: min(1400, 1300) = the 24-hour slab, then +10%
  const capped = price(card({ hourlyRate: new Decimal(100) }), "2026-10-20T08:00:00", "2026-10-20T22:00:00");
  assert.equal(capped.basePrice.toNumber(), 1430);
});

test("a remainder block is a festival block on its own", () => {
  // 19 Oct 10:00 → 20 Oct 20:00: 19→20 Oct 10:00 (14 h on the 19th) + 10 h remainder on the 20th
  const sel = price(card(), "2026-10-19T10:00:00", "2026-10-20T20:00:00");
  assert.equal(sel.basePrice.toNumber(), 1300 + 990);
  assert.equal(sel.billedAs, "1 day + 12 hours");
  assert.equal(sel.festival?.label, "Includes 12 festival hours (Dussehra +10%)");
});

test("weekend rents underneath: the weekend slab, then the festival percentage", () => {
  const weekendFestival = rule({ id: 5, name: "Weekend fair", startDate: "2026-10-24", endDate: "2026-10-25" });
  const sel = price(
    card({ weekendPrice24Hour: new Decimal(1600) }),
    "2026-10-24T10:00:00",
    "2026-10-25T10:00:00",
    [weekendFestival],
    [6, 7],
  );
  assert.equal(sel.basePrice.toNumber(), 1760);
  // the weekend label still names the weekend rent; the festival one the rule
  assert.equal(sel.weekend?.label, "Includes 1 weekend day at ₹1,600");
  assert.equal(sel.weekend?.weekendAmount, 1600);
  assert.equal(sel.festival?.label, "Includes 1 festival day (Weekend fair +10%)");
  assert.equal(sel.festival?.amount, 160);
});

test("a held 12-hour package is a festival block by its real hours", () => {
  const priceHeld = (from: string, realReturn: string) => {
    const startAt = ist(from);
    const duration = DurationCalculatorService.calculate(
      DateTime.fromJSDate(startAt),
      DateTime.fromJSDate(startAt).plus({ hours: 12 }),
    );
    return selectBasePrice(card(), duration, { startAt, endAt: ist(realReturn), weekendDays: [], specialRules: [rule()] });
  };
  // Festival evening 20 Oct 18:00 → 22:30: billed as 12 hours, at the festival rent
  const evening = priceHeld("2026-10-20T18:00:00", "2026-10-20T22:30:00");
  assert.equal(evening.basePrice.toNumber(), 990);
  assert.equal(evening.billedAs, "12 hours");
  assert.equal(evening.freeKmLimit, 100);
  assert.equal(evening.festival?.label, "Includes 12 festival hours (Dussehra +10%)");
  // The eve, 19 Oct 18:00 → 22:30: pickup + 12 h would reach 20 Oct 06:00 (a 6 / 12 tie),
  // but the car is only out on the 19th
  const eve = priceHeld("2026-10-19T18:00:00", "2026-10-19T22:30:00");
  assert.equal(eve.basePrice.toNumber(), 900);
  assert.equal(eve.festival, undefined);
});

test("monthly: full months are never festival blocks, overflow days are", () => {
  const monthly = card({ priceMonthly: new Decimal(25000) });
  const late = rule({ id: 6, name: "Fair", startDate: "2026-11-11", endDate: "2026-11-12" });
  // 12 Oct 10:00 + 30 days = 11 Nov 10:00 (the month holds Dussehra); one overflow day on the fair
  const sel = price(monthly, "2026-10-12T10:00:00", "2026-11-12T10:00:00", [rule(), late]);
  assert.equal(sel.basePrice.toNumber(), 25000 + 1430);
  assert.equal(sel.billedAs, "1 month + 1 day");
  assert.equal(sel.festival?.label, "Includes 1 festival day (Fair +10%)");
  const monthOnly = price(monthly, "2026-10-12T10:00:00", "2026-11-11T10:00:00", [rule()]);
  assert.equal(monthOnly.basePrice.toNumber(), 25000);
  assert.equal(monthOnly.festival, undefined);
});

test("extension delta: both terms at today's rules — the booked days cancel, new days pick up the festival", () => {
  // Booked 17 → 20 Oct 10:00 (day 3 already on Dussehra); extended to 22 Oct 10:00
  const booked = price(card(), "2026-10-17T10:00:00", "2026-10-20T10:00:00");
  const extended = price(card(), "2026-10-17T10:00:00", "2026-10-22T10:00:00");
  assert.equal(booked.basePrice.toNumber(), 3 * 1300);
  assert.equal(extended.basePrice.sub(booked.basePrice).toNumber(), 2 * 1430);
  // A remainder grown into a full day: only the difference is charged, at the festival rate
  const short = price(card(), "2026-10-18T10:00:00", "2026-10-20T16:00:00");
  const longer = price(card(), "2026-10-18T10:00:00", "2026-10-21T10:00:00");
  assert.equal(short.basePrice.toNumber(), 2 * 1300 + 990);
  assert.equal(longer.basePrice.sub(short.basePrice).toNumber(), 1430 - 990);
});

test("scope, overlap and stored rules", () => {
  const car = { id: 7, categoryId: 3 };
  assert.equal(ruleCoversVehicle(rule(), car), true);
  assert.equal(ruleCoversVehicle(rule({ scope: "CATEGORIES", categoryIds: [3] }), car), true);
  assert.equal(ruleCoversVehicle(rule({ scope: "CATEGORIES", categoryIds: [4] }), car), false);
  assert.equal(ruleCoversVehicle(rule({ scope: "VEHICLES", vehicleIds: [7, 8] }), car), true);
  assert.equal(ruleCoversVehicle(rule({ scope: "VEHICLES", vehicleIds: [8] }), car), false);

  const later = rule({ id: 9, startDate: "2026-11-01", endDate: "2026-11-02" });
  assert.deepEqual(
    rulesOverlapping([rule(), later], ms("2026-10-22T20:00:00"), ms("2026-10-23T20:00:00")).map((r) => r.id),
    [1],
  );

  // Made before festival pricing: no stored rules at all
  assert.equal(specialRulesOf({ items: [], weekendDays: [6, 7] }), null);
  assert.equal(specialRulesOf(null), null);
  assert.deepEqual(specialRulesOf({ specialRules: [] }), []);
  assert.deepEqual(specialRulesOf({ specialRules: [rule()] }), [rule()]);
  // Malformed entries are dropped
  assert.deepEqual(
    normalizeSpecialRules([rule(), { id: 2, name: "x", startDate: "2026-02-30", endDate: "2026-03-01", percent: 5 }, null, { ...rule(), percent: 0 }]),
    [rule()],
  );
});

test("withItemFestivalBreakdowns sets or removes each item's festival breakdown", () => {
  const breakdown = { festivalBlocks: 1, label: "Includes 1 festival day (Dussehra +10%)" };
  const snapshot = {
    specialRules: [rule()],
    items: [
      { vehicleId: 7, pricingBreakdown: { billedAs: "1 day" } },
      { vehicleId: 9, pricingBreakdown: { billedAs: "1 day", festival: breakdown } },
    ],
  };
  const next = withItemFestivalBreakdowns(snapshot, [{ vehicleId: 9 }, { vehicleId: 7, festival: breakdown }]);
  assert.deepEqual(next.items, [
    { vehicleId: 7, pricingBreakdown: { billedAs: "1 day", festival: breakdown } },
    { vehicleId: 9, pricingBreakdown: { billedAs: "1 day" } },
  ]);
  assert.deepEqual(next.specialRules, [rule()]);
});

// ── Stored rules: confirmed extensions / swaps, and reschedule ────────────────

const rent = (from: string, to: string, rules: readonly SpecialRule[]) =>
  price(card(), from, to, rules).basePrice.toNumber();
const span = (from: string, to: string) => ({ startMs: ms(from), endMs: ms(to) });

test("a confirmed extension stores the live rules touching the added time (a stored version wins)", () => {
  const diwali = rule({ id: 2, name: "Diwali", startDate: "2026-11-08", endDate: "2026-11-09" });
  // Added time 19 Oct 10:00 → 21 Oct 10:00: Dussehra touches it, Diwali doesn't
  assert.deepEqual(
    mergeRulesForTime([], [rule(), diwali], ms("2026-10-19T10:00:00"), ms("2026-10-21T10:00:00")).map((r) => r.id),
    [1],
  );
  // Already stored at +10%, edited to +20% since: the stored version stays
  const merged = mergeRulesForTime([rule()], [rule({ percent: 20 })], ms("2026-10-19T10:00:00"), ms("2026-10-21T10:00:00"));
  assert.deepEqual(merged, [rule()]);
  // A booking made before festival pricing gains the rule
  assert.deepEqual(mergeRulesForTime(null, [rule()], ms("2026-10-21T00:00:00"), ms("2026-10-21T10:00:00")), [rule()]);
});

test("reschedule after an extension into a festival: the extended window prices as charged", () => {
  // Booked 18 → 19 Oct 10:00 (no festival), extended to 21 Oct 10:00 at today's rules
  const live = [rule()];
  const charged =
    rent("2026-10-18T10:00:00", "2026-10-19T10:00:00", []) +
    (rent("2026-10-18T10:00:00", "2026-10-21T10:00:00", live) - rent("2026-10-18T10:00:00", "2026-10-19T10:00:00", live));
  assert.equal(charged, 1300 + 1300 + 1430);
  const stored = mergeRulesForTime([], live, ms("2026-10-19T10:00:00"), ms("2026-10-21T10:00:00"));

  // +1 h: same rent both sides → allowed
  const sets = rescheduleRuleSets(stored, live);
  assert.equal(rent("2026-10-18T10:00:00", "2026-10-21T10:00:00", sets.current), charged);
  assert.equal(rent("2026-10-18T11:00:00", "2026-10-21T11:00:00", sets.next), charged);
  // Without the stored rule the current window would price at ₹3,900 and refuse the move
  assert.equal(rent("2026-10-18T10:00:00", "2026-10-21T10:00:00", rescheduleRuleSets([], live).current), 3900);
  // Off the festival: ₹3,900 ≠ ₹4,030 → refused (no festival money kept for plain days)
  assert.equal(rent("2026-10-25T10:00:00", "2026-10-28T10:00:00", sets.next), 3900);
});

test("reschedule: a rule deleted, paused or edited since still counts as stored", () => {
  const stored = [rule()]; // booked on Dussehra at +10%
  const deleted = rescheduleRuleSets(stored, []);
  const edited = rescheduleRuleSets(stored, [rule({ percent: 20 })]);
  for (const sets of [deleted, edited]) {
    // 20 → 21 Oct moved by an hour: ₹1,430 both sides → allowed
    assert.equal(rent("2026-10-20T10:00:00", "2026-10-21T10:00:00", sets.current), 1430);
    assert.equal(rent("2026-10-20T11:00:00", "2026-10-21T11:00:00", sets.next), 1430);
    // moved off the festival: ₹1,300 → refused
    assert.equal(rent("2026-10-25T10:00:00", "2026-10-26T10:00:00", sets.next), 1300);
  }
});

test("reschedule: a booking made before festival pricing gets today's rules on the new window", () => {
  const sets = rescheduleRuleSets(null, [rule()]);
  assert.deepEqual(sets.current, []);
  // Checked even without weekend days: the new window touches Dussehra
  assert.equal(
    rescheduleChecksRent([], sets, span("2026-10-15T10:00:00", "2026-10-16T10:00:00"), span("2026-10-20T10:00:00", "2026-10-21T10:00:00")),
    true,
  );
  // ₹1,300 → ₹1,430: moving onto the festival is refused
  assert.equal(rent("2026-10-15T10:00:00", "2026-10-16T10:00:00", sets.current), 1300);
  assert.equal(rent("2026-10-20T10:00:00", "2026-10-21T10:00:00", sets.next), 1430);
  // Nothing to compare: no weekend days, no rule touching either window
  assert.equal(
    rescheduleChecksRent([], sets, span("2026-10-15T10:00:00", "2026-10-16T10:00:00"), span("2026-10-16T10:00:00", "2026-10-17T10:00:00")),
    false,
  );
  // Weekend days alone still mean a check
  assert.equal(
    rescheduleChecksRent([6, 7], rescheduleRuleSets(null, []), span("2026-10-15T10:00:00", "2026-10-16T10:00:00"), span("2026-10-16T10:00:00", "2026-10-17T10:00:00")),
    true,
  );
});

// ── Flat ₹ a day ──────────────────────────────────────────────────────────────

test("a flat-only rule adds its ₹ a day to a festival day", () => {
  const flat = rule({ percent: 0, flatAmount: 200 });
  const sel = price(card(), "2026-10-20T10:00:00", "2026-10-23T10:00:00", [flat]);
  assert.equal(sel.basePrice.toNumber(), 3 * 1500);
  assert.equal(sel.freeKmLimit, 450);
  assert.equal(sel.festival?.amount, 600);
  assert.deepEqual(sel.festival?.rules, [{ id: 1, name: "Dussehra", percent: 0, flatAmount: 200, blocks: 3, amount: 600 }]);
  assert.equal(sel.festival?.label, "Includes 3 festival days (Dussehra +₹200/day)");
});

test("percentage and flat together: rent × (1 + %) + flat, rounded to the paisa", () => {
  const both = rule({ percent: 10, flatAmount: 200 });
  const sel = price(card(), "2026-10-20T10:00:00", "2026-10-21T10:00:00", [both]);
  assert.equal(sel.basePrice.toNumber(), 1430 + 200);
  assert.equal(sel.festival?.label, "Includes 1 festival day (Dussehra +10% + ₹200/day)");
  // 7.5% of ₹999 + ₹33.33 = 1073.925 + 33.33 → ₹1,107.26 (one rounding, half-up)
  assert.equal(applySpecialRule(new Decimal(999), { percent: 7.5, flatAmount: 33.33 }).toString(), "1107.26");
  // A discount percentage with a flat surcharge
  assert.equal(
    price(card(), "2026-10-20T10:00:00", "2026-10-21T10:00:00", [rule({ percent: -10, flatAmount: 50 })]).festival?.label,
    "Includes 1 festival day (Dussehra −10% + ₹50/day)",
  );
});

test("a negative flat amount is a festival discount, never below ₹0", () => {
  const off = rule({ name: "Diwali", percent: 0, flatAmount: -100 });
  const sel = price(card(), "2026-10-20T10:00:00", "2026-10-21T10:00:00", [off]);
  assert.equal(sel.basePrice.toNumber(), 1200);
  assert.equal(sel.festival?.amount, -100);
  assert.equal(sel.festival?.label, "Includes 1 festival day (Diwali −₹100/day)");
  // ₹1,300 − ₹5,000 → ₹0
  const huge = price(card(), "2026-10-20T10:00:00", "2026-10-21T10:00:00", [rule({ percent: 0, flatAmount: -5000 })]);
  assert.equal(huge.basePrice.toNumber(), 0);
  assert.equal(huge.festival?.amount, -1300);
  assert.equal(applySpecialRule(new Decimal(1300), { percent: -50, flatAmount: -1000 }).toNumber(), 0);
});

test("the 12-hour slab gets half the flat amount, held to closing included", () => {
  const flat = rule({ percent: 0, flatAmount: 200 });
  // 8 h on the festival billed at the 12-hour slab: ₹900 + ₹100
  const short = price(card(), "2026-10-20T08:00:00", "2026-10-20T16:00:00", [flat]);
  assert.equal(short.billedAs, "12 hours");
  assert.equal(short.basePrice.toNumber(), 1000);
  assert.equal(short.festival?.label, "Includes 12 festival hours (Dussehra +₹200/day)");
  // Held to closing on the festival evening (billed pickup + 12 h): ₹900 + ₹100
  const startAt = ist("2026-10-20T18:00:00");
  const held = selectBasePrice(
    card(),
    DurationCalculatorService.calculate(DateTime.fromJSDate(startAt), DateTime.fromJSDate(startAt).plus({ hours: 12 })),
    { startAt, endAt: ist("2026-10-20T22:30:00"), weekendDays: [], specialRules: [flat] },
  );
  assert.equal(held.basePrice.toNumber(), 1000);
  // A remainder block on the 12-hour slab: 1 day + 10 h → ₹1,500 + ₹1,000
  const rest = price(card(), "2026-10-20T10:00:00", "2026-10-21T20:00:00", [flat]);
  assert.equal(rest.basePrice.toNumber(), 1500 + 1000);
});

test("an hourly block gets its hours' share of the flat amount", () => {
  // 5 h billed by the hour (₹100/h): ₹500 + 5/24 × ₹240 = ₹550
  const sel = price(card({ hourlyRate: new Decimal(100) }), "2026-10-20T08:00:00", "2026-10-20T13:00:00", [
    rule({ percent: 0, flatAmount: 240 }),
  ]);
  assert.equal(sel.billedAs, "5 hours");
  assert.equal(sel.basePrice.toNumber(), 550);
  assert.equal(sel.festival?.label, "Includes 5 festival hours (Dussehra +₹240/day)");
  // 5/24 × ₹200 = ₹41.666… → ₹41.67 with +10%: 550 + 41.67 = 591.67
  const both = price(card({ hourlyRate: new Decimal(100) }), "2026-10-20T08:00:00", "2026-10-20T13:00:00", [
    rule({ percent: 10, flatAmount: 200 }),
  ]);
  assert.equal(both.basePrice.toNumber(), 591.67);
});

test("overlapping percentage and flat rules: the highest resulting rent wins per block", () => {
  // Day rent ₹1,300: +10% = ₹1,430, +₹200 = ₹1,500 → flat wins on the day block
  const pct = rule({ id: 1, name: "Dussehra", percent: 10 });
  const flat = rule({ id: 2, name: "Fair", percent: 0, flatAmount: 200 });
  const day = price(card(), "2026-10-20T10:00:00", "2026-10-21T10:00:00", [pct, flat]);
  assert.equal(day.basePrice.toNumber(), 1500);
  assert.equal(day.festival?.label, "Includes 1 festival day (Fair +₹200/day)");
  // 12-hour slab ₹900: +10% = ₹990, half of ₹200 = ₹1,000 → still the flat rule
  const half = price(card(), "2026-10-20T08:00:00", "2026-10-20T16:00:00", [pct, flat]);
  assert.equal(half.basePrice.toNumber(), 1000);
  // 24-hour rent ₹3,000: +10% = ₹3,300 beats +₹200 = ₹3,200
  const dear = price(card({ price24Hour: new Decimal(3000) }), "2026-10-20T10:00:00", "2026-10-21T10:00:00", [pct, flat]);
  assert.equal(dear.basePrice.toNumber(), 3300);
  assert.equal(dear.festival?.rules[0]?.id, 1);
  // A flat discount and a percentage rise: the rise wins
  const mixed = price(card(), "2026-10-20T10:00:00", "2026-10-21T10:00:00", [rule({ id: 3, percent: 0, flatAmount: -100 }), pct]);
  assert.equal(mixed.basePrice.toNumber(), 1430);
});

test("stored rules without flatAmount (older snapshots) read as 0", () => {
  const { flatAmount: _flat, ...old } = rule();
  assert.deepEqual(normalizeSpecialRules([old]), [rule()]);
  assert.deepEqual(normalizeSpecialRules([{ ...old, percent: 0, flatAmount: 150 }]), [rule({ percent: 0, flatAmount: 150 })]);
});

test("with a festival rule the hourly and slab options are both priced with it, the cheaper billed", () => {
  // Hourly ₹56.10, 24-hour slab ₹1,300, −₹600/day: 23 h = 23 × 56.10 = ₹1,290.30 by the hour
  // (cheaper than the slab before the rule), but with the rule ₹1,290.30 − 23/24 × ₹600 =
  // ₹715.30 against ₹1,300 − ₹600 = ₹700 — the slab, never more than the full day
  const hourly = card({ hourlyRate: new Decimal("56.10"), price12Hour: null });
  const off = rule({ name: "Offer", percent: 0, flatAmount: -600 });
  const h23 = price(hourly, "2026-10-20T00:00:00", "2026-10-20T23:00:00", [off]);
  const h24 = price(hourly, "2026-10-20T00:00:00", "2026-10-21T00:00:00", [off]);
  assert.equal(h24.basePrice.toNumber(), 700);
  assert.equal(h23.basePrice.toNumber(), 700);
  assert.ok(h23.basePrice.lte(h24.basePrice));
  // The slab won: billed as a day with the slab's free km; the festival changed ₹1,290.30 → ₹700
  assert.equal(h23.billedAs, "1 day");
  assert.equal(h23.freeKmLimit, 150);
  assert.equal(h23.festival?.amount, -590.3);
  assert.equal(h23.festival?.label, "Includes 1 festival day (Offer −₹600/day)");
  // Without a rule the hourly option still wins
  const plain = price(hourly, "2026-10-20T00:00:00", "2026-10-20T23:00:00", []);
  assert.equal(plain.basePrice.toNumber(), 1290.3);
  assert.equal(plain.billedAs, "23 hours");
  // A positive flat share can make the hours the cheaper option: 23 × ₹57 = ₹1,311 > ₹1,300
  // (the slab before the rule), but with +₹600/day ₹1,311 + ₹575 = ₹1,886 < ₹1,900
  const near = price(card({ hourlyRate: new Decimal(57), price12Hour: null }), "2026-10-20T00:00:00", "2026-10-20T23:00:00", [
    rule({ percent: 0, flatAmount: 600 }),
  ]);
  assert.equal(price(card({ hourlyRate: new Decimal(57), price12Hour: null }), "2026-10-20T00:00:00", "2026-10-20T23:00:00", []).billedAs, "1 day");
  assert.equal(near.basePrice.toNumber(), 1886);
  assert.equal(near.billedAs, "23 hours");
  assert.equal(near.freeKmLimit, Math.floor((23 * 150) / 24));
});

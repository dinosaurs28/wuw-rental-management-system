/**
 * Late / extra-hour charges bill whole hours only, rounded DOWN (client,
 * Oct 17 2026): 1 h 30 min → 1 hr, 2 h 59 min → 2 hr, under an hour → nothing.
 * The floor applies to the minutes left after any grace. Covers the drop-bill
 * maths (calculateLateReturnCharge), the charge-engine EXTRA_TIME module and
 * DurationCalculator.calculateExtraHours. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { calculateLateReturnCharge, type LateReturnPolicy } from "./late-return.service.js";
import { ExtraTimeModule } from "./modules/extra-time.module.js";
import { DurationCalculatorService as DurationCalculator } from "../pricing/duration-calculator.service.js";
import type { ChargeContext } from "../../types/charge-engine.types.js";

const DUE = new Date("2026-10-17T12:35:00.000Z"); // 6:05 PM IST
const after = (minutes: number) => new Date(DUE.getTime() + minutes * 60_000);

const policy = (over: Partial<LateReturnPolicy> = {}): LateReturnPolicy => ({
  extraTimeEnabled: true,
  gracePolicyEnabled: false,
  graceType: "AUTOMATIC",
  graceMinutes: 0,
  extraHourRate: new Decimal(100),
  ...over,
});

test("late return: whole hours only, rounded down", () => {
  const cases: Array<[number, number]> = [
    [60, 1],
    [89, 1],
    [90, 1], // 1 h 30 min → 1 hr
    [119, 1],
    [120, 2],
    [179, 2], // 2 h 59 min → 2 hr
    [180, 3],
    [61 * 24, 24],
  ];
  for (const [late, hours] of cases) {
    const c = calculateLateReturnCharge(DUE, after(late), policy());
    assert.equal(c.lateMinutes, late);
    assert.equal(c.hours, hours, `${late} min late`);
    assert.equal(c.status, "CHARGED");
    assert.equal(c.amount.toFixed(2), new Decimal(100 * hours).toFixed(2));
  }
});

test("late return: under one whole hour bills nothing", () => {
  for (const late of [1, 30, 59]) {
    const c = calculateLateReturnCharge(DUE, after(late), policy());
    assert.equal(c.hours, 0);
    assert.equal(c.chargeableMinutes, late);
    assert.equal(c.status, "UNDER_ONE_HOUR");
    assert.equal(c.amount.toFixed(2), "0.00");
    assert.equal(c.waivedAmount.toFixed(2), "0.00");
  }
  // Seconds past the hour don't count either
  const c = calculateLateReturnCharge(DUE, new Date(after(59).getTime() + 59_000), policy());
  assert.equal(c.status, "UNDER_ONE_HOUR");
});

test("late return: under an hour never blocks on a missing rate or needs a waiver", () => {
  const noRate = calculateLateReturnCharge(DUE, after(45), policy({ extraHourRate: null }));
  assert.equal(noRate.status, "UNDER_ONE_HOUR");
  const waived = calculateLateReturnCharge(DUE, after(45), policy(), { waive: true });
  assert.equal(waived.status, "UNDER_ONE_HOUR");
  assert.equal(waived.waivedAmount.toFixed(2), "0.00");
  // A whole hour without a rate still needs the rate (or a waiver)
  assert.equal(calculateLateReturnCharge(DUE, after(60), policy({ extraHourRate: null })).status, "RATE_UNAVAILABLE");
  const waivedHour = calculateLateReturnCharge(DUE, after(150), policy(), { waive: true });
  assert.equal(waivedHour.status, "WAIVED");
  assert.equal(waivedHour.waivedAmount.toFixed(2), "200.00");
});

test("late return: floor applies to the minutes left after grace", () => {
  const auto = policy({ gracePolicyEnabled: true, graceType: "AUTOMATIC", graceMinutes: 30 });
  // 1 h 29 min late − 30 min grace = 59 min → nothing
  const a = calculateLateReturnCharge(DUE, after(89), auto);
  assert.equal(a.chargeableMinutes, 59);
  assert.equal(a.status, "UNDER_ONE_HOUR");
  assert.equal(a.amount.toFixed(2), "0.00");
  // 2 h late − 30 min = 1 h 30 min → 1 hr
  const b = calculateLateReturnCharge(DUE, after(120), auto);
  assert.equal(b.hours, 1);
  assert.equal(b.amount.toFixed(2), "100.00");
  // Within grace stays WITHIN_GRACE
  assert.equal(calculateLateReturnCharge(DUE, after(20), auto).status, "WITHIN_GRACE");

  const manual = policy({ gracePolicyEnabled: true, graceType: "MANUAL", graceMinutes: 30 });
  assert.equal(calculateLateReturnCharge(DUE, after(80), manual).hours, 1); // grace not ticked: 1 h 20 min → 1 hr
  assert.equal(calculateLateReturnCharge(DUE, after(80), manual, { applyGrace: true }).status, "UNDER_ONE_HOUR"); // 80 − 30 = 50 min
});

test("late return: on time, disabled", () => {
  assert.equal(calculateLateReturnCharge(DUE, DUE, policy()).status, "ON_TIME");
  assert.equal(calculateLateReturnCharge(DUE, after(-30), policy()).status, "ON_TIME");
  assert.equal(calculateLateReturnCharge(DUE, after(150), policy({ extraTimeEnabled: false })).status, "DISABLED");
  assert.equal(calculateLateReturnCharge(DUE, after(30), policy({ extraTimeEnabled: false })).status, "DISABLED");
});

function ctx(lateMinutes: number, over: Partial<ChargeContext["frozenConfig"]> = {}, applyGrace?: boolean): ChargeContext {
  return {
    endAt: DUE,
    actualReturnAt: after(lateMinutes),
    vehiclePricing: { extraHourRate: new Decimal(100) },
    frozenConfig: {
      extraTimeEnabled: true,
      gracePolicyEnabled: false,
      graceType: "AUTOMATIC",
      graceMinutes: 0,
      ...over,
    },
    applyGrace,
  } as unknown as ChargeContext;
}

test("EXTRA_TIME module: whole hours, rounded down", async () => {
  const m = new ExtraTimeModule();
  const r90 = await m.compute(ctx(90));
  assert.equal(r90.finalAmount.toFixed(2), "100.00");
  assert.equal(r90.quantity?.toString(), "1");
  const r179 = await m.compute(ctx(179));
  assert.equal(r179.finalAmount.toFixed(2), "200.00");
  const r45 = await m.compute(ctx(45));
  assert.equal(r45.finalAmount.toFixed(2), "0.00");
  // after a 30-min grace: 2 h late → 1 h 30 min → 1 hr
  const g = await m.compute(ctx(120, { gracePolicyEnabled: true, graceMinutes: 30 }));
  assert.equal(g.finalAmount.toFixed(2), "100.00");
});

test("DurationCalculator.calculateExtraHours: whole hours after its 15-min grace, rounded down", () => {
  const due = DateTime.fromJSDate(DUE);
  const at = (m: number) => DateTime.fromJSDate(after(m));
  assert.equal(DurationCalculator.calculateExtraHours(due, at(10)), 0);
  assert.equal(DurationCalculator.calculateExtraHours(due, at(60)), 0); // 45 min after grace
  assert.equal(DurationCalculator.calculateExtraHours(due, at(75)), 1);
  assert.equal(DurationCalculator.calculateExtraHours(due, at(105)), 1); // 1 h 30 min after grace
  assert.equal(DurationCalculator.calculateExtraHours(due, at(194)), 2); // 2 h 59 min after grace
});

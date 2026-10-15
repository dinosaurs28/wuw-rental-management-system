/**
 * Customer / public responses leave out festival pricing details
 * (festivalPrivacy.ts); totals and everything else stay. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { withoutFestivalPricing } from "./festivalPrivacy.js";

const festival = {
  festivalBlocks: 1,
  amount: 130,
  rules: [{ id: 1, name: "Dussehra", percent: 10, flatAmount: 0, blocks: 1, amount: 130 }],
  label: "Includes 1 festival day (Dussehra +10%)",
};
const weekend = { weekendBlocks: 1, weekdayBlocks: 0, label: "Includes 1 weekend day at ₹1,600" };

test("listing: the festival breakdown goes with the weekend label beside it; the price stays", () => {
  const body = {
    count: 1,
    data: [{ groupKey: "G", pricing: { daily: 1760 }, pricingDetails: { price: 1760, finalPrice: 1760, weekend, festival } }],
  };
  assert.deepEqual(withoutFestivalPricing(body), {
    count: 1,
    data: [{ groupKey: "G", pricing: { daily: 1760 }, pricingDetails: { price: 1760, finalPrice: 1760 } }],
  });
  // the input is not changed (cached payloads are shared)
  assert.equal(body.data[0]!.pricingDetails.festival, festival);
});

test("a weekend label without a festival price is kept", () => {
  const body = { pricingDetails: { price: 1600, finalPrice: 1600, weekend } };
  assert.deepEqual(withoutFestivalPricing(body), body);
});

test("details / summary: pricingBreakdown.festival and stored specialRules go at any depth", () => {
  const body = {
    message: "Success",
    data: {
      items: [{ finalTotal: 1430, pricingBreakdown: { billedAs: "1 day", festival, specialRules: [{ id: 1 }] } }],
      pricingSnapshot: { specialRules: [{ id: 1, name: "Dussehra" }], weekendDays: [6, 7] },
    },
  };
  assert.deepEqual(withoutFestivalPricing(body), {
    message: "Success",
    data: {
      items: [{ finalTotal: 1430, pricingBreakdown: { billedAs: "1 day" } }],
      pricingSnapshot: { weekendDays: [6, 7] },
    },
  });
});

test("non-plain values, primitives and an unrelated `festival` value are kept", () => {
  const when = new Date("2026-10-16T10:00:00+05:30");
  const money = new Decimal("1430.00");
  const out = withoutFestivalPricing({ when, money, festival: "Diwali", n: null, list: [1, "a"] });
  assert.equal(out.when, when);
  assert.equal(out.money, money);
  assert.equal(out.festival, "Diwali");
  assert.equal(out.n, null);
  assert.deepEqual(out.list, [1, "a"]);
  assert.equal(withoutFestivalPricing(undefined), undefined);
  assert.equal(withoutFestivalPricing("ok"), "ok");
});

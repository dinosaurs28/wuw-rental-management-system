/**
 * Customer monthly booking (client TODO items 1–3, Oct 23 2026): monthly price
 * selection (the vehicle's own monthly price only) and the exactly-30-day rule.
 * No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import {
  CUSTOMER_MONTHLY_DAYS,
  MONTHLY_MAX_DAYS,
  bookingSummarySchema,
  customerMonthlyEnd,
  isCustomerMonthlyLength,
  parseBookingPlan,
  splitRentTotal,
  validateBookingWindow,
} from "@repo/schemas";
import { hasVehicleMonthlyPrice, monthlyPlanInfo, monthlyPortion, vehicleMonthlyPrice } from "./monthlyPlan.js";
import { selectBasePrice, type RateCard } from "../../services/pricing/base-price-rule.js";
import { DurationCalculatorService } from "../../services/pricing/duration-calculator.service.js";

const ist = (local: string) => new Date(`${local}+05:30`);
const DAY = 24 * 60 * 60 * 1000;

// ── Monthly price selection ──────────────────────────────────────────────────

test("vehicleMonthlyPrice: the vehicle's own enabled monthly price only", () => {
  assert.equal(vehicleMonthlyPrice({ enabled: true, priceMonthly: "30000" })?.toNumber(), 30000);
  assert.equal(vehicleMonthlyPrice({ enabled: true, priceMonthly: new Decimal("24999.50") })?.toNumber(), 24999.5);
  assert.equal(vehicleMonthlyPrice({ priceMonthly: 18000 })?.toNumber(), 18000, "enabled omitted counts as enabled");
  // Not configured
  assert.equal(vehicleMonthlyPrice(null), null, "no custom pricing (branch defaults) → none");
  assert.equal(vehicleMonthlyPrice(undefined), null);
  assert.equal(vehicleMonthlyPrice({ enabled: true, priceMonthly: null }), null);
  assert.equal(vehicleMonthlyPrice({ enabled: true, priceMonthly: "0" }), null, "₹0 = not offered");
  assert.equal(vehicleMonthlyPrice({ enabled: true, priceMonthly: "" }), null);
  assert.equal(vehicleMonthlyPrice({ enabled: false, priceMonthly: "30000" }), null, "disabled custom pricing → branch defaults → none");
  assert.equal(hasVehicleMonthlyPrice({ enabled: true, priceMonthly: "30000" }), true);
  assert.equal(hasVehicleMonthlyPrice({ enabled: true, priceMonthly: null }), false);
});

test("monthlyPlanInfo: price and free km, or 'not set'", () => {
  assert.deepEqual(monthlyPlanInfo({ enabled: true, priceMonthly: "30000", freeKmMonthly: 2000 }), {
    plan: "MONTHLY", days: 30, priceMonthly: 30000, freeKmMonthly: 2000, bookable: true,
  });
  assert.deepEqual(monthlyPlanInfo(null), {
    plan: "MONTHLY", days: 30, priceMonthly: null, freeKmMonthly: null, bookable: false,
  });
});

const card = (over: Partial<RateCard> = {}): RateCard => ({
  hourlyRate: new Decimal(100),
  price12Hour: new Decimal(800),
  price24Hour: new Decimal(1300),
  priceMonthly: new Decimal(30000),
  freeKm12Hour: 100,
  freeKm24Hour: 150,
  freeKmMonthly: 2000,
  ...over,
});
const window30 = (startLocal: string) => {
  const start = DateTime.fromISO(startLocal, { zone: "Asia/Kolkata" });
  return DurationCalculatorService.calculate(start, start.plus({ days: CUSTOMER_MONTHLY_DAYS }));
};

test("30 days at a vehicle's monthly price: one month, priceMonthly, freeKmMonthly — never the daily rate", () => {
  const sel = selectBasePrice(card(), window30("2026-11-02T10:00"));
  assert.equal(sel.billedAsType, "MONTHLY");
  assert.equal(sel.billedAs, "1 month");
  assert.equal(sel.basePrice.toNumber(), 30000, "not 30 × ₹1,300");
  assert.equal(sel.freeKmLimit, 2000);
  // Weekend rates never touch a full month
  const weekend = selectBasePrice(
    card({ weekendPrice24Hour: new Decimal(2000) }),
    window30("2026-11-07T10:00"),
    { startAt: ist("2026-11-07T10:00"), weekendDays: [6, 7] },
  );
  assert.equal(weekend.basePrice.toNumber(), 30000);
  assert.equal(weekend.weekend, undefined);
});

test("monthly price is GST-inclusive: GST is split out, never added on top", () => {
  const s = splitRentTotal(30000, { cgstRate: 9, sgstRate: 9 });
  assert.equal(s.gst, 5400);
  assert.equal(s.taxable + s.gst, 30000);
});

test("without a monthly price the engine bills per day (why Monthly hides such cars)", () => {
  const sel = selectBasePrice(card({ priceMonthly: null }), window30("2026-11-02T10:00"));
  assert.equal(sel.billedAsType, "MULTI_DAY");
  assert.equal(sel.basePrice.toNumber(), 30 * 1300);
});

test("monthlyPortion: the months part a duration slab never reduces", () => {
  // Exactly 30 days: the whole rent is the month — nothing left to discount
  const m30 = monthlyPortion("30000", window30("2026-11-02T10:00"));
  assert.equal(m30?.fullMonths, 1);
  assert.equal(m30?.amount.toNumber(), 30000);
  assert.equal(m30?.remainderHours, 0);
  // Counter plan, 45 days: 1 month + 15 days (the remainder keeps its own slab)
  const start = DateTime.fromISO("2026-11-02T10:00", { zone: "Asia/Kolkata" });
  const d45 = DurationCalculatorService.calculate(start, start.plus({ days: 45 }));
  const m45 = monthlyPortion(new Decimal(30000), d45);
  assert.equal(m45?.fullMonths, 1);
  assert.equal(m45?.amount.toNumber(), 30000);
  assert.equal(m45?.remainderHours, 15 * 24);
  const d90 = DurationCalculatorService.calculate(start, start.plus({ days: 90 }));
  assert.equal(monthlyPortion(30000, d90)?.amount.toNumber(), 90000);
  // Nothing at the monthly price
  assert.equal(monthlyPortion(null, d45), null, "no monthly rate");
  assert.equal(monthlyPortion("0", d45), null);
  const d29 = DurationCalculatorService.calculate(start, start.plus({ days: 29 }));
  assert.equal(monthlyPortion(30000, d29), null, "under 30 days");
});

// ── Exactly 30 days ──────────────────────────────────────────────────────────

test("isCustomerMonthlyLength: exactly 30 × 24 h (within a minute)", () => {
  const start = ist("2026-11-02T10:00");
  assert.equal(isCustomerMonthlyLength(start, new Date(start.getTime() + 30 * DAY)), true);
  assert.equal(isCustomerMonthlyLength(start, new Date(start.getTime() + 30 * DAY + 30_000)), true);
  assert.equal(isCustomerMonthlyLength(start, new Date(start.getTime() + 29 * DAY)), false, "29 days");
  assert.equal(isCustomerMonthlyLength(start, new Date(start.getTime() + 31 * DAY)), false, "31 days");
  assert.equal(isCustomerMonthlyLength(start, new Date(start.getTime() + 30 * DAY + 60 * 60_000)), false, "30 days + 1 h");
  assert.equal(isCustomerMonthlyLength(start, new Date(start.getTime() + 30 * DAY - 60 * 60_000)), false, "30 days − 1 h");
  assert.equal(isCustomerMonthlyLength("2026-11-02T04:30:00.000Z", "2026-12-02T04:30:00.000Z"), true, "ISO strings");
  assert.equal(isCustomerMonthlyLength("bad", "2026-12-02T04:30:00.000Z"), false);
});

test("customerMonthlyEnd: pickup + 30 × 24 h, same clock time in IST", () => {
  const end = customerMonthlyEnd(ist("2026-11-02T10:00"));
  assert.equal(end.toISOString(), ist("2026-12-02T10:00").toISOString());
});

test("counter monthly plan rule unchanged: 30–180 days still valid for staff", () => {
  const now = ist("2026-10-23T09:00");
  const start = ist("2026-10-25T10:00");
  const at = (days: number) => new Date(start.getTime() + days * DAY);
  assert.equal(validateBookingWindow({ startAt: start, endAt: at(45), now, monthly: true }).ok, true);
  assert.equal(validateBookingWindow({ startAt: start, endAt: at(MONTHLY_MAX_DAYS), now, monthly: true }).ok, true);
  assert.equal(validateBookingWindow({ startAt: start, endAt: at(29), now, monthly: true }).ok, false);
  // A customer monthly booking is a 30-day monthly booking
  assert.equal(validateBookingWindow({ startAt: start, endAt: customerMonthlyEnd(start), now, monthly: true }).ok, true);
});

// ── plan field (old builds omit it) ──────────────────────────────────────────

test("parseBookingPlan + bookingSummarySchema.plan", () => {
  assert.equal(parseBookingPlan(undefined), undefined);
  assert.equal(parseBookingPlan(""), undefined);
  assert.equal(parseBookingPlan("monthly"), "MONTHLY");
  assert.equal(parseBookingPlan("STANDARD"), "STANDARD");
  assert.equal(parseBookingPlan("weekly"), null);
  const base = { vehicles: ["v1"], start: "2026-11-02T10:00", end: "2026-12-02T10:00", payment_type: "ONLINE" };
  assert.equal(bookingSummarySchema.parse(base).plan, undefined, "old builds: no plan = daily flow");
  assert.equal(bookingSummarySchema.parse({ ...base, plan: "MONTHLY" }).plan, "MONTHLY");
  assert.equal(bookingSummarySchema.parse({ ...base, plan: "monthly" }).plan, "MONTHLY");
  assert.equal(bookingSummarySchema.parse({ ...base, plan: null }).plan, undefined);
  assert.equal(bookingSummarySchema.safeParse({ ...base, plan: "YEARLY" }).success, false);
});

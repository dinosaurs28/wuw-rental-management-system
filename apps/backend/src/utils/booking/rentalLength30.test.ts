/**
 * Pure checks of the 30-day rental length (client, Oct 2026: "12 hrs, 1 day,
 * 2 days … up to 30 days"): the package list, the length cap, extensions, and
 * how a 30-day standard booking sits next to the counter monthly plan (priced
 * at the monthly rate when one is set, else per day; stored as MULTI_DAY, not
 * MONTHLY). No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { RentalPeriodType } from "@repo/database/client";
import {
  CUSTOMER_PACKAGES,
  CUSTOMER_PACKAGE_HOURS,
  MAX_RENTAL_DAYS,
  MONTHLY_MIN_DAYS,
  customerPackageFor,
  extensionPackageOptions,
  isCustomerPackageDuration,
  validateBookingWindow,
  validateExtensionWindow,
} from "@repo/schemas";
import { bookingPeriodFields, standardRentalPeriodType } from "./rentalPeriod.js";
import { assertBookingWindow, extensionMaxEndAt } from "./bookingWindow.js";
import { selectBasePrice, type RateCard } from "../../services/pricing/base-price-rule.js";
import { DurationCalculatorService } from "../../services/pricing/duration-calculator.service.js";

const ist = (local: string) => new Date(`${local}+05:30`);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = ist("2026-10-17T10:00:00");
const start = ist("2026-10-20T10:00:00"); // a Tuesday

test("packages: 12 hours, then 1 day … 30 days", () => {
  assert.equal(MAX_RENTAL_DAYS, 30);
  assert.equal(CUSTOMER_PACKAGES.length, 31);
  assert.deepEqual(
    CUSTOMER_PACKAGES.map((p) => p.label).slice(0, 3),
    ["12 hours", "1 day", "2 days"],
  );
  const last = CUSTOMER_PACKAGES[CUSTOMER_PACKAGES.length - 1]!;
  assert.deepEqual([last.id, last.hours, last.days, last.label], ["30D", 720, 30, "30 days"]);
  assert.equal(CUSTOMER_PACKAGE_HOURS.at(-1), 720);
  assert.ok(CUSTOMER_PACKAGES.some((p) => p.label === "16 days"));
});

test("customer create: 30 days is a package, 31 days isn't", () => {
  assert.equal(isCustomerPackageDuration(start, new Date(start.getTime() + 30 * DAY)), true);
  assert.equal(customerPackageFor(start, new Date(start.getTime() + 30 * DAY))?.label, "30 days");
  assert.equal(isCustomerPackageDuration(start, new Date(start.getTime() + 20 * DAY)), true);
  assert.equal(isCustomerPackageDuration(start, new Date(start.getTime() + 31 * DAY)), false);
});

test("booking window: up to 30 days long, past that DURATION", () => {
  assert.equal(validateBookingWindow({ startAt: start, endAt: new Date(start.getTime() + 30 * DAY), now }).ok, true);
  assert.equal(
    assertBookingWindow(start, new Date(start.getTime() + 30 * DAY), { now }).toISOString(),
    new Date(start.getTime() + 30 * DAY).toISOString(),
  );
  const over = validateBookingWindow({ startAt: start, endAt: new Date(start.getTime() + 31 * DAY), now });
  assert.equal(!over.ok && over.reason, "DURATION");
});

test("extensions: up to 30 days from pickup; the options stop there", () => {
  const cap = extensionMaxEndAt(start, { now });
  assert.equal(cap.toISOString(), new Date(start.getTime() + 30 * DAY).toISOString());
  assert.equal(validateExtensionWindow({ bookingStartAt: start, newEndAt: cap, now }).ok, true);
  const opts = extensionPackageOptions(new Date(start.getTime() + 2 * DAY), cap);
  assert.equal(opts[0]!.label, "12 hours");
  assert.equal(opts.at(-1)!.label, "28 days");
});

test("monthly plan unchanged: 30–180 days, so 30 days is allowed on both plans", () => {
  assert.equal(MONTHLY_MIN_DAYS, 30);
  const end = new Date(start.getTime() + 30 * DAY);
  assert.equal(validateBookingWindow({ startAt: start, endAt: end, now, monthly: true }).ok, true);
  assert.equal(validateBookingWindow({ startAt: start, endAt: end, now }).ok, true);
  const tooShort = validateBookingWindow({ startAt: start, endAt: new Date(start.getTime() + 29 * DAY), now, monthly: true });
  assert.equal(!tooShort.ok && tooShort.reason, "MONTHLY_LENGTH");
});

test("a 30-day standard booking is stored as MULTI_DAY; only the plan is MONTHLY", () => {
  const end = new Date(start.getTime() + 30 * DAY);
  assert.equal(bookingPeriodFields(start, end).rentalPeriodType, RentalPeriodType.MULTI_DAY);
  assert.equal(bookingPeriodFields(start, end).days, 30);
  assert.equal(bookingPeriodFields(start, end, { monthly: true }).rentalPeriodType, RentalPeriodType.MONTHLY);
  // 29 days + 13 h bills as 720 h — still a standard booking
  assert.equal(
    bookingPeriodFields(start, new Date(start.getTime() + 29 * DAY + 13 * HOUR)).rentalPeriodType,
    RentalPeriodType.MULTI_DAY,
  );
  assert.equal(standardRentalPeriodType("MULTI_DAY"), RentalPeriodType.MULTI_DAY);
  assert.equal(standardRentalPeriodType("MONTHLY"), RentalPeriodType.MULTI_DAY);
  assert.equal(standardRentalPeriodType("FULL_DAY"), RentalPeriodType.FULL_DAY);
});

test("pricing a 30-day package: the monthly rate when set, else 30 day rates (same rule for listing and booking)", () => {
  const card = (priceMonthly: Decimal | null): RateCard => ({
    hourlyRate: null,
    price12Hour: new Decimal(900),
    price24Hour: new Decimal(1300),
    priceMonthly,
    freeKm12Hour: 100,
    freeKm24Hour: 150,
    freeKmMonthly: 3000,
  });
  const duration = DurationCalculatorService.calculate(
    DateTime.fromJSDate(start, { zone: "Asia/Kolkata" }),
    DateTime.fromJSDate(new Date(start.getTime() + 30 * DAY), { zone: "Asia/Kolkata" }),
  );
  assert.equal(duration.periodType, "MONTHLY"); // 720 billable hours

  const perDay = selectBasePrice(card(null), duration);
  assert.equal(perDay.basePrice.toNumber(), 30 * 1300);
  assert.equal(perDay.billedAsType, "MULTI_DAY");
  assert.equal(perDay.freeKmLimit, 30 * 150);

  const monthly = selectBasePrice(card(new Decimal(30000)), duration);
  assert.equal(monthly.basePrice.toNumber(), 30000);
  assert.equal(monthly.billedAsType, "MONTHLY");
  assert.equal(monthly.freeKmLimit, 3000);

  // 29 days stays on the day-rate path whatever the card
  const d29 = DurationCalculatorService.calculate(
    DateTime.fromJSDate(start, { zone: "Asia/Kolkata" }),
    DateTime.fromJSDate(new Date(start.getTime() + 29 * DAY), { zone: "Asia/Kolkata" }),
  );
  assert.equal(selectBasePrice(card(new Decimal(30000)), d29).basePrice.toNumber(), 29 * 1300);
});

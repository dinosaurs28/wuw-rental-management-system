/**
 * Daily / Monthly classification shared by the Fleet queues, the BM Fleet lists
 * and the monthly expiry reminder. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bookingListTypeOf,
  bookingTypeWhere,
  isMonthlyBooking,
  parseBookingListType,
} from "./bookingTypeFilter.js";

test("isMonthlyBooking: only rentalPeriodType MONTHLY is monthly", () => {
  assert.equal(isMonthlyBooking("MONTHLY"), true);
  // A 30-day standard booking is stored MULTI_DAY, so it stays Daily
  for (const t of ["HOURLY", "HALF_DAY", "FULL_DAY", "MULTI_DAY", null, undefined, "", "monthly"]) {
    assert.equal(isMonthlyBooking(t as string | null | undefined), false, String(t));
  }
});

test("bookingListTypeOf agrees with isMonthlyBooking", () => {
  assert.equal(bookingListTypeOf("MONTHLY"), "MONTHLY");
  assert.equal(bookingListTypeOf("MULTI_DAY"), "DAILY");
  assert.equal(bookingListTypeOf(null), "DAILY");
});

test("bookingTypeWhere: Monthly and Daily are disjoint and Daily keeps NULL rows", () => {
  assert.deepEqual(bookingTypeWhere("MONTHLY"), { rentalPeriodType: "MONTHLY" });
  assert.deepEqual(bookingTypeWhere("DAILY"), {
    OR: [{ rentalPeriodType: null }, { rentalPeriodType: { not: "MONTHLY" } }],
  });
  assert.deepEqual(bookingTypeWhere(undefined), {});
});

test("bookingTypeWhere matches isMonthlyBooking row by row", () => {
  // Evaluate the two Prisma fragments against plain rows (SQL NULL semantics)
  const matches = (where: ReturnType<typeof bookingTypeWhere>, value: string | null): boolean => {
    if ("rentalPeriodType" in where) return value === where.rentalPeriodType;
    if ("OR" in where && Array.isArray(where.OR)) {
      return value === null || value !== "MONTHLY";
    }
    return true;
  };
  for (const value of ["MONTHLY", "MULTI_DAY", "FULL_DAY", "HOURLY", "HALF_DAY", null]) {
    const monthly = matches(bookingTypeWhere("MONTHLY"), value);
    const daily = matches(bookingTypeWhere("DAILY"), value);
    assert.equal(monthly, isMonthlyBooking(value), `monthly ${value}`);
    assert.notEqual(monthly, daily, `exactly one tab for ${value}`);
  }
});

test("parseBookingListType", () => {
  assert.deepEqual(parseBookingListType(undefined), { ok: true, type: undefined });
  assert.deepEqual(parseBookingListType("monthly"), { ok: true, type: "MONTHLY" });
  assert.deepEqual(parseBookingListType(" Daily "), { ok: true, type: "DAILY" });
  assert.deepEqual(parseBookingListType("all"), { ok: true, type: undefined });
  assert.deepEqual(parseBookingListType("weekly"), { ok: false });
});

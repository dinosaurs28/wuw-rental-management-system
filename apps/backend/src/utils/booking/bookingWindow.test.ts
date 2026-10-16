/**
 * Pure checks of the booking window (#15; advance window raised to 30 days,
 * Oct 2026): a pickup up to ADVANCE_BOOKING_DAYS ahead, a booking up to
 * MAX_RENTAL_DAYS long, extensions capped from the original start, monthly
 * plan unchanged. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADVANCE_BOOKING_DAYS,
  MAX_RENTAL_DAYS,
  bookingWindowEnd,
  validateBookingWindow,
  validateExtensionWindow,
} from "@repo/schemas";
import { assertBookingWindow, BookingWindowError, extensionMaxEndAt, maxStandardEndAt } from "./bookingWindow.js";

const ist = (local: string) => new Date(`${local}+05:30`);
const HOUR = 3_600_000;
const now = ist("2026-10-16T10:00:00");

test("constants: 30 days ahead, 15 days long", () => {
  assert.equal(ADVANCE_BOOKING_DAYS, 30);
  assert.equal(MAX_RENTAL_DAYS, 15);
  assert.equal(bookingWindowEnd(now).toISOString(), ist("2026-11-15T23:59:59.999").toISOString());
});

test("a pickup on day 30 is accepted, with any package up to 15 days", () => {
  const start = ist("2026-11-15T10:00:00");
  assert.equal(validateBookingWindow({ startAt: start, endAt: new Date(start.getTime() + 12 * HOUR), now }).ok, true);
  const longest = new Date(start.getTime() + 15 * 24 * HOUR);
  assert.equal(validateBookingWindow({ startAt: start, endAt: longest, now }).ok, true);
  assert.equal(assertBookingWindow(start, longest, { now }).toISOString(), longest.toISOString());
  // late evening on day 30 is still day 30
  const late = ist("2026-11-15T22:00:00");
  assert.equal(validateBookingWindow({ startAt: late, endAt: new Date(late.getTime() + 24 * HOUR), now }).ok, true);
});

test("a pickup on day 31 is refused (WINDOW)", () => {
  const start = ist("2026-11-16T08:00:00");
  const r = validateBookingWindow({ startAt: start, endAt: new Date(start.getTime() + 12 * HOUR), now });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, "WINDOW");
  assert.match(!r.ok ? r.message : "", /30 days ahead.*15 Nov 2026/);
  assert.throws(
    () => assertBookingWindow(start, new Date(start.getTime() + 12 * HOUR), { now }),
    (e: unknown) => e instanceof BookingWindowError && e.reason === "WINDOW",
  );
  // the first instant of day 31
  const midnight = ist("2026-11-16T00:00:00");
  assert.equal(validateBookingWindow({ startAt: midnight, endAt: new Date(midnight.getTime() + 12 * HOUR), now }).ok, false);
});

test("a booking longer than 15 days is refused (DURATION), even inside the window", () => {
  const start = ist("2026-10-20T10:00:00");
  const r = validateBookingWindow({ startAt: start, endAt: new Date(start.getTime() + 16 * 24 * HOUR), now });
  assert.equal(!r.ok && r.reason, "DURATION");
  assert.equal(maxStandardEndAt(start, now).toISOString(), new Date(start.getTime() + 15 * 24 * HOUR).toISOString());
});

test("extensions are capped at 15 days from the original start, not by the advance window", () => {
  const start = ist("2026-11-10T10:00:00");
  const cap = new Date(start.getTime() + 15 * 24 * HOUR); // 25 Nov — past the 15 Nov window end
  assert.equal(extensionMaxEndAt(start, { now }).toISOString(), cap.toISOString());
  assert.equal(validateExtensionWindow({ bookingStartAt: start, newEndAt: cap, now }).ok, true);
  const over = validateExtensionWindow({ bookingStartAt: start, newEndAt: new Date(cap.getTime() + HOUR), now });
  assert.equal(!over.ok && over.reason, "DURATION");
});

test("monthly plan: pickup inside the 30-day window, 30–180 days long", () => {
  const start = ist("2026-11-15T10:00:00");
  const end = new Date(start.getTime() + 30 * 24 * HOUR);
  assert.equal(validateBookingWindow({ startAt: start, endAt: end, now, monthly: true }).ok, true);
  const late = ist("2026-11-16T10:00:00");
  const r = validateBookingWindow({ startAt: late, endAt: new Date(late.getTime() + 30 * 24 * HOUR), now, monthly: true });
  assert.equal(!r.ok && r.reason, "PICKUP_WINDOW");
});

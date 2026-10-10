/**
 * Pure checks of the 12-hour package held to closing (client item 6):
 * halfDayReturnFor / isClampedHalfDay in branchScheduleValidator.ts, the
 * 12-hour billing it implies, the pricingSnapshot flag existing bookings are
 * re-priced by, the reschedule rule (halfDayPackage.ts) and the window's last
 * day. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { customerPackagesForPickup } from "@repo/schemas";
import { halfDayReturnFor, isClampedHalfDay, type BranchScheduleConfig } from "./branchScheduleValidator.js";
import {
  heldBillingEnd,
  heldToClosingOf,
  isHalfDayPackageBooking,
  rescheduledReturn,
  withHeldToClosing,
} from "./halfDayPackage.js";
import { selectBasePrice } from "../../services/pricing/base-price-rule.js";
import { DurationCalculatorService } from "../../services/pricing/duration-calculator.service.js";

const ist = (local: string) => new Date(`${local}+05:30`);
const everyDay = (openTime: string, closeTime: string) =>
  Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isOpen: true, openTime, closeTime }));

/** The live Manipal hours: 08:00–22:30 every day, no grace. */
const manipal: BranchScheduleConfig = { schedules: everyDay("08:00", "22:30"), graceMinutes: 0, is24Hours: false };

test("12 hours inside office hours is pickup + 12 h", () => {
  for (const pickup of ["2026-10-12T08:00:00", "2026-10-12T10:30:00", "2026-10-12T20:00:00", "2026-10-12T22:00:00"]) {
    const r = halfDayReturnFor(manipal, ist(pickup));
    assert.equal(r?.clamped, false, pickup);
    assert.equal(r?.endAt.getTime(), ist(pickup).getTime() + 12 * 3_600_000, pickup);
  }
});

test("12 hours past closing / midnight / before opening returns at closing on the pickup day", () => {
  for (const pickup of ["2026-10-12T11:00:00", "2026-10-12T14:05:00", "2026-10-12T19:55:00"]) {
    const r = halfDayReturnFor(manipal, ist(pickup));
    assert.equal(r?.clamped, true, pickup);
    assert.equal(r?.endAt.toISOString(), ist("2026-10-12T22:30:00").toISOString(), pickup);
  }
});

test("branch without saved hours uses the default 08:00–23:00", () => {
  const defaults: BranchScheduleConfig = { schedules: [], graceMinutes: 0, is24Hours: false };
  assert.equal(halfDayReturnFor(defaults, ist("2026-10-12T11:00:00"))?.clamped, false);
  const r = halfDayReturnFor(defaults, ist("2026-10-12T11:05:00"));
  assert.equal(r?.clamped, true);
  assert.equal(r?.endAt.toISOString(), ist("2026-10-12T23:00:00").toISOString());
});

test("a return inside the grace window is not clamped; a 24-hour branch never is", () => {
  assert.equal(halfDayReturnFor({ ...manipal, graceMinutes: 15 }, ist("2026-10-12T10:40:00"))?.clamped, false);
  assert.equal(halfDayReturnFor({ ...manipal, is24Hours: true }, ist("2026-10-12T14:00:00"))?.clamped, false);
});

test("a closed next day still clamps to the pickup day's closing", () => {
  const sundayClosed: BranchScheduleConfig = {
    ...manipal,
    schedules: manipal.schedules.map((s) => (s.dayOfWeek === 0 ? { ...s, isOpen: false } : s)),
  };
  const r = halfDayReturnFor(sundayClosed, ist("2026-10-10T21:00:00")); // Sat → Sun 09:00
  assert.equal(r?.clamped, true);
  assert.equal(r?.endAt.toISOString(), ist("2026-10-10T22:30:00").toISOString());
});

test("under an hour before closing only whole days remain", () => {
  const short: BranchScheduleConfig = { schedules: everyDay("09:00", "15:00"), graceMinutes: 0, is24Hours: false };
  assert.equal(halfDayReturnFor(short, ist("2026-10-12T14:30:00")), null);
  assert.equal(halfDayReturnFor(short, ist("2026-10-12T14:00:00"))?.clamped, true);
});

test("isClampedHalfDay accepts only the computed closing (±1 minute)", () => {
  const pickup = ist("2026-10-12T14:00:00");
  assert.equal(isClampedHalfDay(manipal, pickup, ist("2026-10-12T22:30:00")), true);
  assert.equal(isClampedHalfDay(manipal, pickup, ist("2026-10-12T22:30:45")), true);
  assert.equal(isClampedHalfDay(manipal, pickup, ist("2026-10-12T22:00:00")), false);
  // pickup + 12 h fits the hours: not a clamp (a plain 12 h / other length)
  assert.equal(isClampedHalfDay(manipal, ist("2026-10-12T09:00:00"), ist("2026-10-12T21:00:00")), false);
  assert.equal(isClampedHalfDay(manipal, ist("2026-10-12T10:00:00"), ist("2026-10-12T22:30:00")), false);
});

test("billed as pickup + 12 h, the clamp costs what a 12-hour package costs", () => {
  const card = {
    hourlyRate: new Decimal(100),
    price12Hour: new Decimal(1500),
    price24Hour: new Decimal(2500),
    priceMonthly: null,
    freeKm12Hour: 120,
    freeKm24Hour: 240,
    freeKmMonthly: 0,
  };
  const start = DateTime.fromISO("2026-10-12T14:00:00", { zone: "Asia/Kolkata" });
  const clock = selectBasePrice(card, DurationCalculatorService.calculate(start, start.plus({ hours: 8.5 })));
  const billed = selectBasePrice(card, DurationCalculatorService.calculate(start, start.plus({ hours: 12 })));
  assert.equal(clock.basePrice.toString(), "900"); // what the clock length alone would cost
  assert.equal(billed.basePrice.toString(), "1200");
  assert.equal(billed.billedAs, "12 hours");
  assert.equal(billed.freeKmLimit, 120);
});

// ── Existing bookings: the persisted flag (review #1, #4) ───────────────────

const hourlyCard = {
  hourlyRate: new Decimal(100),
  price12Hour: new Decimal(1500),
  price24Hour: new Decimal(2500),
  priceMonthly: null,
  freeKm12Hour: 120,
  freeKm24Hour: 240,
  freeKmMonthly: 0,
};
/** Base price of [start, end] billed to `billTo` (the engine's billing end). */
const priceTo = (start: Date, billTo: Date) =>
  selectBasePrice(
    hourlyCard,
    DurationCalculatorService.calculate(
      DateTime.fromJSDate(start, { zone: "Asia/Kolkata" }),
      DateTime.fromJSDate(billTo, { zone: "Asia/Kolkata" }),
    ),
  ).basePrice.toString();

test("heldToClosing is read from and written to pricingSnapshot without touching the rest", () => {
  const snapshot = { items: [{ a: 1 }], totals: { grandFinalTotal: 1200 } };
  assert.equal(heldToClosingOf(snapshot), false);
  assert.equal(heldToClosingOf(null), false);
  const held = withHeldToClosing(snapshot, true) as Record<string, unknown>;
  assert.equal(heldToClosingOf(held), true);
  assert.deepEqual(held.totals, snapshot.totals);
  const cleared = withHeldToClosing(held, false) as Record<string, unknown>;
  assert.equal("heldToClosing" in cleared, false);
  assert.deepEqual(cleared, snapshot);
});

test("a held booking bills at least 12 h after a reschedule — no extension overcharge", () => {
  // Booked 14:00 → 22:30 (held, billed as 12 h = ₹1200), then moved to 13:00 → 22:30
  const start = ist("2026-10-12T13:00:00");
  const end = ist("2026-10-12T22:30:00");
  assert.equal(heldBillingEnd(start, end).toISOString(), ist("2026-10-13T01:00:00").toISOString());
  assert.equal(priceTo(start, heldBillingEnd(start, end)), "1200");
  // +12 h extension: new window 13:00 → 10:30 next day (21.5 h)
  const extendedEnd = ist("2026-10-13T10:30:00");
  assert.equal(heldBillingEnd(start, extendedEnd).getTime(), extendedEnd.getTime());
  const delta = Number(priceTo(start, extendedEnd)) - Number(priceTo(start, heldBillingEnd(start, end)));
  assert.equal(delta, 2200 - 1200);
  // Billing the current window by the clock instead (9.5 h → ₹1000) would overcharge
  assert.equal(priceTo(start, end), "1000");
});

test("a booking without the flag is billed by its clock length (e.g. staff 20:00 → 22:30)", () => {
  const start = ist("2026-10-12T20:00:00");
  const end = ist("2026-10-12T22:30:00");
  assert.equal(heldToClosingOf({ items: [] }), false);
  assert.equal(priceTo(start, end), "300");
});

// ── Reschedule (review #2) ────────────────────────────────────────────────────

const heldBooking = {
  startAt: ist("2026-10-12T14:00:00"),
  endAt: ist("2026-10-12T22:30:00"),
  originalEndAt: null,
  rentalPeriodType: null,
  pricingSnapshot: { heldToClosing: true },
};

test("a held 12-hour booking moved later keeps returning at closing", () => {
  const r = rescheduledReturn(heldBooking, ist("2026-10-12T15:00:00"), manipal);
  assert.deepEqual(r, { endAt: ist("2026-10-12T22:30:00"), halfDayPackage: true, heldToClosing: true });
});

test("a held 12-hour booking moved earlier gets the package's return, not a shifted one", () => {
  // 13:00 + 12 h is past closing → still 22:30 (not 21:30)
  assert.equal(
    rescheduledReturn(heldBooking, ist("2026-10-12T13:00:00"), manipal)?.endAt.toISOString(),
    ist("2026-10-12T22:30:00").toISOString(),
  );
  // 09:00 + 12 h fits → a plain 12 h, no longer held
  assert.deepEqual(rescheduledReturn(heldBooking, ist("2026-10-12T09:00:00"), manipal), {
    endAt: ist("2026-10-12T21:00:00"),
    halfDayPackage: true,
    heldToClosing: false,
  });
});

test("a plain 12-hour booking moved to the afternoon becomes held to closing", () => {
  const plain = { ...heldBooking, startAt: ist("2026-10-12T09:00:00"), endAt: ist("2026-10-12T21:00:00"), pricingSnapshot: {} };
  assert.deepEqual(rescheduledReturn(plain, ist("2026-10-13T14:00:00"), manipal), {
    endAt: ist("2026-10-13T22:30:00"),
    halfDayPackage: true,
    heldToClosing: true,
  });
});

test("extended, other-length or hours-unknown bookings keep their length", () => {
  const extended = { ...heldBooking, endAt: ist("2026-10-13T10:30:00"), originalEndAt: ist("2026-10-12T22:30:00") };
  assert.deepEqual(rescheduledReturn(extended, ist("2026-10-12T15:00:00"), manipal), {
    endAt: ist("2026-10-13T11:30:00"),
    halfDayPackage: false,
    heldToClosing: true,
  });
  const eightHours = { ...heldBooking, endAt: ist("2026-10-12T22:00:00"), pricingSnapshot: {} };
  assert.equal(isHalfDayPackageBooking(eightHours), false);
  assert.equal(
    rescheduledReturn(eightHours, ist("2026-10-12T13:00:00"), manipal)?.endAt.toISOString(),
    ist("2026-10-12T21:00:00").toISOString(),
  );
  assert.equal(
    rescheduledReturn(heldBooking, ist("2026-10-12T15:00:00"), null)?.endAt.toISOString(),
    ist("2026-10-12T23:30:00").toISOString(),
  );
  assert.equal(isHalfDayPackageBooking({ ...heldBooking, rentalPeriodType: "MONTHLY" as never }), false);
});

test("a 12-hour booking with no 12-hour return from the new pickup can't move there", () => {
  const short: BranchScheduleConfig = { schedules: everyDay("09:00", "15:00"), graceMinutes: 0, is24Hours: false };
  assert.equal(rescheduledReturn(heldBooking, ist("2026-10-12T14:30:00"), short), null);
});

// ── Last day of the 15-day window (review #3) ────────────────────────────────

test("the held 12-hour return fits the window's last afternoon", () => {
  const now = ist("2026-10-10T10:00:00"); // window ends 25 Oct 23:59 IST
  const pickup = ist("2026-10-25T14:00:00");
  assert.equal(customerPackagesForPickup(pickup, now).length, 0); // 14:00 + 12 h = 26 Oct 02:00
  const held = halfDayReturnFor(manipal, pickup);
  const offered = customerPackagesForPickup(pickup, now, held?.clamped ? held.endAt : null);
  assert.deepEqual(
    offered.map((p) => [p.hours, p.endAt.toISOString()]),
    [[12, ist("2026-10-25T22:30:00").toISOString()]],
  );
});

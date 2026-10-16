/**
 * Pure checks of the late-evening same-day pickup rule (client, Oct 19):
 * branch hours 8:00 AM – 11:00 PM, last pickup 10:30 PM; tonight, after the
 * last pickup and before closing, a pickup from now up to closing is taken;
 * after closing, today takes none. sameDayPickupStatus (@repo/schemas) and
 * validateBookingSchedule with `now`. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LATE_PICKUP_GRACE_MINUTES, customerPackageEnd, sameDayPickupStatus } from "@repo/schemas";
import {
  DEFAULT_BRANCH_HOURS,
  buildScheduleErrorMessage,
  getEffectiveSchedules,
  halfDayReturnFor,
  validateBookingSchedule,
  type BranchScheduleConfig,
} from "./branchScheduleValidator.js";

const ist = (local: string) => new Date(`${local}+05:30`);
const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h! * 60 + m!;
};
const everyDay = (openTime: string, closeTime: string) =>
  Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isOpen: true, openTime, closeTime }));

/** Manipal after the 20261019090000_branch_hours_11pm migration: 08:00–23:00 every day. */
const branch: BranchScheduleConfig = { schedules: everyDay("08:00", "23:00"), graceMinutes: 30, is24Hours: false };
const day = { lastPickupMin: hm("22:30"), closeMin: hm("23:00") };
const DAY = "2026-10-20";
const at = (t: string) => ist(`${DAY}T${t}:00`);
const nextDay = (t: string) => ist(`2026-10-21T${t}:00`);

test("default hours are 08:00–23:00 and the last pickup is 22:30", () => {
  assert.deepEqual(DEFAULT_BRANCH_HOURS, { openTime: "08:00", closeTime: "23:00" });
  for (const row of getEffectiveSchedules([])) assert.equal(row.lastPickupTime, "22:30");
  for (const row of getEffectiveSchedules(branch.schedules)) assert.equal(row.lastPickupTime, "22:30");
});

test("22:20 — the usual rule: slots up to 22:30, nothing later tonight", () => {
  const now = hm("22:20");
  assert.equal(sameDayPickupStatus(day, hm("22:30"), now), "OK");
  assert.equal(sameDayPickupStatus(day, hm("22:45"), now), "AFTER_LAST_PICKUP");
  assert.equal(sameDayPickupStatus(day, hm("23:00"), now), "AFTER_LAST_PICKUP");
  // Server: 22:30 accepted, 22:45 refused with the last-pickup message
  assert.equal(validateBookingSchedule(branch, at("22:30"), nextDay("22:30"), { now: at("22:20") }).status, "OK");
  const v = validateBookingSchedule(branch, at("22:45"), nextDay("22:45"), { now: at("22:20") });
  assert.equal(v.status, "PICKUP_AT_OR_AFTER_CLOSE");
  assert.equal(v.lastPickupTime, "10:30 PM");
  assert.equal(v.latePickupUntil, undefined);
});

test("22:40 — tonight's late window: 22:45 and 23:00 allowed, past times and after closing not", () => {
  const now = hm("22:40");
  assert.equal(sameDayPickupStatus(day, hm("22:45"), now), "LATE_OK");
  assert.equal(sameDayPickupStatus(day, hm("23:00"), now), "LATE_OK");
  assert.equal(sameDayPickupStatus(day, hm("23:15"), now), "AFTER_LAST_PICKUP");
  assert.equal(sameDayPickupStatus(day, hm("22:35"), now), "AFTER_LAST_PICKUP"); // already past
  for (const t of ["22:45", "23:00"]) {
    assert.equal(validateBookingSchedule(branch, at(t), nextDay(t), { now: at("22:40") }).status, "OK", t);
  }
  // A slot picked a moment ago still goes through (LATE_PICKUP_GRACE_MINUTES)
  assert.equal(LATE_PICKUP_GRACE_MINUTES, 5);
  assert.equal(validateBookingSchedule(branch, at("22:45"), nextDay("22:45"), { now: at("22:49") }).status, "OK");
  const past = validateBookingSchedule(branch, at("22:31"), nextDay("22:31"), { now: at("22:40") });
  assert.equal(past.status, "PICKUP_AT_OR_AFTER_CLOSE");
  assert.equal(past.latePickupUntil, "11:00 PM");
  assert.match(buildScheduleErrorMessage(past), /from now until 11:00 PM/);
});

test("23:05 — today is closed for pickups; the next day from 08:00 is fine", () => {
  const now = hm("23:05");
  assert.equal(sameDayPickupStatus(day, hm("23:00"), now, 0), "TODAY_CLOSED");
  assert.equal(sameDayPickupStatus(day, hm("10:00"), now, 0), "TODAY_CLOSED");
  // Server (5 min grace): 23:06 refuses any same-day pickup
  for (const t of ["10:00", "22:30", "23:00"]) {
    const v = validateBookingSchedule(branch, at(t), nextDay(t), { now: at("23:06") });
    assert.equal(v.status, "PICKUP_TODAY_CLOSED", t);
    assert.match(buildScheduleErrorMessage(v), /closed for today/);
  }
  assert.equal(
    validateBookingSchedule(branch, nextDay("08:00"), ist("2026-10-22T08:00:00"), { now: at("23:05") }).status,
    "OK",
  );
  assert.equal(validateBookingSchedule(branch, nextDay("07:45"), nextDay("19:45"), { now: at("23:05") }).status, "PICKUP_BEFORE_OPEN");
});

test("other days and calls without `now` keep the usual last pickup", () => {
  // Booking tomorrow 22:45 tonight at 22:40: not the late window (other day)
  assert.equal(
    validateBookingSchedule(branch, nextDay("22:45"), ist("2026-10-22T22:45:00"), { now: at("22:40") }).status,
    "PICKUP_AT_OR_AFTER_CLOSE",
  );
  assert.equal(validateBookingSchedule(branch, at("22:45"), nextDay("22:45")).status, "PICKUP_AT_OR_AFTER_CLOSE");
  assert.equal(validateBookingSchedule(branch, at("22:30"), nextDay("22:30")).status, "OK");
});

test("packages from a late pickup: 12 h from 22:45 returns 10:45 next day (no clamp), 1 day at 22:45", () => {
  const pickup = at("22:45");
  const half = halfDayReturnFor(branch, pickup);
  assert.equal(half?.clamped, false);
  assert.equal(half?.endAt.toISOString(), nextDay("10:45").toISOString());
  assert.equal(validateBookingSchedule(branch, pickup, half!.endAt, { now: at("22:40") }).status, "OK");
  const oneDay = customerPackageEnd(pickup, 24);
  assert.equal(validateBookingSchedule(branch, pickup, oneDay, { now: at("22:40") }).status, "OK");
  const fromClosing = at("23:00");
  assert.equal(halfDayReturnFor(branch, fromClosing)?.endAt.toISOString(), nextDay("11:00").toISOString());
  assert.equal(validateBookingSchedule(branch, fromClosing, customerPackageEnd(fromClosing, 24), { now: at("22:50") }).status, "OK");
});

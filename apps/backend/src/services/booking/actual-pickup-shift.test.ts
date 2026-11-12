/**
 * Client TODO 10 (rental runs from the actual handover) and TODO 4 (last
 * return 10:30 PM): the pure rules. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RETURN_CUTOFF_MINUTES, lastReturnMinute, returnWindowEndMinute } from "@repo/schemas";
import { delayLabel, pickupDelayMinutes, planPickupShift, returnShiftMessage } from "./actual-pickup-shift.js";
import { partialExtensionEnd } from "../extension/partial-extension.js";
import {
  getDayWindow,
  validateBookingSchedule,
  validateReturnTime,
  type BranchScheduleConfig,
} from "../../utils/booking/branchScheduleValidator.js";

const ist = (local: string) => new Date(`${local}+05:30`);
const H = 3_600_000;

// ── TODO 10: the shift ───────────────────────────────────────────────────────

test("client example: 12 Nov 12:00 → 14 Nov 12:00, handed over 14:30 → return 14 Nov 14:30", () => {
  const p = planPickupShift({
    startAt: ist("2026-11-12T12:00:00"),
    endAt: ist("2026-11-14T12:00:00"),
    handoverAt: ist("2026-11-12T14:30:00"),
    latestEndAt: null,
  });
  assert.equal(p.delayMinutes, 150);
  assert.equal(p.appliedMinutes, 150);
  assert.equal(p.capped, false);
  assert.equal(p.newEndAt.toISOString(), ist("2026-11-14T14:30:00").toISOString());
  // The whole window slides: the booked length (price, free km) never changes
  assert.equal(p.newStartAt.toISOString(), ist("2026-11-12T14:30:00").toISOString());
  assert.equal(p.newEndAt.getTime() - p.newStartAt.getTime(), 48 * H);
});

test("on time and early pickups leave the booking as scheduled", () => {
  const startAt = ist("2026-11-12T12:00:00");
  const endAt = ist("2026-11-14T12:00:00");
  for (const handover of ["2026-11-12T12:00:00", "2026-11-12T12:00:59", "2026-11-12T11:00:00", "2026-11-11T18:00:00"]) {
    const p = planPickupShift({ startAt, endAt, handoverAt: ist(handover), latestEndAt: null });
    assert.equal(p.delayMinutes, 0, handover);
    assert.equal(p.newStartAt.getTime(), startAt.getTime(), handover);
    assert.equal(p.newEndAt.getTime(), endAt.getTime(), handover);
  }
});

test("the delay is whole minutes (seconds are dropped)", () => {
  assert.equal(pickupDelayMinutes(ist("2026-11-12T12:00:00"), ist("2026-11-12T12:07:59")), 7);
  assert.equal(pickupDelayMinutes(ist("2026-11-12T12:00:00"), ist("2026-11-12T11:07:59")), 0);
});

test("a collision caps the return at the latest allowed time, never before the schedule", () => {
  const base = { startAt: ist("2026-11-12T12:00:00"), endAt: ist("2026-11-14T12:00:00"), handoverAt: ist("2026-11-12T14:30:00") };
  const capped = planPickupShift({ ...base, latestEndAt: ist("2026-11-14T13:00:00") });
  assert.equal(capped.capped, true);
  assert.equal(capped.appliedMinutes, 60);
  assert.equal(capped.newEndAt.toISOString(), ist("2026-11-14T13:00:00").toISOString());
  assert.equal(capped.newStartAt.toISOString(), ist("2026-11-12T13:00:00").toISOString());
  // Next booking right at the return: nothing moves
  const none = planPickupShift({ ...base, latestEndAt: ist("2026-11-14T11:00:00") });
  assert.equal(none.capped, true);
  assert.equal(none.appliedMinutes, 0);
  assert.equal(none.newEndAt.toISOString(), base.endAt.toISOString());
  // A limit past the full shift changes nothing
  const free = planPickupShift({ ...base, latestEndAt: ist("2026-11-15T12:00:00") });
  assert.equal(free.capped, false);
  assert.equal(free.appliedMinutes, 150);
});

test("the cap uses the extension rule: next pickup − 2 h (30-min grid), a lock's effective start", () => {
  const endAt = ist("2026-11-14T12:00:00");
  const target = ist("2026-11-14T14:30:00");
  // Next booking picks up 15:45 → latest return 13:45 → 13:30 on the grid
  const next = partialExtensionEnd(endAt, target, [{ startAt: ist("2026-11-14T15:45:00"), kind: "BOOKING" }]);
  assert.equal(next?.toISOString(), ist("2026-11-14T13:30:00").toISOString());
  // Booking lock from 13:00: no buffer
  const lock = partialExtensionEnd(endAt, target, [{ startAt: ist("2026-11-14T13:00:00"), kind: "LOCK" }]);
  assert.equal(lock?.toISOString(), ist("2026-11-14T13:00:00").toISOString());
  // Booking at 13:00: no room after the scheduled return → null (caller keeps endAt)
  assert.equal(partialExtensionEnd(endAt, target, [{ startAt: ist("2026-11-14T13:00:00"), kind: "BOOKING" }]), null);
});

test("messages for staff and the customer", () => {
  assert.equal(delayLabel(150), "2h 30m");
  assert.equal(delayLabel(45), "45m");
  assert.equal(delayLabel(120), "2h");
  assert.equal(
    returnShiftMessage({
      scheduledEndAt: ist("2026-11-14T12:00:00"),
      endAt: ist("2026-11-14T14:30:00"),
      delayMinutes: 150,
      appliedMinutes: 150,
      capped: false,
      capReason: null,
    }),
    "Return due 14 Nov 2:30 PM (scheduled 12:00 PM, pickup 2h 30m late)",
  );
  assert.match(
    returnShiftMessage({
      scheduledEndAt: ist("2026-11-14T12:00:00"),
      endAt: ist("2026-11-14T13:00:00"),
      delayMinutes: 150,
      appliedMinutes: 60,
      capped: true,
      capReason: "NEXT_BOOKING",
    }),
    /moved only 1h because the car is booked next/,
  );
  assert.equal(
    returnShiftMessage({
      scheduledEndAt: ist("2026-11-14T12:00:00"),
      endAt: ist("2026-11-14T12:00:00"),
      delayMinutes: 0,
      appliedMinutes: 0,
      capped: false,
      capReason: null,
    }),
    "Return due 14 Nov 12:00 PM (as scheduled)",
  );
});

// ── TODO 4: last return 10:30 PM ─────────────────────────────────────────────

const everyDay = (openTime: string, closeTime: string) =>
  Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isOpen: true, openTime, closeTime }));
const live: BranchScheduleConfig = { schedules: everyDay("08:00", "23:00"), graceMinutes: 0, is24Hours: false };
const defaults: BranchScheduleConfig = { schedules: [], graceMinutes: 0, is24Hours: false };
const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

test("the last return is closing − 30 min (+ grace): 10:30 PM for 8 AM – 11 PM", () => {
  assert.equal(RETURN_CUTOFF_MINUTES, 30);
  assert.equal(lastReturnMinute(hm("23:00")), hm("22:30"));
  assert.equal(returnWindowEndMinute(hm("23:00"), 0), hm("22:30"));
  assert.equal(returnWindowEndMinute(hm("23:00"), 15), hm("22:45"));
  for (const c of [live, defaults]) {
    assert.equal(getDayWindow(c, ist("2026-11-13T12:00:00"))?.graceEndMin, hm("22:30"));
  }
});

test("no return after 22:30 is offered or accepted (extensions, reschedule)", () => {
  for (const c of [live, defaults]) {
    assert.equal(validateReturnTime(c, ist("2026-11-13T22:30:00")).status, "OK");
    for (const t of ["22:31", "22:45", "23:00", "23:30"]) {
      const v = validateReturnTime(c, ist(`2026-11-13T${t}:00`));
      assert.equal(v.status, "RETURN_OUTSIDE_HOURS", t);
      assert.equal(v.gracePeriodEnd, "10:30 PM", t);
    }
  }
});

test("booking create: a 23:30 / 23:00 return is never taken as is", () => {
  const v = validateBookingSchedule(live, ist("2026-11-13T10:00:00"), ist("2026-11-14T23:30:00"));
  assert.notEqual(v.status, "OK");
  assert.notEqual(v.status, "RETURN_GRACE");
  const v2 = validateBookingSchedule(live, ist("2026-11-13T10:00:00"), ist("2026-11-14T23:00:00"));
  assert.equal(v2.status, "RETURN_BUMPED");
  assert.equal(validateBookingSchedule(live, ist("2026-11-13T10:00:00"), ist("2026-11-14T22:30:00")).status, "OK");
});

test("a late-window pickup (after 10:30 PM) still returns at its own clock time", () => {
  const now = ist("2026-11-13T22:40:00");
  const v = validateBookingSchedule(live, ist("2026-11-13T22:45:00"), ist("2026-11-14T22:45:00"), { now });
  assert.equal(v.status, "OK");
  // but not later than that
  const later = validateBookingSchedule(live, ist("2026-11-13T22:45:00"), ist("2026-11-14T22:55:00"), { now });
  assert.notEqual(later.status, "OK");
  assert.equal(validateReturnTime(live, ist("2026-11-15T22:45:00"), { pickupAt: ist("2026-11-13T22:45:00") }).status, "OK");
  assert.equal(validateReturnTime(live, ist("2026-11-15T22:45:00")).status, "RETURN_OUTSIDE_HOURS");
});

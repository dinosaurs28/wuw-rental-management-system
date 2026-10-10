/**
 * Pure checks of the listing rule (vehicleEligibility.ts): statuses, the
 * insurance-day boundary in Asia/Kolkata, hidden reasons, reg-no matching,
 * the blocking rule with turnaround grace — and the pickup readiness rule
 * (outForRental.ts). No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LISTABLE_STATUSES,
  automaticGraceMinutes,
  bookingBlocksWindow,
  insuranceValidFrom,
  isInsuranceValid,
  isListableStatus,
  isListableVehicle,
  listableVehicleWhere,
  normalizeRegNo,
  regNoMatches,
  vehicleHiddenReasons,
} from "./vehicleEligibility.js";
import { VEHICLE_NOT_READY, VEHICLE_STILL_OUT, pickupRefusalFor } from "./outForRental.js";

const ist = (iso: string) => new Date(`${iso}+05:30`);

test("listable statuses: AVAILABLE and OUT_FOR_RENTAL only", () => {
  assert.deepEqual([...LISTABLE_STATUSES].sort(), ["AVAILABLE", "OUT_FOR_RENTAL"]);
  assert.equal(isListableStatus("AVAILABLE"), true);
  assert.equal(isListableStatus("OUT_FOR_RENTAL"), true);
  for (const s of ["MAINTENANCE", "INACTIVE", "MANAGER_REPORTED", "", null, undefined]) {
    assert.equal(isListableStatus(s), false, String(s));
  }
});

test("insuranceValidFrom is the start of the IST day, whatever the time", () => {
  assert.equal(insuranceValidFrom(ist("2026-10-15T00:00:00")).toISOString(), ist("2026-10-15T00:00:00").toISOString());
  assert.equal(insuranceValidFrom(ist("2026-10-15T23:59:59")).toISOString(), ist("2026-10-15T00:00:00").toISOString());
  // 20:00 UTC on the 14th is 01:30 on the 15th in IST
  assert.equal(insuranceValidFrom(new Date("2026-10-14T20:00:00Z")).toISOString(), ist("2026-10-15T00:00:00").toISOString());
});

test("insurance is valid through the end of its expiry day (IST)", () => {
  // The BM form saves local midnight of the expiry date
  const expiry = ist("2026-10-15T00:00:00");
  assert.equal(isInsuranceValid(expiry, ist("2026-10-14T12:00:00")), true, "day before");
  assert.equal(isInsuranceValid(expiry, ist("2026-10-15T00:00:00")), true, "expiry day, midnight");
  assert.equal(isInsuranceValid(expiry, ist("2026-10-15T09:30:00")), true, "expiry day, morning (was hidden before)");
  assert.equal(isInsuranceValid(expiry, ist("2026-10-15T23:59:59")), true, "expiry day, last second");
  assert.equal(isInsuranceValid(expiry, ist("2026-10-16T00:00:00")), false, "day after");

  // A date stored as UTC midnight (05:30 IST) is the same IST day
  const utcMidnight = new Date("2026-10-15T00:00:00Z");
  assert.equal(isInsuranceValid(utcMidnight, ist("2026-10-15T22:00:00")), true);
  assert.equal(isInsuranceValid(utcMidnight, ist("2026-10-16T00:00:01")), false);

  // Strings (JSON) work; missing / invalid dates are never valid
  assert.equal(isInsuranceValid("2026-10-15T00:00:00+05:30", ist("2026-10-15T18:00:00")), true);
  assert.equal(isInsuranceValid(null, ist("2026-10-15T18:00:00")), false);
  assert.equal(isInsuranceValid("not a date", ist("2026-10-15T18:00:00")), false);
});

test("listableVehicleWhere mirrors isListableVehicle", () => {
  const now = ist("2026-10-15T15:00:00");
  assert.deepEqual(listableVehicleWhere(now), {
    deletedAt: null,
    status: { in: LISTABLE_STATUSES },
    insuranceExpiry: { gte: ist("2026-10-15T00:00:00") },
  });

  const car = { status: "AVAILABLE", insuranceExpiry: ist("2026-10-15T00:00:00"), deletedAt: null };
  assert.equal(isListableVehicle(car, now), true);
  assert.equal(isListableVehicle({ ...car, status: "OUT_FOR_RENTAL" }, now), true, "out on a rental: listed for later dates");
  assert.equal(isListableVehicle({ ...car, status: "MANAGER_REPORTED" }, now), false);
  assert.equal(isListableVehicle({ ...car, status: "MAINTENANCE" }, now), false);
  assert.equal(isListableVehicle({ ...car, deletedAt: ist("2026-10-01T10:00:00") }, now), false);
  assert.equal(isListableVehicle({ ...car, insuranceExpiry: ist("2026-10-14T00:00:00") }, now), false);
});

test("vehicleHiddenReasons: every rule that keeps a car from customers", () => {
  const now = ist("2026-10-15T15:00:00");
  const ok = { status: "AVAILABLE", insuranceExpiry: ist("2026-12-31T00:00:00"), onActiveRental: false, rent24Hour: 1500 };
  assert.deepEqual(vehicleHiddenReasons(ok, now), []);

  // Out on a rental (the system's status) is listed; set by hand it is not
  assert.deepEqual(vehicleHiddenReasons({ ...ok, status: "OUT_FOR_RENTAL", onActiveRental: true }, now), []);
  assert.deepEqual(vehicleHiddenReasons({ ...ok, status: "OUT_FOR_RENTAL" }, now), ["MANUAL_OUT_FOR_RENTAL"]);

  assert.deepEqual(vehicleHiddenReasons({ ...ok, status: "MANAGER_REPORTED" }, now), ["DAMAGE_REVIEW_PENDING"]);
  assert.deepEqual(vehicleHiddenReasons({ ...ok, status: "MAINTENANCE" }, now), ["STATUS_MAINTENANCE"]);
  assert.deepEqual(vehicleHiddenReasons({ ...ok, status: "INACTIVE" }, now), ["STATUS_INACTIVE"]);
  assert.deepEqual(vehicleHiddenReasons({ ...ok, insuranceExpiry: ist("2026-10-15T00:00:00") }, now), [], "expiry day still valid");
  assert.deepEqual(vehicleHiddenReasons({ ...ok, insuranceExpiry: ist("2026-10-14T00:00:00") }, now), ["INSURANCE_EXPIRED"]);
  assert.deepEqual(vehicleHiddenReasons({ ...ok, rent24Hour: 0 }, now), ["NO_PRICE"]);
  assert.deepEqual(vehicleHiddenReasons({ ...ok, rent24Hour: null }, now), ["NO_PRICE"]);
  // Out on a rental past its return: no window is free until it is back
  assert.deepEqual(
    vehicleHiddenReasons({ ...ok, status: "OUT_FOR_RENTAL", onActiveRental: true, overdueRental: true }, now),
    ["OVERDUE_RETURN"],
  );

  // Several at once, status first
  assert.deepEqual(
    vehicleHiddenReasons({ status: "MAINTENANCE", insuranceExpiry: null, onActiveRental: false, rent24Hour: null }, now),
    ["STATUS_MAINTENANCE", "INSURANCE_EXPIRED", "NO_PRICE"],
  );
});

test("normalizeRegNo: upper case, letters and digits only", () => {
  assert.equal(normalizeRegNo("ka 20 ab-1234"), "KA20AB1234");
  assert.equal(normalizeRegNo(" KA-20.AB 1234 "), "KA20AB1234");
  assert.equal(normalizeRegNo(""), "");
  assert.equal(normalizeRegNo(null), "");
  assert.equal(normalizeRegNo(undefined), "");
});

test("regNoMatches: partial, case-insensitive, spaces / hyphens ignored", () => {
  const reg = "KA 20 AB-1234";
  for (const q of ["ka20ab1234", "KA-20", "20 ab", "ab1234", "1234", "B-12", "a"]) {
    assert.equal(regNoMatches(reg, q), true, q);
  }
  for (const q of ["KA21", "12345", "MH"]) {
    assert.equal(regNoMatches(reg, q), false, q);
  }
  // A query with nothing to match on matches nothing (not everything)
  assert.equal(regNoMatches(reg, ""), false);
  assert.equal(regNoMatches(reg, " - "), false);
  assert.equal(regNoMatches(null, "KA"), false);
});

test("bookingBlocksWindow: CONFIRMED blocks an overlap only", () => {
  const now = ist("2026-10-15T09:00:00");
  const b = { status: "CONFIRMED", startAt: ist("2026-10-16T10:00:00"), endAt: ist("2026-10-17T10:00:00") };
  const block = (s: string, e: string) => bookingBlocksWindow(b, ist(s), ist(e), now, 30);
  assert.equal(block("2026-10-17T09:00:00", "2026-10-18T09:00:00"), true, "overlap");
  assert.equal(block("2026-10-17T10:00:00", "2026-10-18T10:00:00"), false, "back to back (no grace for a booking not yet out)");
  assert.equal(block("2026-10-15T10:00:00", "2026-10-16T10:00:00"), false, "ends at its start");
  assert.equal(bookingBlocksWindow({ ...b, status: "HOLD" }, ist("2026-10-16T12:00:00"), ist("2026-10-16T13:00:00"), now, 0), false);
});

test("bookingBlocksWindow: a car out on a rental is busy until its return + automatic grace", () => {
  const now = ist("2026-10-15T09:00:00");
  const out = { status: "PICKED_UP", startAt: ist("2026-10-14T10:00:00"), endAt: ist("2026-10-15T10:00:00") };
  const block = (s: string, grace: number | null) =>
    bookingBlocksWindow(out, ist(s), ist("2026-10-16T18:00:00"), now, grace);
  assert.equal(block("2026-10-15T10:00:00", null), false, "no grace: a pickup at the return time is fine");
  assert.equal(block("2026-10-15T10:00:00", 30), true, "a return inside the grace is on time");
  assert.equal(block("2026-10-15T10:29:00", 30), true);
  assert.equal(block("2026-10-15T10:30:00", 30), false, "from the end of the grace");
  assert.equal(block("2026-10-15T08:00:00", 0), true, "overlaps the rental");
  // Picked up early: busy now whatever its scheduled start
  const early = { ...out, startAt: ist("2026-10-16T08:00:00"), endAt: ist("2026-10-17T08:00:00") };
  assert.equal(bookingBlocksWindow(early, ist("2026-10-15T12:00:00"), ist("2026-10-15T20:00:00"), now, 0), true);
});

test("bookingBlocksWindow: an overdue rental blocks every window", () => {
  const now = ist("2026-10-15T12:00:00");
  const overdue = { status: "PICKED_UP", startAt: ist("2026-10-14T10:00:00"), endAt: ist("2026-10-15T10:00:00") };
  assert.equal(bookingBlocksWindow(overdue, ist("2026-10-20T10:00:00"), ist("2026-10-21T10:00:00"), now, 15), true);
  assert.equal(bookingBlocksWindow(overdue, ist("2026-11-01T10:00:00"), ist("2026-11-02T10:00:00"), now, null), true);
});

test("automaticGraceMinutes: frozen config, else the branch's, else defaults; AUTOMATIC only", () => {
  const on = { gracePolicyEnabled: true, graceType: "AUTOMATIC" as const, graceMinutes: 30 };
  assert.equal(automaticGraceMinutes(on, null), 30);
  assert.equal(automaticGraceMinutes(null, on), 30, "the live branch config when nothing was frozen");
  assert.equal(automaticGraceMinutes({ graceMinutes: 45 }, on), 45, "each key from the frozen config first");
  assert.equal(automaticGraceMinutes({ ...on, graceType: "MANUAL" }, null), null, "manual grace isn't counted");
  assert.equal(automaticGraceMinutes({ ...on, gracePolicyEnabled: false }, null), null);
  assert.equal(automaticGraceMinutes({ ...on, graceMinutes: 0 }, null), null);
  assert.equal(automaticGraceMinutes(null, null), null, "defaults: grace policy off");
});

test("pickupRefusalFor: only a car that is here and AVAILABLE is handed over", () => {
  const car = { regNo: "KA20AB1234", status: "AVAILABLE", otherRental: null, heldByThisBooking: false };
  assert.equal(pickupRefusalFor(car), null);

  const out = pickupRefusalFor({ ...car, status: "OUT_FOR_RENTAL", otherRental: { awaitingReturnConfirmation: false } });
  assert.equal(out?.code, VEHICLE_STILL_OUT);
  assert.match(out!.message, /still out on another rental/);
  const awaiting = pickupRefusalFor({ ...car, status: "OUT_FOR_RENTAL", otherRental: { awaitingReturnConfirmation: true } });
  assert.equal(awaiting?.code, VEHICLE_STILL_OUT);
  assert.match(awaiting!.message, /waiting for the branch manager's confirmation/);

  for (const [status, words] of [
    ["MANAGER_REPORTED", "in damage review"],
    ["MAINTENANCE", "in maintenance"],
    ["INACTIVE", "inactive"],
    ["OUT_FOR_RENTAL", "marked Out For Rental by the manager"],
  ] as const) {
    const refusal = pickupRefusalFor({ ...car, status });
    assert.equal(refusal?.code, VEHICLE_NOT_READY, status);
    assert.match(refusal!.message, new RegExp(`KA20AB1234 is ${words}`), status);
    assert.match(refusal!.message, /Swap the vehicle/);
  }

  // A retried completion: the car is already out on THIS booking
  assert.equal(pickupRefusalFor({ ...car, status: "OUT_FOR_RENTAL", heldByThisBooking: true }), null);
});


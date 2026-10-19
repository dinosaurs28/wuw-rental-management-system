/**
 * Pure checks of the vehicle-swap availability rule (swap-availability.ts):
 * the window a replacement must be free for, its eligibility, and how the
 * customer booking rule's refusals become swap exclusions. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DATE_CONFLICT_CODES,
  blockerExclusion,
  classifySwapCandidates,
  swapAvailabilityWindow,
  swapEligibilityExclusion,
  swapUnavailableMessage,
} from "./swap-availability.js";
import type { UnavailableReason } from "../../utils/availability/availabilityBatch.js";

const at = (iso: string) => new Date(iso);
const NOW = at("2026-10-16T06:00:00.000Z"); // 16 Oct 11:30 IST

const H3 = 3 * 60 * 60 * 1000;

test("window: a booking not yet started runs from its start to its end, with the 3 h turnaround", () => {
  const w = swapAvailabilityWindow(
    { status: "CONFIRMED", startAt: at("2026-10-18T04:30:00Z"), endAt: at("2026-10-20T04:30:00Z") },
    NOW,
    { graceMinutes: 240 },
  );
  assert.equal(w.start.toISOString(), "2026-10-18T04:30:00.000Z");
  assert.equal(w.end.toISOString(), "2026-10-20T04:30:00.000Z");
  assert.equal(w.coverUntil.toISOString(), "2026-10-20T04:30:00.000Z");
  assert.equal(w.turnaroundMs, H3, "grace only counts for a rental already out");
});

test("window: a pickup-time swap after the start time runs from now", () => {
  const w = swapAvailabilityWindow(
    { status: "CONFIRMED", startAt: at("2026-10-16T04:30:00Z"), endAt: at("2026-10-17T04:30:00Z") },
    NOW,
  );
  assert.equal(w.start.toISOString(), NOW.toISOString());
  assert.equal(w.end.toISOString(), "2026-10-17T04:30:00.000Z");
});

test("window: an active rental runs from now to its end; turnaround = max(3 h, grace)", () => {
  const w = swapAvailabilityWindow(
    { status: "PICKED_UP", startAt: at("2026-10-15T04:30:00Z"), endAt: at("2026-10-17T04:30:00Z") },
    NOW,
    { graceMinutes: 30 },
  );
  assert.equal(w.start.toISOString(), NOW.toISOString());
  assert.equal(w.end.toISOString(), "2026-10-17T04:30:00.000Z");
  assert.equal(w.coverUntil.toISOString(), "2026-10-17T04:30:00.000Z");
  assert.equal(w.turnaroundMs, H3, "30 min grace is inside the 3 h turnaround");
  const longGrace = swapAvailabilityWindow(
    { status: "PICKED_UP", startAt: at("2026-10-15T04:30:00Z"), endAt: at("2026-10-17T04:30:00Z") },
    NOW,
    { graceMinutes: 240 },
  );
  assert.equal(longGrace.turnaroundMs, 240 * 60_000, "a longer automatic grace wins");
});

test("window: an extension swap can pass its own turnaround", () => {
  const w = swapAvailabilityWindow(
    { status: "PICKED_UP", startAt: at("2026-10-15T04:30:00Z"), endAt: at("2026-10-17T04:30:00Z") },
    NOW,
    { availabilityEndAt: at("2026-10-19T04:30:00Z"), graceMinutes: 30, turnaroundMs: 2 * 60 * 60 * 1000 },
  );
  assert.equal(w.end.toISOString(), "2026-10-19T04:30:00.000Z");
  assert.equal(w.turnaroundMs, 2 * 60 * 60 * 1000);
});

test("window: an extension swap of a rental out is checked from now to the extended end", () => {
  // The extension commit applies the swap and the extended end in one
  // transaction; the replacement is re-checked over this window under its row lock
  const w = swapAvailabilityWindow(
    { status: "PICKED_UP", startAt: at("2026-10-15T04:30:00Z"), endAt: at("2026-10-17T04:30:00Z") },
    NOW,
    { availabilityEndAt: at("2026-10-19T04:30:00Z"), graceMinutes: 30 },
  );
  assert.equal(w.start.toISOString(), NOW.toISOString());
  assert.equal(w.coverUntil.toISOString(), "2026-10-19T04:30:00.000Z");
  assert.equal(w.end.toISOString(), "2026-10-19T04:30:00.000Z");
  assert.equal(w.turnaroundMs, H3);
});

test("window: a rental picked up before its booked start still runs from now", () => {
  const w = swapAvailabilityWindow(
    { status: "PICKED_UP", startAt: at("2026-10-16T10:00:00Z"), endAt: at("2026-10-17T10:00:00Z") },
    NOW,
  );
  assert.equal(w.start.toISOString(), NOW.toISOString());
});

test("window: an extension swap runs to the extended end; an earlier one is ignored", () => {
  const booking = { status: "PICKED_UP", startAt: at("2026-10-15T04:30:00Z"), endAt: at("2026-10-17T04:30:00Z") };
  const later = swapAvailabilityWindow(booking, NOW, { availabilityEndAt: at("2026-10-19T04:30:00Z") });
  assert.equal(later.coverUntil.toISOString(), "2026-10-19T04:30:00.000Z");
  assert.equal(later.end.toISOString(), "2026-10-19T04:30:00.000Z");
  const earlier = swapAvailabilityWindow(booking, NOW, { availabilityEndAt: at("2026-10-16T10:00:00Z") });
  assert.equal(earlier.coverUntil.toISOString(), "2026-10-17T04:30:00.000Z");
});

const car = (over: Partial<{ status: string; insuranceExpiry: Date | null; categoryRank: number }> = {}) => ({
  status: "AVAILABLE",
  insuranceExpiry: at("2027-01-01T00:00:00Z") as Date | null,
  categoryName: "Hatchback",
  categoryRank: 2,
  ...over,
});
const ctx = (over: Partial<{ stage: "PRE_PICKUP" | "ACTIVE_RENTAL"; onRental: boolean }> = {}) => ({
  stage: "PRE_PICKUP" as const,
  currentRank: 2,
  coverUntil: at("2026-10-20T04:30:00Z"),
  onRental: false,
  ...over,
});

test("eligibility: available, insured, same or higher category qualifies", () => {
  assert.equal(swapEligibilityExclusion(car(), ctx()), null);
  assert.equal(swapEligibilityExclusion(car({ categoryRank: 3 }), ctx()), null);
});

test("eligibility: statuses that never qualify", () => {
  assert.equal(swapEligibilityExclusion(car({ status: "MAINTENANCE" }), ctx())?.code, "STATUS_MAINTENANCE");
  assert.equal(swapEligibilityExclusion(car({ status: "MANAGER_REPORTED" }), ctx())?.code, "DAMAGE_REVIEW_PENDING");
  assert.equal(swapEligibilityExclusion(car({ status: "INACTIVE" }), ctx())?.code, "STATUS_INACTIVE");
  assert.equal(
    swapEligibilityExclusion(car({ status: "OUT_FOR_RENTAL" }), ctx({ onRental: false }))?.code,
    "MANUAL_OUT_FOR_RENTAL",
  );
});

test("eligibility: a car out on another rental — booking rule decides before pickup, refused mid-rental", () => {
  assert.equal(swapEligibilityExclusion(car({ status: "OUT_FOR_RENTAL" }), ctx({ onRental: true })), null);
  assert.equal(
    swapEligibilityExclusion(car({ status: "OUT_FOR_RENTAL" }), ctx({ stage: "ACTIVE_RENTAL", onRental: true }))?.code,
    "STATUS_OUT_FOR_RENTAL",
  );
});

test("eligibility: insurance must last through the rental's last day (IST)", () => {
  // expiry saved as local midnight of 20 Oct = valid through 20 Oct
  assert.equal(swapEligibilityExclusion(car({ insuranceExpiry: at("2026-10-19T18:30:00Z") }), ctx()), null);
  const expired = swapEligibilityExclusion(car({ insuranceExpiry: at("2026-10-18T18:30:00Z") }), ctx());
  assert.equal(expired?.code, "INSURANCE_EXPIRES");
  assert.match(expired!.reason, /^Insurance expires on 19 Oct 2026/);
  assert.equal(swapEligibilityExclusion(car({ insuranceExpiry: null }), ctx())?.code, "INSURANCE_EXPIRES");
});

test("eligibility: a lower category is refused", () => {
  assert.equal(swapEligibilityExclusion(car({ categoryRank: 1 }), ctx())?.code, "LOWER_CATEGORY");
});

test("blocker reasons read like the staff screens", () => {
  const booked = blockerExclusion({
    code: "BOOKED",
    startAt: at("2026-10-18T04:30:00Z"),
    endAt: at("2026-10-19T04:30:00Z"),
    availableFrom: at("2026-10-19T07:30:00Z"),
  });
  assert.deepEqual(booked, {
    code: "BOOKED",
    reason: "Booked 18 Oct 2026, 10:00 AM – 19 Oct 2026, 10:00 AM (free again from 19 Oct 2026, 1:00 PM)",
  });
  assert.equal(
    blockerExclusion({ code: "ON_RENT", endAt: at("2026-10-17T04:30:00Z"), availableFrom: at("2026-10-17T07:30:00Z") }).reason,
    "Out on another rental until 17 Oct 2026, 10:00 AM (available from 17 Oct 2026, 1:00 PM)",
  );
  assert.equal(blockerExclusion({ code: "OVERDUE_RENTAL", endAt: at("2026-10-15T04:30:00Z") }).code, "STILL_OUT");
  assert.match(blockerExclusion({ code: "ON_HOLD" }).reason, /^Checkout in progress/);
  assert.equal(blockerExclusion({ code: "MANUAL_OUT_FOR_RENTAL" }).code, "MANUAL_OUT_FOR_RENTAL");
  for (const r of [{ code: "BOOKED" }, { code: "ON_HOLD" }, { code: "STILL_OUT" }, { code: "MANUAL_OUT_FOR_RENTAL" }]) {
    assert.ok(DATE_CONFLICT_CODES.has(r.code as never));
  }
  assert.ok(!DATE_CONFLICT_CODES.has("INSURANCE_EXPIRES"));
});

test("classify: overlapping cars are excluded with the reason, the rest stay offered", () => {
  const v = (id: number, over: Partial<{ status: string; rank: number }> = {}) => ({
    id,
    status: over.status ?? "AVAILABLE",
    insuranceExpiry: at("2027-01-01T00:00:00Z"),
    category: { name: "Hatchback", rank: over.rank ?? 2 },
  });
  const blockers = new Map<number, UnavailableReason>([
    [2, { code: "BOOKED", startAt: at("2026-10-18T04:30:00Z"), endAt: at("2026-10-19T04:30:00Z"), availableFrom: at("2026-10-19T07:30:00Z") }],
    [3, { code: "ON_HOLD" }],
    [5, { code: "BOOKED", startAt: at("2026-10-18T04:30:00Z"), endAt: at("2026-10-19T04:30:00Z"), availableFrom: at("2026-10-19T07:30:00Z") }],
  ]);
  const window = swapAvailabilityWindow(
    { status: "CONFIRMED", startAt: at("2026-10-17T04:30:00Z"), endAt: at("2026-10-20T04:30:00Z") },
    NOW,
  );
  const { free, excluded } = classifySwapCandidates([v(1), v(2), v(3), v(4, { rank: 3 }), v(5, { status: "MAINTENANCE" })], {
    stage: "PRE_PICKUP",
    currentRank: 2,
    window,
    onRental: new Set(),
    blockers,
  });
  assert.deepEqual(free.map((c) => c.id), [1, 4]);
  assert.deepEqual(
    excluded.map((e) => [e.vehicle.id, e.exclusion.code]),
    [
      [2, "BOOKED"],
      [3, "ON_HOLD"],
      // eligibility is reported first
      [5, "STATUS_MAINTENANCE"],
    ],
  );
});

test("conflict message names the car and the reason", () => {
  assert.equal(
    swapUnavailableMessage("KA20AB1234", { code: "ON_HOLD", reason: "Checkout in progress" }),
    "KA20AB1234 is no longer available for these dates — pick another vehicle. Checkout in progress.",
  );
});

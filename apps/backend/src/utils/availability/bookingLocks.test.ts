/**
 * Pure checks of the booking-lock rule (lockOverlapsWindow / lockCoversVehicle /
 * lockBlocksVehicle in @repo/schemas, read by bookingLocks.ts for the listing,
 * booking create, reschedule and swaps) and of how the extension rule treats a
 * lock (partial-extension.ts): a lock acts on its effective window — from
 * 00:00 IST the day before it starts (effectiveLockStart, the lead day) to its
 * end — with no turnaround and no extension buffer, and what is offered also
 * commits.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOCK_LEAD_DAYS,
  bookingLockStatus,
  bookingLockWindowIssues,
  effectiveLockStart,
  lockActsAt,
  lockBlocksVehicle,
  lockCoversVehicle,
  lockOverlapsWindow,
  vehicleGroupKey,
  wholeDayLockWindow,
  type BookingLockRule,
} from "@repo/schemas";
import {
  blocksExtension,
  extensionAvailableUntil,
  latestReturnFor,
  partialExtensionEnd,
} from "../../services/extension/partial-extension.js";

const at = (iso: string) => new Date(iso);
// Lock: Tue 20 Oct 10:00 IST → Wed 21 Oct 18:00 IST
const LOCK_START = at("2026-10-20T04:30:00Z");
const LOCK_END = at("2026-10-21T12:30:00Z");
// Its effective start: Mon 19 Oct 00:00 IST (the lead day)
const EFF_START = at("2026-10-18T18:30:00Z");

const swift = { id: 7, branchId: 1, make: "Maruti", model: "Swift", categoryId: 3 };
const swift2 = { id: 8, branchId: 1, make: " maruti ", model: "SWIFT", categoryId: 3 };
const creta = { id: 9, branchId: 1, make: "Hyundai", model: "Creta", categoryId: 4 };
const otherBranch = { id: 10, branchId: 2, make: "Maruti", model: "Swift", categoryId: 3 };

const lock = (over: Partial<BookingLockRule> = {}): BookingLockRule => ({
  branchId: 1,
  startAt: LOCK_START,
  endAt: LOCK_END,
  scope: "BRANCH",
  vehicleIds: [],
  groupKeys: [],
  customersOnly: false,
  cancelledAt: null,
  ...over,
});

// ── the lead day ─────────────────────────────────────────────────────────────

test("effective start = 00:00 IST on the calendar day before the lock starts (IST, not UTC)", () => {
  assert.equal(LOCK_LEAD_DAYS, 1);
  assert.equal(effectiveLockStart(LOCK_START).toISOString(), EFF_START.toISOString());
  // 25 Aug 10:00 IST → 24 Aug 00:00 IST
  assert.equal(effectiveLockStart(at("2026-08-25T04:30:00Z")).toISOString(), "2026-08-23T18:30:00.000Z");
  // 25 Aug 00:00 IST and 25 Aug 05:00 IST (still 24 Aug in UTC) → 24 Aug 00:00 IST
  assert.equal(effectiveLockStart(at("2026-08-24T18:30:00Z")).toISOString(), "2026-08-23T18:30:00.000Z");
  assert.equal(effectiveLockStart(at("2026-08-24T23:30:00Z")).toISOString(), "2026-08-23T18:30:00.000Z");
  // 24 Aug 23:30 IST (the same UTC date as above) → 23 Aug 00:00 IST
  assert.equal(effectiveLockStart(at("2026-08-24T18:00:00Z")).toISOString(), "2026-08-22T18:30:00.000Z");
  // A month boundary: 1 Sep 08:00 IST → 31 Aug 00:00 IST
  assert.equal(effectiveLockStart(at("2026-09-01T02:30:00Z")).toISOString(), "2026-08-30T18:30:00.000Z");
});

test("lead day: a booking ending 23:59 on the lead day is refused; one ending the day before is allowed", () => {
  // Lock 25 Aug 10:00 IST → 28 Aug 10:00 IST; lead day 24 Aug
  const aug = lock({ startAt: at("2026-08-25T04:30:00Z"), endAt: at("2026-08-28T04:30:00Z") });
  const pickup = at("2026-08-23T04:30:00Z"); // 23 Aug 10:00 IST
  // Returns 24 Aug 23:59 IST (the lead day): refused, for staff too
  assert.equal(lockBlocksVehicle(aug, swift, pickup, at("2026-08-24T18:29:00Z")), true);
  assert.equal(lockBlocksVehicle(aug, swift, pickup, at("2026-08-24T18:29:00Z"), true), true);
  // Returns 24 Aug 00:30 IST: refused (inside the lead day)
  assert.equal(lockBlocksVehicle(aug, swift, pickup, at("2026-08-23T19:00:00Z")), true);
  // Returns 23 Aug 23:59 IST (the day before the lead day): allowed
  assert.equal(lockBlocksVehicle(aug, swift, pickup, at("2026-08-23T18:29:00Z")), false);
  // Returns exactly 24 Aug 00:00 IST: allowed (touching the effective start)
  assert.equal(lockBlocksVehicle(aug, swift, pickup, at("2026-08-23T18:30:00Z")), false);
});

test("the lock acts (hides the car) from its effective start to its end", () => {
  const l = lock();
  assert.equal(lockActsAt(l, at("2026-10-18T18:29:00Z")), false); // 18 Oct 23:59 IST
  assert.equal(lockActsAt(l, EFF_START), true); // 19 Oct 00:00 IST
  assert.equal(lockActsAt(l, at("2026-10-20T00:00:00Z")), true); // lead day, before the lock
  assert.equal(lockActsAt(l, at("2026-10-21T12:00:00Z")), true); // inside the lock
  assert.equal(lockActsAt(l, LOCK_END), false);
  assert.equal(lockActsAt(lock({ cancelledAt: at("2026-10-18T00:00:00Z") }), at("2026-10-20T00:00:00Z")), false);
});

test("a whole-day lock: From 00:00 IST through the end of To", () => {
  const w = wholeDayLockWindow("2026-08-25", "2026-08-28");
  assert.deepEqual(w, { startAt: "2026-08-24T18:30:00.000Z", endAt: "2026-08-28T18:30:00.000Z" });
  assert.deepEqual(bookingLockWindowIssues(w!, at("2026-08-01T00:00:00Z")), []);
  // One day: 25 Aug 00:00 → 26 Aug 00:00 IST
  assert.deepEqual(wholeDayLockWindow("2026-08-25", "2026-08-25"), {
    startAt: "2026-08-24T18:30:00.000Z",
    endAt: "2026-08-25T18:30:00.000Z",
  });
  // Hidden from 24 Aug 00:00 IST
  assert.equal(effectiveLockStart(w!.startAt).toISOString(), "2026-08-23T18:30:00.000Z");
  assert.equal(wholeDayLockWindow("25-08-2026", "2026-08-28"), null);
});

// ── overlap: a plain overlap with the effective window, no turnaround ────────

test("a window overlapping the effective window is blocked; touching its edges is not", () => {
  const l = lock();
  // Inside
  assert.equal(lockOverlapsWindow(l, at("2026-10-20T06:30:00Z"), at("2026-10-20T10:30:00Z")), true);
  // Starts before, ends inside
  assert.equal(lockOverlapsWindow(l, at("2026-10-19T04:30:00Z"), at("2026-10-20T05:00:00Z")), true);
  // Covers the whole lock
  assert.equal(lockOverlapsWindow(l, at("2026-10-19T04:30:00Z"), at("2026-10-22T04:30:00Z")), true);
  // Return exactly at the lock start: refused now (the lead day is in the way)
  assert.equal(lockOverlapsWindow(l, at("2026-10-17T04:30:00Z"), LOCK_START), true);
  // Return exactly at the effective start: free (no 3 h turnaround around a lock)
  assert.equal(lockOverlapsWindow(l, at("2026-10-17T04:30:00Z"), EFF_START), false);
  // Pickup exactly at the lock end: free
  assert.equal(lockOverlapsWindow(l, LOCK_END, at("2026-10-22T12:30:00Z")), false);
  // 30 minutes after the lock ends: free (a booking would need 3 h)
  assert.equal(lockOverlapsWindow(l, at("2026-10-21T13:00:00Z"), at("2026-10-22T13:00:00Z")), false);
});

// ── scope ────────────────────────────────────────────────────────────────────

test("a branch lock covers every vehicle of its branch, none of another branch", () => {
  assert.equal(lockCoversVehicle(lock(), swift), true);
  assert.equal(lockCoversVehicle(lock(), creta), true);
  assert.equal(lockCoversVehicle(lock(), otherBranch), false);
});

test("a vehicles lock covers only the picked vehicles", () => {
  const l = lock({ scope: "VEHICLES", vehicleIds: [7] });
  assert.equal(lockCoversVehicle(l, swift), true);
  assert.equal(lockCoversVehicle(l, swift2), false);
  assert.equal(lockCoversVehicle(l, creta), false);
  // The same id at another branch is not covered (the lock is per branch)
  assert.equal(lockCoversVehicle(l, { ...otherBranch, id: 7 }), false);
});

test("a groups lock covers every vehicle of the make + model + category (normalised), not other groups", () => {
  const l = lock({ scope: "GROUPS", groupKeys: [vehicleGroupKey("Maruti", "Swift", 3)] });
  assert.equal(lockCoversVehicle(l, swift), true);
  assert.equal(lockCoversVehicle(l, swift2), true); // " maruti " / "SWIFT" → same group
  assert.equal(lockCoversVehicle(l, creta), false);
  assert.equal(lockCoversVehicle(l, { ...swift, categoryId: 4 }), false); // another category
  assert.equal(lockCoversVehicle(l, otherBranch), false);
});

test("an unknown scope covers nothing", () => {
  assert.equal(lockCoversVehicle(lock({ scope: "SOMETHING" }), swift), false);
});

// ── who it blocks ────────────────────────────────────────────────────────────

const INSIDE: [Date, Date] = [at("2026-10-20T06:30:00Z"), at("2026-10-20T10:30:00Z")];

test("a lock blocks customers and staff; a customers-only lock blocks customers only", () => {
  assert.equal(lockBlocksVehicle(lock(), swift, ...INSIDE), true);
  assert.equal(lockBlocksVehicle(lock(), swift, ...INSIDE, true), true);
  const hidden = lock({ customersOnly: true });
  assert.equal(lockBlocksVehicle(hidden, swift, ...INSIDE), true);
  assert.equal(lockBlocksVehicle(hidden, swift, ...INSIDE, true), false);
});

test("a cancelled lock, or one not covering the car or the window, blocks nothing", () => {
  assert.equal(lockBlocksVehicle(lock({ cancelledAt: at("2026-10-19T00:00:00Z") }), swift, ...INSIDE), false);
  assert.equal(lockBlocksVehicle(lock({ scope: "VEHICLES", vehicleIds: [9] }), swift, ...INSIDE), false);
  assert.equal(lockBlocksVehicle(lock(), swift, at("2026-10-22T04:30:00Z"), at("2026-10-23T04:30:00Z")), false);
});

// ── status and window checks ─────────────────────────────────────────────────

test("lock status by time and cancellation", () => {
  assert.equal(bookingLockStatus(lock(), at("2026-10-19T00:00:00Z")), "UPCOMING");
  assert.equal(bookingLockStatus(lock(), LOCK_START), "ACTIVE");
  assert.equal(bookingLockStatus(lock(), LOCK_END), "ENDED");
  assert.equal(bookingLockStatus(lock({ cancelledAt: at("2026-10-19T00:00:00Z") }), at("2026-10-20T06:00:00Z")), "CANCELLED");
});

test("window checks: 30-minute steps, end after start, not over, at most 60 days", () => {
  const now = at("2026-10-19T00:00:00Z");
  assert.deepEqual(bookingLockWindowIssues({ startAt: LOCK_START.toISOString(), endAt: LOCK_END.toISOString() }, now), []);
  const paths = (s: string, e: string) => bookingLockWindowIssues({ startAt: s, endAt: e }, now).map((i) => i.path);
  assert.deepEqual(paths("2026-10-20T04:45:00Z", "2026-10-21T12:30:00Z"), ["startAt"]); // 10:15 IST
  assert.deepEqual(paths("2026-10-20T04:30:00Z", "2026-10-20T04:30:00Z"), ["endAt"]); // end = start
  assert.deepEqual(paths("2026-10-10T04:30:00Z", "2026-10-11T04:30:00Z"), ["endAt"]); // already over
  assert.deepEqual(paths("2026-10-20T04:30:00Z", "2026-12-25T04:30:00Z"), ["endAt"]); // > 60 days
  assert.deepEqual(paths("not a date", "2026-10-21T12:30:00Z"), ["startAt"]);
  // Started already but still running: allowed
  assert.deepEqual(paths("2026-10-18T04:30:00Z", "2026-10-20T04:30:00Z"), []);
});

// ── extensions: a lock is like a next booking at its effective start, no buffer ─

const END = at("2026-10-17T04:30:00Z"); // current return Sat 17 Oct 10:00 IST
const MAX = at("2026-11-10T04:30:00Z");
// As extension-availability.service passes it: startAt = the effective start
const lockConflict = { startAt: effectiveLockStart(LOCK_START), endAt: LOCK_END, kind: "LOCK" as const };

test("an extension may run right up to the lead day (00:00 IST the day before the lock), not past it", () => {
  assert.equal(blocksExtension(lockConflict, END, EFF_START), false);
  // 30 minutes into the lead day, or right up to the lock start: refused
  assert.equal(blocksExtension(lockConflict, END, at("2026-10-18T19:00:00Z")), true);
  assert.equal(blocksExtension(lockConflict, END, LOCK_START), true);
  // A booking at the same time would need the 2 h buffer
  assert.equal(blocksExtension({ startAt: EFF_START, endAt: LOCK_END }, END, EFF_START), true);
});

test("available until = the effective start (rounded down to the grid), limit NEXT_BOOKING", () => {
  const u = extensionAvailableUntil({ currentEndAt: END, maxEndAt: MAX, nextPickupAt: EFF_START, nextKind: "LOCK" });
  assert.equal(u.availableUntil.toISOString(), EFF_START.toISOString());
  assert.equal(u.limitReason, "NEXT_BOOKING");
  assert.equal(u.canExtend, true);
});

test("offer vs commit: the partial end / available until offered for a lock passes the commit's check", () => {
  const requested = at("2026-10-21T04:30:00Z"); // into the lock
  const partial = partialExtensionEnd(END, requested, [lockConflict]);
  assert.equal(partial?.toISOString(), EFF_START.toISOString());
  assert.equal(blocksExtension(lockConflict, END, partial!), false);
  const u = extensionAvailableUntil({ currentEndAt: END, maxEndAt: MAX, nextPickupAt: EFF_START, nextKind: "LOCK" });
  assert.equal(blocksExtension(lockConflict, END, u.availableUntil), false);
  // One slot later is refused
  assert.equal(blocksExtension(lockConflict, END, new Date(u.availableUntil.getTime() + 30 * 60_000)), true);
});

test("a lock and a booking together: the tighter limit wins (booking buffer vs the lock's lead day)", () => {
  // Booking at 18 Oct 20:00 IST (limit 18:00) and the lock acting from 19 Oct 00:00 IST: the booking limits more
  const booking = { startAt: at("2026-10-18T14:30:00Z"), endAt: at("2026-10-21T05:30:00Z") };
  const requested = at("2026-10-21T04:30:00Z");
  const partial = partialExtensionEnd(END, requested, [lockConflict, booking]);
  assert.equal(partial?.toISOString(), "2026-10-18T12:30:00.000Z");
  assert.equal(latestReturnFor(booking).toISOString(), "2026-10-18T12:30:00.000Z");
  assert.equal(latestReturnFor(lockConflict).toISOString(), EFF_START.toISOString());
  assert.equal([lockConflict, booking].some((c) => blocksExtension(c, END, partial!)), false);
});

test("a lock starting at the current return leaves nothing to extend", () => {
  const atReturn = { startAt: END, endAt: LOCK_END, kind: "LOCK" as const };
  assert.equal(partialExtensionEnd(END, at("2026-10-20T04:30:00Z"), [atReturn]), null);
  const u = extensionAvailableUntil({ currentEndAt: END, maxEndAt: MAX, nextPickupAt: END, nextKind: "LOCK" });
  assert.equal(u.canExtend, false);
});

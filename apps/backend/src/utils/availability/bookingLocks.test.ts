/**
 * Pure checks of the booking-lock rule (lockOverlapsWindow / lockCoversVehicle /
 * lockBlocksVehicle in @repo/schemas, read by bookingLocks.ts for the listing,
 * booking create, reschedule and swaps) and of how the extension rule treats a
 * lock (partial-extension.ts): a lock is an exact window — no turnaround, no
 * extension buffer — and what is offered also commits.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bookingLockStatus,
  bookingLockWindowIssues,
  lockBlocksVehicle,
  lockCoversVehicle,
  lockOverlapsWindow,
  vehicleGroupKey,
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

// ── overlap: a plain overlap, no turnaround ──────────────────────────────────

test("a window overlapping the lock is blocked; touching its edges is not", () => {
  const l = lock();
  // Inside
  assert.equal(lockOverlapsWindow(l, at("2026-10-20T06:30:00Z"), at("2026-10-20T10:30:00Z")), true);
  // Starts before, ends inside
  assert.equal(lockOverlapsWindow(l, at("2026-10-19T04:30:00Z"), at("2026-10-20T05:00:00Z")), true);
  // Covers the whole lock
  assert.equal(lockOverlapsWindow(l, at("2026-10-19T04:30:00Z"), at("2026-10-22T04:30:00Z")), true);
  // Return exactly at the lock start: free (no 3 h turnaround around a lock)
  assert.equal(lockOverlapsWindow(l, at("2026-10-19T04:30:00Z"), LOCK_START), false);
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

// ── extensions: a lock is like a next booking, with no buffer ────────────────

const END = at("2026-10-19T04:30:00Z"); // current return Mon 19 Oct 10:00 IST
const MAX = at("2026-11-10T04:30:00Z");
const lockConflict = { startAt: LOCK_START, endAt: LOCK_END, kind: "LOCK" as const };

test("an extension may run right up to the lock start, not past it", () => {
  assert.equal(blocksExtension(lockConflict, END, LOCK_START), false);
  assert.equal(blocksExtension(lockConflict, END, at("2026-10-20T05:00:00Z")), true);
  // A booking at the same time would need the 2 h buffer
  assert.equal(blocksExtension({ startAt: LOCK_START, endAt: LOCK_END }, END, LOCK_START), true);
});

test("available until = the lock start (rounded down to the grid), limit NEXT_BOOKING", () => {
  const u = extensionAvailableUntil({ currentEndAt: END, maxEndAt: MAX, nextPickupAt: LOCK_START, nextKind: "LOCK" });
  assert.equal(u.availableUntil.toISOString(), LOCK_START.toISOString());
  assert.equal(u.limitReason, "NEXT_BOOKING");
  assert.equal(u.canExtend, true);
});

test("offer vs commit: the partial end / available until offered for a lock passes the commit's check", () => {
  const requested = at("2026-10-21T04:30:00Z"); // into the lock
  const partial = partialExtensionEnd(END, requested, [lockConflict]);
  assert.equal(partial?.toISOString(), LOCK_START.toISOString());
  assert.equal(blocksExtension(lockConflict, END, partial!), false);
  const u = extensionAvailableUntil({ currentEndAt: END, maxEndAt: MAX, nextPickupAt: LOCK_START, nextKind: "LOCK" });
  assert.equal(blocksExtension(lockConflict, END, u.availableUntil), false);
  // One slot later is refused
  assert.equal(blocksExtension(lockConflict, END, new Date(u.availableUntil.getTime() + 30 * 60_000)), true);
});

test("a lock and a booking together: the tighter limit wins (booking buffer vs lock start)", () => {
  // Booking at 11:00 IST (limit 09:00) and lock at 10:00 IST (limit 10:00): the booking limits more
  const booking = { startAt: at("2026-10-20T05:30:00Z"), endAt: at("2026-10-21T05:30:00Z") };
  const requested = at("2026-10-21T04:30:00Z");
  const partial = partialExtensionEnd(END, requested, [lockConflict, booking]);
  assert.equal(partial?.toISOString(), "2026-10-20T03:30:00.000Z");
  assert.equal(latestReturnFor(booking).toISOString(), "2026-10-20T03:30:00.000Z");
  assert.equal(latestReturnFor(lockConflict).toISOString(), LOCK_START.toISOString());
  assert.equal([lockConflict, booking].some((c) => blocksExtension(c, END, partial!)), false);
});

test("a lock starting at the current return leaves nothing to extend", () => {
  const atReturn = { startAt: END, endAt: LOCK_END, kind: "LOCK" as const };
  assert.equal(partialExtensionEnd(END, at("2026-10-20T04:30:00Z"), [atReturn]), null);
  const u = extensionAvailableUntil({ currentEndAt: END, maxEndAt: MAX, nextPickupAt: END, nextKind: "LOCK" });
  assert.equal(u.canExtend, false);
});

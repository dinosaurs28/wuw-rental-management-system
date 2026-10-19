/**
 * Pure checks of the extension availability rule (partial-extension.ts): the
 * 2-hour buffer before the car's next pickup, applied the same way by evaluate
 * (blocksExtension over the conflicts the resolver reads), the partial end,
 * the "available until" the eligibility/evaluate responses return and the
 * commit's re-checks (checkVehicleAvailability queries [current end,
 * extensionCheckEnd(new end)) and keeps the conflicts blocksExtension keeps).
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXTENSION_BUFFER_HOURS } from "@repo/schemas";
import {
  blocksExtension,
  extensionAvailableUntil,
  extensionCheckEnd,
  latestReturnBefore,
  partialExtensionEnd,
} from "./partial-extension.js";

const at = (iso: string) => new Date(iso);
const END = at("2026-10-17T05:30:00Z"); // Sat 17 Oct 11:00 IST
const REQ = at("2026-10-18T11:30:00Z"); // Sun 18 Oct 17:00 IST
const booking = (startIso: string, endIso: string) => ({ startAt: at(startIso), endAt: at(endIso) });

test("the buffer is 2 hours", () => {
  assert.equal(EXTENSION_BUFFER_HOURS, 2);
  assert.equal(extensionCheckEnd(REQ).toISOString(), "2026-10-18T13:30:00.000Z");
});

// ── evaluate / commit: what blocks the same car ─────────────────────────────

test("a next pickup less than 2 h after the new return blocks the extension (evaluate and commit)", () => {
  // Next pickup Sun 18:30 IST, new return Sun 17:00 IST: only 1 h 30 min apart
  assert.equal(blocksExtension(booking("2026-10-18T13:00:00Z", "2026-10-19T13:00:00Z"), END, REQ), true);
  // Exactly at the new return
  assert.equal(blocksExtension(booking("2026-10-18T11:30:00Z", "2026-10-19T13:00:00Z"), END, REQ), true);
});

test("a next pickup exactly 2 h (or more) after the new return leaves the extension free", () => {
  assert.equal(blocksExtension(booking("2026-10-18T13:30:00Z", "2026-10-19T13:00:00Z"), END, REQ), false);
  assert.equal(blocksExtension(booking("2026-10-19T04:00:00Z", "2026-10-20T04:00:00Z"), END, REQ), false);
});

test("a booking that ended before the current return never blocks", () => {
  assert.equal(blocksExtension(booking("2026-10-15T05:30:00Z", "2026-10-17T05:30:00Z"), END, REQ), false);
});

// ── partial extension ───────────────────────────────────────────────────────

test("only the tail conflicts → partial until 2 h before the first conflict's start", () => {
  const p = partialExtensionEnd(END, REQ, [{ startAt: at("2026-10-18T04:00:00Z") }]); // Sun 09:30 IST
  assert.equal(p?.toISOString(), "2026-10-18T02:00:00.000Z"); // Sun 07:30 IST
});

test("the partial end is rounded down to the 30-minute picker grid", () => {
  // Pickup Sun 09:40 IST → 07:40 → 07:30 IST
  const p = partialExtensionEnd(END, REQ, [{ startAt: at("2026-10-18T04:10:00Z") }]);
  assert.equal(p?.toISOString(), "2026-10-18T02:00:00.000Z");
  assert.equal(latestReturnBefore(at("2026-10-18T04:29:59Z")).toISOString(), "2026-10-18T02:00:00.000Z");
  assert.equal(latestReturnBefore(at("2026-10-18T04:30:00Z")).toISOString(), "2026-10-18T02:30:00.000Z");
});

test("the earliest of several conflicts wins (bookings and checkout holds alike)", () => {
  const p = partialExtensionEnd(END, REQ, [
    { startAt: at("2026-10-18T04:00:00Z") },
    { startAt: at("2026-10-17T12:30:00Z") }, // a checkout from Sat 18:00 IST
  ]);
  assert.equal(p?.toISOString(), "2026-10-17T10:30:00.000Z"); // Sat 16:00 IST
});

test("a pickup inside the 2 h after the requested return → partial just before it", () => {
  // Pickup Sun 18:00 IST (requested return 17:00): the partial ends 16:00 IST
  const p = partialExtensionEnd(END, REQ, [{ startAt: at("2026-10-18T12:30:00Z") }]);
  assert.equal(p?.toISOString(), "2026-10-18T10:30:00.000Z");
});

test("a conflict at (or before) the current end → no partial (the 'availability changed' bug)", () => {
  // A booking from exactly the return time plus a later one: the old code offered
  // a partial until the later one, which the commit then refused
  assert.equal(
    partialExtensionEnd(END, REQ, [{ startAt: END }, { startAt: at("2026-10-18T04:00:00Z") }]),
    null,
  );
  assert.equal(partialExtensionEnd(END, REQ, [{ startAt: at("2026-10-17T04:30:00Z") }]), null);
});

test("a pickup within 2 h of the current return → no partial (nothing left after the buffer)", () => {
  assert.equal(partialExtensionEnd(END, REQ, [{ startAt: at("2026-10-17T07:00:00Z") }]), null); // +1 h 30
  assert.equal(partialExtensionEnd(END, REQ, [{ startAt: at("2026-10-17T07:30:00Z") }]), null); // +2 h exactly
  // 2 h 30 min after: a 30-minute partial
  assert.equal(
    partialExtensionEnd(END, REQ, [{ startAt: at("2026-10-17T08:00:00Z") }])?.toISOString(),
    "2026-10-17T06:00:00.000Z",
  );
});

test("no conflicts, or none before the requested end + 2 h → no partial", () => {
  assert.equal(partialExtensionEnd(END, REQ, []), null);
  assert.equal(partialExtensionEnd(END, REQ, [{ startAt: extensionCheckEnd(REQ) }]), null);
});

test("an offered partial commits: nothing in the conflict list blocks [current end, partial end]", () => {
  const conflicts = [booking("2026-10-18T04:10:00Z", "2026-10-19T04:10:00Z")];
  const p = partialExtensionEnd(END, REQ, conflicts)!;
  assert.ok(p);
  assert.equal(conflicts.some((c) => blocksExtension(c, END, p)), false);
});

// ── available until (eligibility / evaluate response) ───────────────────────

const MAX = at("2026-11-10T05:30:00Z");

test("available until = next pickup − 2 h (rounded down) when it comes before the cap", () => {
  const u = extensionAvailableUntil({ currentEndAt: END, maxEndAt: MAX, nextPickupAt: at("2026-10-18T04:10:00Z") });
  assert.deepEqual(
    { at: u.availableUntil.toISOString(), reason: u.limitReason, can: u.canExtend },
    { at: "2026-10-18T02:00:00.000Z", reason: "NEXT_BOOKING", can: true },
  );
});

test("no next booking, or one past the cap → the rental-length cap", () => {
  const none = extensionAvailableUntil({ currentEndAt: END, maxEndAt: MAX, nextPickupAt: null });
  assert.equal(none.availableUntil.toISOString(), MAX.toISOString());
  assert.equal(none.limitReason, "MAX_RENTAL_PERIOD");
  const later = extensionAvailableUntil({ currentEndAt: END, maxEndAt: MAX, nextPickupAt: at("2026-11-10T07:30:00Z") });
  assert.equal(later.limitReason, "MAX_RENTAL_PERIOD");
});

test("a next pickup within 2 h of the current return → nothing left on this car", () => {
  const u = extensionAvailableUntil({ currentEndAt: END, maxEndAt: MAX, nextPickupAt: at("2026-10-17T07:00:00Z") });
  assert.equal(u.canExtend, false);
  assert.equal(u.limitReason, "NEXT_BOOKING");
  assert.equal(u.availableUntil.toISOString(), END.toISOString());
});

test("available until and a partial extension agree", () => {
  const next = at("2026-10-18T04:10:00Z");
  const u = extensionAvailableUntil({ currentEndAt: END, maxEndAt: MAX, nextPickupAt: next });
  assert.equal(partialExtensionEnd(END, REQ, [{ startAt: next }])?.toISOString(), u.availableUntil.toISOString());
});

/**
 * Pure checks of the partial-extension end (partial-extension.ts): it must come
 * from the same conflicts the commit re-checks, so an offered partial commits.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { partialExtensionEnd } from "./partial-extension.js";

const at = (iso: string) => new Date(iso);
const END = at("2026-10-17T05:30:00Z"); // Sat 17 Oct 11:00 IST
const REQ = at("2026-10-18T11:30:00Z"); // Sun 18 Oct 17:00 IST

test("only the tail conflicts → partial until the first conflict's start", () => {
  const p = partialExtensionEnd(END, REQ, [{ startAt: at("2026-10-18T04:00:00Z") }]); // Sun 09:30
  assert.equal(p?.toISOString(), "2026-10-18T04:00:00.000Z");
});

test("the earliest of several conflicts wins (bookings and checkout holds alike)", () => {
  const p = partialExtensionEnd(END, REQ, [
    { startAt: at("2026-10-18T04:00:00Z") },
    { startAt: at("2026-10-17T12:30:00Z") }, // a checkout from Sat 18:00
  ]);
  assert.equal(p?.toISOString(), "2026-10-17T12:30:00.000Z");
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

test("no conflicts, or none before the requested end → no partial", () => {
  assert.equal(partialExtensionEnd(END, REQ, []), null);
  assert.equal(partialExtensionEnd(END, REQ, [{ startAt: REQ }]), null);
});

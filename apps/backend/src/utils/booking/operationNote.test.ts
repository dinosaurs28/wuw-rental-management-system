/**
 * Pure checks of the Fleet pickup / drop note (Oct 20 2026): trimming, the
 * length limit, blank → no note, not sent → left as saved, and the before /
 * after the Edit Pickup / Edit Drop audit entry records. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OPERATION_NOTE_MAX,
  OperationNoteError,
  operationNoteChanges,
  parseOperationNote,
} from "./operationNote.js";
import { changedFields } from "../../services/booking/operation-edit-guard.js";

test("a note is trimmed", () => {
  assert.equal(parseOperationNote("  Left mirror scratched  \n", "pickupNote"), "Left mirror scratched");
  assert.equal(parseOperationNote("Line 1\nLine 2", "dropNote"), "Line 1\nLine 2");
});

test("empty, blank or null → no note (null); not sent → undefined", () => {
  assert.equal(parseOperationNote("", "pickupNote"), null);
  assert.equal(parseOperationNote("   \n\t ", "pickupNote"), null);
  assert.equal(parseOperationNote(null, "pickupNote"), null);
  assert.equal(parseOperationNote(undefined, "pickupNote"), undefined);
});

test("up to the limit is kept; over it is refused with OPERATION_NOTE_TOO_LONG", () => {
  const max = "a".repeat(OPERATION_NOTE_MAX);
  assert.equal(parseOperationNote(max, "pickupNote"), max);
  // Surrounding spaces don't count towards the limit
  assert.equal(parseOperationNote(`  ${max}  `, "pickupNote"), max);
  assert.throws(
    () => parseOperationNote("a".repeat(OPERATION_NOTE_MAX + 1), "dropNote"),
    (err: unknown) =>
      err instanceof OperationNoteError &&
      err.code === "OPERATION_NOTE_TOO_LONG" &&
      err.status === 400 &&
      err.field === "dropNote" &&
      err.toJSON().code === "OPERATION_NOTE_TOO_LONG",
  );
});

test("a non-text note is refused with OPERATION_NOTE_INVALID", () => {
  for (const bad of [42, true, { text: "x" }, ["x"]]) {
    assert.throws(
      () => parseOperationNote(bad, "pickupNote"),
      (err: unknown) => err instanceof OperationNoteError && err.code === "OPERATION_NOTE_INVALID",
    );
  }
});

test("operationNoteChanges: not sent never changes; same text doesn't; clearing does", () => {
  assert.equal(operationNoteChanges("x", undefined), false);
  assert.equal(operationNoteChanges(null, undefined), false);
  assert.equal(operationNoteChanges("x", "x"), false);
  assert.equal(operationNoteChanges(null, null), false);
  assert.equal(operationNoteChanges(undefined, null), false);
  assert.equal(operationNoteChanges("x", "y"), true);
  assert.equal(operationNoteChanges(null, "y"), true);
  assert.equal(operationNoteChanges("x", null), true);
});

test("edit audit: the note's before / after is recorded when it changes, and only then", () => {
  const before = { odometer: 1200, pickupNote: "Fuel cap loose" } as Record<string, unknown>;

  const edited = changedFields(before, { odometer: undefined, pickupNote: "Fuel cap fixed" });
  assert.deepEqual(edited.fields, ["pickupNote"]);
  assert.deepEqual(edited.before, { pickupNote: "Fuel cap loose" });
  assert.deepEqual(edited.after, { pickupNote: "Fuel cap fixed" });

  // Cleared: null is a change (undefined = not sent)
  const cleared = changedFields(before, { pickupNote: null });
  assert.deepEqual(cleared.fields, ["pickupNote"]);
  assert.deepEqual(cleared.after, { pickupNote: null });

  // Added where there was none
  const added = changedFields({ dropNote: null } as Record<string, unknown>, { dropNote: "Customer asked for invoice" });
  assert.deepEqual(added.fields, ["dropNote"]);
  assert.deepEqual(added.before, { dropNote: null });

  // Not sent / unchanged: nothing logged
  assert.deepEqual(changedFields(before, { pickupNote: undefined }).fields, []);
  assert.deepEqual(changedFields(before, { pickupNote: "Fuel cap loose" }).fields, []);
});

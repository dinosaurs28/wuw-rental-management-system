import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { fieldValidationError } from "./fieldError.js";

const schema = z.object({
  odo: z.number().min(1, "Enter the odometer reading"),
  photos: z.array(z.object({ label: z.string().max(3) })).optional(),
});

test("a message written for the field is kept, with the field named", () => {
  const r = schema.safeParse({ odo: 0 });
  const e = fieldValidationError(r.error!, { odo: "Odometer" });
  assert.deepEqual([e.success, e.code, e.field, e.path, e.message], [false, "VALIDATION_FAILED", "odo", "odo", "Enter the odometer reading"]);
  assert.ok(e.errors, "zod's format() kept for older clients");
});

test("zod's own wording gets the field's name (and the item) in front", () => {
  const r = schema.safeParse({ odo: 5, photos: [{ label: "ok" }, { label: "toolong" }] });
  const e = fieldValidationError(r.error!, { photos: "Photos" });
  assert.equal(e.field, "photos");
  assert.equal(e.path, "photos.1.label");
  assert.match(e.message, /^Photos \(item 2\): Too big/);
});

test("an unknown field falls back to its request name", () => {
  const r = schema.safeParse({ odo: "x" });
  assert.match(fieldValidationError(r.error!).message, /^odo: /);
});

test("no issues → a readable default", () => {
  assert.equal(fieldValidationError({ issues: [] }).message, "Some of the details sent couldn't be read.");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeProofIdList, PAYMENT_PROOF_MAX_PHOTOS } from "./payment-proof-list.js";

test("allows up to three photos", () => {
  assert.equal(PAYMENT_PROOF_MAX_PHOTOS, 3);
});

test("nothing sent → no photos (the caller decides if one is required)", () => {
  assert.deepEqual(normalizeProofIdList(undefined, undefined), { ok: true, ids: [] });
  assert.deepEqual(normalizeProofIdList(null, null), { ok: true, ids: [] });
  assert.deepEqual(normalizeProofIdList("", []), { ok: true, ids: [] });
});

test("legacy single proof_file_id still works", () => {
  assert.deepEqual(normalizeProofIdList("  abc  ", undefined), { ok: true, ids: ["abc"] });
  assert.deepEqual(normalizeProofIdList("abc", []), { ok: true, ids: ["abc"] });
});

test("a list of 1–3 photos keeps its order", () => {
  assert.deepEqual(normalizeProofIdList(undefined, ["a"]), { ok: true, ids: ["a"] });
  assert.deepEqual(normalizeProofIdList(undefined, ["a", " b "]), { ok: true, ids: ["a", "b"] });
  assert.deepEqual(normalizeProofIdList(undefined, ["c", "a", "b"]), { ok: true, ids: ["c", "a", "b"] });
});

test("more than three photos is refused", () => {
  const r = normalizeProofIdList(undefined, ["a", "b", "c", "d"]);
  assert.equal(r.ok, false);
});

test("the single id must be the first photo when both are sent", () => {
  assert.deepEqual(normalizeProofIdList("a", ["a", "b"]), { ok: true, ids: ["a", "b"] });
  const r = normalizeProofIdList("b", ["a", "b"]);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.position, 1);
});

test("a blank or non-string slot is refused with its position", () => {
  const blank = normalizeProofIdList(undefined, ["a", ""]);
  assert.equal(blank.ok, false);
  assert.equal(!blank.ok && blank.position, 2);
  const num = normalizeProofIdList(undefined, [7]);
  assert.equal(!num.ok && num.position, 1);
  // The first photo can't be skipped by leaving slot 1 empty
  const firstMissing = normalizeProofIdList(undefined, [null, "b"]);
  assert.equal(!firstMissing.ok && firstMissing.position, 1);
});

test("the same photo twice is refused", () => {
  const r = normalizeProofIdList(undefined, ["a", "b", "a"]);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.position, 3);
});

test("malformed fields are refused", () => {
  assert.equal(normalizeProofIdList(undefined, "a").ok, false);
  assert.equal(normalizeProofIdList(12, undefined).ok, false);
  assert.equal(normalizeProofIdList("   ", undefined).ok, false);
});

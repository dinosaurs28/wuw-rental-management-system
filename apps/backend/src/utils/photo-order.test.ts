/**
 * Pure checks of the photo capture order (Oct 22 2026): vehicle condition
 * photos are saved and listed in the order they were taken, not the order
 * their uploads finished; rows from before keep the old order. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bookingPhotoOrderBy,
  bookingPhotoSetKey,
  compareBookingPhotos,
  nextCaptureOrder,
  orderByCapture,
  sortBookingPhotos,
  sortPhotoSetsNewestFirst,
} from "./photo-order.js";

const at = (iso: string) => new Date(`2026-10-22T${iso}:00.000Z`);

test("photos with a capture order list by it, whatever their id or save time", () => {
  const rows = [
    { id: 1, captureOrder: 2, createdAt: at("10:00") },
    { id: 2, captureOrder: 0, createdAt: at("10:00") },
    { id: 3, captureOrder: 1, createdAt: at("09:00") },
  ];
  assert.deepEqual(sortBookingPhotos(rows).map((r) => r.id), [2, 3, 1]);
  // the input is left as it is
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3]);
});

test("rows from before captureOrder keep the old order: createdAt, then id", () => {
  const rows = [
    { id: 7, captureOrder: null, createdAt: at("10:05") },
    { id: 9, captureOrder: null, createdAt: at("10:00") },
    { id: 8, captureOrder: null, createdAt: at("10:00") },
  ];
  assert.deepEqual(sortBookingPhotos(rows).map((r) => r.id), [8, 9, 7]);
  // a field left out counts as null (older selects)
  assert.deepEqual(sortBookingPhotos([{ id: 2 }, { id: 1 }]).map((r) => r.id), [1, 2]);
});

test("a set mixing old rows and photos added later: old rows first, then the new ones in capture order", () => {
  const rows = [
    { id: 20, captureOrder: 1, createdAt: at("12:00") },
    { id: 4, captureOrder: null, createdAt: at("09:00") },
    { id: 21, captureOrder: 0, createdAt: at("12:00") },
    { id: 3, captureOrder: null, createdAt: at("09:00") },
  ];
  assert.deepEqual(sortBookingPhotos(rows).map((r) => r.id), [3, 4, 21, 20]);
  assert.ok(compareBookingPhotos({ captureOrder: null }, { captureOrder: 0 }) < 0);
  assert.ok(compareBookingPhotos({ captureOrder: 0 }, { captureOrder: null }) > 0);
});

test("equal capture orders (two saves of one set) fall back to save time, then id", () => {
  const rows = [
    { id: 11, captureOrder: 1, createdAt: at("10:00") },
    { id: 10, captureOrder: 1, createdAt: at("10:00") },
    { id: 5, captureOrder: 1, createdAt: at("09:59") },
  ];
  assert.deepEqual(sortBookingPhotos(rows).map((r) => r.id), [5, 10, 11]);
  // ISO strings work too (serialized rows)
  assert.ok(compareBookingPhotos({ createdAt: "2026-10-22T09:00:00Z" }, { createdAt: "2026-10-22T10:00:00Z" }) < 0);
});

test("the Prisma orderBy matches the in-memory sort: capture order (nulls first), createdAt, id", () => {
  assert.deepEqual(bookingPhotoOrderBy(), [
    { captureOrder: { sort: "asc", nulls: "first" } },
    { createdAt: "asc" },
    { id: "asc" },
  ]);
  // a fresh array each call (Prisma args are never shared)
  assert.notEqual(bookingPhotoOrderBy(), bookingPhotoOrderBy());
});

test("orderByCapture: by photoOrder when sent, else as sent (older builds = arrival order)", () => {
  const plain = [{ fileId: "c" }, { fileId: "a" }];
  const labelled = [{ fileId: "b", label: "Front" }];
  const sent = [...plain, ...labelled];
  assert.deepEqual(orderByCapture(sent, ["a", "b", "c"]).map((p) => p.fileId), ["a", "b", "c"]);
  // labels travel with their photo
  assert.deepEqual(orderByCapture(sent, ["b", "c", "a"])[0], { fileId: "b", label: "Front" });
  assert.deepEqual(orderByCapture(sent, undefined).map((p) => p.fileId), ["c", "a", "b"]);
  assert.deepEqual(orderByCapture(sent, []).map((p) => p.fileId), ["c", "a", "b"]);
  // photos left out of photoOrder go after, in their sent order; unknown / repeated ids are ignored
  assert.deepEqual(orderByCapture(sent, ["zz", "a", "a"]).map((p) => p.fileId), ["a", "c", "b"]);
  // the input is left as it is
  assert.deepEqual(sent.map((p) => p.fileId), ["c", "a", "b"]);
});

test("nextCaptureOrder: 0 for an empty (or old-rows-only) set, else one past the highest", () => {
  assert.equal(nextCaptureOrder(null), 0);
  assert.equal(nextCaptureOrder(undefined), 0);
  assert.equal(nextCaptureOrder(0), 1);
  assert.equal(nextCaptureOrder(5), 6);
});

test("mixed lists: newest set first (as before), each set in capture order", () => {
  const rows = [
    { id: 1, type: "PRE_DELIVERY", captureOrder: 1, createdAt: at("09:00") },
    { id: 2, type: "PRE_DELIVERY", captureOrder: 0, createdAt: at("09:00") },
    { id: 5, type: "POST_RETURN", captureOrder: 1, createdAt: at("18:00") },
    { id: 6, type: "POST_RETURN", captureOrder: 0, createdAt: at("18:00") },
    { id: 3, type: "SWAP_DELIVERY", swapId: 4, captureOrder: null, createdAt: at("12:00") },
    { id: 4, type: "SWAP_DELIVERY", swapId: 4, captureOrder: null, createdAt: at("12:00") },
  ];
  assert.deepEqual(sortPhotoSetsNewestFirst(rows, bookingPhotoSetKey).map((r) => r.id), [6, 5, 3, 4, 2, 1]);
  assert.notEqual(
    bookingPhotoSetKey({ type: "DAMAGE", damageReportId: 1 }),
    bookingPhotoSetKey({ type: "DAMAGE", damageReportId: 2 }),
  );
});

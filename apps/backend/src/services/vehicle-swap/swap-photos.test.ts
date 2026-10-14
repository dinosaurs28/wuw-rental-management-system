/**
 * Pure checks of the replacement-car photos at a mid-rental swap (client
 * item 2): the required shots, the old-app-build rule, the FASTag balances,
 * and which photos stand for the car being returned. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { vehicleSwapSchema } from "@repo/schemas";
import {
  MIN_SWAP_PHOTOS_WITHOUT_CONFIG,
  fastagBalancesToStore,
  isMidRentalSwap,
  missingFastagBalances,
  normalizeReplacementPhotos,
  parseCaptureFields,
  replacementPhotoShortfall,
  selectReturnConditionPhotos,
  swapPhotoMode,
  swapPhotoRequirement,
  swapPhotosMissing,
  type SwapWithPhotos,
} from "./swap-photos.js";

const FIELDS = parseCaptureFields([
  { name: "Front", required: true },
  { name: "Back", required: true },
  { name: "Odometer", required: false },
]);

test("parseCaptureFields keeps valid named fields, trimmed, without repeats", () => {
  assert.deepEqual(
    parseCaptureFields([{ name: " Front ", required: true }, { name: "front" }, { name: "" }, null, "x", { required: true }]),
    [{ name: "Front", required: true }],
  );
  assert.deepEqual(parseCaptureFields(null), []);
  assert.deepEqual(parseCaptureFields({ name: "Front" }), []);
});

test("requirement: required labels, one photo for an all-optional config, four without a config", () => {
  assert.deepEqual(swapPhotoRequirement(FIELDS), { fields: FIELDS, minPhotos: 2 });
  assert.equal(swapPhotoRequirement([{ name: "Front", required: false }]).minPhotos, 1);
  assert.equal(swapPhotoRequirement([]).minPhotos, MIN_SWAP_PHOTOS_WITHOUT_CONFIG);
  assert.equal(MIN_SWAP_PHOTOS_WITHOUT_CONFIG, 4);
});

test("mode: strict when the field is sent (even empty), legacy when omitted, never before pickup", () => {
  assert.equal(swapPhotoMode({ stage: "ACTIVE_RENTAL", source: "STAFF", replacementPhotos: [] }), "STRICT");
  assert.equal(swapPhotoMode({ stage: "ACTIVE_RENTAL", source: "STAFF", replacementPhotos: undefined }), "LEGACY");
  assert.equal(swapPhotoMode({ stage: "PRE_PICKUP", source: "STAFF", replacementPhotos: [] }), "NOT_REQUIRED");
  assert.equal(swapPhotoMode({ stage: "ACTIVE_RENTAL", source: "EXTENSION", replacementPhotos: undefined }), "NOT_REQUIRED");
});

test("shortfall names the required labels still missing", () => {
  const req = swapPhotoRequirement(FIELDS);
  const one = normalizeReplacementPhotos([{ fileId: "a", label: "front" }, { fileId: "b", label: "Odometer" }], FIELDS).photos;
  assert.deepEqual(replacementPhotoShortfall(one, req), { missingLabels: ["Back"], minPhotos: 2, photoCount: 2 });
  const both = normalizeReplacementPhotos([{ fileId: "a", label: "Front" }, { fileId: "b", label: "BACK" }], FIELDS).photos;
  assert.equal(replacementPhotoShortfall(both, req), null);
  // config spelling is stored
  assert.deepEqual(both.map((p) => p.label), ["Front", "Back"]);
  assert.deepEqual(replacementPhotoShortfall([], req), { missingLabels: ["Front", "Back"], minPhotos: 2, photoCount: 0 });
});

test("shortfall without a config counts photos; repeats of a file count once", () => {
  const req = swapPhotoRequirement([]);
  const three = normalizeReplacementPhotos(
    [{ fileId: "a" }, { fileId: "b" }, { fileId: "c" }, { fileId: "a" }],
    [],
  ).photos;
  assert.equal(three.length, 3);
  assert.deepEqual(replacementPhotoShortfall(three, req), { missingLabels: [], minPhotos: 4, photoCount: 3 });
  const four = normalizeReplacementPhotos([{ fileId: "a" }, { fileId: "b" }, { fileId: "c" }, { fileId: "d", label: " " }], []).photos;
  assert.equal(replacementPhotoShortfall(four, req), null);
});

test("two files for one shot: the last is kept, the earlier one is reported (never left unattached)", () => {
  const result = normalizeReplacementPhotos(
    [{ fileId: "a", label: "Front" }, { fileId: "b", label: "front" }, { fileId: "c" }],
    FIELDS,
  );
  assert.deepEqual(result.photos, [{ fileId: "b", label: "Front" }, { fileId: "c" }]);
  assert.deepEqual(result.duplicates, ["a"]);
  // the same file sent twice is not a duplicate shot
  assert.deepEqual(
    normalizeReplacementPhotos([{ fileId: "a", label: "Front" }, { fileId: "a", label: "Front" }], FIELDS).duplicates,
    [],
  );
});

test("FASTag balances: required in strict mode for cars with a FASTag, stored only mid-rental", () => {
  const base = { stage: "ACTIVE_RENTAL" as const, oldVehicleHasFastag: true, newVehicleHasFastag: true };
  assert.deepEqual(missingFastagBalances("STRICT", base), ["oldVehicleFastagBalance", "newVehicleFastagBalance"]);
  assert.deepEqual(missingFastagBalances("STRICT", { ...base, oldVehicleFastagBalance: 0 }), ["newVehicleFastagBalance"]);
  assert.deepEqual(missingFastagBalances("STRICT", { ...base, newVehicleHasFastag: false, oldVehicleFastagBalance: 120.5 }), []);
  assert.deepEqual(missingFastagBalances("LEGACY", base), []);
  assert.deepEqual(
    fastagBalancesToStore({ ...base, newVehicleHasFastag: false, oldVehicleFastagBalance: 120.5, newVehicleFastagBalance: 300 }),
    { oldVehicleFastagBalance: 120.5, newVehicleFastagBalance: null },
  );
  assert.deepEqual(
    fastagBalancesToStore({ ...base, stage: "PRE_PICKUP", oldVehicleFastagBalance: 1, newVehicleFastagBalance: 2 }),
    { oldVehicleFastagBalance: null, newVehicleFastagBalance: null },
  );
});

test("request schema: replacementPhotos optional, FASTag balances ≥ 0 with 2 decimals", () => {
  const base = { newVehicleId: 5, reason: "MAINTENANCE" };
  const legacy = vehicleSwapSchema.parse(base);
  assert.equal(legacy.replacementPhotos, undefined);
  const strict = vehicleSwapSchema.parse({
    ...base,
    replacementPhotos: [{ fileId: "f1", label: "Front" }, { fileId: "f2", label: "" }],
    oldVehicleFastagBalance: "150.50",
    newVehicleFastagBalance: null,
  });
  assert.deepEqual(
    strict.replacementPhotos?.map((p) => [p.fileId, p.label]),
    [["f1", "Front"], ["f2", undefined]],
  );
  assert.equal(strict.oldVehicleFastagBalance, 150.5);
  assert.equal(strict.newVehicleFastagBalance, undefined);
  assert.equal(vehicleSwapSchema.safeParse({ ...base, oldVehicleFastagBalance: -1 }).success, false);
  assert.equal(vehicleSwapSchema.safeParse({ ...base, oldVehicleFastagBalance: 10.555 }).success, false);
  // same cap as the pickup / drop balances (₹1,00,000)
  assert.equal(vehicleSwapSchema.safeParse({ ...base, newVehicleFastagBalance: 100000 }).success, true);
  assert.equal(vehicleSwapSchema.safeParse({ ...base, newVehicleFastagBalance: 100000.01 }).success, false);
  assert.equal(vehicleSwapSchema.safeParse({ ...base, replacementPhotos: [{ fileId: "" }] }).success, false);
});

// ── Which photos stand for the car being returned ───────────────────────────

const A = { regNo: "KA20A1111", make: "Maruti", model: "Swift" };
const B = { regNo: "KA20B2222", make: "Hyundai", model: "i20" };
const C = { regNo: "KA20C3333", make: "Tata", model: "Nexon" };
const at = (iso: string) => new Date(iso);
const photo = (id: string, iso: string) => ({ id, createdAt: at(iso) });

function swap(
  publicId: string,
  iso: string,
  from: typeof A,
  to: typeof A,
  photos: ReturnType<typeof photo>[],
  bookingStatusAtSwap: string | null = "PICKED_UP",
): SwapWithPhotos<ReturnType<typeof photo>> {
  return { publicId, swappedAt: at(iso), bookingStatusAtSwap, originalVehicle: from, newVehicle: to, photos };
}

const pickupPhotos = [photo("p1", "2026-10-01T05:00:00Z"), photo("p2", "2026-10-01T05:01:00Z")];

test("no swap: the pickup photos of the current car", () => {
  const r = selectReturnConditionPhotos({ pickupPhotos, swaps: [], currentVehicle: A, pickedUpAt: at("2026-10-01T05:00:00Z") });
  assert.equal(r.swapped, false);
  assert.equal(r.photosMissing, false);
  assert.equal(r.current.source, "PICKUP");
  assert.deepEqual(r.current.vehicle, A);
  assert.deepEqual(r.current.takenAt, at("2026-10-01T05:00:00Z"));
  assert.equal(r.current.photos.length, 2);
  assert.deepEqual(r.earlier, []);
});

test("a swap before pickup doesn't replace the pickup photos", () => {
  const r = selectReturnConditionPhotos({
    pickupPhotos,
    swaps: [swap("s0", "2026-09-30T10:00:00Z", A, B, [], "CONFIRMED")],
    currentVehicle: B,
    pickedUpAt: at("2026-10-01T05:00:00Z"),
  });
  assert.equal(r.current.source, "PICKUP");
  assert.deepEqual(r.current.vehicle, B);
  assert.equal(r.current.replaced, false);
});

test("mid-rental swap: the replacement's swap photos first, the original pickup after", () => {
  const swapPhotos = [photo("s1", "2026-10-03T08:00:00Z")];
  const r = selectReturnConditionPhotos({
    pickupPhotos,
    swaps: [swap("s1", "2026-10-03T08:00:00Z", A, B, swapPhotos)],
    currentVehicle: B,
    pickedUpAt: at("2026-10-01T05:00:00Z"),
  });
  assert.equal(r.swapped, true);
  assert.equal(r.photosMissing, false);
  assert.equal(r.current.source, "SWAP");
  assert.deepEqual(r.current.vehicle, B);
  assert.equal(r.current.swapPublicId, "s1");
  assert.deepEqual(r.current.photos, swapPhotos);
  assert.equal(r.earlier.length, 1);
  assert.equal(r.earlier[0]!.source, "PICKUP");
  assert.deepEqual(r.earlier[0]!.vehicle, A);
  assert.equal(r.earlier[0]!.replaced, true);
});

test("two swaps: the last swap is current, earlier ones newest first, sets without photos left out", () => {
  const r = selectReturnConditionPhotos({
    pickupPhotos,
    // out of order on purpose; the first swap was made by an old app build (no photos)
    swaps: [
      swap("s2", "2026-10-05T08:00:00Z", B, C, [photo("c1", "2026-10-05T08:00:00Z")]),
      swap("s1", "2026-10-03T08:00:00Z", A, B, []),
    ],
    currentVehicle: C,
    pickedUpAt: at("2026-10-01T05:00:00Z"),
  });
  assert.deepEqual(r.current.vehicle, C);
  assert.equal(r.current.swapPublicId, "s2");
  assert.deepEqual(r.earlier.map((s) => s.source), ["PICKUP"]);

  const withB = selectReturnConditionPhotos({
    pickupPhotos,
    swaps: [
      swap("s1", "2026-10-03T08:00:00Z", A, B, [photo("b1", "2026-10-03T08:00:00Z")]),
      swap("s2", "2026-10-05T08:00:00Z", B, C, [photo("c1", "2026-10-05T08:00:00Z")]),
    ],
    currentVehicle: C,
    pickedUpAt: at("2026-10-01T05:00:00Z"),
  });
  assert.deepEqual(withB.earlier.map((s) => s.swapPublicId), ["s1", null]);
  assert.equal(withB.earlier[0]!.replaced, true);
});

test("the last swap without photos (old app build) flags photosMissing", () => {
  const r = selectReturnConditionPhotos({
    pickupPhotos,
    swaps: [swap("s1", "2026-10-03T08:00:00Z", A, B, [])],
    currentVehicle: B,
    pickedUpAt: at("2026-10-01T05:00:00Z"),
  });
  assert.equal(r.photosMissing, true);
  assert.equal(r.current.photosMissing, true);
  assert.deepEqual(r.current.photos, []);
  assert.deepEqual(r.earlier.map((s) => s.vehicle), [A]);
});

test("history and drop screen share one missing-photos rule (rows without a status use the pickup marker)", () => {
  const pickedUpAt = at("2026-10-01T05:00:00Z");
  const legacyMid = swap("s1", "2026-10-03T08:00:00Z", A, B, [], null);
  const legacyBefore = swap("s0", "2026-09-30T08:00:00Z", A, B, [], null);
  assert.equal(swapPhotosMissing(legacyMid, pickedUpAt), true);
  assert.equal(swapPhotosMissing(legacyBefore, pickedUpAt), false);
  assert.equal(swapPhotosMissing(swap("s2", "2026-10-03T08:00:00Z", A, B, [], "PICKED_UP"), null), true);
  assert.equal(swapPhotosMissing(swap("s3", "2026-10-03T08:00:00Z", A, B, [photo("b1", "2026-10-03T08:00:00Z")]), null), false);
  const drop = selectReturnConditionPhotos({ pickupPhotos, swaps: [legacyMid], currentVehicle: B, pickedUpAt });
  assert.equal(drop.photosMissing, swapPhotosMissing(legacyMid, pickedUpAt));
});

test("swap rows without a status count as mid-rental from the pickup marker on", () => {
  const pickedUpAt = at("2026-10-01T05:00:00Z");
  assert.equal(isMidRentalSwap({ bookingStatusAtSwap: null, swappedAt: at("2026-10-02T00:00:00Z") }, pickedUpAt), true);
  assert.equal(isMidRentalSwap({ bookingStatusAtSwap: null, swappedAt: at("2026-09-30T00:00:00Z") }, pickedUpAt), false);
  assert.equal(isMidRentalSwap({ bookingStatusAtSwap: null, swappedAt: at("2026-09-30T00:00:00Z") }, null), true);
  assert.equal(isMidRentalSwap({ bookingStatusAtSwap: "CONFIRMED", swappedAt: at("2026-10-02T00:00:00Z") }, pickedUpAt), false);
});

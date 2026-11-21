import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PICKUP_FIELD_LABELS,
  PICKUP_PHOTOS_MAX,
  PICKUP_PHOTO_LABEL_MAX,
  updatePickupHandoverSchema,
} from "./pickup-handover-input.js";
import { fieldValidationError } from "../../utils/validation/fieldError.js";
import { saveOperationDraftSchema } from "./operation-draft.service.js";

const parse = (body: unknown) => updatePickupHandoverSchema.safeParse(body);
const refusal = (body: unknown) => {
  const r = parse(body);
  assert.equal(r.success, false, `expected a refusal for ${JSON.stringify(body)}`);
  return fieldValidationError(r.error!, PICKUP_FIELD_LABELS);
};

// What the current app sends from "Save & back to Payment" (syncHandover)
const appBody = {
  odo: 12345,
  fuelLevel: 70,
  pickupFuelLevel: "7",
  pickupFastagBalance: 400,
  photos: [{ fileId: "f1", label: "Front" }, { fileId: "f2", label: null }],
  dlStatus: "NOT_COLLECTED",
  pickupNote: "Scratch",
};

test("the app's handover body is accepted as is", () => {
  const r = parse(appBody);
  assert.equal(r.success, true);
  assert.equal(r.data!.odo, 12345);
  assert.deepEqual(r.data!.photos, [{ fileId: "f1", label: "Front" }, { fileId: "f2", label: null }]);
});

test("a capture-slot name over 80 characters is accepted, kept exactly (client report Nov 21)", () => {
  const name = "Dashboard with odometer and fuel gauge clearly visible (engine on, all warning lights) ";
  assert.ok(name.length > 80);
  const r = parse({ photos: [{ fileId: "f1", label: name }] });
  assert.equal(r.success, true);
  assert.equal(r.data!.photos![0]!.label, name);
  assert.equal(parse({ photos: [{ fileId: "f1", label: "x".repeat(PICKUP_PHOTO_LABEL_MAX + 1) }] }).success, false);
});

test("more than 60 photos are accepted (extra photos have no cap in the app)", () => {
  const photos = Array.from({ length: 65 }, (_, i) => ({ fileId: `f${i}` }));
  assert.equal(parse({ photos }).success, true);
  const tooMany = Array.from({ length: PICKUP_PHOTOS_MAX + 1 }, (_, i) => ({ fileId: `f${i}` }));
  assert.match(refusal({ photos: tooMany }).message, /at most 200 pickup photos/);
});

test("a blank label is no label; null / '' readings are not sent", () => {
  const r = parse({ odo: null, fuelLevel: "", pickupFuelLevel: null, pickupFastagBalance: "", photos: [{ fileId: "f1", label: "  " }], dlStatus: null });
  assert.equal(r.success, true);
  assert.equal(r.data!.odo, undefined);
  assert.equal(r.data!.fuelLevel, undefined);
  assert.equal(r.data!.pickupFuelLevel, undefined);
  assert.equal(r.data!.pickupFastagBalance, undefined);
  assert.equal(r.data!.photos![0]!.label, null);
});

test("numbers sent as strings (older builds) are accepted", () => {
  const r = parse({ odo: "12346", fuelLevel: "60", pickupFuelLevel: "6", pickupFastagBalance: "250.50" });
  assert.equal(r.success, true);
  assert.equal(r.data!.odo, 12346);
  assert.equal(r.data!.fuelLevel, 60);
  assert.equal(r.data!.pickupFastagBalance, 250.5);
});

test("refusals name the field with a specific message, never a bare 'Validation failed'", () => {
  const cases: Array<[unknown, string, RegExp]> = [
    [{ odo: 0 }, "odo", /Enter the odometer reading/],
    [{ odo: "abc" }, "odo", /odometer/i],
    [{ odo: 123.5 }, "odo", /whole km/],
    [{ fuelLevel: 140 }, "fuelLevel", /fuel level/i],
    [{ pickupFuelLevel: "11" }, "pickupFuelLevel", /Fuel/],
    [{ pickupFastagBalance: -5 }, "pickupFastagBalance", /FASTag balance can't be negative/],
    [{ photos: [] }, "photos", /at least one pickup photo/],
    [{ photos: [{ fileId: "" }] }, "photos", /take it again/],
  ];
  for (const [body, field, message] of cases) {
    const e = refusal(body);
    assert.equal(e.code, "VALIDATION_FAILED");
    assert.equal(e.field, field, JSON.stringify(body));
    assert.match(e.message, message, JSON.stringify(body));
    assert.notEqual(e.message, "Validation failed");
  }
});

test("the paused-draft save takes the same photos (count and slot names)", () => {
  const photos = Array.from({ length: 65 }, (_, i) => ({ fileId: `f${i}`, label: i === 0 ? "x".repeat(150) : null }));
  assert.equal(saveOperationDraftSchema.safeParse({ schemaVersion: 1, data: {}, photos }).success, true);
});

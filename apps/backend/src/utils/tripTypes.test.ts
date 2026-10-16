/**
 * Pure checks of the trip-type tags (Oct 20 2026): "Udupi/Manipal" (LOCAL) and
 * "Out of Udupi" (OUT_OF_UDUPI) replace Highway / Hill Station / Long Drive.
 * Legacy tags from older app builds map to OUT_OF_UDUPI in filters, saves and
 * responses (packages/schemas/src/vehicle.schema.ts). No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VEHICLE_USE_CASES,
  VEHICLE_USE_CASE_LABELS,
  createVehicleSchema,
  editVehicleSchema,
  normalizeUseCases,
  parseUseCasesFilter,
  updateVehicleUseCasesSchema,
  useCaseStoredValues,
} from "@repo/schemas";

test("only the two new tags are offered, with the client's labels", () => {
  assert.deepEqual([...VEHICLE_USE_CASES], ["LOCAL", "OUT_OF_UDUPI"]);
  assert.deepEqual(VEHICLE_USE_CASE_LABELS, { LOCAL: "Udupi/Manipal", OUT_OF_UDUPI: "Out of Udupi" });
});

test("normalizeUseCases: legacy tags become OUT_OF_UDUPI, deduped, unknown dropped, fixed order", () => {
  assert.deepEqual(normalizeUseCases(["HIGHWAY"]), ["OUT_OF_UDUPI"]);
  assert.deepEqual(normalizeUseCases(["HILL_STATION", "LONG_DRIVE", "HIGHWAY"]), ["OUT_OF_UDUPI"]);
  assert.deepEqual(normalizeUseCases(["OUT_OF_UDUPI", "HIGHWAY", "LOCAL"]), ["LOCAL", "OUT_OF_UDUPI"]);
  assert.deepEqual(normalizeUseCases(["local", " out_of_udupi "]), ["LOCAL", "OUT_OF_UDUPI"]);
  assert.deepEqual(normalizeUseCases(["BEACH", 3, null]), []);
  assert.deepEqual(normalizeUseCases(null), []);
  assert.deepEqual(normalizeUseCases(undefined), []);
});

test("public listing filter: legacy values from old builds filter as OUT_OF_UDUPI", () => {
  assert.deepEqual(parseUseCasesFilter("HIGHWAY,HILL_STATION"), ["OUT_OF_UDUPI"]);
  assert.deepEqual(parseUseCasesFilter(["LONG_DRIVE", "LOCAL"]), ["LOCAL", "OUT_OF_UDUPI"]);
  assert.deepEqual(parseUseCasesFilter("LOCAL"), ["LOCAL"]);
  assert.deepEqual(parseUseCasesFilter("nope,,"), []);
  assert.deepEqual(parseUseCasesFilter(undefined), []);
});

test("useCaseStoredValues: OUT_OF_UDUPI also matches rows still holding a legacy tag", () => {
  assert.deepEqual(useCaseStoredValues(["LOCAL"]), ["LOCAL"]);
  assert.deepEqual(useCaseStoredValues(["OUT_OF_UDUPI"]), ["OUT_OF_UDUPI", "HIGHWAY", "HILL_STATION", "LONG_DRIVE"]);
});

test("admin save: legacy tags save as OUT_OF_UDUPI (deduped); other unknown values are rejected", () => {
  const ok = updateVehicleUseCasesSchema.safeParse({ useCases: ["HIGHWAY", "LONG_DRIVE", "OUT_OF_UDUPI"] });
  assert.ok(ok.success);
  assert.deepEqual(ok.data.useCases, ["OUT_OF_UDUPI"]);
  const both = updateVehicleUseCasesSchema.safeParse({ useCases: ["LOCAL", "HILL_STATION"] });
  assert.ok(both.success);
  assert.deepEqual(both.data.useCases, ["LOCAL", "OUT_OF_UDUPI"]);
  assert.equal(updateVehicleUseCasesSchema.safeParse({ useCases: ["BEACH"] }).success, false);
  const cleared = updateVehicleUseCasesSchema.safeParse({ useCases: [] });
  assert.ok(cleared.success);
  assert.deepEqual(cleared.data.useCases, []);
});

const baseVehicle = {
  make: "Maruti",
  model: "Swift",
  regNo: "KA20AB1234",
  odo: "100",
  insuranceExpiry: "2027-01-01",
  categoryId: "1",
  policyNumber: "P1",
  provider: "X",
};

test("BM vehicle form (multipart): legacy tags map, '' clears, a new car without the key is LOCAL", () => {
  const legacy = createVehicleSchema.safeParse({ ...baseVehicle, useCases: ["HIGHWAY", "HILL_STATION"] });
  assert.ok(legacy.success);
  assert.deepEqual(legacy.data.useCases, ["OUT_OF_UDUPI"]);

  const single = createVehicleSchema.safeParse({ ...baseVehicle, useCases: "LONG_DRIVE" });
  assert.ok(single.success);
  assert.deepEqual(single.data.useCases, ["OUT_OF_UDUPI"]);

  const absent = createVehicleSchema.safeParse(baseVehicle);
  assert.ok(absent.success);
  assert.deepEqual(absent.data.useCases, ["LOCAL"]);

  const cleared = editVehicleSchema.safeParse({ useCases: "" });
  assert.ok(cleared.success);
  assert.deepEqual(cleared.data.useCases, []);

  // Edit without the key leaves the stored tags untouched
  const untouched = editVehicleSchema.safeParse({ make: "Maruti" });
  assert.ok(untouched.success);
  assert.equal(untouched.data.useCases, undefined);
});

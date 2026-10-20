/**
 * Fuel bars start at 0 (Oct 2026: "The Fuel point should start from 0").
 * Validators accept "0".."10" and reject -1 / 11; the fuel deficit maths treats
 * 0 (empty tank) as a reading, never as "missing" — at pickup, at drop, and
 * against a mid-rental swap's start reading. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import {
  FUEL_BAR_OPTIONS,
  chargePickupDataSchema,
  chargeReturnDataSchema,
  fuelBarOptionLabel,
  fuelBarsNumber,
  fuelBarsShort,
  fuelDeficitAmount,
  vehicleSwapSchema,
} from "@repo/schemas";
import { fuelBarsField, fuelBarsToPercent, fuelPercentToBars } from "./fuel-bars.js";
import { FuelDeficitModule } from "./modules/fuel-deficit.module.js";
import { DEFAULT_FROZEN_CHARGE_CONFIG, type ChargeContext } from "../../types/charge-engine.types.js";

const VALID = ["0", "1", "5", "9", "10"];
const INVALID = ["-1", "11", "", " ", "01", "1.5", "ten", "100"];

// ── Validators ────────────────────────────────────────────────────────────────

test("backend fuel field (pickup / drop / edits) accepts 0..10 and rejects -1 / 11", () => {
  for (const v of VALID) assert.equal(fuelBarsField.safeParse(v).success, true, `accepts ${v}`);
  for (const v of INVALID) assert.equal(fuelBarsField.safeParse(v).success, false, `rejects ${JSON.stringify(v)}`);
  assert.equal(fuelBarsField.safeParse(0).success, false, "a number is not a bars string");
});

test("shared pickup / return charge schemas accept fuel 0 and reject -1 / 11", () => {
  assert.equal(chargePickupDataSchema.safeParse({ pickupFuelLevel: "0" }).success, true);
  assert.equal(chargePickupDataSchema.safeParse({ pickupFuelLevel: "10" }).success, true);
  assert.equal(chargePickupDataSchema.safeParse({ pickupFuelLevel: "-1" }).success, false);
  assert.equal(chargePickupDataSchema.safeParse({ pickupFuelLevel: "11" }).success, false);
  assert.equal(chargeReturnDataSchema.safeParse({ returnFuelLevel: "0" }).success, true);
  assert.equal(chargeReturnDataSchema.safeParse({ returnFuelLevel: "-1" }).success, false);
  assert.equal(chargeReturnDataSchema.safeParse({ returnFuelLevel: "11" }).success, false);
});

test("swap schema accepts fuel 0 on both cars (string or number) and rejects -1 / 11", () => {
  const base = { newVehicleId: 7, reason: "MAINTENANCE" as const };
  const ok = vehicleSwapSchema.safeParse({ ...base, originalVehicleFuelLevel: "0", newVehicleFuelLevel: 0 });
  assert.equal(ok.success, true);
  if (ok.success) {
    assert.equal(ok.data.originalVehicleFuelLevel, "0");
    assert.equal(ok.data.newVehicleFuelLevel, "0");
  }
  assert.equal(vehicleSwapSchema.safeParse({ ...base, originalVehicleFuelLevel: "10", newVehicleFuelLevel: "1" }).success, true);
  assert.equal(vehicleSwapSchema.safeParse({ ...base, originalVehicleFuelLevel: "-1" }).success, false);
  assert.equal(vehicleSwapSchema.safeParse({ ...base, newVehicleFuelLevel: 11 }).success, false);
  // Empty / null still means "not sent" (pre-pickup swaps send no readings)
  const none = vehicleSwapSchema.safeParse({ ...base, originalVehicleFuelLevel: "", newVehicleFuelLevel: null });
  assert.equal(none.success, true);
  if (none.success) assert.equal(none.data.originalVehicleFuelLevel, undefined);
});

test("picker options run 0..10 with 0 labelled empty", () => {
  assert.deepEqual([...FUEL_BAR_OPTIONS], ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  assert.equal(fuelBarOptionLabel("0"), "0 (Empty)");
  assert.equal(fuelBarOptionLabel("7"), "7");
});

test("fuelBarsNumber: 0 is a reading, missing / junk is null", () => {
  assert.equal(fuelBarsNumber("0"), 0);
  assert.equal(fuelBarsNumber(0), 0);
  assert.equal(fuelBarsNumber("10"), 10);
  assert.equal(fuelBarsNumber(null), null);
  assert.equal(fuelBarsNumber(undefined), null);
  assert.equal(fuelBarsNumber(""), null);
  assert.equal(fuelBarsNumber("11"), null);
  assert.equal(fuelBarsNumber("HALF"), null); // the retired enum
});

// ── Fuel charge (drop bill prefill + charge engine fuel module) ──────────────

test("fuel deficit amount: pickup 0 / return 0 / both 0", () => {
  // Returned empty after an 8-bar pickup at ₹120/bar
  assert.equal(fuelBarsShort("8", "0"), 8);
  assert.equal(fuelDeficitAmount("8", "0", 120), 960);
  // Picked up empty: any return is not short
  assert.equal(fuelBarsShort("0", "5"), 0);
  assert.equal(fuelDeficitAmount("0", "5", 120), 0);
  // Both empty: nothing short
  assert.equal(fuelBarsShort("0", "0"), 0);
  assert.equal(fuelDeficitAmount("0", "0", 120), 0);
  // Rounded up to whole rupees, as before
  assert.equal(fuelDeficitAmount("3", "0", 33.3), 100);
  // A missing reading or rate charges nothing
  assert.equal(fuelDeficitAmount(null, "0", 120), 0);
  assert.equal(fuelDeficitAmount("5", "", 120), 0);
  assert.equal(fuelDeficitAmount("5", "0", 0), 0);
  assert.equal(fuelDeficitAmount("5", "0", null), 0);
});

function ctx(pickupFuelLevel: string | undefined, returnFuelLevel: string | undefined, charge?: number): ChargeContext {
  return {
    bookingId: 1,
    bookingPublicId: "b1",
    branchId: 1,
    frozenConfig: { ...DEFAULT_FROZEN_CHARGE_CONFIG, fuelModuleEnabled: true },
    vehiclePricing: {
      vehicleId: 1,
      hasFastag: false,
      fastagNumber: null,
      extraKmRate: new Decimal(0),
      extraHourRate: new Decimal(0),
      freeKmLimit: 0,
    },
    baseAmount: new Decimal(0),
    startAt: new Date("2026-10-20T04:30:00Z"),
    endAt: new Date("2026-10-21T04:30:00Z"),
    actualReturnAt: new Date("2026-10-21T04:30:00Z"),
    actualHours: 24,
    billableHours: 24,
    startOdometer: 1000,
    endOdometer: 1100,
    totalKmDriven: 100,
    pickupFuelLevel,
    returnFuelLevel,
    fuelDeficitCharge: charge != null ? new Decimal(charge) : undefined,
    actorId: 1,
  };
}

test("fuel module: return 0 after a pickup with fuel is a deficit, charged as entered", async () => {
  const r = await new FuelDeficitModule().compute(ctx("6", "0", 720));
  assert.notEqual(r.skip, true);
  assert.equal(r.finalAmount.toFixed(2), "720.00");
  assert.equal(r.label, "Fuel Deficit (6 → 0)");
});

test("fuel module: pickup 0 is a captured level, not 'not captured'", async () => {
  const r = await new FuelDeficitModule().compute(ctx("0", "4"));
  assert.equal(r.skip, true);
  assert.equal(r.finalAmount.toFixed(2), "0.00");
  assert.equal(r.notes, "No fuel deficit. Pickup: 0, Return: 4");
});

test("fuel module: both 0 is no deficit", async () => {
  const r = await new FuelDeficitModule().compute(ctx("0", "0"));
  assert.equal(r.skip, true);
  assert.equal(r.notes, "No fuel deficit. Pickup: 0, Return: 0");
});

test("fuel module: a missing reading is still 'not captured'", async () => {
  const r = await new FuelDeficitModule().compute(ctx(undefined, "0"));
  assert.equal(r.skip, true);
  assert.equal(r.notes, "Fuel levels not captured");
});

// ── Mid-rental swap ───────────────────────────────────────────────────────────

test("swap fuel difference: the drop is measured against the replacement's start, 0 included", () => {
  // Replacement handed over empty ("0" at the swap), returned with 3 bars: nothing short
  assert.equal(fuelBarsShort("0", "3"), 0);
  // Replacement handed over with 5, returned empty: 5 bars short
  assert.equal(fuelBarsShort("5", "0"), 5);
  assert.equal(fuelDeficitAmount("5", "0", 100), 500);
  // Handed over empty, returned empty
  assert.equal(fuelBarsShort("0", "0"), 0);
});

test("swap readings: 0 bars is stored on the vehicle as 0%, but 0% never prefills 0", () => {
  assert.equal(fuelBarsToPercent("0"), 0);
  assert.equal(fuelBarsToPercent("10"), 100);
  // 0% is also the column default for a vehicle never read: no prefill
  assert.equal(fuelPercentToBars(0), null);
  assert.equal(fuelPercentToBars(70), "7");
  assert.equal(fuelPercentToBars(100), "10");
  assert.equal(fuelPercentToBars(55), null);
});

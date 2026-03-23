import Decimal from "decimal.js";
import type {
  ChargeContext,
  ChargeModuleInterface,
  ChargeResult,
} from "../../../types/charge-engine.types.js";

/** Fuel level ordinal for comparison — higher = more fuel. */
const FUEL_LEVEL_ORDER: Record<string, number> = {
  EMPTY: 0,
  QUARTER: 1,
  HALF: 2,
  THREE_QUARTER: 3,
  FULL: 4,
};

/**
 * FUEL_DEFICIT module — detects fuel drop between pickup and return.
 * Enabled via frozenConfig.fuelModuleEnabled.
 *
 * Employee either provides a custom fuelDeficitCharge or skips with a
 * mandatory fuelSkipReason. Both are validated upstream in chargeReturnDataSchema.
 */
export class FuelDeficitModule implements ChargeModuleInterface {
  isApplicable(context: ChargeContext): boolean {
    return context.frozenConfig.fuelModuleEnabled;
  }

  async compute(context: ChargeContext): Promise<ChargeResult> {
    const { pickupFuelLevel, returnFuelLevel, fuelDeficitCharge, fuelSkipReason } = context;

    if (!pickupFuelLevel || !returnFuelLevel) {
      return {
        chargeType: "FUEL_DEFICIT",
        moduleKey: "fuel",
        label: "Fuel Deficit Charge",
        originalAmount: new Decimal(0),
        finalAmount: new Decimal(0),
        skip: true,
        notes: "Fuel levels not captured",
      };
    }

    const pickupOrdinal = FUEL_LEVEL_ORDER[pickupFuelLevel] ?? 0;
    const returnOrdinal = FUEL_LEVEL_ORDER[returnFuelLevel] ?? 0;
    const hasDeficit = returnOrdinal < pickupOrdinal;

    if (!hasDeficit) {
      return {
        chargeType: "FUEL_DEFICIT",
        moduleKey: "fuel",
        label: "Fuel",
        originalAmount: new Decimal(0),
        finalAmount: new Decimal(0),
        skip: true,
        notes: `No fuel deficit. Pickup: ${pickupFuelLevel}, Return: ${returnFuelLevel}`,
      };
    }

    // Employee chose to skip the charge
    if (fuelSkipReason) {
      return {
        chargeType: "FUEL_DEFICIT",
        moduleKey: "fuel",
        label: "Fuel Deficit (Waived)",
        originalAmount: new Decimal(0),
        finalAmount: new Decimal(0),
        skip: false,
        notes: `Charge waived. Reason: ${fuelSkipReason}`,
      };
    }

    const amount = fuelDeficitCharge ?? new Decimal(0);
    return {
      chargeType: "FUEL_DEFICIT",
      moduleKey: "fuel",
      label: `Fuel Deficit (${pickupFuelLevel} → ${returnFuelLevel})`,
      originalAmount: amount,
      finalAmount: amount,
      notes: `Pickup: ${pickupFuelLevel}, Return: ${returnFuelLevel}`,
    };
  }
}

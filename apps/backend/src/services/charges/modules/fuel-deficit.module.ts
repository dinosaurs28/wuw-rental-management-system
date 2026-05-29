import Decimal from "decimal.js";
import type {
  ChargeContext,
  ChargeModuleInterface,
  ChargeResult,
} from "../../../types/charge-engine.types.js";


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

    const pickupOrdinal = parseInt(pickupFuelLevel, 10);
    const returnOrdinal = parseInt(returnFuelLevel, 10);
    const hasDeficit = !isNaN(pickupOrdinal) && !isNaN(returnOrdinal) && returnOrdinal < pickupOrdinal;

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

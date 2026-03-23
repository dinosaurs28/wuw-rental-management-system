import Decimal from "decimal.js";
import type {
  ChargeContext,
  ChargeModuleInterface,
  ChargeResult,
} from "../../../types/charge-engine.types.js";

/**
 * FASTAG module — employee-entered toll/fastag expense.
 * Enabled only when frozenConfig.fastagModuleEnabled = true
 * AND vehicle.hasFastag = true.
 */
export class FastagModule implements ChargeModuleInterface {
  isApplicable(context: ChargeContext): boolean {
    return (
      context.frozenConfig.fastagModuleEnabled &&
      context.vehiclePricing.hasFastag
    );
  }

  async compute(context: ChargeContext): Promise<ChargeResult> {
    const amount = context.fastagAmount ?? new Decimal(0);

    if (amount.lte(0)) {
      return {
        chargeType: "FASTAG",
        moduleKey: "fastag",
        label: "FASTag Charges",
        originalAmount: new Decimal(0),
        finalAmount: new Decimal(0),
        skip: true,
        notes: "No FASTag charges entered",
      };
    }

    return {
      chargeType: "FASTAG",
      moduleKey: "fastag",
      label: "FASTag / Toll Charges",
      originalAmount: amount,
      finalAmount: amount,
      notes: context.fastagNotes,
    };
  }
}

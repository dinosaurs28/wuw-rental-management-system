import Decimal from "decimal.js";
import type {
  ChargeContext,
  ChargeModuleInterface,
  ChargeResult,
} from "../../../types/charge-engine.types.js";

/**
 * EXTRA_KM module — charges for kilometers driven beyond the plan's free limit.
 * Enabled via frozenConfig.extraKmEnabled.
 */
export class ExtraKmModule implements ChargeModuleInterface {
  isApplicable(context: ChargeContext): boolean {
    return context.frozenConfig.extraKmEnabled;
  }

  async compute(context: ChargeContext): Promise<ChargeResult> {
    const { totalKmDriven, vehiclePricing } = context;
    const { freeKmLimit, extraKmRate } = vehiclePricing;

    const excessKm = Math.max(0, totalKmDriven - freeKmLimit);
    const amount = excessKm > 0
      ? extraKmRate.mul(excessKm)
      : new Decimal(0);

    return {
      chargeType: "EXTRA_KM",
      moduleKey: "extra_km",
      label: `Extra Kilometers (${excessKm} km × ₹${extraKmRate.toFixed(2)}/km)`,
      originalAmount: amount,
      finalAmount: amount,
      quantity: new Decimal(excessKm),
      unitRate: extraKmRate,
      skip: excessKm === 0,
    };
  }
}

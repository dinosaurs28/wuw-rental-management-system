import Decimal from "decimal.js";
import type {
  ChargeContext,
  ChargeModuleInterface,
  ChargeResult,
} from "../../../types/charge-engine.types.js";

/**
 * BASE module — always enabled, never togglable.
 * Reads the baseAmount already computed by PricingEngineService at booking creation.
 */
export class BasePricingModule implements ChargeModuleInterface {
  isApplicable(_context: ChargeContext): boolean {
    return true; // always runs
  }

  async compute(context: ChargeContext): Promise<ChargeResult> {
    return {
      chargeType: "BASE",
      moduleKey: "base",
      label: "Base Rental Charge",
      originalAmount: context.baseAmount,
      finalAmount: context.baseAmount,
    };
  }
}

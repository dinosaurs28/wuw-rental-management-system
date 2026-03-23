import Decimal from "decimal.js";
import { DateTime } from "luxon";
import type {
  ChargeContext,
  ChargeModuleInterface,
  ChargeResult,
} from "../../../types/charge-engine.types.js";

/**
 * EXTRA_TIME module — charges for time beyond the booked rental period.
 * Enabled via frozenConfig.extraTimeEnabled.
 *
 * Grace minutes (from frozenConfig) are subtracted from late time
 * when gracePolicyEnabled and grace was applied (AUTOMATIC or employee-triggered MANUAL).
 */
export class ExtraTimeModule implements ChargeModuleInterface {
  isApplicable(context: ChargeContext): boolean {
    return context.frozenConfig.extraTimeEnabled;
  }

  async compute(context: ChargeContext): Promise<ChargeResult> {
    const plannedEnd = DateTime.fromJSDate(context.endAt);
    const actualReturn = DateTime.fromJSDate(context.actualReturnAt);
    const extraHourRate = context.vehiclePricing.extraHourRate;

    // Total late minutes (negative means early return)
    let lateMinutes = actualReturn.diff(plannedEnd, "minutes").minutes;

    if (lateMinutes <= 0) {
      return {
        chargeType: "EXTRA_TIME",
        moduleKey: "extra_time",
        label: "Extra Time Charge",
        originalAmount: new Decimal(0),
        finalAmount: new Decimal(0),
        skip: true,
      };
    }

    // Subtract grace period if the grace module was applied
    const graceApplied =
      context.frozenConfig.gracePolicyEnabled &&
      (context.frozenConfig.graceType === "AUTOMATIC" || context.applyGrace === true);

    if (graceApplied) {
      lateMinutes = Math.max(0, lateMinutes - context.frozenConfig.graceMinutes);
    }

    if (lateMinutes <= 0) {
      return {
        chargeType: "EXTRA_TIME",
        moduleKey: "extra_time",
        label: "Extra Time Charge (within grace period)",
        originalAmount: new Decimal(0),
        finalAmount: new Decimal(0),
        skip: false,
        notes: "Return was within the grace period — no extra time charge",
      };
    }

    // Round up to nearest hour
    const extraHours = Math.ceil(lateMinutes / 60);
    const amount = extraHourRate.mul(extraHours);

    return {
      chargeType: "EXTRA_TIME",
      moduleKey: "extra_time",
      label: `Extra Time (${extraHours} hr × ₹${extraHourRate.toFixed(2)}/hr)`,
      originalAmount: amount,
      finalAmount: amount,
      quantity: new Decimal(extraHours),
      unitRate: extraHourRate,
    };
  }
}

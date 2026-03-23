import Decimal from "decimal.js";
import { DateTime } from "luxon";
import type {
  ChargeContext,
  ChargeModuleInterface,
  ChargeResult,
} from "../../../types/charge-engine.types.js";

/**
 * GRACE_ADJUSTMENT module — reduces late-return minutes before extra-time is computed.
 * Enabled via frozenConfig.gracePolicyEnabled.
 *
 * AUTOMATIC mode: always applies the configured grace minutes.
 * MANUAL mode: only applies if context.applyGrace === true.
 *
 * This module produces a negative or zero GRACE_ADJUSTMENT entry.
 * It must run BEFORE ExtraTimeModule so the extra-time context is accurate.
 * The engine passes the computed graceMinutesApplied back via context mutation.
 */
export class GracePolicyModule implements ChargeModuleInterface {
  isApplicable(context: ChargeContext): boolean {
    if (!context.frozenConfig.gracePolicyEnabled) return false;
    if (context.frozenConfig.graceType === "MANUAL" && !context.applyGrace) return false;
    return true;
  }

  async compute(context: ChargeContext): Promise<ChargeResult> {
    const graceMinutes = context.frozenConfig.graceMinutes;

    // Determine if there is actually a late return
    const plannedEnd = DateTime.fromJSDate(context.endAt);
    const actualReturn = DateTime.fromJSDate(context.actualReturnAt);
    const lateMinutes = actualReturn.diff(plannedEnd, "minutes").minutes;

    if (lateMinutes <= 0) {
      // Returned on time — grace has no effect
      return {
        chargeType: "GRACE_ADJUSTMENT",
        moduleKey: "grace",
        label: `Grace Period (${graceMinutes} min)`,
        originalAmount: new Decimal(0),
        finalAmount: new Decimal(0),
        skip: true,
      };
    }

    // Grace applies — we record it as a metadata entry (zero charge)
    // The ExtraTimeModule reads graceMinutes directly from frozenConfig
    return {
      chargeType: "GRACE_ADJUSTMENT",
      moduleKey: "grace",
      label: `Grace Period Applied (${graceMinutes} min waived)`,
      originalAmount: new Decimal(0),
      finalAmount: new Decimal(0),
      notes: `${graceMinutes} minutes of grace applied before extra-time calculation`,
      skip: false,
    };
  }
}

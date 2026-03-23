import Decimal from "decimal.js";
import { prisma } from "@repo/database/client";
import type {
  ChargeContext,
  ChargeModuleInterface,
  ChargeResult,
} from "../../../types/charge-engine.types.js";

/**
 * OVERRIDE_ADJUSTER — applies approved employee overrides to ChargeEntry records.
 * Enabled via frozenConfig.employeeOverrideEnabled.
 *
 * This module runs LAST in the engine pipeline. It reads all approved
 * ChargeOverride records for the booking and adjusts the finalAmount on
 * the matching ChargeEntry. The engine's persistChargeEntries() then saves
 * the updated finalAmount and isOverridden flag.
 *
 * Note: This module does not produce its own ChargeResult row. Instead it
 * mutates the results array passed in from the engine context (via skip:true
 * sentinel). The engine handles the mutation after calling compute().
 */
export class OverrideAdjusterModule implements ChargeModuleInterface {
  isApplicable(context: ChargeContext): boolean {
    return context.frozenConfig.employeeOverrideEnabled;
  }

  async compute(context: ChargeContext): Promise<ChargeResult> {
    // Load all approved overrides for this booking (indexed by moduleKey via chargeEntry)
    const overrides = await prisma.chargeOverride.findMany({
      where: {
        bookingId: context.bookingId,
        status: { in: ["APPROVED", "AUTO_APPROVED"] },
      },
      include: {
        chargeEntry: { select: { moduleKey: true } },
      },
    });

    // Store override map on context for the engine to apply after module execution
    // We use a non-standard field on context — engine reads this after calling compute()
    (context as any)._pendingOverrides = overrides.map((o) => ({
      moduleKey: o.chargeEntry?.moduleKey ?? "",
      overriddenAmount: new Decimal(o.overriddenAmount.toString()),
      waivedAmount: new Decimal(o.waivedAmount.toString()),
    }));

    return {
      chargeType: "EXTRA_KM", // placeholder — skip:true means engine ignores this row
      moduleKey: "__override_adjuster__",
      label: "Override Adjuster",
      originalAmount: new Decimal(0),
      finalAmount: new Decimal(0),
      skip: true, // engine does not persist this row
    };
  }
}

import Decimal from "decimal.js";
import { prisma } from "@repo/database/client";
import type {
  ChargeContext,
  ChargeModuleInterface,
  ChargeResult,
} from "../../../types/charge-engine.types.js";

/**
 * DAMAGE module — sums all manager-approved damage report final costs.
 * Enabled via frozenConfig.damageModuleEnabled.
 * Only DamageReport records with status = APPROVED are included.
 */
export class DamageModule implements ChargeModuleInterface {
  isApplicable(context: ChargeContext): boolean {
    return context.frozenConfig.damageModuleEnabled;
  }

  async compute(context: ChargeContext): Promise<ChargeResult> {
    const approvedReports = await prisma.damageReport.findMany({
      where: {
        bookingId: context.bookingId,
        status: "APPROVED",
        finalCost: { not: null },
      },
      select: { id: true, finalCost: true, severity: true },
    });

    if (approvedReports.length === 0) {
      return {
        chargeType: "DAMAGE",
        moduleKey: "damage",
        label: "Damage Charges",
        originalAmount: new Decimal(0),
        finalAmount: new Decimal(0),
        skip: true,
      };
    }

    const total = approvedReports.reduce(
      (sum, r) => sum.add(new Decimal(r.finalCost!.toString())),
      new Decimal(0),
    );

    return {
      chargeType: "DAMAGE",
      moduleKey: "damage",
      label: `Damage Charges (${approvedReports.length} report${approvedReports.length > 1 ? "s" : ""})`,
      originalAmount: total,
      finalAmount: total,
      quantity: new Decimal(approvedReports.length),
    };
  }
}

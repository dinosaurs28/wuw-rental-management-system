import Decimal from "decimal.js";
import { prisma } from "@repo/database/client";
import type { PrismaClient } from "@repo/database/client";
import type {
  ChargeBreakdown,
  ChargeContext,
  ChargeResult,
} from "../../types/charge-engine.types.js";

import { BasePricingModule } from "./modules/base-pricing.module.js";
import { ExtraKmModule } from "./modules/extra-km.module.js";
import { GracePolicyModule } from "./modules/grace-policy.module.js";
import { ExtraTimeModule } from "./modules/extra-time.module.js";
import { FuelDeficitModule } from "./modules/fuel-deficit.module.js";
import { FastagModule } from "./modules/fastag.module.js";
import { DamageModule } from "./modules/damage.module.js";
import { OverrideAdjusterModule } from "./modules/override-adjuster.module.js";
import { createID } from "../../utils/nanoID.js";

/** Deterministic execution order — do NOT reorder. */
const MODULE_PIPELINE = [
  new BasePricingModule(),
  new ExtraKmModule(),
  new GracePolicyModule(),
  new ExtraTimeModule(),
  new FuelDeficitModule(),
  new FastagModule(),
  new DamageModule(),
  new OverrideAdjusterModule(),
];

type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Central Charge Engine — executes all charge modules in deterministic order
 * and produces a ChargeBreakdown.
 *
 * Usage:
 *   const breakdown = await chargeEngineService.computeCharges(context);
 *   await chargeEngineService.persistChargeEntries(bookingId, breakdown, actorId, tx);
 */
export class ChargeEngineService {
  /**
   * Run all applicable modules in order and return the full ChargeBreakdown.
   * No DB writes occur here — computation only.
   */
  async computeCharges(context: ChargeContext): Promise<ChargeBreakdown> {
    const rawResults: ChargeResult[] = [];

    for (const module of MODULE_PIPELINE) {
      if (!module.isApplicable(context)) continue;
      const result = await module.compute(context);
      rawResults.push(result);
    }

    // Apply pending overrides from OverrideAdjusterModule (stored on context)
    const pendingOverrides: Array<{
      moduleKey: string;
      overriddenAmount: Decimal;
      waivedAmount: Decimal;
    }> = (context as any)._pendingOverrides ?? [];

    const results = rawResults.map((r) => {
      const override = pendingOverrides.find((o) => o.moduleKey === r.moduleKey);
      if (!override) return r;
      return {
        ...r,
        finalAmount: override.overriddenAmount,
        isOverridden: true,
      };
    });

    // Aggregate totals — only non-skipped results
    const active = results.filter((r) => !r.skip);
    const subtotal = active.reduce((s, r) => s.add(r.originalAmount), new Decimal(0));
    const finalTotal = active.reduce((s, r) => s.add(r.finalAmount), new Decimal(0));
    const waivedTotal = subtotal.sub(finalTotal);

    return {
      bookingId: context.bookingId,
      results,
      subtotal,
      waivedTotal,
      finalTotal,
    };
  }

  /**
   * Upsert ChargeEntry records from a ChargeBreakdown.
   * Uses moduleKey as the upsert key per booking (one row per module per booking).
   * Skipped results (skip: true) are not persisted.
   *
   * Must be called inside a Prisma transaction when part of a larger operation.
   */
  async persistChargeEntries(
    bookingId: number,
    breakdown: ChargeBreakdown,
    actorId: number,
    tx: TxClient = prisma,
  ): Promise<void> {
    const toUpsert = breakdown.results.filter((r) => !r.skip);

    for (const result of toUpsert) {
      const existing = await tx.chargeEntry.findUnique({
        where: { bookingId_moduleKey: { bookingId, moduleKey: result.moduleKey } },
        select: { id: true },
      });

      const data = {
        chargeType: result.chargeType,
        label: result.label,
        originalAmount: result.originalAmount.toFixed(2),
        finalAmount: result.finalAmount.toFixed(2),
        quantity: result.quantity ? result.quantity.toFixed(4) : null,
        unitRate: result.unitRate ? result.unitRate.toFixed(2) : null,
        notes: result.notes ?? null,
        isOverridden: result.isOverridden ?? false,
        createdById: actorId,
      };

      if (existing) {
        await tx.chargeEntry.update({
          where: { id: existing.id },
          data,
        });
      } else {
        await tx.chargeEntry.create({
          data: {
            publicId: createID(),
            bookingId,
            moduleKey: result.moduleKey,
            ...data,
          },
        });
      }
    }
  }

  /**
   * Load all persisted ChargeEntry records for a booking and reconstitute
   * them as a ChargeBreakdown (for display or settlement).
   */
  async loadBreakdown(bookingId: number): Promise<ChargeBreakdown> {
    const entries = await prisma.chargeEntry.findMany({
      where: { bookingId },
      orderBy: { createdAt: "asc" },
    });

    const results: ChargeResult[] = entries.map((e) => ({
      chargeType: e.chargeType,
      moduleKey: e.moduleKey,
      label: e.label,
      originalAmount: new Decimal(e.originalAmount.toString()),
      finalAmount: new Decimal(e.finalAmount.toString()),
      quantity: e.quantity ? new Decimal(e.quantity.toString()) : undefined,
      unitRate: e.unitRate ? new Decimal(e.unitRate.toString()) : undefined,
      isOverridden: e.isOverridden,
      notes: e.notes ?? undefined,
    }));

    const subtotal = results.reduce((s, r) => s.add(r.originalAmount), new Decimal(0));
    const finalTotal = results.reduce((s, r) => s.add(r.finalAmount), new Decimal(0));

    return {
      bookingId,
      results,
      subtotal,
      waivedTotal: subtotal.sub(finalTotal),
      finalTotal,
    };
  }
}

export const chargeEngineService = new ChargeEngineService();

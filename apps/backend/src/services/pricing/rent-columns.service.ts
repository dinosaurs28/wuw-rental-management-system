/**
 * GST-inclusive rent columns of VehicleCustomPricing / BranchPricingDefaults
 * (item 17).
 *
 * The 12 h and 24 h rents a manager enters are the totals the customer pays,
 * GST included. They are stored three ways:
 *   totalRent12Hour / totalRent24Hour       the GST-inclusive totals (the price)
 *   price12Hour / price24Hour               the same totals (older readers)
 *   rentWithoutGst12Hour / rentWithoutGst24Hour
 *                                           total − CGST − SGST by the branch GST
 *                                           rule (splitRentTotal; null while the
 *                                           branch has no rule)
 * The pricing engine always splits GST out of the rent live with the branch
 * rule; rentWithoutGst* is a stored convenience for lists and reports, so it is
 * recomputed for the whole branch whenever the GST rule is saved.
 */
import Decimal from "decimal.js";
import { prisma, Prisma } from "@repo/database/client";
import { splitRentTotal, type GstRates } from "@repo/schemas";

type Db = Pick<typeof prisma, "gSTRule" | "$executeRaw">;

/** The branch's CGST/SGST, or null when it has no GST rule yet. */
export async function branchRentRates(branchId: number, db: Pick<typeof prisma, "gSTRule"> = prisma): Promise<GstRates | null> {
  const rule = await db.gSTRule.findUnique({
    where: { branchId },
    select: { cgstRate: true, sgstRate: true },
  });
  return rule ? { cgstRate: Number(rule.cgstRate), sgstRate: Number(rule.sgstRate) } : null;
}

/** Rent without GST of a GST-inclusive total (2 dp string), null without a total or rates. */
export function rentWithoutGstOf(total: number | null | undefined, rates: GstRates | null): string | null {
  if (total == null || !rates) return null;
  return new Decimal(splitRentTotal(total, rates).taxable).toFixed(2);
}

/**
 * The pricing columns to write for a 12 h / 24 h GST-inclusive total. A slab
 * left undefined is not written (edit: keep what is stored); null clears it.
 */
export function rentColumns(
  input: { total12Hour?: number | null; total24Hour?: number | null },
  rates: GstRates | null,
): {
  price12Hour?: string | null;
  totalRent12Hour?: string | null;
  rentWithoutGst12Hour?: string | null;
  price24Hour?: string;
  totalRent24Hour?: string;
  rentWithoutGst24Hour?: string | null;
} {
  const out: ReturnType<typeof rentColumns> = {};
  if (input.total12Hour !== undefined) {
    const t = input.total12Hour == null ? null : new Decimal(input.total12Hour).toFixed(2);
    out.price12Hour = t;
    out.totalRent12Hour = t;
    out.rentWithoutGst12Hour = rentWithoutGstOf(input.total12Hour, rates);
  }
  if (input.total24Hour != null) {
    const t = new Decimal(input.total24Hour).toFixed(2);
    out.price24Hour = t;
    out.totalRent24Hour = t;
    out.rentWithoutGst24Hour = rentWithoutGstOf(input.total24Hour, rates);
  }
  return out;
}

/**
 * Recompute rentWithoutGst* for every vehicle of the branch and every
 * BranchPricingDefaults row of the branch from the GST-inclusive totals
 * (totalRent*, else price*), with the given rates — same arithmetic as
 * splitRentTotal: CGST and SGST each rounded half-up to paise. Rows priced
 * before totalRent* existed get it filled from price*. Returns rows updated.
 */
export async function recomputeBranchRentWithoutGst(
  branchId: number,
  rates: GstRates,
  db: Db = prisma,
): Promise<{ vehicles: number; defaults: number }> {
  const c = new Prisma.Decimal(rates.cgstRate);
  const s = new Prisma.Decimal(rates.sgstRate);
  const vehicles = await db.$executeRaw`
    UPDATE "VehicleCustomPricing" p
       SET "totalRent24Hour" = COALESCE(p."totalRent24Hour", ROUND(p."price24Hour"::numeric, 2)),
           "totalRent12Hour" = COALESCE(p."totalRent12Hour", ROUND(p."price12Hour"::numeric, 2)),
           "rentWithoutGst24Hour" = COALESCE(p."totalRent24Hour", ROUND(p."price24Hour"::numeric, 2))
             - ROUND(COALESCE(p."totalRent24Hour", ROUND(p."price24Hour"::numeric, 2)) * ${c} / 100, 2)
             - ROUND(COALESCE(p."totalRent24Hour", ROUND(p."price24Hour"::numeric, 2)) * ${s} / 100, 2),
           "rentWithoutGst12Hour" = COALESCE(p."totalRent12Hour", ROUND(p."price12Hour"::numeric, 2))
             - ROUND(COALESCE(p."totalRent12Hour", ROUND(p."price12Hour"::numeric, 2)) * ${c} / 100, 2)
             - ROUND(COALESCE(p."totalRent12Hour", ROUND(p."price12Hour"::numeric, 2)) * ${s} / 100, 2),
           "updatedAt" = NOW()
      FROM "Vehicle" v
     WHERE v."id" = p."vehicleId" AND v."branchId" = ${branchId}`;
  const defaults = await db.$executeRaw`
    UPDATE "BranchPricingDefaults" p
       SET "totalRent24Hour" = COALESCE(p."totalRent24Hour", ROUND(p."price24Hour"::numeric, 2)),
           "totalRent12Hour" = COALESCE(p."totalRent12Hour", ROUND(p."price12Hour"::numeric, 2)),
           "rentWithoutGst24Hour" = COALESCE(p."totalRent24Hour", ROUND(p."price24Hour"::numeric, 2))
             - ROUND(COALESCE(p."totalRent24Hour", ROUND(p."price24Hour"::numeric, 2)) * ${c} / 100, 2)
             - ROUND(COALESCE(p."totalRent24Hour", ROUND(p."price24Hour"::numeric, 2)) * ${s} / 100, 2),
           "rentWithoutGst12Hour" = COALESCE(p."totalRent12Hour", ROUND(p."price12Hour"::numeric, 2))
             - ROUND(COALESCE(p."totalRent12Hour", ROUND(p."price12Hour"::numeric, 2)) * ${c} / 100, 2)
             - ROUND(COALESCE(p."totalRent12Hour", ROUND(p."price12Hour"::numeric, 2)) * ${s} / 100, 2),
           "updatedAt" = NOW()
     WHERE p."branchId" = ${branchId}`;
  return { vehicles, defaults };
}

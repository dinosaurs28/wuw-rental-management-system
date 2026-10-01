import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { redis } from "../../lib/redisconfig.js";
import { gstRuleKey } from "../../utils/cache/vehicleCacheKeys.js";
import {
  computeGst,
  splitGstInclusive,
  isTaxableChargeType,
  type GstRates,
} from "@repo/schemas";

/**
 * The one place the backend turns a taxable amount into CGST/SGST.
 * The rule and rounding live in @repo/schemas (gst.ts); this wraps them with
 * the branch's GSTRule and Decimal values. IGST is never applied: rentals are
 * supplied at the branch (intra-state), and customer GSTIN is not captured.
 */

export const GST_RULE_MISSING = "GST_RULE_MISSING";

export class GstRuleMissingError extends Error {
  code = GST_RULE_MISSING;
  constructor(branchId: number) {
    super(`GST rules are not configured for branch ${branchId}`);
    this.name = "GstRuleMissingError";
  }
}

export interface BranchGstRates extends GstRates {
  /** cgstRate + sgstRate, e.g. 18 */
  rate: number;
}

export interface LineGst {
  taxable: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  gst: Decimal;
  total: Decimal;
  /** cgstRate + sgstRate frozen onto the line */
  rate: Decimal;
}

type Db = Pick<typeof prisma, "gSTRule">;

/** Current CGST/SGST for a branch. Throws GstRuleMissingError if unset. */
export async function getBranchGstRates(branchId: number, db: Db = prisma): Promise<BranchGstRates> {
  const rule = await db.gSTRule.findUnique({
    where: { branchId },
    select: { cgstRate: true, sgstRate: true },
  });
  if (!rule) throw new GstRuleMissingError(branchId);
  const cgstRate = Number(rule.cgstRate);
  const sgstRate = Number(rule.sgstRate);
  return { cgstRate, sgstRate, rate: cgstRate + sgstRate };
}

const GST_RULE_TTL = 600; // 10 minutes; the BM GST page deletes the key on save

/**
 * getBranchGstRates through the shared Redis GSTRule cache (gstRuleKey).
 * Used on hot pricing paths. A missing rule is never cached, so a rule added
 * later takes effect immediately; Redis errors fall back to the database.
 */
export async function getBranchGstRatesCached(branchId: number): Promise<BranchGstRates> {
  const cacheKey = gstRuleKey(branchId);
  try {
    const cached = await redis.get(cacheKey);
    const rule = cached ? JSON.parse(cached) : null;
    if (rule && rule.cgstRate != null && rule.sgstRate != null) {
      const cgstRate = Number(rule.cgstRate);
      const sgstRate = Number(rule.sgstRate);
      return { cgstRate, sgstRate, rate: cgstRate + sgstRate };
    }
  } catch (err) {
    console.warn("[gst] Redis read failed, using the database:", err);
  }

  const rates = await getBranchGstRates(branchId);
  try {
    await redis.set(
      cacheKey,
      JSON.stringify({ cgstRate: rates.cgstRate, sgstRate: rates.sgstRate }),
      "EX",
      GST_RULE_TTL,
    );
  } catch (err) {
    console.warn("[gst] Redis write failed (non-fatal):", err);
  }
  return rates;
}

/** True for the GST_RULE_MISSING error; controllers answer it with 409 + GST_RULE_MISSING_MESSAGE. */
export function isGstRuleMissing(err: unknown): err is GstRuleMissingError {
  return (err as { code?: string } | null)?.code === GST_RULE_MISSING;
}

export const GST_RULE_MISSING_MESSAGE =
  "GST is not configured for this branch. Ask the branch manager to set the GST rule before continuing.";

const toLine = (b: ReturnType<typeof computeGst>): LineGst => ({
  taxable: new Decimal(b.taxable),
  cgst: new Decimal(b.cgst),
  sgst: new Decimal(b.sgst),
  gst: new Decimal(b.gst),
  total: new Decimal(b.total),
  rate: new Decimal(b.rate),
});

/** GST on a GST-exclusive taxable amount. */
export function computeLineGst(taxable: Decimal | number | string, rates: GstRates): LineGst {
  return toLine(computeGst(Number(taxable), rates));
}

/** Split a GST-inclusive amount (e.g. a legacy lump sum) into taxable + GST. */
export function splitInclusiveGst(gross: Decimal | number | string, rates: GstRates): LineGst {
  return toLine(splitGstInclusive(Number(gross), rates));
}

/** GST for a ledger/charge line: zero for non-taxable types. */
export function computeChargeGst(
  chargeType: string,
  amount: Decimal | number | string,
  rates: GstRates,
): LineGst {
  if (!isTaxableChargeType(chargeType)) {
    const a = new Decimal(Number(amount));
    return { taxable: a, cgst: new Decimal(0), sgst: new Decimal(0), gst: new Decimal(0), total: a, rate: new Decimal(0) };
  }
  return computeLineGst(amount, rates);
}

export { isTaxableChargeType };

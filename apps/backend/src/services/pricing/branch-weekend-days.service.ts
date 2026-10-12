/**
 * The branch's weekend days (Branch.weekendDays, ISO weekday 1 = Mon … 7 = Sun)
 * the weekend rents apply on — read through Redis by the pricing engine and the
 * listing batch pricer (weekend-wise pricing, utils/pricing/weekendRule.ts).
 */
import { prisma } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { branchWeekendDaysKey } from "../../utils/cache/vehicleCacheKeys.js";
import { DEFAULT_WEEKEND_DAYS, normalizeWeekendDays } from "../../utils/pricing/weekendRule.js";

const WEEKEND_DAYS_TTL = 300; // 5 minutes

async function readWeekendDays(branchId: number): Promise<number[]> {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { weekendDays: true } });
  return branch ? normalizeWeekendDays(branch.weekendDays) : [...DEFAULT_WEEKEND_DAYS];
}

/** The branch's weekend days (empty = the branch has no weekend). */
export async function getBranchWeekendDays(branchId: number): Promise<number[]> {
  const cacheKey = branchWeekendDaysKey(branchId);
  try {
    const cached = await redis.get(cacheKey);
    if (cached !== null) return normalizeWeekendDays(JSON.parse(cached));
  } catch (err) {
    console.warn("[pricing-cache] Redis error, falling back to DB:", err);
  }
  const days = await readWeekendDays(branchId);
  try {
    await redis.set(cacheKey, JSON.stringify(days), "EX", WEEKEND_DAYS_TTL);
  } catch (err) {
    console.warn("[pricing-cache] Redis set error (non-fatal):", err);
  }
  return days;
}

/** Weekend days of several branches in one query (listing batch pricer). */
export async function getBranchesWeekendDays(branchIds: number[]): Promise<Map<number, number[]>> {
  const unique = [...new Set(branchIds)];
  if (unique.length === 0) return new Map();
  const branches = await prisma.branch.findMany({
    where: { id: { in: unique } },
    select: { id: true, weekendDays: true },
  });
  return new Map(branches.map((b) => [b.id, normalizeWeekendDays(b.weekendDays)]));
}

/** Drop the cached weekend days after the branch saves them. */
export async function invalidateBranchWeekendDays(branchId: number): Promise<void> {
  try {
    await redis.del(branchWeekendDaysKey(branchId));
  } catch (err) {
    console.warn("[pricing-cache] Redis del error (non-fatal):", err);
  }
}

/**
 * Festival pricing rules (SpecialPricingRule) — list / create / edit / pause /
 * delete, the vehicle pickers' options and the draft preview, shared by the
 * branch manager (own branch) and admin (any branch) controllers.
 *
 * Rules are read from the database on every price; every change drops the
 * branch's cached listing / details prices (as a weekend-days change does), so
 * the very next quote uses it. Bookings already made keep the rules they were priced with
 * (pricingSnapshot.specialRules).
 */
import type { Response } from "express";
import { prisma, StaffActionType, StaffEntityType, type Prisma, type Role } from "@repo/database/client";
import { DateTime } from "luxon";
import {
  calendarDaysBetween,
  formatSpecialPercent,
  istToday,
  specialPricingRuleIssues,
  specialPricingStatus,
  type SpecialPricingListFilter,
  type SpecialPricingScopeValue,
  type CreateSpecialPricingRuleInput,
  type UpdateSpecialPricingRuleInput,
  type SpecialPricingPreviewInput,
} from "@repo/schemas";
import { redis } from "../../lib/redisconfig.js";
import { createID } from "../../utils/nanoID.js";
import { invalidateGroupListingCache, invalidateVehiclePricing } from "../../utils/cache/vehicleCacheKeys.js";
import { getBatchListingPrices } from "../../utils/pricing/batchListingPrice.js";
import { PRICING_ZONE } from "../../utils/pricing/weekendRule.js";
import type { SpecialRule } from "../../utils/pricing/specialDateRule.js";
import { DurationCalculatorService } from "./duration-calculator.service.js";
import { dateOnly, toDateColumn } from "./branch-special-rules.service.js";
import { staffActivityService } from "../staffActivity/staffActivity.service.js";

export class SpecialPricingError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly errors?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "SpecialPricingError";
  }
}

/** Who made the change — the staff activity log's actor. */
export interface SpecialPricingActor {
  userId: number;
  publicId: string;
  name: string;
  role: Role;
}

/** The signed-in staff user behind the request (the BM / admin). */
export async function specialPricingActor(publicId: string): Promise<SpecialPricingActor> {
  const user = await prisma.user.findUnique({
    where: { publicId },
    select: { id: true, publicId: true, name: true, role: true },
  });
  if (!user) throw new SpecialPricingError(401, "UNAUTHORIZED", "Your session has expired. Please sign in again.");
  return { userId: user.id, publicId: user.publicId, name: user.name, role: user.role };
}

const RULE_INCLUDE = {
  createdBy: { select: { name: true } },
  updatedBy: { select: { name: true } },
} as const satisfies Prisma.SpecialPricingRuleInclude;

type RuleRow = Prisma.SpecialPricingRuleGetPayload<{ include: typeof RULE_INCLUDE }>;

/** A rule as the API returns it (dates YYYY-MM-DD, percent a number, the picked categories / vehicles named). */
async function viewRules(rows: RuleRow[], today = istToday()) {
  const categoryIds = [...new Set(rows.flatMap((r) => r.categoryIds))];
  const vehicleIds = [...new Set(rows.flatMap((r) => r.vehicleIds))];
  const [categories, vehicles] = await Promise.all([
    categoryIds.length
      ? prisma.vehicleCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } })
      : [],
    vehicleIds.length
      ? prisma.vehicle.findMany({
          where: { id: { in: vehicleIds } },
          select: { id: true, regNo: true, make: true, model: true },
        })
      : [],
  ]);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  return rows.map((r) => {
    const startDate = dateOnly(r.startDate);
    const endDate = dateOnly(r.endDate);
    return {
      id: r.id,
      publicId: r.publicId,
      branchId: r.branchId,
      name: r.name,
      startDate,
      endDate,
      days: calendarDaysBetween(startDate, endDate) + 1,
      percent: Number(r.percent.toString()),
      scope: r.scope,
      categoryIds: r.categoryIds,
      vehicleIds: r.vehicleIds,
      active: r.active,
      status: specialPricingStatus({ startDate, endDate, active: r.active }, today),
      categories: r.categoryIds.flatMap((id) => categoryById.get(id) ?? []),
      vehicles: r.vehicleIds.flatMap((id) => vehicleById.get(id) ?? []),
      createdBy: r.createdBy ? { name: r.createdBy.name } : null,
      updatedBy: r.updatedBy ? { name: r.updatedBy.name } : null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
}

export type SpecialPricingRuleView = Awaited<ReturnType<typeof viewRules>>[number];

/**
 * The branch's rules (not deleted), filtered by their dates against today
 * (IST): running now and upcoming first (soonest first), then past (latest
 * first). A paused rule is listed by its dates.
 */
export async function listSpecialRules(branchId: number, filter: SpecialPricingListFilter = "all") {
  const today = toDateColumn(istToday());
  const where: Prisma.SpecialPricingRuleWhereInput = {
    branchId,
    deletedAt: null,
    ...(filter === "upcoming" && { startDate: { gt: today } }),
    ...(filter === "active" && { startDate: { lte: today }, endDate: { gte: today } }),
    ...(filter === "past" && { endDate: { lt: today } }),
  };
  const rows = await prisma.specialPricingRule.findMany({
    where,
    include: RULE_INCLUDE,
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  const views = await viewRules(rows);
  const bucket = (r: SpecialPricingRuleView) => (r.endDate < dateOnly(today) ? 1 : 0);
  return views.sort((a, b) => {
    const diff = bucket(a) - bucket(b);
    if (diff !== 0) return diff;
    return bucket(a) === 0 ? a.startDate.localeCompare(b.startDate) : b.endDate.localeCompare(a.endDate);
  });
}

/** Only the id list matching the scope is kept. */
function scopedIds(scope: SpecialPricingScopeValue, categoryIds: number[], vehicleIds: number[]) {
  return {
    categoryIds: scope === "CATEGORIES" ? [...new Set(categoryIds)] : [],
    vehicleIds: scope === "VEHICLES" ? [...new Set(vehicleIds)] : [],
  };
}

/**
 * Picked categories must be in use at the branch (a vehicle or branch pricing
 * defaults of that category); picked vehicles must be the branch's own.
 */
async function assertScopeAtBranch(branchId: number, categoryIds: number[], vehicleIds: number[]): Promise<void> {
  if (categoryIds.length > 0) {
    const [withVehicles, withDefaults] = await Promise.all([
      prisma.vehicle.findMany({
        where: { branchId, deletedAt: null, categoryId: { in: categoryIds } },
        select: { categoryId: true },
        distinct: ["categoryId"],
      }),
      prisma.branchPricingDefaults.findMany({
        where: { branchId, categoryId: { in: categoryIds } },
        select: { categoryId: true },
      }),
    ]);
    const known = new Set([...withVehicles, ...withDefaults].map((r) => r.categoryId));
    if (categoryIds.some((id) => !known.has(id))) {
      throw new SpecialPricingError(400, "SPECIAL_RULE_SCOPE_INVALID", "Some of the picked categories aren't used at this branch.", [
        { path: "categoryIds", message: "Pick categories this branch has vehicles in" },
      ]);
    }
  }
  if (vehicleIds.length > 0) {
    const count = await prisma.vehicle.count({ where: { branchId, deletedAt: null, id: { in: vehicleIds } } });
    if (count !== vehicleIds.length) {
      throw new SpecialPricingError(400, "SPECIAL_RULE_SCOPE_INVALID", "Some of the picked vehicles aren't at this branch.", [
        { path: "vehicleIds", message: "Pick this branch's vehicles" },
      ]);
    }
  }
}

function assertRuleIssues(rule: Parameters<typeof specialPricingRuleIssues>[0]): void {
  const issues = specialPricingRuleIssues(rule);
  if (issues.length > 0) {
    throw new SpecialPricingError(400, "INVALID_SPECIAL_RULE", issues.map((i) => i.message).join("; "), issues);
  }
}

function assertNotEnded(endDate: string): void {
  if (endDate < istToday()) {
    throw new SpecialPricingError(400, "SPECIAL_RULE_ENDED", "These dates are in the past. Pick dates from today onwards.", [
      { path: "endDate", message: "The end date is in the past" },
    ]);
  }
}

/** Branch name for the staff activity log (404 when the branch doesn't exist). */
async function branchName(branchId: number): Promise<string> {
  const branch = await prisma.branch.findFirst({ where: { id: branchId, deletedAt: null }, select: { name: true } });
  if (!branch) throw new SpecialPricingError(404, "BRANCH_NOT_FOUND", "Branch not found");
  return branch.name;
}

/** "Dussehra +10%, 20 Oct – 22 Oct 2026, all vehicles" — the log's summary of a rule. */
function describeRule(rule: { name: string; startDate: string; endDate: string; percent: number; scope: string; categoryIds: number[]; vehicleIds: number[] }) {
  const day = (d: string) => DateTime.fromISO(d, { zone: PRICING_ZONE }).toFormat("d LLL yyyy");
  const scope =
    rule.scope === "CATEGORIES"
      ? `${rule.categoryIds.length} categor${rule.categoryIds.length === 1 ? "y" : "ies"}`
      : rule.scope === "VEHICLES"
        ? `${rule.vehicleIds.length} vehicle${rule.vehicleIds.length === 1 ? "" : "s"}`
        : "all vehicles";
  const dates = rule.startDate === rule.endDate ? day(rule.startDate) : `${day(rule.startDate)} – ${day(rule.endDate)}`;
  return `${rule.name} ${formatSpecialPercent(rule.percent)}, ${dates}, ${scope}`;
}

async function logChange(
  actor: SpecialPricingActor,
  branchId: number,
  actionType: StaffActionType,
  entityRef: string,
  description: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await staffActivityService.log({
      actorPublicId: actor.publicId,
      actorName: actor.name,
      actorRole: actor.role,
      branchId,
      branchName: await branchName(branchId).catch(() => "Unknown Branch"),
      actionType,
      entityType: StaffEntityType.PRICING,
      entityRef,
      description,
      metadata,
    });
  } catch (err) {
    console.error("[special-pricing] staff activity log failed (non-fatal):", err);
  }
}

/**
 * New quotes use the change at once: the engine and the listing read the rules
 * from the database, and the cached listing / details prices go.
 */
async function invalidateFestivalPricing(branchId: number): Promise<void> {
  try {
    const vehicles = await prisma.vehicle.findMany({ where: { branchId }, select: { id: true } });
    await invalidateVehiclePricing(redis, vehicles.map((v) => v.id));
    await invalidateGroupListingCache(redis);
  } catch (err) {
    console.warn("[special-pricing] cache invalidation failed (non-fatal):", err);
  }
}

async function loadRule(publicId: string, branchId?: number): Promise<RuleRow> {
  const rule = await prisma.specialPricingRule.findFirst({
    where: { publicId, deletedAt: null, ...(branchId != null && { branchId }) },
    include: RULE_INCLUDE,
  });
  if (!rule) throw new SpecialPricingError(404, "SPECIAL_RULE_NOT_FOUND", "Festival pricing rule not found");
  return rule;
}

export async function createSpecialRule(branchId: number, input: CreateSpecialPricingRuleInput, actor: SpecialPricingActor) {
  await branchName(branchId);
  assertRuleIssues(input);
  assertNotEnded(input.endDate);
  const ids = scopedIds(input.scope, input.categoryIds, input.vehicleIds);
  await assertScopeAtBranch(branchId, ids.categoryIds, ids.vehicleIds);

  const row = await prisma.specialPricingRule.create({
    data: {
      publicId: createID(),
      branchId,
      name: input.name,
      startDate: toDateColumn(input.startDate),
      endDate: toDateColumn(input.endDate),
      percent: input.percent.toFixed(2),
      scope: input.scope,
      ...ids,
      active: input.active,
      createdById: actor.userId,
      updatedById: actor.userId,
    },
    include: RULE_INCLUDE,
  });
  const [view] = await viewRules([row]);
  await invalidateFestivalPricing(branchId);
  await logChange(actor, branchId, StaffActionType.CREATED, row.publicId, `Festival pricing created: ${describeRule(view!)}`, {
    name: view!.name,
    startDate: view!.startDate,
    endDate: view!.endDate,
    percent: view!.percent,
    scope: view!.scope,
    ...ids,
    active: view!.active,
  });
  return view!;
}

/**
 * Edit, pause ({ active: false }) or resume ({ active: true }) a rule.
 * `branchId` = the BM's branch (a rule of another branch is not found); admin
 * passes none.
 */
export async function updateSpecialRule(
  publicId: string,
  patch: UpdateSpecialPricingRuleInput,
  actor: SpecialPricingActor,
  branchId?: number,
) {
  const existing = await loadRule(publicId, branchId);
  const [before] = await viewRules([existing]);
  const scope = patch.scope ?? before!.scope;
  const merged = {
    name: patch.name ?? before!.name,
    startDate: patch.startDate ?? before!.startDate,
    endDate: patch.endDate ?? before!.endDate,
    percent: patch.percent ?? before!.percent,
    scope,
    ...scopedIds(scope, patch.categoryIds ?? before!.categoryIds, patch.vehicleIds ?? before!.vehicleIds),
    active: patch.active ?? before!.active,
  };
  assertRuleIssues(merged);
  // Moved dates can't be in the past (a past rule can still be renamed or paused)
  if (merged.startDate !== before!.startDate || merged.endDate !== before!.endDate) assertNotEnded(merged.endDate);
  const scopeChanged =
    merged.scope !== before!.scope ||
    merged.categoryIds.join() !== before!.categoryIds.join() ||
    merged.vehicleIds.join() !== before!.vehicleIds.join();
  if (scopeChanged) await assertScopeAtBranch(existing.branchId, merged.categoryIds, merged.vehicleIds);

  const row = await prisma.specialPricingRule.update({
    where: { id: existing.id },
    data: {
      name: merged.name,
      startDate: toDateColumn(merged.startDate),
      endDate: toDateColumn(merged.endDate),
      percent: merged.percent.toFixed(2),
      scope: merged.scope,
      categoryIds: merged.categoryIds,
      vehicleIds: merged.vehicleIds,
      active: merged.active,
      updatedById: actor.userId,
    },
    include: RULE_INCLUDE,
  });
  const [view] = await viewRules([row]);
  await invalidateFestivalPricing(existing.branchId);

  const changed = (Object.keys(merged) as (keyof typeof merged)[]).filter(
    (key) => JSON.stringify(merged[key]) !== JSON.stringify(before![key]),
  );
  const onlyActive = changed.length === 1 && changed[0] === "active";
  await logChange(
    actor,
    existing.branchId,
    onlyActive ? (merged.active ? StaffActionType.ACTIVATED : StaffActionType.DEACTIVATED) : StaffActionType.UPDATED,
    row.publicId,
    onlyActive
      ? `Festival pricing ${merged.active ? "resumed" : "paused"}: ${describeRule(view!)}`
      : `Festival pricing updated: ${describeRule(view!)}`,
    {
      changed,
      before: Object.fromEntries(changed.map((k) => [k, before![k]])),
      after: Object.fromEntries(changed.map((k) => [k, merged[k]])),
    },
  );
  return view!;
}

/** Soft delete (deletedAt). Bookings priced with the rule keep it in their snapshot. */
export async function deleteSpecialRule(publicId: string, actor: SpecialPricingActor, branchId?: number) {
  const existing = await loadRule(publicId, branchId);
  const [view] = await viewRules([existing]);
  await prisma.specialPricingRule.update({
    where: { id: existing.id },
    data: { deletedAt: new Date(), updatedById: actor.userId },
  });
  await invalidateFestivalPricing(existing.branchId);
  await logChange(actor, existing.branchId, StaffActionType.DELETED, existing.publicId, `Festival pricing deleted: ${describeRule(view!)}`, {
    name: view!.name,
    startDate: view!.startDate,
    endDate: view!.endDate,
    percent: view!.percent,
  });
}

/**
 * What the pickers offer: the branch's vehicles (not deleted) and the
 * categories in use there (vehicles or branch pricing defaults), with counts.
 */
export async function specialRuleOptions(branchId: number) {
  await branchName(branchId);
  const [vehicles, defaults] = await Promise.all([
    prisma.vehicle.findMany({
      where: { branchId, deletedAt: null },
      select: { id: true, regNo: true, make: true, model: true, categoryId: true, category: { select: { name: true } } },
      orderBy: [{ make: "asc" }, { model: "asc" }, { regNo: "asc" }],
    }),
    prisma.branchPricingDefaults.findMany({
      where: { branchId },
      select: { categoryId: true, category: { select: { name: true } } },
    }),
  ]);
  const categories = new Map<number, { id: number; name: string; vehicleCount: number }>();
  for (const d of defaults) categories.set(d.categoryId, { id: d.categoryId, name: d.category.name, vehicleCount: 0 });
  for (const v of vehicles) {
    const entry = categories.get(v.categoryId) ?? { id: v.categoryId, name: v.category.name, vehicleCount: 0 };
    entry.vehicleCount++;
    categories.set(v.categoryId, entry);
  }
  return {
    categories: [...categories.values()].sort((a, b) => a.name.localeCompare(b.name)),
    vehicles: vehicles.map((v) => ({
      id: v.id,
      regNo: v.regNo,
      make: v.make,
      model: v.model,
      categoryId: v.categoryId,
      categoryName: v.category.name,
    })),
  };
}

const PREVIEW_SAMPLES = 6;

/**
 * A draft rule's effect on one festival day: up to PREVIEW_SAMPLES vehicles in
 * scope (one per make / model / category) with the 24-hour rent of that day
 * before → after (incl. GST, before duration discounts; the branch's weekend
 * rents apply underneath, other festival rules don't). The day is the first
 * festival day from today on.
 */
export async function previewSpecialRule(branchId: number, input: SpecialPricingPreviewInput) {
  await branchName(branchId);
  assertRuleIssues(input);
  const ids = scopedIds(input.scope, input.categoryIds, input.vehicleIds);
  await assertScopeAtBranch(branchId, ids.categoryIds, ids.vehicleIds);

  const inScope = await prisma.vehicle.findMany({
    where: {
      branchId,
      deletedAt: null,
      ...(input.scope === "CATEGORIES" && { categoryId: { in: ids.categoryIds } }),
      ...(input.scope === "VEHICLES" && { id: { in: ids.vehicleIds } }),
    },
    select: { id: true, branchId: true, categoryId: true, make: true, model: true, regNo: true, category: { select: { name: true } } },
    orderBy: [{ make: "asc" }, { model: "asc" }, { regNo: "asc" }],
  });
  const seen = new Set<string>();
  const samples = inScope.filter((v) => {
    const key = `${v.make}|${v.model}|${v.categoryId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const today = istToday();
  const day = input.startDate >= today || input.endDate < today ? input.startDate : today;
  const start = DateTime.fromISO(day, { zone: PRICING_ZONE });
  const end = start.plus({ hours: 24 });
  const window = { startAt: start.toJSDate(), endAt: end.toJSDate() };
  const duration = DurationCalculatorService.calculate(start, end);
  const draft: SpecialRule = {
    id: 0,
    name: "Preview",
    startDate: input.startDate,
    endDate: input.endDate,
    percent: input.percent,
    scope: input.scope,
    ...ids,
  };

  // Only priced vehicles are shown (a car without rates lists at ₹0)
  const candidates = samples.slice(0, PREVIEW_SAMPLES * 2);
  const [before, after] = candidates.length
    ? await Promise.all([
        getBatchListingPrices(candidates, duration, window, { specialRules: [] }),
        getBatchListingPrices(candidates, duration, window, { specialRules: [draft] }),
      ])
    : [new Map(), new Map()];
  const rows = candidates
    .map((v) => ({
      vehicleId: v.id,
      name: `${v.make} ${v.model}`,
      category: v.category.name,
      regNo: v.regNo,
      before: before.get(v.id)?.price ?? 0,
      after: after.get(v.id)?.price ?? 0,
    }))
    .filter((r) => r.before > 0)
    .slice(0, PREVIEW_SAMPLES);

  return { day, vehiclesInScope: inScope.length, samples: rows };
}

// ── Controller helpers ────────────────────────────────────────────────────────

/** 400 INVALID_SPECIAL_RULE for a body that failed its zod schema. */
export function invalidSpecialRuleBody(res: Response, issues: { path: (string | number)[]; message: string }[]) {
  return res.status(400).json({
    success: false,
    code: "INVALID_SPECIAL_RULE",
    message: issues[0]?.message ?? "Invalid festival pricing rule",
    errors: issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}

/** A SpecialPricingError as { success: false, code, message, errors? }; anything else 500. */
export function sendSpecialPricingError(res: Response, error: unknown, label: string) {
  if (error instanceof SpecialPricingError) {
    return res.status(error.status).json({
      success: false,
      code: error.code,
      message: error.message,
      ...(error.errors && { errors: error.errors }),
    });
  }
  console.error(`[${label}] error:`, error);
  return res.status(500).json({ message: "Internal server error" });
}

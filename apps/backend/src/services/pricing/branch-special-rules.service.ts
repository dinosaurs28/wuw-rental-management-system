/**
 * A branch's live festival pricing rules (SpecialPricingRule: active, not
 * deleted) as the pricer uses them (utils/pricing/specialDateRule.ts). The
 * pricing engine and the listing batch pricer both read them from the
 * database on every price (one small indexed query) — never a cached copy —
 * so a listed price and the booked price always use the same rules, the
 * moment a rule changes.
 */
import { prisma, type Prisma } from "@repo/database/client";
import { istToday, calendarDaysBetween } from "@repo/schemas";
import {
  mergeRulesForTime,
  normalizeSpecialRules,
  specialRulesOf,
  type SpecialRule,
} from "../../utils/pricing/specialDateRule.js";

/**
 * How far back the engine's per-branch list reaches: rules that ended more
 * than this many days ago are left out (a booking window is never that long —
 * monthly rentals included — and both terms of an extension use the same list).
 */
const PAST_RULES_DAYS = 180;

/** A DATE column (00:00 UTC of the day) as its calendar date. */
export const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);
/** A calendar date as the DATE column value. */
export const toDateColumn = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

type RuleRow = {
  id: number;
  name: string;
  startDate: Date;
  endDate: Date;
  percent: { toString(): string };
  scope: string;
  categoryIds: number[];
  vehicleIds: number[];
};

const RULE_SELECT = {
  id: true,
  name: true,
  startDate: true,
  endDate: true,
  percent: true,
  scope: true,
  categoryIds: true,
  vehicleIds: true,
} as const;

/** A SpecialPricingRule row as the pricer's rule (null for a malformed row). */
export function toSpecialRule(row: RuleRow): SpecialRule | null {
  return normalizeSpecialRules([
    {
      id: row.id,
      name: row.name,
      startDate: dateOnly(row.startDate),
      endDate: dateOnly(row.endDate),
      percent: Number(row.percent.toString()),
      scope: row.scope,
      categoryIds: row.categoryIds,
      vehicleIds: row.vehicleIds,
    },
  ])[0] ?? null;
}

function shiftDay(day: string, days: number): string {
  return dateOnly(new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000));
}

/** The branch's live festival rules (all scopes; the pricer filters by vehicle). */
export async function getBranchSpecialRules(branchId: number): Promise<SpecialRule[]> {
  const rows = await prisma.specialPricingRule.findMany({
    where: {
      branchId,
      active: true,
      deletedAt: null,
      endDate: { gte: toDateColumn(shiftDay(istToday(), -PAST_RULES_DAYS)) },
    },
    select: RULE_SELECT,
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  return rows.flatMap((row) => toSpecialRule(row) ?? []);
}

/**
 * Live festival rules of several branches touching [startAt, endAt] in one
 * query (listing batch pricer). Dates are compared as IST calendar days.
 */
export async function getBranchesSpecialRules(
  branchIds: number[],
  startAt: Date,
  endAt: Date,
): Promise<Map<number, SpecialRule[]>> {
  const unique = [...new Set(branchIds)];
  if (unique.length === 0) return new Map();
  const firstDay = istToday(startAt);
  const lastDay = istToday(endAt);
  if (calendarDaysBetween(firstDay, lastDay) < 0) return new Map();
  const rows = await prisma.specialPricingRule.findMany({
    where: {
      branchId: { in: unique },
      active: true,
      deletedAt: null,
      startDate: { lte: toDateColumn(lastDay) },
      endDate: { gte: toDateColumn(firstDay) },
    },
    select: { ...RULE_SELECT, branchId: true },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  const byBranch = new Map<number, SpecialRule[]>();
  for (const row of rows) {
    const rule = toSpecialRule(row);
    if (!rule) continue;
    byBranch.set(row.branchId, [...(byBranch.get(row.branchId) ?? []), rule]);
  }
  return byBranch;
}

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Once an extension or a vehicle swap is confirmed, the branch's live rules
 * touching the newly priced time [from, to] join the booking's stored rules
 * (pricingSnapshot.specialRules — a stored version wins per id), so a later
 * reschedule prices the booking the way it was charged. Call it inside the
 * confirming transaction, after the booking row is updated.
 */
export async function recordBookingSpecialRules(db: Db, bookingId: number, from: Date, to: Date): Promise<void> {
  if (to <= from) return;
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { branchId: true, pricingSnapshot: true },
  });
  if (!booking) return;
  const stored = specialRulesOf(booking.pricingSnapshot);
  const live = await getBranchSpecialRules(booking.branchId);
  const merged = mergeRulesForTime(stored, live, from.getTime(), to.getTime());
  if (merged.length === (stored?.length ?? 0)) return;
  await db.booking.update({
    where: { id: bookingId },
    data: {
      pricingSnapshot: {
        ...((booking.pricingSnapshot ?? {}) as Record<string, unknown>),
        specialRules: merged,
      } as Prisma.InputJsonValue,
    },
  });
}

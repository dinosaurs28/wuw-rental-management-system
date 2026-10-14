/**
 * Festival (special-date) pricing (Oct 2026 client item: "Dussehra next week —
 * the owner bulk-edits three days' fees, e.g. +10% for each product").
 *
 * A branch manager (or admin) sets a SpecialPricingRule: a name, IST calendar
 * dates (both inclusive), a percentage (−90 … +300; negative = a festival
 * discount) and the vehicles it covers (all, some categories, some vehicles).
 *
 * The rule, per priced block (base-price-rule.ts — each full 24 h day, the
 * remainder, a single trip of up to 24 h, the 12-hour package held to closing,
 * monthly overflow days; never a full month): the block is a FESTIVAL block for
 * a rule when at least half of its minutes fall on the rule's dates in
 * Asia/Kolkata — classified on the real return, like the weekend rule. Its
 * rent, after the weekday / weekend slab and the hourly cap, is multiplied by
 * (1 + percent / 100) and rounded to the paisa (half-up, as the engine rounds
 * a percentage discount). When several rules apply to one block, the one
 * giving the HIGHEST rent wins — one rule per block, never stacked. Free km
 * never change.
 *
 *   Dussehra 20–22 Oct +10%, 24-hour rent ₹1,300:
 *   20 Oct 10:00 → 21 Oct 10:00  festival day      → ₹1,430
 *   19 Oct 18:00 → 20 Oct 18:00  18 of 24 h on it  → ₹1,430
 *   22 Oct 20:00 → 23 Oct 20:00  4 of 24 h on it   → ₹1,300
 *
 * Bookings store the rules they were charged with (pricingSnapshot.specialRules:
 * the rules touching the booked window at create, plus those touching the time
 * a confirmed extension or swap priced at today's rules), so a re-price of the
 * same window (BM coupon re-price) stays at the booked rent and a reschedule
 * compares the current window as charged with the new one (rescheduleRuleSets).
 */
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { formatSpecialPercent, isCalendarDate } from "@repo/schemas";
import { PRICING_ZONE } from "./weekendRule.js";

export type SpecialPricingScope = "ALL" | "CATEGORIES" | "VEHICLES";

/** A festival rule as the pricer uses it — and as a booking stores it (a type, so it is JSON-assignable). */
export type SpecialRule = {
  id: number;
  name: string;
  /** First and last day, IST calendar dates (YYYY-MM-DD), both inclusive */
  startDate: string;
  endDate: string;
  /** −90 … +300: positive raises the rent, negative is a festival discount */
  percent: number;
  scope: SpecialPricingScope;
  categoryIds: number[];
  vehicleIds: number[];
};

/** [startMs, endMs) of the rule's days: 00:00 IST of the first day to 00:00 IST after the last. */
export function ruleSpanMs(rule: Pick<SpecialRule, "startDate" | "endDate">): { startMs: number; endMs: number } {
  return {
    startMs: DateTime.fromISO(rule.startDate, { zone: PRICING_ZONE }).toMillis(),
    endMs: DateTime.fromISO(rule.endDate, { zone: PRICING_ZONE }).plus({ days: 1 }).toMillis(),
  };
}

/** Minutes of [startMs, endMs) on the rule's days. */
export function ruleMinutesIn(startMs: number, endMs: number, rule: Pick<SpecialRule, "startDate" | "endDate">): number {
  if (endMs <= startMs) return 0;
  const span = ruleSpanMs(rule);
  return Math.max(0, Math.min(endMs, span.endMs) - Math.max(startMs, span.startMs)) / 60_000;
}

/** At least half of the block's minutes on the rule's days (a 12 / 12 split counts). */
export function isFestivalBlock(startMs: number, endMs: number, rule: Pick<SpecialRule, "startDate" | "endDate">): boolean {
  if (endMs <= startMs) return false;
  return ruleMinutesIn(startMs, endMs, rule) * 2 >= (endMs - startMs) / 60_000;
}

/** Whether the rule's scope covers the vehicle. */
export function ruleCoversVehicle(rule: SpecialRule, vehicle: { id: number; categoryId: number }): boolean {
  if (rule.scope === "CATEGORIES") return rule.categoryIds.includes(vehicle.categoryId);
  if (rule.scope === "VEHICLES") return rule.vehicleIds.includes(vehicle.id);
  return true;
}

/** The rules covering one vehicle. */
export function rulesForVehicle(rules: readonly SpecialRule[], vehicle: { id: number; categoryId: number }): SpecialRule[] {
  return rules.filter((rule) => ruleCoversVehicle(rule, vehicle));
}

/** The rules with any time in [startMs, endMs) — what a booking of that window stores. */
export function rulesOverlapping(rules: readonly SpecialRule[], startMs: number, endMs: number): SpecialRule[] {
  return rules.filter((rule) => ruleMinutesIn(startMs, endMs, rule) > 0);
}

/** `current` plus the rules of `next` it doesn't hold yet (by id) — a booking's rules across its vehicles. */
export function unionSpecialRules(current: SpecialRule[] | null, next: readonly SpecialRule[]): SpecialRule[] {
  const rules = [...(current ?? [])];
  for (const rule of next) if (!rules.some((r) => r.id === rule.id)) rules.push(rule);
  return rules;
}

/**
 * The stored rules once an extension / swap is confirmed: plus the live rules
 * touching the newly priced time [fromMs, toMs) not stored yet (a stored
 * version wins per id — what the booking was already charged with).
 */
export function mergeRulesForTime(
  stored: SpecialRule[] | null,
  live: readonly SpecialRule[],
  fromMs: number,
  toMs: number,
): SpecialRule[] {
  return unionSpecialRules(stored, rulesOverlapping(live, fromMs, toMs));
}

/**
 * The rules a reschedule prices each window with. The current window as it
 * was charged: the stored rules, in their stored form (a rule deleted, paused
 * or edited since still counts as stored). The new window: the stored rules
 * plus today's live rules not stored (by id). A booking made before festival
 * pricing has none stored, so its new window gets today's rules.
 */
export function rescheduleRuleSets(
  stored: SpecialRule[] | null,
  live: readonly SpecialRule[],
): { current: SpecialRule[]; next: SpecialRule[] } {
  return { current: [...(stored ?? [])], next: unionSpecialRules(stored, live) };
}

/**
 * Whether a reschedule must compare the rents: the booking has weekend days,
 * or a rule of either set touches its window (bookings made before festival
 * pricing included — their new window gets today's rules).
 */
export function rescheduleChecksRent(
  weekendDays: readonly number[],
  sets: { current: readonly SpecialRule[]; next: readonly SpecialRule[] },
  current: { startMs: number; endMs: number },
  next: { startMs: number; endMs: number },
): boolean {
  return (
    weekendDays.length > 0 ||
    rulesOverlapping(sets.current, current.startMs, current.endMs).length > 0 ||
    rulesOverlapping(sets.next, next.startMs, next.endMs).length > 0
  );
}

/** rent × (1 + percent / 100), to the paisa (half-up), never below ₹0. */
export function applySpecialPercent(rent: Decimal, percent: number): Decimal {
  return Decimal.max(rent.mul(new Decimal(100).add(percent)).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP), 0);
}

/**
 * The rule a block is billed under, and its rent: among `rules` with at least
 * half of [startMs, endMs) on their days, the one giving the highest rent (a
 * tie keeps the first). null = not a festival block.
 */
export function festivalPriceFor(
  startMs: number,
  endMs: number,
  rent: Decimal,
  rules: readonly SpecialRule[],
): { rule: SpecialRule; price: Decimal } | null {
  let best: { rule: SpecialRule; price: Decimal } | null = null;
  for (const rule of rules) {
    if (!isFestivalBlock(startMs, endMs, rule)) continue;
    const price = applySpecialPercent(rent, rule.percent);
    if (!best || price.gt(best.price)) best = { rule, price };
  }
  return best;
}

/** "Dussehra +10%" — a rule as the breakdown label names it. */
export function ruleLabel(rule: Pick<SpecialRule, "name" | "percent">): string {
  return `${rule.name} ${formatSpecialPercent(rule.percent)}`;
}

const positiveIds = (raw: unknown): number[] =>
  Array.isArray(raw) ? raw.filter((id): id is number => Number.isInteger(id) && id > 0) : [];

/** Well-formed rules from JSON (a booking's snapshot, the Redis cache); anything else is dropped. */
export function normalizeSpecialRules(raw: unknown): SpecialRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: SpecialRule[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    const percent = Number(r.percent);
    if (
      !Number.isInteger(r.id) ||
      typeof r.name !== "string" ||
      typeof r.startDate !== "string" ||
      typeof r.endDate !== "string" ||
      !isCalendarDate(r.startDate) ||
      !isCalendarDate(r.endDate) ||
      !Number.isFinite(percent) ||
      percent === 0
    ) {
      continue;
    }
    const scope: SpecialPricingScope = r.scope === "CATEGORIES" || r.scope === "VEHICLES" ? r.scope : "ALL";
    rules.push({
      id: r.id as number,
      name: r.name,
      startDate: r.startDate,
      endDate: r.endDate,
      percent,
      scope,
      categoryIds: positiveIds(r.categoryIds),
      vehicleIds: positiveIds(r.vehicleIds),
    });
  }
  return rules;
}

/**
 * The festival rules an EXISTING booking was charged with (pricingSnapshot.
 * specialRules). null = the booking was made before festival pricing existed
 * (none stored).
 */
export function specialRulesOf(pricingSnapshot: unknown): SpecialRule[] | null {
  const raw = (pricingSnapshot as { specialRules?: unknown } | null)?.specialRules;
  return Array.isArray(raw) ? normalizeSpecialRules(raw) : null;
}

/**
 * The snapshot with its items' pricingBreakdown.festival set to the given
 * breakdowns (none = removed), matched by vehicleId, else by position.
 * Reschedule refreshes them when the move kept the rent.
 */
export function withItemFestivalBreakdowns(
  pricingSnapshot: unknown,
  breakdowns: { vehicleId: number; festival?: unknown }[],
): Record<string, unknown> {
  const snapshot = { ...((pricingSnapshot ?? {}) as Record<string, unknown>) };
  if (!Array.isArray(snapshot.items)) return snapshot;
  snapshot.items = snapshot.items.map((item: unknown, index: number) => {
    if (!item || typeof item !== "object") return item;
    const row = item as { vehicleId?: unknown; pricingBreakdown?: Record<string, unknown> };
    const entry = breakdowns.find((b) => b.vehicleId === row.vehicleId) ?? breakdowns[index];
    if (!entry) return item;
    const { festival: _previous, ...pricingBreakdown } = row.pricingBreakdown ?? {};
    return { ...row, pricingBreakdown: entry.festival ? { ...pricingBreakdown, festival: entry.festival } : pricingBreakdown };
  });
  return snapshot;
}

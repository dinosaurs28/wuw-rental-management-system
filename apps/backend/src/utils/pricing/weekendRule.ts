/**
 * Weekend-wise rental pricing (Oct 2026 client item).
 *
 * A vehicle (VehicleCustomPricing) or a branch category (BranchPricingDefaults)
 * may carry weekend 12 h / 24 h rents next to the weekday ones; the branch
 * picks its weekend days (Branch.weekendDays, ISO weekday 1 = Mon … 7 = Sun,
 * default Sat + Sun).
 *
 * The rule, per priced block — each full 24 h block of a multi-day rental, the
 * remainder block, and a single booking of up to 24 h (base-price-rule.ts):
 * the block is a WEEKEND block when at least half of its minutes fall on the
 * branch's weekend days in Asia/Kolkata. A weekend block is billed at the
 * weekend 12 h / 24 h slab (each falling back to the weekday slab when unset);
 * the hourly rate stays the same, its cap is the slab that applies to the
 * block. Full months of a monthly rental keep the monthly rate.
 *
 *   Fri 18:00 → Sat 18:00: 18 of the 24 h fall on Saturday → weekend block
 *   Fri 10:00 → Sat 10:00: 10 of 24 h on Saturday           → weekday block
 *   Sat 12:00 → Sun 00:00: 12 of 12 h on Saturday           → weekend block
 *
 * Bookings store the weekend days they were priced with (pricingSnapshot.
 * weekendDays); every re-price of an existing booking passes weekendDaysOf()
 * so a booking made before weekend rates existed keeps its weekday prices.
 */
import { DateTime } from "luxon";

export const PRICING_ZONE = "Asia/Kolkata";

/** Saturday and Sunday (ISO weekdays) — Branch.weekendDays' default. */
export const DEFAULT_WEEKEND_DAYS: readonly number[] = [6, 7];

/** Distinct ISO weekdays (1–7), sorted; anything else is dropped. */
export function normalizeWeekendDays(days: unknown): number[] {
  if (!Array.isArray(days)) return [];
  return [...new Set(days.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);
}

/** Minutes of [startMs, endMs) that fall on the weekend days, in Asia/Kolkata. */
export function weekendMinutesIn(startMs: number, endMs: number, weekendDays: readonly number[]): number {
  if (endMs <= startMs || weekendDays.length === 0) return 0;
  let weekendMs = 0;
  let cursor = DateTime.fromMillis(startMs, { zone: PRICING_ZONE });
  while (cursor.toMillis() < endMs) {
    const segmentEnd = Math.min(cursor.startOf("day").plus({ days: 1 }).toMillis(), endMs);
    if (weekendDays.includes(cursor.weekday)) weekendMs += segmentEnd - cursor.toMillis();
    cursor = DateTime.fromMillis(segmentEnd, { zone: PRICING_ZONE });
  }
  return weekendMs / 60_000;
}

/** At least half of the block's minutes on the weekend days (a 12 / 12 split counts as weekend). */
export function isWeekendBlock(startMs: number, endMs: number, weekendDays: readonly number[]): boolean {
  if (endMs <= startMs) return false;
  return weekendMinutesIn(startMs, endMs, weekendDays) * 2 >= (endMs - startMs) / 60_000;
}

/**
 * The weekend days an EXISTING booking is re-priced with: the ones stored at
 * create (pricingSnapshot.weekendDays), else none — a booking made before
 * weekend rates existed keeps its weekday prices.
 */
export function weekendDaysOf(pricingSnapshot: unknown): number[] {
  return normalizeWeekendDays((pricingSnapshot as { weekendDays?: unknown } | null)?.weekendDays);
}

/**
 * The snapshot with its items' pricingBreakdown.weekend set to the given
 * breakdowns (none = removed), matched by vehicleId, else by position.
 * Reschedule refreshes them when the move kept the rent.
 */
export function withItemWeekendBreakdowns(
  pricingSnapshot: unknown,
  breakdowns: { vehicleId: number; weekend?: unknown }[],
): Record<string, unknown> {
  const snapshot = { ...((pricingSnapshot ?? {}) as Record<string, unknown>) };
  if (!Array.isArray(snapshot.items)) return snapshot;
  snapshot.items = snapshot.items.map((item: unknown, index: number) => {
    if (!item || typeof item !== "object") return item;
    const row = item as { vehicleId?: unknown; pricingBreakdown?: Record<string, unknown> };
    const entry = breakdowns.find((b) => b.vehicleId === row.vehicleId) ?? breakdowns[index];
    if (!entry) return item;
    const { weekend: _previous, ...pricingBreakdown } = row.pricingBreakdown ?? {};
    return { ...row, pricingBreakdown: entry.weekend ? { ...pricingBreakdown, weekend: entry.weekend } : pricingBreakdown };
  });
  return snapshot;
}

/** "₹1,600" / "₹1,600.50" — the label's rupee amounts. */
export function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

import { z } from "zod";
import { FUEL_BARS_MESSAGE, FUEL_BARS_PATTERN } from "@repo/schemas";

/**
 * Fuel bars on request bodies (pickup, drop, edits): "0".."10".
 * Oct 2026: the scale starts at 0 (empty tank). Old app builds send "1".."10",
 * which stays valid.
 */
export const fuelBarsField = z.string().regex(FUEL_BARS_PATTERN, FUEL_BARS_MESSAGE);

/**
 * Vehicle.fuelLevel holds a percent (both pickup screens send bars × 10), while
 * swap readings are bars "0".."10" ("0" = empty). Store a reading on the vehicle as a percent.
 */
export function fuelBarsToPercent(bars: string): number {
  return Number(bars) * 10;
}

/**
 * Vehicle.fuelLevel (percent) as fuel bars "1".."10" — the swap form's prefill.
 * null when it isn't a whole bar (unknown / legacy). 0% also gives null: it is the
 * column's default for a vehicle never read, so it must not prefill "0" (empty) —
 * staff pick an empty tank themselves.
 */
export function fuelPercentToBars(percent: number | null | undefined): string | null {
  if (percent == null || !Number.isInteger(percent)) return null;
  if (percent < 10 || percent > 100 || percent % 10 !== 0) return null;
  return String(percent / 10);
}

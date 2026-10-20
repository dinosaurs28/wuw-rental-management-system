/**
 * Fuel bars (Oct 2026: "The Fuel point should start from 0").
 *
 * Staff record fuel at pickup, drop, a mid-rental swap and every edit as a
 * whole number of bars, sent as a string "0".."10". "0" is an empty tank and
 * is a real reading — never treat it as "not recorded" (use `== null`, not a
 * truthiness check, on parsed numbers). Old app builds send "1".."10", which
 * stays valid. The mobile app mirrors this by hand in mobile/lib/fuel.ts.
 */
export const FUEL_BARS_MIN = 0;
export const FUEL_BARS_MAX = 10;

/** A whole number of bars, "0".."10". */
export const FUEL_BARS_PATTERN = /^(10|[0-9])$/;

export const FUEL_BARS_MESSAGE = `Fuel must be between ${FUEL_BARS_MIN} and ${FUEL_BARS_MAX} bars`;

/** Picker values, empty first: "0", "1", … "10". */
export const FUEL_BAR_OPTIONS: readonly string[] = Array.from(
  { length: FUEL_BARS_MAX - FUEL_BARS_MIN + 1 },
  (_, i) => String(FUEL_BARS_MIN + i),
);

/** A valid reading as a number of bars, or null when missing / not a bar value. */
export function fuelBarsNumber(level: string | number | null | undefined): number | null {
  if (level == null) return null;
  const s = String(level).trim();
  return FUEL_BARS_PATTERN.test(s) ? Number(s) : null;
}

/** Option label: "0 (Empty)" for an empty tank, the number otherwise. */
export function fuelBarOptionLabel(level: string): string {
  return fuelBarsNumber(level) === 0 ? "0 (Empty)" : level;
}

/** Bars a return is short of the start reading (0 when not lower, or either is missing). */
export function fuelBarsShort(
  startLevel: string | number | null | undefined,
  endLevel: string | number | null | undefined,
): number {
  const start = fuelBarsNumber(startLevel);
  const end = fuelBarsNumber(endLevel);
  if (start == null || end == null) return 0;
  return Math.max(0, start - end);
}

/**
 * The fuel deficit charge staff are offered at drop: bars short × the vehicle's
 * ₹-per-bar rate, rounded up to whole rupees (staff can still edit it).
 * 0 when nothing is short, a reading is missing, or there is no rate.
 */
export function fuelDeficitAmount(
  startLevel: string | number | null | undefined,
  endLevel: string | number | null | undefined,
  ratePerBar: number | null | undefined,
): number {
  const short = fuelBarsShort(startLevel, endLevel);
  const rate = ratePerBar != null && Number.isFinite(ratePerBar) && ratePerBar > 0 ? ratePerBar : 0;
  return short > 0 && rate > 0 ? Math.ceil(short * rate) : 0;
}

/**
 * Fuel bars (Oct 2026: "The Fuel point should start from 0"). Mirrors
 * packages/schemas/src/fuel.ts by hand (the app doesn't import @repo/schemas);
 * keep the two in step.
 *
 * Fuel is recorded at pickup, drop, a mid-rental swap and every edit as a whole
 * number of bars, sent as "0".."10". "0" is an empty tank — a real reading, so
 * check parsed numbers with `== null`, never truthiness.
 */
export const FUEL_BARS_PATTERN = /^(10|[0-9])$/;

/** Picker values, empty first: "0", "1", … "10". */
export const FUEL_BAR_LEVELS: string[] = Array.from({ length: 11 }, (_, i) => String(i));

/** A valid reading as a number of bars, or null when missing / not a bar value. */
export function fuelBarsNumber(level: string | number | null | undefined): number | null {
  if (level == null) return null;
  const s = String(level).trim();
  return FUEL_BARS_PATTERN.test(s) ? Number(s) : null;
}

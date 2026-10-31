/**
 * Absolute + percentage change between a current and a previous value
 * (spec §9.3). Null-safe: when the previous value is 0 or missing the
 * percentage is null (the UI shows "new" / "–"), never Infinity or a fake 100%.
 */
export interface Delta {
  current: number | null;
  previous: number | null;
  /** current − previous (2 dp), null when either side is missing. */
  abs: number | null;
  /** (current − previous) / |previous| × 100 (1 dp); null when previous is 0/null. */
  pct: number | null;
  direction: "up" | "down" | "flat" | null;
}

const num = (v: number | null | undefined): number | null =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v);

const round = (v: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round((v + Number.EPSILON) * f) / f;
};

export const computeDelta = (
  current: number | null | undefined,
  previous: number | null | undefined,
): Delta => {
  const cur = num(current);
  const prev = num(previous);
  if (cur === null || prev === null) {
    return { current: cur, previous: prev, abs: null, pct: null, direction: null };
  }
  const abs = round(cur - prev, 2);
  const pct = prev === 0 ? null : round(((cur - prev) / Math.abs(prev)) * 100, 1);
  const direction = abs > 0 ? "up" : abs < 0 ? "down" : "flat";
  return { current: cur, previous: prev, abs, pct, direction };
};

export const withDelta = computeDelta;

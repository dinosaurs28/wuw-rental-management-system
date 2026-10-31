/**
 * Pure fleet-report math (Admin Reports 4.1–4.4, 5.1, 5.2, 6.1). No database —
 * fleet.service.ts loads the rows and calls these. Unit tests: fleet-math.test.ts.
 *
 * Time is handled as half-open millisecond intervals [start, end).
 * One "day" = 24 h of elapsed time (fractional days, rounded to 2 dp for output).
 */

export const DAY_MS = 86_400_000;

export interface Interval {
  start: number;
  end: number;
}

export const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
export const msToDays = (ms: number): number => r2(ms / DAY_MS);

/** Sort + merge overlapping / touching intervals; drops empty ones. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ start: i.start, end: i.end });
  }
  return out;
}

/** Intersect every interval with [window.start, window.end). */
export function clipIntervals(list: Interval[], window: Interval): Interval[] {
  const out: Interval[] = [];
  for (const i of list) {
    const start = Math.max(i.start, window.start);
    const end = Math.min(i.end, window.end);
    if (end > start) out.push({ start, end });
  }
  return out;
}

/** a − b (both lists may be unmerged). */
export function subtractIntervals(a: Interval[], b: Interval[]): Interval[] {
  const bm = mergeIntervals(b);
  const out: Interval[] = [];
  for (const i of mergeIntervals(a)) {
    let cur = i.start;
    for (const x of bm) {
      if (x.end <= cur) continue;
      if (x.start >= i.end) break;
      if (x.start > cur) out.push({ start: cur, end: x.start });
      cur = Math.max(cur, x.end);
      if (cur >= i.end) break;
    }
    if (cur < i.end) out.push({ start: cur, end: i.end });
  }
  return out;
}

export const totalMs = (list: Interval[]): number =>
  mergeIntervals(list).reduce((s, i) => s + (i.end - i.start), 0);

// ── Status history → out-of-service intervals ─────────────────────────────

/** Vehicle statuses that take a car out of service (not rentable). */
export const DOWNTIME_STATUSES = ["MAINTENANCE", "MANAGER_REPORTED", "INACTIVE"] as const;
export type DowntimeStatus = (typeof DOWNTIME_STATUSES)[number];
export type DowntimeKind = DowntimeStatus | "BOOKING_LOCK";

export interface StatusChange {
  toStatus: string;
  changedAt: Date;
}

/**
 * Status intervals from a vehicle's change log (sorted or not). Each change's
 * status runs until the next change (the last one until `until`). Returns the
 * intervals and `knownFrom` = the first change (null = no history at all):
 * the status before it is not recorded.
 */
export function statusIntervals(
  changes: StatusChange[],
  until: number,
): { knownFrom: number | null; intervals: Array<Interval & { status: string }> } {
  const sorted = [...changes].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
  const intervals: Array<Interval & { status: string }> = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!.changedAt.getTime();
    const end = i + 1 < sorted.length ? sorted[i + 1]!.changedAt.getTime() : until;
    if (end > start) intervals.push({ start, end, status: sorted[i]!.toStatus });
  }
  return { knownFrom: sorted.length > 0 ? sorted[0]!.changedAt.getTime() : null, intervals };
}

// ── Rentals → per-vehicle rented intervals ────────────────────────────────

export interface RentalSwap {
  swappedAt: Date;
  originalVehicleId: number;
  newVehicleId: number;
  /** PICKED_UP = mid-rental; CONFIRMED = before pickup; null = legacy row. */
  bookingStatusAtSwap: string | null;
}

export interface RentalInput {
  bookingId: number;
  status: string;
  /** Actual handover time (earliest pickup marker); null = not picked up. */
  pickedUpAt: Date | null;
  /** Actual return / end time; null = still out (active). */
  endedAt: Date | null;
  /** BookingItem vehicle ids (the car at the end after swaps). */
  itemVehicleIds: number[];
  swaps: RentalSwap[];
}

export interface RentalSegment extends Interval {
  bookingId: number;
  vehicleId: number;
}

/**
 * Split a picked-up booking into per-vehicle segments: [pickup, swap1) on the
 * first car, [swap1, swap2) on the next, …, [last swap, end) on the last. A swap
 * counts as mid-rental when bookingStatusAtSwap = PICKED_UP, or (legacy rows)
 * when it happened at/after the pickup — the same rule as getOdometerSegments.
 * `now` closes an active rental.
 */
export function rentalSegments(r: RentalInput, now: number): RentalSegment[] {
  if (!r.pickedUpAt) return [];
  const start = r.pickedUpAt.getTime();
  const end = r.endedAt ? r.endedAt.getTime() : now;
  if (end <= start) return [];
  const mid = r.swaps
    .filter((s) =>
      s.bookingStatusAtSwap === "PICKED_UP" ||
      (s.bookingStatusAtSwap == null && s.swappedAt.getTime() >= start),
    )
    .sort((a, b) => a.swappedAt.getTime() - b.swappedAt.getTime());
  if (mid.length === 0) {
    return [...new Set(r.itemVehicleIds)].map((vehicleId) => ({ bookingId: r.bookingId, vehicleId, start, end }));
  }
  const out: RentalSegment[] = [];
  let cur = start;
  let vehicleId = mid[0]!.originalVehicleId;
  for (const s of mid) {
    const at = Math.min(Math.max(s.swappedAt.getTime(), start), end);
    if (at > cur) out.push({ bookingId: r.bookingId, vehicleId, start: cur, end: at });
    cur = Math.max(cur, at);
    vehicleId = s.newVehicleId;
  }
  if (end > cur) out.push({ bookingId: r.bookingId, vehicleId, start: cur, end });
  return out;
}

// ── Utilization ───────────────────────────────────────────────────────────

export interface VehicleTimelineInput {
  /** The vehicle's window inside the report range: [max(from, createdAt), min(to, now, deletedAt)). */
  window: Interval;
  rented: Interval[];
  /** Out-of-service intervals by kind (from status history and booking locks). */
  downtime: Partial<Record<DowntimeKind, Interval[]>>;
  /** First recorded status change (ms) or null — downtime before it is unknown. */
  historyKnownFrom: number | null;
}

export interface VehicleTimelineResult {
  rangeDays: number;
  rentedDays: number;
  /** Union of every downtime kind, minus rented time. */
  downtimeDays: number;
  byKind: Record<DowntimeKind, number>;
  availableDays: number;
  /** rented ÷ available × 100, null when available = 0. */
  utilizationPct: number | null;
  /** rented ÷ range days × 100 — what utilization would read with downtime counted as available. */
  utilizationInclDowntimePct: number | null;
  /** Days in the window before status history starts — counted as available (downtime unknown). */
  untrackedDays: number;
  /** ms totals (unrounded) for summing groups exactly. */
  ms: { range: number; rented: number; downtime: number; available: number; untracked: number };
}

export const pct = (num: number, den: number): number | null =>
  den > 0 ? r2((num / den) * 100) : null;

/**
 * THE utilization rule (4.1) and downtime rule (5.2), per vehicle:
 *   rented    = union of the car's rental segments inside its window
 *   downtime  = union of out-of-service intervals inside its window, minus rented time
 *               (a car on a rental is never "down", whatever its status flag says)
 *   available = window − downtime
 *   utilization % = rented ÷ available × 100
 */
export function vehicleTimeline(v: VehicleTimelineInput): VehicleTimelineResult {
  const w = v.window;
  const rangeMs = Math.max(0, w.end - w.start);
  const rented = mergeIntervals(clipIntervals(v.rented, w));
  const rentedMs = totalMs(rented);
  const kinds: DowntimeKind[] = [...DOWNTIME_STATUSES, "BOOKING_LOCK"];
  const byKind = {} as Record<DowntimeKind, number>;
  const all: Interval[] = [];
  for (const k of kinds) {
    const list = subtractIntervals(clipIntervals(v.downtime[k] ?? [], w), rented);
    byKind[k] = msToDays(totalMs(list));
    all.push(...list);
  }
  const downtimeMs = totalMs(all);
  const availableMs = Math.max(0, rangeMs - downtimeMs);
  const untrackedMs =
    rangeMs === 0
      ? 0
      : v.historyKnownFrom == null
        ? rangeMs
        : Math.max(0, Math.min(w.end, v.historyKnownFrom) - w.start);
  return {
    rangeDays: msToDays(rangeMs),
    rentedDays: msToDays(rentedMs),
    downtimeDays: msToDays(downtimeMs),
    byKind,
    availableDays: msToDays(availableMs),
    utilizationPct: pct(rentedMs, availableMs),
    utilizationInclDowntimePct: pct(rentedMs, rangeMs),
    untrackedDays: msToDays(untrackedMs),
    ms: { range: rangeMs, rented: rentedMs, downtime: downtimeMs, available: availableMs, untracked: untrackedMs },
  };
}

export interface UtilTotals {
  vehicles: number;
  rangeDays: number;
  downtimeDays: number;
  availableDays: number;
  rentedDays: number;
  utilizationPct: number | null;
  untrackedDays: number;
}

/** Sum vehicles into a group: totals of days, utilization = Σ rented ÷ Σ available. */
export function sumTimelines(list: VehicleTimelineResult[]): UtilTotals {
  const s = { range: 0, rented: 0, downtime: 0, available: 0, untracked: 0 };
  for (const t of list) {
    s.range += t.ms.range;
    s.rented += t.ms.rented;
    s.downtime += t.ms.downtime;
    s.available += t.ms.available;
    s.untracked += t.ms.untracked;
  }
  return {
    vehicles: list.length,
    rangeDays: msToDays(s.range),
    downtimeDays: msToDays(s.downtime),
    availableDays: msToDays(s.available),
    rentedDays: msToDays(s.rented),
    utilizationPct: pct(s.rented, s.available),
    untrackedDays: msToDays(s.untracked),
  };
}

// ── Profitability ─────────────────────────────────────────────────────────

export interface ProfitInput {
  revenue: number;
  costs: { maintenance: number; repair: number; other: number };
  /** Number of cost rows recorded for the vehicle in the range. */
  costEntries: number;
}

export function profitRow(p: ProfitInput) {
  const totalCost = r2(p.costs.maintenance + p.costs.repair + p.costs.other);
  const profit = r2(p.revenue - totalCost);
  return {
    revenue: r2(p.revenue),
    maintenance: r2(p.costs.maintenance),
    repair: r2(p.costs.repair),
    other: r2(p.costs.other),
    totalCost,
    profit,
    marginPct: p.revenue > 0 ? r2((profit / p.revenue) * 100) : null,
    costsCaptured: p.costEntries > 0,
  };
}

// ── Document expiry ───────────────────────────────────────────────────────

export type DocType = "INSURANCE" | "RC" | "PERMIT" | "PUC" | "FITNESS";
export type DocStatus = "EXPIRED" | "EXPIRING_7" | "EXPIRING_30" | "VALID";

const IST_OFFSET_MS = 330 * 60_000;
/** IST calendar day number (days since epoch) of an instant. */
export const istDayNumber = (d: Date | number): number =>
  Math.floor(((typeof d === "number" ? d : d.getTime()) + IST_OFFSET_MS) / DAY_MS);

/**
 * Days left = IST calendar days from today to the expiry day (0 = expires today).
 * Expired = expiry day before today; ≤7d = 0..7; ≤30d = 8..30; Valid beyond.
 */
export function docStatus(expiry: Date, now: Date): { daysLeft: number; status: DocStatus } {
  const daysLeft = istDayNumber(expiry) - istDayNumber(now);
  const status: DocStatus =
    daysLeft < 0 ? "EXPIRED" : daysLeft <= 7 ? "EXPIRING_7" : daysLeft <= 30 ? "EXPIRING_30" : "VALID";
  return { daysLeft, status };
}

// ── Km ────────────────────────────────────────────────────────────────────

export interface KmSwapSegment {
  originalVehicleId: number;
  /** km on the returning car, as recorded at the swap (segmentKmDriven, else end − start). */
  km: number | null;
}

/**
 * km per vehicle for one trip: each mid-rental swap's returning car gets its
 * segment km; the last car gets total − Σ segments. total = Booking.totalKmDriven
 * (which already includes the earlier segments). Returns null km where unknown.
 */
export function tripKmByVehicle(
  totalKm: number | null,
  lastVehicleId: number,
  segments: KmSwapSegment[],
): Array<{ vehicleId: number; km: number | null }> {
  const out: Array<{ vehicleId: number; km: number | null }> = segments.map((s) => ({
    vehicleId: s.originalVehicleId,
    km: s.km,
  }));
  const known = segments.every((s) => s.km != null);
  const prior = segments.reduce((s, x) => s + (x.km ?? 0), 0);
  out.push({
    vehicleId: lastVehicleId,
    km: totalKm == null || !known ? null : Math.max(0, totalKm - prior),
  });
  return out;
}

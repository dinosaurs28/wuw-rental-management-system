/**
 * Fleet reports (Admin Reports 4.1 utilization, 4.2 idle, 4.3 profitability,
 * 4.4 km & mileage, 5.1 damage, 5.2 downtime, 6.1 document expiry). READ-ONLY.
 *
 * Shared API (used by the Dashboard and Branch Comparison):
 *   computeUtilization(scope)   per vehicle / category / branch + totals
 *   getDocumentExpiry(opts)     expired + expiring documents
 *
 * RULES (documented on every page):
 *  - Rented time = each picked-up booking's actual handover → return (an active
 *    rental runs to now), split per car at mid-rental swaps, clipped to the range.
 *    Handover = earliest pickup marker (licence collected, fuel captured, first
 *    handover photo), else the scheduled start. Return = returnedAt, else the
 *    drop's fuel capture, else the scheduled end; a manually cancelled active rent
 *    ends at its cancellation.
 *  - Downtime = time the car was MAINTENANCE / MANAGER_REPORTED (damage review) /
 *    INACTIVE per VehicleStatusHistory, plus booking locks that block staff too
 *    (customersOnly locks excluded), minus any rented time, clipped to the range.
 *  - Available = days in range (from the vehicle's creation, up to now) − downtime.
 *  - Utilization % = rented ÷ available × 100. Groups sum days, then divide.
 *  - Status history is only recorded from the 20261031100000_fleet_reports deploy;
 *    days before a vehicle's first history row are counted as available (status
 *    then is unknown) and reported as `untrackedDays`.
 */
import { prisma, Prisma, BookingPhotoType, BookingStatus } from "@repo/database/client";
import { vehicleGroupKey } from "@repo/schemas";
import { revenueByVehicle } from "../finance/revenue.js";
import { getChargedVsCollectedByBooking } from "../charge-collection.service.js";
import {
  DAY_MS,
  DOWNTIME_STATUSES,
  type DowntimeKind,
  type DocStatus,
  type DocType,
  type Interval,
  type RentalInput,
  type UtilTotals,
  type VehicleTimelineResult,
  clipIntervals,
  docStatus,
  mergeIntervals,
  msToDays,
  pct,
  profitRow,
  r2,
  rentalSegments,
  statusIntervals,
  subtractIntervals,
  sumTimelines,
  tripKmByVehicle,
  vehicleTimeline,
} from "./fleet-math.js";

export interface FleetScope {
  from: Date;
  to: Date;
  branchPublicId?: string | null;
  categoryPublicIds?: string[];
  vehiclePublicId?: string | null;
  now?: Date;
}

export const STATUS_HISTORY_NOTE =
  "Vehicle status history (maintenance / damage review / inactive) is recorded from the Oct 31 2026 release onward. " +
  "Days before a vehicle's first recorded status are counted as available because its status then is unknown (shown as 'untracked days').";

// ── Loaders ────────────────────────────────────────────────────────────────

const vehicleSelect = {
  id: true,
  publicId: true,
  regNo: true,
  make: true,
  model: true,
  status: true,
  odo: true,
  branchId: true,
  categoryId: true,
  createdAt: true,
  deletedAt: true,
  branch: { select: { publicId: true, name: true } },
  category: { select: { publicId: true, name: true } },
} satisfies Prisma.VehicleSelect;

export type FleetVehicle = Prisma.VehicleGetPayload<{ select: typeof vehicleSelect }>;

/** Vehicles in scope that existed at some point in [from, to] (inactive included). */
export async function loadScopeVehicles(
  scope: Pick<FleetScope, "branchPublicId" | "categoryPublicIds" | "vehiclePublicId"> & { from?: Date; to?: Date },
): Promise<FleetVehicle[]> {
  const where: Prisma.VehicleWhereInput = {
    OR: [{ deletedAt: null }, ...(scope.from ? [{ deletedAt: { gt: scope.from } }] : [])],
  };
  if (scope.to) where.createdAt = { lte: scope.to };
  if (scope.branchPublicId) where.branch = { publicId: scope.branchPublicId };
  if (scope.categoryPublicIds && scope.categoryPublicIds.length > 0) {
    where.category = { publicId: { in: scope.categoryPublicIds } };
  }
  if (scope.vehiclePublicId) where.publicId = scope.vehiclePublicId;
  return prisma.vehicle.findMany({ where, select: vehicleSelect, orderBy: { regNo: "asc" } });
}

const RENTAL_STATUSES: BookingStatus[] = [
  BookingStatus.PICKED_UP,
  BookingStatus.RETURNED,
  BookingStatus.CANCELLED,
];

export interface LoadedRental extends RentalInput {
  publicId: string;
  branchId: number;
}

/**
 * Picked-up bookings that involve any of the vehicles (as the item or either side
 * of a swap) and could overlap [from, to]. CANCELLED bookings count only when they
 * were picked up (a manually cancelled active rent).
 */
export async function loadRentals(vehicleIds: number[], from: Date | null, to: Date): Promise<LoadedRental[]> {
  if (vehicleIds.length === 0) return [];
  const where: Prisma.BookingWhereInput = {
    deletedAt: null,
    status: { in: RENTAL_STATUSES },
    startAt: { lte: new Date(to.getTime() + 2 * DAY_MS) },
    OR: [
      { items: { some: { vehicleId: { in: vehicleIds } } } },
      { vehicleSwaps: { some: { OR: [{ originalVehicleId: { in: vehicleIds } }, { newVehicleId: { in: vehicleIds } }] } } },
    ],
  };
  if (from) {
    where.AND = [
      {
        OR: [
          { status: BookingStatus.PICKED_UP },
          { returnedAt: { gte: from } },
          { cancelledAt: { gte: from } },
          { returnedAt: null, endAt: { gte: new Date(from.getTime() - 60 * DAY_MS) } },
        ],
      },
    ];
  }
  const bookings = await prisma.booking.findMany({
    where,
    select: {
      id: true,
      publicId: true,
      branchId: true,
      status: true,
      startAt: true,
      endAt: true,
      returnedAt: true,
      cancelledAt: true,
      licenseCollectedAt: true,
      fuelRecord: { select: { pickupAt: true, returnAt: true } },
      items: { select: { vehicleId: true } },
      vehicleSwaps: {
        select: { swappedAt: true, originalVehicleId: true, newVehicleId: true, bookingStatusAtSwap: true },
      },
    },
  });
  const photoMarkers = new Map<number, Date>();
  const ids = bookings.map((b) => b.id);
  for (let i = 0; i < ids.length; i += 5000) {
    const rows = await prisma.bookingPhoto.groupBy({
      by: ["bookingId"],
      where: { bookingId: { in: ids.slice(i, i + 5000) }, type: BookingPhotoType.PRE_DELIVERY },
      _min: { createdAt: true },
    });
    for (const r of rows) if (r._min.createdAt) photoMarkers.set(r.bookingId, r._min.createdAt);
  }
  const out: LoadedRental[] = [];
  for (const b of bookings) {
    const markers = [b.licenseCollectedAt, b.fuelRecord?.pickupAt, photoMarkers.get(b.id)].filter(
      (d): d is Date => d instanceof Date,
    );
    const marker = markers.length ? new Date(Math.min(...markers.map((d) => d.getTime()))) : null;
    let pickedUpAt: Date | null;
    let endedAt: Date | null;
    if (b.status === BookingStatus.CANCELLED) {
      // Only an active rent cancelled by the manager was ever on the road
      if (!marker || !b.cancelledAt || b.cancelledAt <= marker) continue;
      pickedUpAt = marker;
      endedAt = b.returnedAt ?? b.cancelledAt;
    } else {
      pickedUpAt = marker ?? b.startAt;
      endedAt =
        b.status === BookingStatus.PICKED_UP ? null : (b.returnedAt ?? b.fuelRecord?.returnAt ?? b.endAt);
    }
    out.push({
      bookingId: b.id,
      publicId: b.publicId,
      branchId: b.branchId,
      status: b.status,
      pickedUpAt,
      endedAt,
      itemVehicleIds: b.items.map((i) => i.vehicleId),
      swaps: b.vehicleSwaps.map((s) => ({
        swappedAt: s.swappedAt,
        originalVehicleId: s.originalVehicleId,
        newVehicleId: s.newVehicleId,
        bookingStatusAtSwap: s.bookingStatusAtSwap,
      })),
    });
  }
  return out;
}

/** Per-vehicle rented intervals (+ booking ids) for the rentals. */
export function rentedByVehicle(rentals: LoadedRental[], now: number) {
  const map = new Map<number, Array<Interval & { bookingId: number }>>();
  for (const r of rentals) {
    for (const s of rentalSegments(r, now)) {
      const list = map.get(s.vehicleId) ?? [];
      list.push({ start: s.start, end: s.end, bookingId: s.bookingId });
      map.set(s.vehicleId, list);
    }
  }
  return map;
}

interface VehicleDowntimeData {
  intervals: Partial<Record<DowntimeKind, Interval[]>>;
  historyKnownFrom: number | null;
  lockReasons: Array<Interval & { reason: string }>;
}

/** Status-history and booking-lock downtime for each vehicle, up to `until`. */
export async function loadDowntime(
  vehicles: FleetVehicle[],
  from: Date,
  until: number,
): Promise<Map<number, VehicleDowntimeData>> {
  const out = new Map<number, VehicleDowntimeData>();
  if (vehicles.length === 0) return out;
  const ids = vehicles.map((v) => v.id);
  const [history, locks] = await Promise.all([
    prisma.vehicleStatusHistory.findMany({
      where: { vehicleId: { in: ids }, changedAt: { lte: new Date(until) } },
      select: { vehicleId: true, toStatus: true, changedAt: true },
      orderBy: [{ vehicleId: "asc" }, { changedAt: "asc" }, { id: "asc" }],
    }),
    prisma.bookingLock.findMany({
      where: {
        branchId: { in: [...new Set(vehicles.map((v) => v.branchId))] },
        customersOnly: false,
        startAt: { lt: new Date(until) },
        endAt: { gt: from },
      },
      select: {
        branchId: true,
        scope: true,
        vehicleIds: true,
        groupKeys: true,
        startAt: true,
        endAt: true,
        cancelledAt: true,
        reason: true,
      },
    }),
  ]);
  const byVehicle = new Map<number, typeof history>();
  for (const h of history) {
    const list = byVehicle.get(h.vehicleId) ?? [];
    list.push(h);
    byVehicle.set(h.vehicleId, list);
  }
  for (const v of vehicles) {
    const { knownFrom, intervals } = statusIntervals(byVehicle.get(v.id) ?? [], until);
    const data: VehicleDowntimeData = { intervals: {}, historyKnownFrom: knownFrom, lockReasons: [] };
    for (const k of DOWNTIME_STATUSES) {
      data.intervals[k] = intervals.filter((i) => i.status === k).map(({ start, end }) => ({ start, end }));
    }
    const key = vehicleGroupKey(v.make, v.model, v.categoryId);
    const lockIntervals: Interval[] = [];
    for (const l of locks) {
      if (l.branchId !== v.branchId) continue;
      const applies =
        l.scope === "BRANCH" ||
        (l.scope === "VEHICLES" && l.vehicleIds.includes(v.id)) ||
        (l.scope === "GROUPS" && l.groupKeys.includes(key));
      if (!applies) continue;
      // A cancelled lock was in force until it was cancelled
      const end = Math.min(l.endAt.getTime(), l.cancelledAt ? l.cancelledAt.getTime() : Infinity);
      if (end <= l.startAt.getTime()) continue;
      lockIntervals.push({ start: l.startAt.getTime(), end });
      data.lockReasons.push({ start: l.startAt.getTime(), end, reason: l.reason });
    }
    data.intervals.BOOKING_LOCK = lockIntervals;
    out.set(v.id, data);
  }
  return out;
}

// ── Timelines (shared by 4.1 and 5.2) ─────────────────────────────────────

export interface VehicleTimeline {
  vehicle: FleetVehicle;
  window: Interval;
  timeline: VehicleTimelineResult;
  rented: Array<Interval & { bookingId: number }>;
  downtime: VehicleDowntimeData;
}

/** Each vehicle's window: [max(from, createdAt), min(to, now, deletedAt)). */
const vehicleWindow = (v: FleetVehicle, from: number, end: number): Interval => ({
  start: Math.max(from, v.createdAt.getTime()),
  end: Math.max(Math.max(from, v.createdAt.getTime()), Math.min(end, v.deletedAt ? v.deletedAt.getTime() : Infinity)),
});

export async function computeFleetTimelines(scope: FleetScope): Promise<{
  vehicles: VehicleTimeline[];
  rangeEnd: number;
  historyKnownFrom: Date | null;
}> {
  const now = (scope.now ?? new Date()).getTime();
  const from = scope.from.getTime();
  // Report ranges end at 23:59:59.999 — make it half-open; never count the future
  const rangeEnd = Math.max(from, Math.min(scope.to.getTime() + 1, now));
  const vehicles = await loadScopeVehicles({ ...scope, from: scope.from, to: new Date(rangeEnd) });
  const ids = vehicles.map((v) => v.id);
  const [rentals, downtime] = await Promise.all([
    loadRentals(ids, scope.from, new Date(rangeEnd)),
    loadDowntime(vehicles, scope.from, rangeEnd),
  ]);
  const rented = rentedByVehicle(rentals, now);
  let earliestHistory: number | null = null;
  const out: VehicleTimeline[] = vehicles.map((v) => {
    const window = vehicleWindow(v, from, rangeEnd);
    const d = downtime.get(v.id) ?? { intervals: {}, historyKnownFrom: null, lockReasons: [] };
    if (d.historyKnownFrom != null) {
      earliestHistory = earliestHistory == null ? d.historyKnownFrom : Math.min(earliestHistory, d.historyKnownFrom);
    }
    const r = rented.get(v.id) ?? [];
    return {
      vehicle: v,
      window,
      rented: r,
      downtime: d,
      timeline: vehicleTimeline({ window, rented: r, downtime: d.intervals, historyKnownFrom: d.historyKnownFrom }),
    };
  });
  return { vehicles: out, rangeEnd, historyKnownFrom: earliestHistory != null ? new Date(earliestHistory) : null };
}

// ── 4.1 Utilization ───────────────────────────────────────────────────────

export interface UtilGroup extends UtilTotals {
  publicId: string | null;
  name: string;
}

export interface VehicleUtilRow {
  vehicleId: number;
  publicId: string;
  regNo: string;
  name: string;
  branchPublicId: string;
  branchName: string;
  categoryPublicId: string;
  categoryName: string;
  status: string;
  rangeDays: number;
  rentedDays: number;
  downtimeDays: number;
  availableDays: number;
  utilizationPct: number | null;
  utilizationInclDowntimePct: number | null;
  untrackedDays: number;
  rentals: number;
  downtimeByKind: Record<DowntimeKind, number>;
}

export interface UtilizationResult {
  totals: UtilGroup;
  byBranch: UtilGroup[];
  byCategory: UtilGroup[];
  vehicles: VehicleUtilRow[];
  historyKnownFrom: Date | null;
  notes: string[];
}

const groupBy = (
  list: VehicleTimeline[],
  key: (v: FleetVehicle) => { publicId: string; name: string },
): UtilGroup[] => {
  const map = new Map<string, { name: string; items: VehicleTimelineResult[] }>();
  for (const t of list) {
    const k = key(t.vehicle);
    const g = map.get(k.publicId) ?? { name: k.name, items: [] };
    g.items.push(t.timeline);
    map.set(k.publicId, g);
  }
  return [...map.entries()]
    .map(([publicId, g]) => ({ publicId, name: g.name, ...sumTimelines(g.items) }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const toUtilRow = (t: VehicleTimeline): VehicleUtilRow => ({
  vehicleId: t.vehicle.id,
  publicId: t.vehicle.publicId,
  regNo: t.vehicle.regNo,
  name: `${t.vehicle.make} ${t.vehicle.model}`,
  branchPublicId: t.vehicle.branch.publicId,
  branchName: t.vehicle.branch.name,
  categoryPublicId: t.vehicle.category.publicId,
  categoryName: t.vehicle.category.name,
  status: t.vehicle.status,
  rangeDays: t.timeline.rangeDays,
  rentedDays: t.timeline.rentedDays,
  downtimeDays: t.timeline.downtimeDays,
  availableDays: t.timeline.availableDays,
  utilizationPct: t.timeline.utilizationPct,
  utilizationInclDowntimePct: t.timeline.utilizationInclDowntimePct,
  untrackedDays: t.timeline.untrackedDays,
  rentals: new Set(clipIntervalsWithId(t.rented, t.window).map((r) => r.bookingId)).size,
  downtimeByKind: t.timeline.byKind,
});

function clipIntervalsWithId<T extends Interval>(list: T[], w: Interval): T[] {
  return list.filter((i) => Math.min(i.end, w.end) > Math.max(i.start, w.start));
}

export async function computeUtilization(scope: FleetScope): Promise<UtilizationResult> {
  const { vehicles, historyKnownFrom } = await computeFleetTimelines(scope);
  const notes = [STATUS_HISTORY_NOTE];
  return {
    totals: { publicId: null, name: "All vehicles", ...sumTimelines(vehicles.map((v) => v.timeline)) },
    byBranch: groupBy(vehicles, (v) => ({ publicId: v.branch.publicId, name: v.branch.name })),
    byCategory: groupBy(vehicles, (v) => ({ publicId: v.category.publicId, name: v.category.name })),
    vehicles: vehicles.map(toUtilRow),
    historyKnownFrom,
    notes,
  };
}

// ── 5.2 Downtime ──────────────────────────────────────────────────────────

export interface DowntimeEpisode {
  vehiclePublicId: string;
  regNo: string;
  branchName: string;
  categoryName: string;
  kind: DowntimeKind;
  start: Date;
  /** null = still ongoing at the end of the range (up to now). */
  end: Date | null;
  days: number;
  reason: string | null;
}

export async function computeDowntime(scope: FleetScope) {
  const { vehicles, rangeEnd, historyKnownFrom } = await computeFleetTimelines(scope);
  const episodes: DowntimeEpisode[] = [];
  for (const t of vehicles) {
    const rented = mergeIntervals(clipIntervals(t.rented, t.window));
    for (const kind of [...DOWNTIME_STATUSES, "BOOKING_LOCK"] as DowntimeKind[]) {
      const list = mergeIntervals(subtractIntervals(clipIntervals(t.downtime.intervals[kind] ?? [], t.window), rented));
      for (const i of list) {
        const reason =
          kind === "BOOKING_LOCK"
            ? t.downtime.lockReasons.filter((l) => l.start < i.end && l.end > i.start).map((l) => l.reason).join("; ") || null
            : null;
        episodes.push({
          vehiclePublicId: t.vehicle.publicId,
          regNo: t.vehicle.regNo,
          branchName: t.vehicle.branch.name,
          categoryName: t.vehicle.category.name,
          kind,
          start: new Date(i.start),
          end: i.end >= rangeEnd ? null : new Date(i.end),
          days: msToDays(i.end - i.start),
          reason,
        });
      }
    }
  }
  episodes.sort((a, b) => a.start.getTime() - b.start.getTime());
  const rows = vehicles.map(toUtilRow).sort((a, b) => b.downtimeDays - a.downtimeDays || a.regNo.localeCompare(b.regNo));
  const all = vehicles.map((v) => v.timeline);
  const totals = sumTimelines(all);
  const byKind = {} as Record<DowntimeKind, number>;
  for (const k of [...DOWNTIME_STATUSES, "BOOKING_LOCK"] as DowntimeKind[]) {
    byKind[k] = r2(all.reduce((s, t) => s + t.byKind[k], 0));
  }
  const rangeMs = all.reduce((s, t) => s + t.ms.range, 0);
  const rentedMs = all.reduce((s, t) => s + t.ms.rented, 0);
  return {
    totals: {
      ...totals,
      vehiclesWithDowntime: rows.filter((r) => r.downtimeDays > 0).length,
      byKind,
      // Effect on utilization: the same rented days over all days vs over available days
      utilizationInclDowntimePct: pct(rentedMs, rangeMs),
      utilizationEffectPts:
        totals.utilizationPct != null && pct(rentedMs, rangeMs) != null
          ? r2(totals.utilizationPct - (pct(rentedMs, rangeMs) as number))
          : null,
    },
    vehicles: rows,
    episodes,
    historyKnownFrom,
    notes: [
      STATUS_HISTORY_NOTE,
      "Downtime = Maintenance + Damage review (Manager reported) + Inactive + booking locks that block staff bookings; time the car was out on a rental is never counted as downtime. Overlapping causes are counted once in the total.",
    ],
  };
}

// ── 4.2 Idle vehicles ─────────────────────────────────────────────────────

export async function computeIdle(opts: {
  branchPublicId?: string | null;
  categoryPublicIds?: string[];
  vehiclePublicId?: string | null;
  idleDays: number;
  now?: Date;
}) {
  const now = opts.now ?? new Date();
  const vehicles = (await loadScopeVehicles(opts)).filter((v) => v.deletedAt == null);
  const ids = vehicles.map((v) => v.id);
  const rentals = await loadRentals(ids, null, now);
  const segments = rentedByVehicle(rentals, now.getTime());
  const activeIds = new Set(rentals.filter((r) => r.endedAt == null).map((r) => r.bookingId));
  const rev90Start = new Date(now.getTime() - 90 * DAY_MS);
  const [revenue, upcoming] = await Promise.all([
    revenueByVehicle({ ...opts, start: rev90Start, end: now }),
    prisma.bookingItem.findMany({
      where: {
        vehicleId: { in: ids },
        booking: { deletedAt: null, status: BookingStatus.CONFIRMED, startAt: { gte: now } },
      },
      select: { vehicleId: true, booking: { select: { startAt: true } } },
    }),
  ]);
  const nextBooking = new Map<number, Date>();
  for (const u of upcoming) {
    const cur = nextBooking.get(u.vehicleId);
    if (!cur || u.booking.startAt < cur) nextBooking.set(u.vehicleId, u.booking.startAt);
  }
  const rows = vehicles.map((v) => {
    const list = segments.get(v.id) ?? [];
    const onRent = list.some((s) => activeIds.has(s.bookingId) && s.end >= now.getTime());
    const lastEnd = list.length ? Math.max(...list.map((s) => s.end)) : null;
    const since = lastEnd ?? v.createdAt.getTime();
    const daysIdle = onRent ? 0 : Math.max(0, Math.floor((now.getTime() - since) / DAY_MS));
    const rev = revenue.get(v.id);
    return {
      vehicleId: v.id,
      publicId: v.publicId,
      regNo: v.regNo,
      name: `${v.make} ${v.model}`,
      branchPublicId: v.branch.publicId,
      branchName: v.branch.name,
      categoryPublicId: v.category.publicId,
      categoryName: v.category.name,
      status: v.status,
      onRent,
      neverRented: lastEnd == null,
      lastRentalEnd: lastEnd != null ? new Date(lastEnd) : null,
      daysIdle,
      revenue90d: rev?.revenue ?? 0,
      bookings90d: rev?.bookings ?? 0,
      nextBookingAt: nextBooking.get(v.id) ?? null,
      odometer: v.odo,
    };
  });
  const idle = rows
    .filter((r) => !r.onRent && r.daysIdle >= opts.idleDays)
    .sort((a, b) => b.daysIdle - a.daysIdle || a.regNo.localeCompare(b.regNo));
  return {
    idleDays: opts.idleDays,
    asOf: now,
    summary: {
      vehicles: rows.length,
      idle: idle.length,
      neverRented: idle.filter((r) => r.neverRented).length,
      onRent: rows.filter((r) => r.onRent).length,
      avgDaysIdle: idle.length ? r2(idle.reduce((s, r) => s + r.daysIdle, 0) / idle.length) : null,
      revenue90dOfIdle: r2(idle.reduce((s, r) => s + r.revenue90d, 0)),
    },
    rows: idle,
    notes: [
      `Idle = not out on a rental and no rental ended in the last ${opts.idleDays} day(s). Days idle = whole days since the last rental ended (for a car never rented: since it was added).`,
      "Revenue (last 90 days) uses the Revenue report's rule: bookings starting in the last 90 days, GST-inclusive, attributed to the car on the booking.",
    ],
  };
}

// ── 4.3 Profitability ─────────────────────────────────────────────────────

async function loadCosts(vehicleIds: number[], start: Date, end: Date) {
  const [expenses, legacy] = await Promise.all([
    prisma.vehicleExpense.groupBy({
      by: ["vehicleId", "category"],
      where: { vehicleId: { in: vehicleIds }, deletedAt: null, incurredAt: { gte: start, lte: end } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.vehicleMaintenanceRecord.groupBy({
      by: ["vehicleId"],
      where: { vehicleId: { in: vehicleIds }, servicedAt: { gte: start, lte: end } },
      _sum: { cost: true },
      _count: { _all: true },
    }),
  ]);
  const map = new Map<number, { maintenance: number; repair: number; other: number; entries: number }>();
  const get = (id: number) => {
    const e = map.get(id) ?? { maintenance: 0, repair: 0, other: 0, entries: 0 };
    map.set(id, e);
    return e;
  };
  for (const e of expenses) {
    const c = get(e.vehicleId);
    const amt = Number(e._sum.amount ?? 0);
    if (e.category === "MAINTENANCE") c.maintenance += amt;
    else if (e.category === "REPAIR") c.repair += amt;
    else c.other += amt;
    c.entries += e._count._all;
  }
  for (const m of legacy) {
    const c = get(m.vehicleId);
    c.maintenance += Number(m._sum.cost ?? 0);
    c.entries += m._count._all;
  }
  return map;
}

async function profitFor(scope: FleetScope, vehicles: FleetVehicle[]) {
  const ids = vehicles.map((v) => v.id);
  const [revenue, costs] = await Promise.all([
    revenueByVehicle({ ...scope, start: scope.from, end: scope.to }),
    loadCosts(ids, scope.from, scope.to),
  ]);
  const rows = vehicles.map((v) => {
    const rev = revenue.get(v.id);
    const c = costs.get(v.id) ?? { maintenance: 0, repair: 0, other: 0, entries: 0 };
    return {
      vehicleId: v.id,
      publicId: v.publicId,
      regNo: v.regNo,
      name: `${v.make} ${v.model}`,
      branchName: v.branch.name,
      categoryPublicId: v.category.publicId,
      categoryName: v.category.name,
      status: v.status,
      bookings: rev?.bookings ?? 0,
      rent: rev?.rent ?? 0,
      extras: rev?.extras ?? 0,
      costEntries: c.entries,
      ...profitRow({ revenue: rev?.revenue ?? 0, costs: c, costEntries: c.entries }),
    };
  });
  const sum = (k: "revenue" | "maintenance" | "repair" | "other" | "totalCost" | "profit") =>
    r2(rows.reduce((s, r) => s + r[k], 0));
  const totals = {
    vehicles: rows.length,
    revenue: sum("revenue"),
    maintenance: sum("maintenance"),
    repair: sum("repair"),
    other: sum("other"),
    totalCost: sum("totalCost"),
    profit: sum("profit"),
    vehiclesWithCosts: rows.filter((r) => r.costsCaptured).length,
    marginPct: sum("revenue") > 0 ? r2((sum("profit") / sum("revenue")) * 100) : null,
  };
  return { rows, totals };
}

export async function computeProfitability(scope: FleetScope, previous?: { start: Date; end: Date }) {
  const vehicles = await loadScopeVehicles({ ...scope });
  const cur = await profitFor(scope, vehicles);
  const prev = previous ? await profitFor({ ...scope, from: previous.start, to: previous.end }, vehicles) : null;
  const byCategory = new Map<string, { name: string; revenue: number; totalCost: number; profit: number; vehicles: number }>();
  for (const r of cur.rows) {
    const g = byCategory.get(r.categoryPublicId) ?? { name: r.categoryName, revenue: 0, totalCost: 0, profit: 0, vehicles: 0 };
    g.revenue = r2(g.revenue + r.revenue);
    g.totalCost = r2(g.totalCost + r.totalCost);
    g.profit = r2(g.profit + r.profit);
    g.vehicles += 1;
    byCategory.set(r.categoryPublicId, g);
  }
  return {
    totals: cur.totals,
    previousTotals: prev?.totals ?? null,
    byCategory: [...byCategory.entries()].map(([publicId, g]) => ({ publicId, ...g })),
    rows: cur.rows.sort((a, b) => b.profit - a.profit),
    costsCaptured: cur.totals.vehiclesWithCosts > 0,
    notes: [
      "Revenue = the Revenue report's rule (bookings starting in the range; rent after discounts incl. extensions + drop charges − goodwill; GST-inclusive), attributed to the car on the booking — a swapped booking counts for the car it ended on.",
      "Costs = vehicle expenses recorded by an admin (Maintenance / Repair / Other) dated in the range, plus any legacy maintenance records. Fuel, insurance premiums, loan EMIs, salaries and other costs that are not entered are NOT captured.",
      "A vehicle marked 'costs not captured' has no cost entries in the range — its profit equals its revenue and is not a true profit.",
    ],
  };
}

// ── 4.4 Kilometres & mileage ──────────────────────────────────────────────

export async function computeKm(scope: FleetScope, previous?: { start: Date; end: Date }) {
  const vehicles = await loadScopeVehicles({ ...scope });
  const cur = await kmFor(scope, vehicles);
  const prev = previous ? await kmFor({ ...scope, from: previous.start, to: previous.end }, vehicles) : null;
  return {
    ...cur,
    previousTotals: prev?.totals ?? null,
    notes: [
      "Trips = rentals returned in the range (by return date). Km per trip = the drop's recorded km (Booking.totalKmDriven), which already sums every car's segment after a mid-rental swap.",
      "Km per vehicle: a car handed back at a mid-rental swap gets that segment's km; the last car gets the rest. Trips whose swaps were recorded without odometer readings have unknown km (blank).",
      "Extra-km charged = the drop bill's Extra km lines (incl. later drop-edit differences). Collected = the extra-km share of the booking's collected 'Extra charges' (fuel, FASTag, extra km and other drop charges are paid together, so extra km's part is pro-rata).",
    ],
  };
}

async function kmFor(scope: FleetScope, vehicles: FleetVehicle[]) {
  const ids = new Set(vehicles.map((v) => v.id));
  const idList = [...ids];
  const bookings = idList.length
    ? await prisma.booking.findMany({
        where: {
          deletedAt: null,
          status: BookingStatus.RETURNED,
          OR: [
            { returnedAt: { gte: scope.from, lte: scope.to } },
            { returnedAt: null, endAt: { gte: scope.from, lte: scope.to } },
          ],
          AND: [
            {
              OR: [
                { items: { some: { vehicleId: { in: idList } } } },
                { vehicleSwaps: { some: { originalVehicleId: { in: idList } } } },
              ],
            },
          ],
        },
        select: {
          id: true,
          publicId: true,
          startAt: true,
          endAt: true,
          returnedAt: true,
          startOdometer: true,
          endOdometer: true,
          totalKmDriven: true,
          freeKmLimit: true,
          extraKmCharged: true,
          licenseCollectedAt: true,
          fuelRecord: { select: { pickupAt: true } },
          customer: { select: { user: { select: { name: true } } } },
          branch: { select: { name: true } },
          items: { select: { vehicleId: true, vehicle: { select: { regNo: true } } } },
          vehicleSwaps: {
            orderBy: { swappedAt: "asc" },
            select: {
              swappedAt: true,
              bookingStatusAtSwap: true,
              originalVehicleId: true,
              originalVehicleEndOdometer: true,
              newVehicleStartOdometer: true,
              segmentKmDriven: true,
              originalVehicle: { select: { regNo: true } },
            },
          },
        },
        orderBy: { returnedAt: "asc" },
      })
    : [];
  const bookingIds = bookings.map((b) => b.id);
  const [ledger, legacy, collected] = await Promise.all([
    bookingIds.length
      ? prisma.ledgerEntry.groupBy({
          by: ["bookingId"],
          where: { bookingId: { in: bookingIds }, entryType: "EXTRA_KM", isVoided: false },
          _sum: { amount: true },
        })
      : [],
    bookingIds.length
      ? prisma.chargeEntry.groupBy({
          by: ["bookingId"],
          where: { bookingId: { in: bookingIds }, chargeType: "EXTRA_KM" },
          _sum: { finalAmount: true, gstAmount: true },
        })
      : [],
    getChargedVsCollectedByBooking(bookingIds, ["EXTRA_CHARGES"]),
  ]);
  const ledgerMap = new Map(ledger.map((l) => [l.bookingId, Number(l._sum.amount ?? 0)]));
  const legacyMap = new Map(
    legacy.map((l) => [l.bookingId, Number(l._sum.finalAmount ?? 0) + Number(l._sum.gstAmount ?? 0)]),
  );
  const vMap = new Map(vehicles.map((v) => [v.id, v]));
  const perVehicle = new Map<number, { km: number; trips: number; unknownKmTrips: number; extraKm: number; charged: number; collected: number }>();
  const trips = bookings.map((b) => {
    const pickupMarker = [b.licenseCollectedAt, b.fuelRecord?.pickupAt].filter((d): d is Date => d instanceof Date);
    const pickedUpAt = pickupMarker.length ? Math.min(...pickupMarker.map((d) => d.getTime())) : b.startAt.getTime();
    const mid = b.vehicleSwaps.filter(
      (s) => s.bookingStatusAtSwap === "PICKED_UP" || (s.bookingStatusAtSwap == null && s.swappedAt.getTime() >= pickedUpAt),
    );
    let segStart = b.startOdometer;
    const segs = mid.map((s) => {
      const km =
        s.segmentKmDriven ??
        (s.originalVehicleEndOdometer != null && segStart != null ? Math.max(0, s.originalVehicleEndOdometer - segStart) : null);
      segStart = s.newVehicleStartOdometer;
      return { originalVehicleId: s.originalVehicleId, km };
    });
    const lastVehicleId = b.items[0]?.vehicleId ?? 0;
    const kmBy = tripKmByVehicle(b.totalKmDriven, lastVehicleId, segs);
    const charged = r2(ledgerMap.has(b.id) ? ledgerMap.get(b.id)! : (legacyMap.get(b.id) ?? 0));
    const extra = collected.get(b.id)?.EXTRA_CHARGES;
    const share = extra && extra.charged > 0 ? Math.min(1, Math.max(0, extra.collected / extra.charged)) : 0;
    const collectedKm = r2(charged * share);
    const extraKm = b.extraKmCharged ?? 0;
    // Spread a trip's extra km / charge over its cars by km share (single car: all of it)
    const knownKm = kmBy.reduce((s, x) => s + (x.km ?? 0), 0);
    for (const x of kmBy) {
      if (!ids.has(x.vehicleId)) continue;
      const e = perVehicle.get(x.vehicleId) ?? { km: 0, trips: 0, unknownKmTrips: 0, extraKm: 0, charged: 0, collected: 0 };
      e.trips += 1;
      if (x.km == null) e.unknownKmTrips += 1;
      else e.km += x.km;
      const w = kmBy.length === 1 ? 1 : knownKm > 0 && x.km != null ? x.km / knownKm : 1 / kmBy.length;
      e.extraKm = r2(e.extraKm + extraKm * w);
      e.charged = r2(e.charged + charged * w);
      e.collected = r2(e.collected + collectedKm * w);
      perVehicle.set(x.vehicleId, e);
    }
    return {
      bookingId: b.id,
      bookingPublicId: b.publicId,
      customerName: b.customer?.user?.name ?? "",
      branchName: b.branch.name,
      vehicles: [...mid.map((s) => s.originalVehicle.regNo), ...b.items.map((i) => i.vehicle.regNo)].join(" → "),
      startAt: b.startAt,
      returnedAt: b.returnedAt ?? b.endAt,
      startOdometer: b.startOdometer,
      endOdometer: b.endOdometer,
      swaps: mid.length,
      totalKm: b.totalKmDriven,
      freeKm: b.freeKmLimit,
      extraKm: b.extraKmCharged,
      extraKmCharged: charged,
      extraKmCollected: collectedKm,
      extraKmOutstanding: r2(charged - collectedKm),
    };
  });
  const vehicleRows = [...perVehicle.entries()]
    .map(([id, e]) => {
      const v = vMap.get(id)!;
      return {
        vehicleId: id,
        publicId: v.publicId,
        regNo: v.regNo,
        name: `${v.make} ${v.model}`,
        branchName: v.branch.name,
        categoryName: v.category.name,
        odometer: v.odo,
        trips: e.trips,
        km: e.km,
        unknownKmTrips: e.unknownKmTrips,
        avgKmPerTrip: e.trips - e.unknownKmTrips > 0 ? r2(e.km / (e.trips - e.unknownKmTrips)) : null,
        extraKm: e.extraKm,
        extraKmCharged: e.charged,
        extraKmCollected: e.collected,
      };
    })
    .sort((a, b) => b.km - a.km);
  const knownTrips = trips.filter((t) => t.totalKm != null);
  const totalKm = knownTrips.reduce((s, t) => s + (t.totalKm ?? 0), 0);
  return {
    totals: {
      trips: trips.length,
      tripsWithKm: knownTrips.length,
      totalKm,
      avgKmPerTrip: knownTrips.length ? r2(totalKm / knownTrips.length) : null,
      tripsWithExtraKm: trips.filter((t) => (t.extraKm ?? 0) > 0).length,
      extraKm: trips.reduce((s, t) => s + (t.extraKm ?? 0), 0),
      extraKmCharged: r2(trips.reduce((s, t) => s + t.extraKmCharged, 0)),
      extraKmCollected: r2(trips.reduce((s, t) => s + t.extraKmCollected, 0)),
      extraKmOutstanding: r2(trips.reduce((s, t) => s + t.extraKmOutstanding, 0)),
    },
    vehicles: vehicleRows,
    trips,
  };
}

// ── 5.1 Damage ────────────────────────────────────────────────────────────

export async function computeDamage(scope: FleetScope, previous?: { start: Date; end: Date }) {
  const vehicles = await loadScopeVehicles({ ...scope });
  const cur = await damageFor(scope, vehicles);
  const prev = previous ? await damageFor({ ...scope, from: previous.start, to: previous.end }, vehicles) : null;
  return {
    ...cur,
    previousTotals: prev?.totals ?? null,
    notes: [
      "Damages = damage reports logged in the range (drop damage and manager-reviewed reports).",
      "Charged to customer = the final cost (estimated cost while the report is still pending is shown separately and not counted). Recovered = money collected for damages on the booking (payments allocated like the Branch Manager Financials view, plus a deposit set off on the drop bill), split over the booking's reports by amount.",
      "Payments are not itemised per charge: a lump-sum balance payment is split over the bill's itemised lines (Branch Manager Financials rule). A damage settled on a legacy (pre-ledger) drop bill — by its deposit set-off or a balance payment — is not an itemised line there, so it shows as unrecovered.",
      "Repair cost = Repair expenses an admin linked to the report. Reports without one show 'not recorded' and are left out of the repair-cost vs recovered difference.",
    ],
  };
}

async function damageFor(scope: FleetScope, vehicles: FleetVehicle[]) {
  const ids = vehicles.map((v) => v.id);
  const reports = ids.length
    ? await prisma.damageReport.findMany({
        where: { vehicleId: { in: ids }, createdAt: { gte: scope.from, lte: scope.to }, booking: { deletedAt: null } },
        select: {
          id: true,
          publicId: true,
          bookingId: true,
          severity: true,
          estimatedCost: true,
          finalCost: true,
          chargeType: true,
          status: true,
          disposition: true,
          chargedAtDrop: true,
          createdAt: true,
          booking: { select: { publicId: true, customer: { select: { user: { select: { name: true } } } } } },
          vehicle: { select: { publicId: true, regNo: true, make: true, model: true, branch: { select: { name: true } }, category: { select: { name: true } } } },
          expenses: { where: { deletedAt: null, category: "REPAIR" }, select: { amount: true } },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const collected = await getChargedVsCollectedByBooking([...new Set(reports.map((r) => r.bookingId))], ["DAMAGES"]);
  const chargedOf = (r: (typeof reports)[number]) =>
    r.status === "APPROVED" || r.chargedAtDrop ? Number(r.finalCost ?? (r.chargedAtDrop ? r.estimatedCost : 0)) : 0;
  const bookingCharged = new Map<number, number>();
  for (const r of reports) bookingCharged.set(r.bookingId, (bookingCharged.get(r.bookingId) ?? 0) + chargedOf(r));
  const countPerBooking = new Map<number, number>();
  for (const r of reports) countPerBooking.set(r.bookingId, (countPerBooking.get(r.bookingId) ?? 0) + 1);
  const rows = reports.map((r) => {
    const charged = r2(chargedOf(r));
    const bCharged = bookingCharged.get(r.bookingId) ?? 0;
    const bCollected = collected.get(r.bookingId)?.DAMAGES?.collected ?? 0;
    const share = bCharged > 0 ? charged / bCharged : 1 / (countPerBooking.get(r.bookingId) ?? 1);
    const recovered = r2(bCollected * share);
    const repairCost = r.expenses.length ? r2(r.expenses.reduce((s, e) => s + Number(e.amount), 0)) : null;
    return {
      damageReportId: r.id,
      publicId: r.publicId,
      loggedAt: r.createdAt,
      bookingPublicId: r.booking.publicId,
      customerName: r.booking.customer?.user?.name ?? "",
      vehiclePublicId: r.vehicle.publicId,
      regNo: r.vehicle.regNo,
      vehicleName: `${r.vehicle.make} ${r.vehicle.model}`,
      branchName: r.vehicle.branch.name,
      categoryName: r.vehicle.category.name,
      severity: r.severity,
      chargeType: r.chargeType,
      status: r.status,
      disposition: r.disposition,
      chargedAtDrop: r.chargedAtDrop,
      estimatedCost: r2(Number(r.estimatedCost)),
      chargedToCustomer: charged,
      recovered,
      unrecovered: r2(charged - recovered),
      repairCost,
      /** repair cost − recovered (positive = the business bore the gap); null = repair cost not recorded */
      difference: repairCost == null ? null : r2(repairCost - recovered),
    };
  });
  const sum = (f: (r: (typeof rows)[number]) => number) => r2(rows.reduce((s, r) => s + f(r), 0));
  const withRepair = rows.filter((r) => r.repairCost != null);
  return {
    totals: {
      damages: rows.length,
      pending: rows.filter((r) => r.status === "PENDING").length,
      pendingEstimated: sum((r) => (r.status === "PENDING" && !r.chargedAtDrop ? r.estimatedCost : 0)),
      chargedToCustomer: sum((r) => r.chargedToCustomer),
      recovered: sum((r) => r.recovered),
      unrecovered: sum((r) => r.unrecovered),
      withRepairCost: withRepair.length,
      repairCost: r2(withRepair.reduce((s, r) => s + (r.repairCost ?? 0), 0)),
      recoveredOnRepaired: r2(withRepair.reduce((s, r) => s + r.recovered, 0)),
      difference: r2(withRepair.reduce((s, r) => s + (r.difference ?? 0), 0)),
    },
    rows,
  };
}

// ── 6.1 Document expiry ───────────────────────────────────────────────────

export interface DocExpiryRow {
  vehiclePublicId: string;
  regNo: string;
  make: string;
  model: string;
  branchName: string;
  categoryName: string;
  vehicleStatus: string;
  docType: DocType;
  expiryDate: Date;
  daysLeft: number;
  status: Exclude<DocStatus, "VALID">;
}

export const DOC_LABELS: Record<DocType, string> = {
  INSURANCE: "Insurance",
  RC: "RC",
  PERMIT: "Permit",
  PUC: "PUC",
  FITNESS: "Fitness",
};
export const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  EXPIRED: "Expired",
  EXPIRING_7: "Expiring ≤7d",
  EXPIRING_30: "Expiring ≤30d",
  VALID: "Valid",
};

/**
 * Expired documents + documents expiring within `withinDays` (default 30), for
 * active (non-deleted, non-inactive) vehicles. Insurance = the latest
 * VehicleInsurance.validTill, else Vehicle.insuranceExpiry. RC / permit / PUC /
 * fitness = the Vehicle columns (null = not recorded, counted in `notRecorded`).
 */
export async function getDocumentExpiry(opts: {
  branchPublicId?: string | null;
  categoryPublicIds?: string[];
  vehiclePublicId?: string | null;
  withinDays?: number;
  docTypes?: DocType[];
  now?: Date;
}) {
  const now = opts.now ?? new Date();
  const within = opts.withinDays ?? 30;
  const types: DocType[] = opts.docTypes?.length ? opts.docTypes : ["INSURANCE", "RC", "PERMIT", "PUC", "FITNESS"];
  const where: Prisma.VehicleWhereInput = { deletedAt: null, status: { not: "INACTIVE" } };
  if (opts.branchPublicId) where.branch = { publicId: opts.branchPublicId };
  if (opts.categoryPublicIds?.length) where.category = { publicId: { in: opts.categoryPublicIds } };
  if (opts.vehiclePublicId) where.publicId = opts.vehiclePublicId;
  const vehicles = await prisma.vehicle.findMany({
    where,
    select: {
      publicId: true,
      regNo: true,
      make: true,
      model: true,
      status: true,
      insuranceExpiry: true,
      rcExpiry: true,
      permitExpiry: true,
      pucExpiry: true,
      fitnessExpiry: true,
      branch: { select: { name: true } },
      category: { select: { name: true } },
      insuranceRecords: { orderBy: { validTill: "desc" }, take: 1, select: { validTill: true } },
    },
  });
  const rows: DocExpiryRow[] = [];
  const notRecorded: Record<DocType, number> = { INSURANCE: 0, RC: 0, PERMIT: 0, PUC: 0, FITNESS: 0 };
  for (const v of vehicles) {
    const dates: Record<DocType, Date | null> = {
      INSURANCE: v.insuranceRecords[0]?.validTill ?? v.insuranceExpiry,
      RC: v.rcExpiry,
      PERMIT: v.permitExpiry,
      PUC: v.pucExpiry,
      FITNESS: v.fitnessExpiry,
    };
    for (const t of types) {
      const d = dates[t];
      if (!d) {
        notRecorded[t] += 1;
        continue;
      }
      const { daysLeft, status } = docStatus(d, now);
      if (status === "VALID" || daysLeft > within) continue;
      rows.push({
        vehiclePublicId: v.publicId,
        regNo: v.regNo,
        make: v.make,
        model: v.model,
        branchName: v.branch.name,
        categoryName: v.category.name,
        vehicleStatus: v.status,
        docType: t,
        expiryDate: d,
        daysLeft,
        status,
      });
    }
  }
  rows.sort((a, b) => a.daysLeft - b.daysLeft || a.regNo.localeCompare(b.regNo));
  const byType = Object.fromEntries(
    types.map((t) => [
      t,
      {
        expired: rows.filter((r) => r.docType === t && r.status === "EXPIRED").length,
        expiring: rows.filter((r) => r.docType === t && r.status !== "EXPIRED").length,
        notRecorded: notRecorded[t],
      },
    ]),
  ) as Partial<Record<DocType, { expired: number; expiring: number; notRecorded: number }>>;
  return {
    asOf: now,
    withinDays: within,
    vehicles: vehicles.length,
    summary: {
      expired: rows.filter((r) => r.status === "EXPIRED").length,
      expiring7: rows.filter((r) => r.status === "EXPIRING_7").length,
      expiring30: rows.filter((r) => r.status === "EXPIRING_30").length,
      total: rows.length,
    },
    byType,
    notRecorded,
    rows,
  };
}

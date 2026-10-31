/**
 * 2.1 Revenue Summary — rules in booking-finance.ts (revenue recognised on
 * Booking.startAt; rent + extras − goodwill; bookingValue = Sales totalFinal).
 *
 * Attribution: branch = Booking.branch; category / vehicle = the vehicle on the
 * booking's BookingItem at report time (after any swap — a swapped rental is not
 * split between cars). A booking with several items is split equally between them.
 */
import { prisma } from "@repo/database/client";
import {
  applyVehicleToBookingWhere,
  buildBookingWhere,
  computeDelta,
  enumerateIstBuckets,
  istBucketIndexer,
  type Delta,
  type PeriodGroupBy,
} from "../../../utils/reporting/index.js";
import { getRevenueByBooking, REVENUE_STATUSES, type BookingRevenue } from "./booking-finance.js";

export interface FinanceScope {
  branchPublicId?: string | null;
  categoryPublicIds?: string[];
  vehiclePublicId?: string | null;
}
export interface FinanceRange extends FinanceScope {
  start: Date;
  end: Date;
}

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface RevenueRow extends BookingRevenue {
  bookingId: number;
  bookingPublicId: string;
  startAt: Date;
  endAt: Date;
  status: string;
  branchId: number;
  branchName: string;
  customerName: string;
  customerPhone: string | null;
  vehicles: Array<{ vehicleId: number; publicId: string; regNo: string; name: string; categoryId: number; categoryPublicId: string; categoryName: string }>;
}

/** Revenue-status bookings in the range + scope, with their revenue split. */
export async function loadRevenueRows(f: FinanceRange): Promise<RevenueRow[]> {
  const where = applyVehicleToBookingWhere(
    buildBookingWhere({
      branchPublicId: f.branchPublicId,
      categoryPublicIds: f.categoryPublicIds ?? [],
      from: f.start,
      to: f.end,
      statuses: REVENUE_STATUSES,
    }),
    f.vehiclePublicId,
  );
  const bookings = await prisma.booking.findMany({
    where,
    orderBy: { startAt: "desc" },
    select: {
      id: true,
      publicId: true,
      startAt: true,
      endAt: true,
      status: true,
      branchId: true,
      branch: { select: { name: true } },
      customer: { select: { user: { select: { name: true, phone: true } } } },
      items: {
        select: {
          vehicle: {
            select: {
              id: true,
              publicId: true,
              regNo: true,
              make: true,
              model: true,
              category: { select: { id: true, publicId: true, name: true } },
            },
          },
        },
      },
    },
  });
  const revenue = await getRevenueByBooking(bookings.map((b) => b.id));
  return bookings.map((b) => {
    const rev = revenue.get(b.id)!;
    return {
      ...rev,
      bookingId: b.id,
      bookingPublicId: b.publicId,
      startAt: b.startAt,
      endAt: b.endAt,
      status: b.status,
      branchId: b.branchId,
      branchName: b.branch.name,
      customerName: b.customer.user.name,
      customerPhone: b.customer.user.phone ?? null,
      vehicles: b.items.map((it) => ({
        vehicleId: it.vehicle.id,
        publicId: it.vehicle.publicId,
        regNo: it.vehicle.regNo,
        name: `${it.vehicle.make} ${it.vehicle.model}`.trim(),
        categoryId: it.vehicle.category.id,
        categoryPublicId: it.vehicle.category.publicId,
        categoryName: it.vehicle.category.name,
      })),
    };
  });
}

export interface RevenueTotals {
  total: number;
  bookingValue: number;
  rent: number;
  extras: number;
  deposit: number;
  goodwill: number;
  gst: number;
  /** total − gst (GST-exclusive; pre-Oct-3 taxable drop GST is not split out) */
  netOfGst: number;
  bookings: number;
  averagePerBooking: number;
}

export function sumRevenue(rows: Array<BookingRevenue>): RevenueTotals {
  const t = { total: 0, bookingValue: 0, rent: 0, extras: 0, deposit: 0, goodwill: 0, gst: 0 };
  for (const r of rows) {
    t.total += r.revenue;
    t.bookingValue += r.bookingValue;
    t.rent += r.rent;
    t.extras += r.extras;
    t.deposit += r.deposit;
    t.goodwill += r.goodwill;
    t.gst += r.gst;
  }
  const total = r2(t.total);
  return {
    total,
    bookingValue: r2(t.bookingValue),
    rent: r2(t.rent),
    extras: r2(t.extras),
    deposit: r2(t.deposit),
    goodwill: r2(t.goodwill),
    gst: r2(t.gst),
    netOfGst: r2(t.total - t.gst),
    bookings: rows.length,
    averagePerBooking: rows.length ? r2(total / rows.length) : 0,
  };
}

/** THE revenue figure (dashboard + Revenue Summary). */
export async function computeRevenue(f: FinanceRange): Promise<RevenueTotals> {
  return sumRevenue(await loadRevenueRows(f));
}

export interface RevenueGroup {
  key: string;
  label: string;
  revenue: number;
  rent: number;
  extras: number;
  bookings: number;
}

type GroupAcc = Map<string, RevenueGroup>;
const add = (acc: GroupAcc, key: string, label: string, r: BookingRevenue, share: number) => {
  const g = acc.get(key) ?? { key, label, revenue: 0, rent: 0, extras: 0, bookings: 0 };
  g.revenue += r.revenue * share;
  g.rent += r.rent * share;
  g.extras += r.extras * share;
  g.bookings += share;
  acc.set(key, g);
};
const finish = (acc: GroupAcc): RevenueGroup[] =>
  [...acc.values()]
    .map((g) => ({ ...g, revenue: r2(g.revenue), rent: r2(g.rent), extras: r2(g.extras), bookings: r2(g.bookings) }))
    .sort((a, b) => b.revenue - a.revenue);

/** Per-vehicle revenue (equal split across a booking's items). Used by rpt-fleet 4.3. */
export function groupByVehicle(rows: RevenueRow[]): RevenueGroup[] {
  const acc: GroupAcc = new Map();
  for (const r of rows) {
    const share = r.vehicles.length ? 1 / r.vehicles.length : 1;
    if (r.vehicles.length === 0) add(acc, "none", "No vehicle recorded", r, 1);
    for (const v of r.vehicles) add(acc, v.publicId, `${v.regNo} · ${v.name}`, r, share);
  }
  return finish(acc);
}

export function groupByCategory(rows: RevenueRow[]): RevenueGroup[] {
  const acc: GroupAcc = new Map();
  for (const r of rows) {
    const share = r.vehicles.length ? 1 / r.vehicles.length : 1;
    if (r.vehicles.length === 0) add(acc, "none", "No vehicle recorded", r, 1);
    for (const v of r.vehicles) add(acc, v.categoryPublicId, v.categoryName, r, share);
  }
  return finish(acc);
}

export function groupByBranch(rows: RevenueRow[]): RevenueGroup[] {
  const acc: GroupAcc = new Map();
  for (const r of rows) add(acc, String(r.branchId), r.branchName, r, 1);
  return finish(acc);
}

/** Revenue per vehicle id for a range + scope (rpt-fleet). */
export async function revenueByVehicle(f: FinanceRange): Promise<Map<number, { revenue: number; rent: number; extras: number; bookings: number }>> {
  const rows = await loadRevenueRows(f);
  const out = new Map<number, { revenue: number; rent: number; extras: number; bookings: number }>();
  for (const r of rows) {
    const share = r.vehicles.length ? 1 / r.vehicles.length : 0;
    for (const v of r.vehicles) {
      const e = out.get(v.vehicleId) ?? { revenue: 0, rent: 0, extras: 0, bookings: 0 };
      e.revenue = r2(e.revenue + r.revenue * share);
      e.rent = r2(e.rent + r.rent * share);
      e.extras = r2(e.extras + r.extras * share);
      e.bookings = r2(e.bookings + share);
      out.set(v.vehicleId, e);
    }
  }
  return out;
}

export interface RevenueTrendPoint {
  key: string;
  label: string;
  from: string;
  to: string;
  revenue: number;
  rent: number;
  extras: number;
  bookings: number;
}

export function revenueTrend(rows: RevenueRow[], range: { start: Date; end: Date }, groupBy: PeriodGroupBy): RevenueTrendPoint[] {
  const buckets = enumerateIstBuckets(range, groupBy);
  const idx = istBucketIndexer(range, groupBy, buckets);
  const points = buckets.map((b) => ({ ...b, revenue: 0, rent: 0, extras: 0, bookings: 0 }));
  for (const r of rows) {
    const i = idx(r.startAt);
    if (i < 0) continue;
    const p = points[i]!;
    p.revenue += r.revenue;
    p.rent += r.rent;
    p.extras += r.extras;
    p.bookings += 1;
  }
  return points.map((p) => ({ ...p, revenue: r2(p.revenue), rent: r2(p.rent), extras: r2(p.extras) }));
}

export function revenueDeltas(cur: RevenueTotals, prev: RevenueTotals): Record<string, Delta> {
  return {
    total: computeDelta(cur.total, prev.total),
    rent: computeDelta(cur.rent, prev.rent),
    extras: computeDelta(cur.extras, prev.extras),
    bookings: computeDelta(cur.bookings, prev.bookings),
    averagePerBooking: computeDelta(cur.averagePerBooking, prev.averagePerBooking),
    bookingValue: computeDelta(cur.bookingValue, prev.bookingValue),
  };
}

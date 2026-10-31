import type { Request, Response } from "express";
import { DateTime } from "luxon";
import { prisma, BookingStatus, Prisma } from "@repo/database/client";
import {
  parseReportFilters,
  handleReportError,
  previousPeriod,
  resolvePresetDays,
  computeDelta,
  parseIstDate,
  bookingScopeFromFilters,
  vehicleWhereFromFilters,
  type ReportFilters,
} from "../../../utils/reporting/index.js";
import { SYSTEM_TIMEZONE } from "../../../services/timezone/timezone.service.js";
import { computeRevenue, type RevenueTotals } from "../../../services/reporting/finance/revenue.js";
import { getOutstandingDues } from "../../../services/reporting/finance/dues.js";
import { computeUtilization } from "../../../services/reporting/fleet/fleet.service.js";
import { getDocumentExpiry } from "../../../services/reporting/fleet/fleet.service.js";
import { listOverdueReturns } from "../../../services/booking/overdue-returns.service.js";

/**
 * GET /api/admin/dashboard/reports/home — Dashboard Home (client spec §1).
 *
 * Query: branchId, categories, vehicleId (shared report filters; dates are fixed:
 * today + month-to-date, IST), refresh=1 bypasses the short cache.
 *
 * Business rules (single sources of truth, never re-derived here):
 *  - Revenue  = rpt-finance computeRevenue (= Revenue Summary 2.1): rent (totalFinal −
 *               refundable category deposit, GST-inclusive, after discounts, confirmed
 *               extensions) + drop extras (late fee, extra km, damage charged at drop,
 *               net of drop discount) − goodwill refunds; bookings CONFIRMED/PICKED_UP/
 *               RETURNED anchored on startAt (IST day). `bookingValue` = Σ totalFinal on
 *               the same bookings = the Sales report figure (Sales↔Dashboard invariant).
 *  - MTD vs   = 1st of this month → today vs the same days of the previous month
 *               (clipped to its length) — previousPeriod().
 *  - Fleet    = Vehicle.status snapshot (non-deleted): OUT_FOR_RENTAL on rent, AVAILABLE,
 *               MAINTENANCE under maintenance, MANAGER_REPORTED awaiting damage review
 *               (shown with maintenance), INACTIVE excluded from the fleet.
 *  - Utilization = rpt-fleet computeUtilization for this month (Σ rented ÷ Σ available
 *               days; maintenance/unavailable days excluded from available).
 *  - Pickups/returns today = bookings scheduled to start / end today (IST); done =
 *               picked up / returned (or drop recorded awaiting the manager).
 *  - Overdue  = the Fleet/BM overdue rule (listOverdueReturns): PICKED_UP past endAt,
 *               not back yet (excludes drops awaiting manager confirmation).
 *  - Dues     = rpt-finance getOutstandingDues (= Outstanding Dues 2.3), snapshot now.
 *  - Documents = rpt-fleet getDocumentExpiry (= 6.1), next 30 days.
 * Read-only. Aggregates are SQL counts/aggregates or the shared report services.
 */

const CACHE_TTL_MS = 20_000;
const cache = new Map<string, { at: number; body: unknown }>();

const NOT_TRACKED = {
  servicing:
    "Not tracked yet: the system records past services (VehicleMaintenanceRecord: date, cost, description) but no next-service due date or km interval, so upcoming servicing can't be computed.",
  challans:
    "Not tracked yet: traffic fines / challans are not recorded anywhere in the system (no challan table or field).",
};

const ist = (d: Date) => DateTime.fromJSDate(d, { zone: SYSTEM_TIMEZONE });

const revenueBlock = (r: RevenueTotals) => ({
  total: r.total,
  bookingValue: r.bookingValue,
  rent: r.rent,
  extras: r.extras,
  deposit: r.deposit,
  goodwill: r.goodwill,
  bookings: r.bookings,
});

export const buildDashboardHome = async (f: ReportFilters, now = new Date()) => {
  const nowIst = ist(now);
  const todayStr = nowIst.toFormat("yyyy-MM-dd");
  const todayStart = parseIstDate(todayStr)!.startOf("day").toJSDate();
  const todayEnd = parseIstDate(todayStr)!.endOf("day").toJSDate();
  const mtd = resolvePresetDays("thisMonth", nowIst);
  const mtdStart = parseIstDate(mtd.from)!.startOf("day").toJSDate();
  const prev = previousPeriod({ from: mtd.from, to: mtd.to, preset: "thisMonth", now: nowIst });

  const scope = {
    branchPublicId: f.branchPublicId,
    categoryPublicIds: f.categoryPublicIds,
    vehiclePublicId: f.vehiclePublicId,
  };
  const bookingScope = bookingScopeFromFilters(f);
  const vehicleScope = vehicleWhereFromFilters(f, { includeInactive: true });

  const opStatuses: BookingStatus[] = [BookingStatus.CONFIRMED, BookingStatus.PICKED_UP, BookingStatus.RETURNED];
  const and = (...w: Prisma.BookingWhereInput[]): Prisma.BookingWhereInput => ({ AND: [bookingScope, ...w] });

  const [
    revToday,
    revMtd,
    revPrev,
    vehicleStatus,
    pickupsScheduled,
    pickupsDone,
    returnsScheduled,
    returnsDone,
    dues,
    utilization,
    docs,
    branches,
    scopedVehicleIds,
  ] = await Promise.all([
    computeRevenue({ ...scope, start: todayStart, end: todayEnd }),
    computeRevenue({ ...scope, start: mtdStart, end: todayEnd }),
    computeRevenue({ ...scope, start: prev.start, end: prev.end }),
    prisma.vehicle.groupBy({ by: ["status"], where: vehicleScope, _count: { _all: true } }),
    prisma.booking.count({ where: and({ status: { in: opStatuses }, startAt: { gte: todayStart, lte: todayEnd } }) }),
    prisma.booking.count({
      where: and({ status: { in: [BookingStatus.PICKED_UP, BookingStatus.RETURNED] }, startAt: { gte: todayStart, lte: todayEnd } }),
    }),
    prisma.booking.count({
      where: and({ status: { in: [BookingStatus.PICKED_UP, BookingStatus.RETURNED] }, endAt: { gte: todayStart, lte: todayEnd } }),
    }),
    prisma.booking.count({
      where: and({
        endAt: { gte: todayStart, lte: todayEnd },
        OR: [
          { status: BookingStatus.RETURNED },
          { status: BookingStatus.PICKED_UP, requiresManagerConfirmation: true },
        ],
      }),
    }),
    getOutstandingDues({ ...scope, now }),
    computeUtilization({ ...scope, from: mtdStart, to: todayEnd, now }),
    getDocumentExpiry({ ...scope, withinDays: 30, now }),
    prisma.branch.findMany({
      where: { deletedAt: null, ...(f.branchPublicId ? { publicId: f.branchPublicId } : {}) },
      select: { id: true, publicId: true, name: true },
    }),
    f.categoryPublicIds.length || f.vehiclePublicId
      ? prisma.vehicle.findMany({ where: vehicleScope, select: { id: true } }).then((v) => v.map((x) => x.id))
      : Promise.resolve(undefined),
  ]);

  // Overdue: the Fleet / BM rule, per branch in scope.
  const overdueLists = await Promise.all(
    branches.map((b) => listOverdueReturns(b.id, { now, limit: 5, vehicleIds: scopedVehicleIds })),
  );
  let overdueCount = 0;
  const overdueRows: Array<{ publicId: string; branchName: string; customer: string | null; regNo: string | null; endAt: Date; overdueMinutes: number }> = [];
  overdueLists.forEach((l, i) => {
    overdueCount += l.overdueCount;
    for (const r of l.data) {
      if (r.returnState !== "OVERDUE" && r.returnState !== "IN_GRACE") continue;
      overdueRows.push({
        publicId: r.publicId,
        branchName: branches[i]!.name,
        customer: r.customer.name,
        regNo: r.vehicles[0]?.regNo ?? null,
        endAt: r.endAt,
        overdueMinutes: r.overdueMinutes,
      });
    }
  });
  overdueRows.sort((a, b) => b.overdueMinutes - a.overdueMinutes);

  const statusCount = (s: string) => vehicleStatus.find((v) => v.status === s)?._count._all ?? 0;
  const onRent = statusCount("OUT_FOR_RENTAL");
  const available = statusCount("AVAILABLE");
  const maintenance = statusCount("MAINTENANCE");
  const reported = statusCount("MANAGER_REPORTED");
  const inactive = statusCount("INACTIVE");

  return {
    asOf: now.toISOString(),
    filters: scope,
    periods: {
      today: { from: todayStr, to: todayStr, label: "Today" },
      mtd: { from: mtd.from, to: mtd.to, label: prev.currentLabel },
      previousMtd: { from: prev.from, to: prev.to, label: prev.label },
    },
    revenue: {
      today: revenueBlock(revToday),
      mtd: revenueBlock(revMtd),
      previousMtd: revenueBlock(revPrev),
      mtdDelta: computeDelta(revMtd.total, revPrev.total),
      bookingValueDelta: computeDelta(revMtd.bookingValue, revPrev.bookingValue),
      rule:
        "Revenue = rent (booking total − refundable deposit, GST-inclusive, after discounts, incl. confirmed extensions) + drop extras (late fee, extra km, damage) − goodwill refunds, for confirmed/active/completed bookings by start date (IST). Booking value = the Sales report figure.",
    },
    fleet: {
      total: onRent + available + maintenance + reported,
      onRent,
      available,
      maintenance,
      reported,
      inactive,
      rule: "Live vehicle status. 'Under maintenance' includes vehicles awaiting a damage review (manager-reported). Inactive vehicles are not counted.",
    },
    utilization: {
      pct: utilization.totals.utilizationPct,
      rentedDays: utilization.totals.rentedDays,
      availableDays: utilization.totals.availableDays,
      downtimeDays: utilization.totals.downtimeDays,
      untrackedDays: utilization.totals.untrackedDays,
      vehicles: utilization.totals.vehicles,
      from: mtd.from,
      to: mtd.to,
      notes: utilization.notes,
    },
    today: {
      pickupsScheduled,
      pickupsDone,
      pickupsPending: pickupsScheduled - pickupsDone,
      returnsScheduled,
      returnsDone,
      returnsPending: returnsScheduled - returnsDone,
    },
    overdue: { count: overdueCount, top: overdueRows.slice(0, 5) },
    dues: {
      total: dues.total,
      customers: dues.customers,
      bookings: dues.bookings,
      awaitingConfirmation: dues.awaitingConfirmation,
      buckets: dues.buckets,
    },
    alerts: {
      documents: {
        tracked: true,
        withinDays: 30,
        ...docs.summary,
        notRecorded: docs.notRecorded,
        top: docs.rows.slice(0, 5).map((r) => ({
          regNo: r.regNo,
          docType: r.docType,
          expiryDate: r.expiryDate,
          daysLeft: r.daysLeft,
          status: r.status,
        })),
      },
      servicing: { tracked: false, note: NOT_TRACKED.servicing },
      challans: { tracked: false, note: NOT_TRACKED.challans },
    },
  };
};

export const GetDashboardHome = async (req: Request, res: Response) => {
  try {
    const f = parseReportFilters(req.query as Record<string, unknown>, { defaultPreset: "thisMonth" });
    const key = JSON.stringify([f.branchPublicId, f.categoryPublicIds, f.vehiclePublicId]);
    const hit = cache.get(key);
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    if (hit && !refresh && Date.now() - hit.at < CACHE_TTL_MS) {
      res.setHeader("X-Cache", "HIT");
      return res.json(hit.body);
    }
    const body = await buildDashboardHome(f);
    cache.set(key, { at: Date.now(), body });
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
    res.setHeader("X-Cache", "MISS");
    return res.json(body);
  } catch (err) {
    handleReportError(res, err, "dashboard");
  }
};

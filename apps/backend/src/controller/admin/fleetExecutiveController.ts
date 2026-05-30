import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus } from "@repo/database/client";
import { exportFleetExecutiveToExcel } from "../../utils/exportToExcel.js";
import {
  buildBookingWhere,
  getPaidByBooking,
  getCollections,
  REVENUE_BOOKING_STATUSES,
  exportRowsToCSV,
  summaryRow,
  csvCurrency,
} from "../../utils/reporting/index.js";

/**
 * Fleet Executive Report Controller
 * GET /api/dashboard/reports/fleet-executive
 *
 * Spec §4.8 — PER-STAFF report. One row per executive (= booking.createdById,
 * with collectors folded in so collected cash never disappears). Each row blends
 * two lenses on a staff member's activity in the range:
 *   - Bookings / Revenue / Outstanding / Cancellations: keyed on createdById
 *     (the "executive" who created the booking — no assigned_staff field exists).
 *   - Cash / UPI collected: keyed on PaymentTransaction.collectedById.
 *
 * Rows are the UNION of createdById ∪ collectedById in range so that a staff
 * member who only collected payments (created no bookings) still appears with
 * their cash, and `executivesSummary` reconciles with the Collection report.
 * createdById is non-null in schema, so the "Unassigned" row is defensive only.
 *
 * BACKWARD COMPAT: the legacy branch/category performance report (kpis,
 * branchPerformance, categoryPerformance, operationalMetrics) is PRESERVED
 * unchanged so the existing FleetExecutiveReport.tsx keeps working. The new
 * per-staff rows are ADDED as `executives` + `executivesSummary`. The xlsx
 * export still consumes the legacy shape; only the CSV branch is replaced with a
 * spec §4.8-ordered per-staff export.
 *
 * Query Parameters:
 * - startDate: string (required) - Format: YYYY-MM-DD
 * - endDate: string (required) - Format: YYYY-MM-DD
 * - branchId | branch: string (optional) - branch publicId, or "all"
 * - executiveId | executive: string (optional) - staff User publicId, or "all"
 * - export: 'xlsx' | 'csv' (optional)
 */

const UNASSIGNED_KEY = "unassigned";

interface ExecutiveRow {
  executiveId: string; // User publicId, or "unassigned"
  executiveName: string;
  branchName: string;
  bookingsHandled: number;
  totalRevenue: number;
  cashCollected: number;
  upiCollected: number;
  outstanding: number;
  cancellations: number;
}

export const GetFleetExecutiveReport = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, export: exportFormat } = req.query;

    if (!startDate || !endDate) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Start date and end date are required",
      });
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const branchPublicId =
      req.query.branchId && String(req.query.branchId) !== "all"
        ? String(req.query.branchId)
        : req.query.branch && String(req.query.branch) !== "all"
          ? String(req.query.branch)
          : undefined;

    const executivePublicId =
      req.query.executiveId && String(req.query.executiveId) !== "all"
        ? String(req.query.executiveId)
        : req.query.executive && String(req.query.executive) !== "all"
          ? String(req.query.executive)
          : undefined;

    // Resolve the Executive/Staff filter (publicId -> internal id) once.
    let executiveFilterId: number | undefined;
    if (executivePublicId) {
      const u = await prisma.user.findUnique({
        where: { publicId: executivePublicId },
        select: { id: true },
      });
      // Unknown publicId -> an id that matches nothing, yielding an empty report.
      executiveFilterId = u?.id ?? -1;
    }

    // ========================================================================
    // PER-STAFF report (spec §4.8) — the new primary output.
    // ========================================================================

    // Revenue bookings (revenue statuses, startAt in range, branch filter) —
    // group by createdById for bookings handled, revenue and outstanding.
    const revenueBookings = await prisma.booking.findMany({
      where: {
        ...buildBookingWhere({
          branchPublicId,
          from: start,
          to: end,
          statuses: REVENUE_BOOKING_STATUSES,
        }),
        ...(executiveFilterId !== undefined
          ? { createdById: executiveFilterId }
          : {}),
      },
      select: { id: true, createdById: true, totalFinal: true },
    });

    const paidMap = await getPaidByBooking(revenueBookings.map((b) => b.id));

    // Cancelled bookings (separate query — CANCELLED is excluded from the
    // revenue set, anchored on startAt per the task) grouped by createdById.
    const cancelledBookings = await prisma.booking.findMany({
      where: {
        ...buildBookingWhere({
          branchPublicId,
          from: start,
          to: end,
          statuses: [BookingStatus.CANCELLED],
        }),
        ...(executiveFilterId !== undefined
          ? { createdById: executiveFilterId }
          : {}),
      },
      select: { id: true, createdById: true },
    });

    // Collections (money received in range, payment-date anchored) grouped by
    // collectedById. UPI column = full online portion (upi + gateway) so
    // Cash + UPI == total collected (UPI-vs-gateway split is a known heuristic).
    const collections = await getCollections({
      branchPublicId,
      from: start,
      to: end,
      collectedById: executiveFilterId,
    });

    // --- Aggregate per staff key (numeric user id, or UNASSIGNED_KEY) ---
    const keyOf = (id: number | null | undefined): string =>
      id === null || id === undefined ? UNASSIGNED_KEY : String(id);

    interface Agg {
      userId: number | null;
      bookingsHandled: number;
      totalRevenue: number;
      outstanding: number;
      cancellations: number;
      cashCollected: number;
      upiCollected: number;
    }
    const aggByKey = new Map<string, Agg>();
    const ensure = (id: number | null): Agg => {
      const key = keyOf(id);
      let a = aggByKey.get(key);
      if (!a) {
        a = {
          userId: id ?? null,
          bookingsHandled: 0,
          totalRevenue: 0,
          outstanding: 0,
          cancellations: 0,
          cashCollected: 0,
          upiCollected: 0,
        };
        aggByKey.set(key, a);
      }
      return a;
    };

    for (const b of revenueBookings) {
      const a = ensure(b.createdById ?? null);
      const total = Number(b.totalFinal);
      const paid = paidMap.get(b.id)?.total ?? 0;
      a.bookingsHandled += 1;
      a.totalRevenue += total;
      a.outstanding += Math.max(0, total - paid); // per-booking floor
    }

    for (const c of cancelledBookings) {
      const a = ensure(c.createdById ?? null);
      a.cancellations += 1;
    }

    for (const t of collections) {
      const a = ensure(t.collectedById ?? null);
      a.cashCollected += t.cash;
      a.upiCollected += t.upi + t.gateway; // full online portion
    }

    // --- Resolve User name + branch for every key that has a real user id ---
    const userIds = Array.from(aggByKey.values())
      .map((a) => a.userId)
      .filter((id): id is number => id !== null);
    const users =
      userIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: {
              id: true,
              publicId: true,
              name: true,
              branch: { select: { name: true } },
            },
          })
        : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    const executives: ExecutiveRow[] = Array.from(aggByKey.values()).map((a) => {
      const u = a.userId !== null ? userById.get(a.userId) : undefined;
      return {
        executiveId: u?.publicId ?? UNASSIGNED_KEY,
        executiveName: u?.name ?? "Unassigned",
        branchName: u?.branch?.name ?? "—",
        bookingsHandled: a.bookingsHandled,
        totalRevenue: a.totalRevenue,
        cashCollected: a.cashCollected,
        upiCollected: a.upiCollected,
        outstanding: a.outstanding,
        cancellations: a.cancellations,
      };
    });

    // Sort: Total Revenue DESC, with Unassigned always last.
    executives.sort((x, y) => {
      const xUn = x.executiveId === UNASSIGNED_KEY;
      const yUn = y.executiveId === UNASSIGNED_KEY;
      if (xUn !== yUn) return xUn ? 1 : -1;
      return y.totalRevenue - x.totalRevenue;
    });

    const executivesSummary = executives.reduce(
      (s, e) => ({
        executiveCount: s.executiveCount + 1,
        bookingsHandled: s.bookingsHandled + e.bookingsHandled,
        totalRevenue: s.totalRevenue + e.totalRevenue,
        cashCollected: s.cashCollected + e.cashCollected,
        upiCollected: s.upiCollected + e.upiCollected,
        outstanding: s.outstanding + e.outstanding,
        cancellations: s.cancellations + e.cancellations,
      }),
      {
        executiveCount: 0,
        bookingsHandled: 0,
        totalRevenue: 0,
        cashCollected: 0,
        upiCollected: 0,
        outstanding: 0,
        cancellations: 0,
      },
    );

    // ========================================================================
    // LEGACY branch/category performance report — PRESERVED for the frontend.
    // (Unchanged calc; consumed by FleetExecutiveReport.tsx + the xlsx export.)
    // ========================================================================

    const [
      totalVehicles,
      activeBookings,
      completedBookings,
      totalRevenue,
      branches,
      categories,
      damageReports,
      maintenanceRecords,
    ] = await Promise.all([
      prisma.vehicle.count({ where: { deletedAt: null } }),
      prisma.booking.count({
        where: {
          status: { in: ["HOLD", "CONFIRMED", "PICKED_UP"] },
          startAt: { lte: end },
          endAt: { gte: start },
          deletedAt: null,
        },
      }),
      prisma.booking.findMany({
        where: {
          status: "RETURNED",
          endAt: { gte: start, lte: end },
          deletedAt: null,
        },
        include: { invoice: true },
      }),
      prisma.payment.aggregate({
        where: { createdAt: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      prisma.branch.findMany({
        where: { deletedAt: null },
        include: {
          _count: {
            select: { vehicles: { where: { deletedAt: null } } },
          },
        },
      }),
      prisma.vehicleCategory.findMany({
        include: {
          _count: {
            select: { vehicles: { where: { deletedAt: null } } },
          },
        },
      }),
      prisma.damageReport.count({
        where: { createdAt: { gte: start, lte: end } },
      }),
      prisma.vehicleMaintenanceRecord.count({
        where: { servicedAt: { gte: start, lte: end } },
      }),
    ]);

    const totalBookings = completedBookings.length;
    const totalRevenueAmount = Number(totalRevenue._sum.amount || 0);
    const averageBookingValue =
      totalBookings > 0 ? totalRevenueAmount / totalBookings : 0;
    const fleetUtilization =
      totalVehicles > 0 ? (activeBookings / totalVehicles) * 100 : 0;
    const revenuePerVehicle =
      totalVehicles > 0 ? totalRevenueAmount / totalVehicles : 0;

    const branchPerformance = await Promise.all(
      branches.map(async (branch) => {
        const [branchRevenue, branchBookings, branchActiveVehicles] =
          await Promise.all([
            prisma.payment.aggregate({
              where: {
                createdAt: { gte: start, lte: end },
                invoice: {
                  booking: {
                    items: {
                      some: { vehicle: { branchId: branch.id } },
                    },
                  },
                },
              },
              _sum: { amount: true },
            }),
            prisma.booking.count({
              where: {
                status: "RETURNED",
                endAt: { gte: start, lte: end },
                items: { some: { vehicle: { branchId: branch.id } } },
                deletedAt: null,
              },
            }),
            prisma.vehicle.count({
              where: {
                branchId: branch.id,
                status: { in: ["AVAILABLE", "OUT_FOR_RENTAL"] },
                deletedAt: null,
              },
            }),
          ]);

        return {
          branchId: branch.publicId,
          branchName: branch.name,
          totalVehicles: branch._count.vehicles,
          activeVehicles: branchActiveVehicles,
          totalBookings: branchBookings,
          totalRevenue: Number(branchRevenue._sum.amount ?? 0),
          averageBookingValue:
            branchBookings > 0
              ? Number(branchRevenue._sum.amount ?? 0) / branchBookings
              : 0,
          utilization:
            branch._count.vehicles > 0
              ? (branchActiveVehicles / branch._count.vehicles) * 100
              : 0,
        };
      }),
    );

    const categoryPerformance = await Promise.all(
      categories.map(async (category) => {
        const [categoryRevenue, categoryBookings] = await Promise.all([
          prisma.payment.aggregate({
            where: {
              createdAt: { gte: start, lte: end },
              invoice: {
                booking: {
                  items: {
                    some: { vehicle: { categoryId: category.id } },
                  },
                },
              },
            },
            _sum: { amount: true },
          }),
          prisma.booking.count({
            where: {
              status: "RETURNED",
              endAt: { gte: start, lte: end },
              items: { some: { vehicle: { categoryId: category.id } } },
              deletedAt: null,
            },
          }),
        ]);

        return {
          categoryName: category.name,
          totalVehicles: category._count.vehicles,
          totalBookings: categoryBookings,
          totalRevenue: Number(categoryRevenue._sum.amount ?? 0),
          averageBookingValue:
            categoryBookings > 0
              ? Number(categoryRevenue._sum.amount ?? 0) / categoryBookings
              : 0,
        };
      }),
    );

    const operationalMetrics = {
      damageReports,
      maintenanceRecords,
      damageReportRate:
        totalBookings > 0 ? (damageReports / totalBookings) * 100 : 0,
      maintenanceRate:
        totalVehicles > 0 ? (maintenanceRecords / totalVehicles) * 100 : 0,
    };

    // ========================================================================
    // Build response (legacy fields + new per-staff fields)
    // ========================================================================

    const reportData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        dateRange: {
          startDate: start.toISOString().split("T")[0],
          endDate: end.toISOString().split("T")[0],
        },
        filters: {
          branch: branchPublicId ?? "All Branches",
          executive: executivePublicId ?? "All",
        },
      },
      kpis: {
        totalVehicles,
        activeBookings,
        totalBookings,
        totalRevenue: totalRevenueAmount,
        averageBookingValue,
        fleetUtilization,
        revenuePerVehicle,
      },
      branchPerformance: branchPerformance.sort(
        (a, b) => b.totalRevenue - a.totalRevenue,
      ),
      categoryPerformance: categoryPerformance.sort(
        (a, b) => b.totalRevenue - a.totalRevenue,
      ),
      operationalMetrics,
      // NEW — spec §4.8 per-staff report.
      executives,
      executivesSummary,
    };

    // ========================================================================
    // Handle export if requested
    // ========================================================================

    if (exportFormat === "xlsx") {
      const filename = `fleet-executive-${start.toISOString().split("T")[0]}-${end.toISOString().split("T")[0]}`;
      return await exportFleetExecutiveToExcel(res, reportData, filename);
    }

    if (exportFormat === "csv") {
      // Spec §4.8 per-staff CSV: exact column order + a TOTAL summary row.
      const columns = [
        "Executive Name",
        "Branch",
        "Bookings Handled",
        "Total Revenue",
        "Cash Collected",
        "UPI Collected",
        "Outstanding",
        "Cancellations",
      ];
      const rows = executives.map((e) => ({
        "Executive Name": e.executiveName,
        Branch: e.branchName,
        "Bookings Handled": e.bookingsHandled,
        "Total Revenue": csvCurrency(e.totalRevenue),
        "Cash Collected": csvCurrency(e.cashCollected),
        "UPI Collected": csvCurrency(e.upiCollected),
        Outstanding: csvCurrency(e.outstanding),
        Cancellations: e.cancellations,
      }));
      const summary = summaryRow(columns, "TOTAL", {
        "Bookings Handled": executivesSummary.bookingsHandled,
        "Total Revenue": csvCurrency(executivesSummary.totalRevenue),
        "Cash Collected": csvCurrency(executivesSummary.cashCollected),
        "UPI Collected": csvCurrency(executivesSummary.upiCollected),
        Outstanding: csvCurrency(executivesSummary.outstanding),
        Cancellations: executivesSummary.cancellations,
      });
      const filename = `fleet-executive-${start.toISOString().split("T")[0]}-${end.toISOString().split("T")[0]}`;
      return exportRowsToCSV(res, {
        columns,
        rows,
        summaryRows: [summary],
        filename,
      });
    }

    return res.status(StatusCode.OK).json({
      message: "Fleet executive report generated successfully",
      data: reportData,
    });
  } catch (error) {
    console.error("Get Fleet Executive Report Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Failed to generate fleet executive report",
    });
  }
};

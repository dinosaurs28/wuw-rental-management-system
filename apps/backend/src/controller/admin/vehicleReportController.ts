import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, Prisma, VehicleStatus } from "@repo/database/client";
import {
  resolveReportRange,
  parseCategoryIds,
  buildVehicleWhere,
  buildBookingWhere,
  REVENUE_BOOKING_STATUSES,
  exportRowsToCSV,
  summaryRow,
  csvCurrency,
  csvDate,
} from "../../utils/reporting/index.js";

/**
 * Vehicle Reports — per-vehicle list (spec §4.5). NEW report.
 * GET (route added by integrator).
 *
 * One row per vehicle (zero-booking vehicles still listed with 0s):
 * - Filters: branch, date, category, vehicle status (Active / Inactive / All).
 * - Total Bookings: count of revenue-status bookings in range (startAt anchor)
 *   that include this vehicle (via items -> vehicle).
 * - Total Revenue: SUM of BookingItem.finalTotal attributable to the vehicle,
 *   restricted to revenue-status bookings within the range.
 * - Utilisation %: rented days within range (each booking capped to range
 *   boundaries) / available days in range, capped at 100%.
 * - Avg Booking Duration: average rented days per booking in range.
 * Sorted by Total Revenue desc. CSV export in spec §4.5 column order.
 *
 * DATA GAP (documented): there is no vehicle status-history table — only the
 * current Vehicle.status. Historical INACTIVE/MAINTENANCE windows cannot be
 * reconstructed, so "available days" uses the full range length as denominator
 * (utilisation clamped to 100%).
 */

const overlapDays = (
  bStart: Date,
  bEnd: Date,
  rangeStart: Date,
  rangeEnd: Date,
): number => {
  const s = Math.max(bStart.getTime(), rangeStart.getTime());
  const e = Math.min(bEnd.getTime(), rangeEnd.getTime());
  if (e < s) return 0;
  // Inclusive day count, capped to the range.
  const ms = e - s;
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
};

export const GetVehicleReportList = async (req: Request, res: Response) => {
  try {
    const {
      branchId,
      branch,
      categories,
      categoryId,
      vehicleStatus,
      export: exportFormat,
    } = req.query;

    const branchPublicId =
      branchId && String(branchId) !== "all"
        ? String(branchId)
        : branch && String(branch) !== "all"
          ? String(branch)
          : undefined;
    const categoryPublicIds = parseCategoryIds(categories ?? categoryId);

    const { start, end, days } = resolveReportRange({
      preset: req.query.preset,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      from: req.query.from,
      to: req.query.to,
    });

    // Vehicle status filter: Active (default, status != INACTIVE),
    // Inactive (only INACTIVE), All (no status restriction).
    const statusFilter = vehicleStatus
      ? String(vehicleStatus).toLowerCase()
      : "active";
    const includeInactive = statusFilter === "all" || statusFilter === "inactive";
    const vehicleWhere: Prisma.VehicleWhereInput = buildVehicleWhere({
      branchPublicId,
      categoryPublicIds,
      includeInactive,
    });
    if (statusFilter === "inactive") {
      vehicleWhere.status = VehicleStatus.INACTIVE;
    }

    const vehicles = await prisma.vehicle.findMany({
      where: vehicleWhere,
      select: {
        id: true,
        publicId: true,
        regNo: true,
        make: true,
        model: true,
        status: true,
        category: { select: { name: true } },
        branch: { select: { name: true } },
      },
    });

    // --- In-range revenue bookings that include any of these vehicles ---
    const vehicleDbIds = vehicles.map((v) => v.id);
    const bookingWhere = buildBookingWhere({
      branchPublicId,
      categoryPublicIds,
      from: start,
      to: end,
      statuses: REVENUE_BOOKING_STATUSES,
    });

    // Pull the booking items for those bookings, restricted to our vehicles.
    // finalTotal is the vehicle-attributable revenue for the booking.
    const items =
      vehicleDbIds.length === 0
        ? []
        : await prisma.bookingItem.findMany({
            where: {
              vehicleId: { in: vehicleDbIds },
              booking: bookingWhere,
            },
            select: {
              vehicleId: true,
              finalTotal: true,
              booking: {
                select: { id: true, startAt: true, endAt: true, days: true },
              },
            },
          });

    // Aggregate per vehicle.
    interface VehStat {
      revenue: number;
      bookingIds: Set<number>;
      rentedDays: number;
      durationSum: number;
    }
    const statByVehicle = new Map<number, VehStat>();
    for (const it of items) {
      const stat = statByVehicle.get(it.vehicleId) ?? {
        revenue: 0,
        bookingIds: new Set<number>(),
        rentedDays: 0,
        durationSum: 0,
      };
      stat.revenue += Number(it.finalTotal);
      if (!stat.bookingIds.has(it.booking.id)) {
        stat.bookingIds.add(it.booking.id);
        // Utilisation: rented days capped to the range boundaries.
        stat.rentedDays += overlapDays(
          it.booking.startAt,
          it.booking.endAt,
          start,
          end,
        );
        // Avg Booking Duration: true booking length (Booking.days), uncapped.
        stat.durationSum += it.booking.days;
      }
      statByVehicle.set(it.vehicleId, stat);
    }

    const availableDays = days; // see DATA GAP note above

    let rows = vehicles.map((v) => {
      const stat = statByVehicle.get(v.id);
      const totalBookings = stat ? stat.bookingIds.size : 0;
      const totalRevenue = stat ? stat.revenue : 0;
      const rentedDays = stat ? stat.rentedDays : 0;
      const utilisation =
        availableDays > 0
          ? Math.min(100, (rentedDays / availableDays) * 100)
          : 0;
      const avgDuration = totalBookings > 0 ? stat!.durationSum / totalBookings : 0;
      return {
        vehicleId: v.publicId,
        regNo: v.regNo,
        vehicleName: `${v.make} ${v.model}`,
        category: v.category.name,
        branch: v.branch.name,
        totalBookings,
        totalRevenue,
        utilisation: Math.round(utilisation * 10) / 10,
        avgBookingDuration: Math.round(avgDuration * 10) / 10,
        status: v.status,
      };
    });

    // Sort Total Revenue desc.
    rows.sort((a, b) => b.totalRevenue - a.totalRevenue);

    const summary = {
      totalVehicles: rows.length,
      totalBookings: rows.reduce((s, r) => s + r.totalBookings, 0),
      totalRevenue: rows.reduce((s, r) => s + r.totalRevenue, 0),
      averageUtilisation:
        rows.length > 0
          ? Math.round(
              (rows.reduce((s, r) => s + r.utilisation, 0) / rows.length) * 10,
            ) / 10
          : 0,
    };

    if (exportFormat === "csv") {
      const columns = [
        "Vehicle Reg No",
        "Vehicle Name",
        "Category",
        "Branch",
        "Total Bookings",
        "Total Revenue",
        "Utilisation %",
        "Avg Booking Duration",
        "Status",
      ];
      const csvRows = rows.map((r) => ({
        "Vehicle Reg No": r.regNo,
        "Vehicle Name": r.vehicleName,
        Category: r.category,
        Branch: r.branch,
        "Total Bookings": r.totalBookings,
        "Total Revenue": csvCurrency(r.totalRevenue),
        "Utilisation %": r.utilisation,
        "Avg Booking Duration": r.avgBookingDuration,
        Status: r.status,
      }));
      const summaryCsv = summaryRow(columns, "TOTAL", {
        "Total Bookings": summary.totalBookings,
        "Total Revenue": csvCurrency(summary.totalRevenue),
        "Utilisation %": summary.averageUtilisation,
      });
      return exportRowsToCSV(res, {
        columns,
        rows: csvRows,
        summaryRows: [summaryCsv],
        filename: `vehicle-report-${csvDate(start)}-${csvDate(end)}`,
      });
    }

    return res.status(StatusCode.OK).json({
      message: "Vehicle report generated successfully",
      data: {
        metadata: {
          generatedAt: new Date().toISOString(),
          period: { start: start.toISOString(), end: end.toISOString() },
          filters: {
            branch: branchPublicId ?? "All Branches",
            vehicleStatus: statusFilter,
          },
        },
        summary,
        data: rows,
      },
    });
  } catch (error) {
    console.error("Vehicle Report List Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Failed to generate vehicle report",
    });
  }
};

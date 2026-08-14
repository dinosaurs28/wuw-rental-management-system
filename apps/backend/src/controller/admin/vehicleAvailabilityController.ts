import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { exportVehicleAvailabilityToExcel } from "../../utils/exportToExcel.js";
import {
  resolveReportRange,
  parseCategoryIds,
  buildVehicleWhere,
  exportRowsToCSV,
  csvDate,
} from "../../utils/reporting/index.js";

/**
 * Vehicle Availability Report (spec §4.6) — operational, no revenue.
 *
 * Conformed to spec:
 * - Vehicle filter via shared buildVehicleWhere: branch + category + EXCLUDE
 *   inactive vehicles by default.
 * - "Booked" on a day = a booking with status in [CONFIRMED, PICKED_UP] overlaps
 *   that day (HOLD excluded).
 * - Adds the two missing fields: Next Available From and Booked Dates in Range.
 * - Booked days counted as DISTINCT calendar days in range (no double counting
 *   across overlapping bookings) so Free Days = range days - booked days >= 0.
 * - "Show Only Available" toggle filters to vehicles with at least one free day.
 * - Sort: most free days first. CSV in spec column order, inline via reporting/csv.
 *
 * GET /api/dashboard/reports/vehicle-availability
 * Query: startDate, endDate (or preset/from/to), branchId, categoryId/categories,
 *        availableOnly ("true"|"1"), export ("xlsx"|"csv").
 */

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Start-of-day clone. */
const dayStart = (d: Date): Date => {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
};

/** A "DD-MM" date label for the "Booked Dates in Range" ranges (no year, spec). */
const ddmm = (d: Date): string => {
  const day = d.getDate().toString().padStart(2, "0");
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  return `${day}-${month}`;
};

const ACTIVE_BOOKING_STATUSES = ["CONFIRMED", "PICKED_UP"] as const;

export const GetVehicleAvailability = async (req: Request, res: Response) => {
  try {
    const {
      branchId,
      branch,
      categoryId,
      categories,
      availableOnly,
      export: exportFormat,
    } = req.query;

    // Date range (availability window). Supports preset OR explicit start/end.
    const { start, end, days: totalDays } = resolveReportRange({
      preset: req.query.preset,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      from: req.query.from,
      to: req.query.to,
    });

    const branchPublicId =
      branchId && String(branchId) !== "all"
        ? String(branchId)
        : branch && String(branch) !== "all"
          ? String(branch)
          : undefined;
    const categoryPublicIds = parseCategoryIds(categories ?? categoryId);
    const showOnlyAvailable =
      String(availableOnly) === "true" || String(availableOnly) === "1";

    // Canonical vehicle filter: branch + category + EXCLUDE inactive (spec §4.6).
    const vehicleWhere = buildVehicleWhere({
      branchPublicId,
      categoryPublicIds,
      includeInactive: false,
    });

    const [vehicles, categoriesList] = await Promise.all([
      prisma.vehicle.findMany({
        where: vehicleWhere,
        include: {
          category: { select: { name: true, id: true } },
          branch: { select: { name: true, publicId: true } },
          bookingItems: {
            where: {
              booking: {
                // overlap with the availability window
                startAt: { lte: end },
                endAt: { gte: start },
                // Booked = CONFIRMED or PICKED_UP only (HOLD excluded, spec §4.6)
                status: { in: [...ACTIVE_BOOKING_STATUSES] },
                deletedAt: null,
              },
            },
            include: {
              booking: {
                include: {
                  customer: {
                    include: { user: { select: { name: true, phone: true } } },
                  },
                },
              },
            },
            orderBy: { booking: { startAt: "asc" } },
          },
        },
        orderBy: [{ status: "asc" }, { regNo: "asc" }],
      }),
      prisma.vehicleCategory.findMany({ select: { id: true, name: true } }),
    ]);

    const totalVehicles = vehicles.length;
    const now = new Date();
    const todayStart = dayStart(now);
    const rangeStartDay = dayStart(start);

    let totalAvailableDays = 0;
    let totalBookedDays = 0;
    let currentlyAvailable = 0;
    let currentlyRented = 0;
    let upcomingBookings = 0;

    const vehicleData = vehicles.map((vehicle) => {
      const bookings = vehicle.bookingItems.map((item) => ({
        bookingId: item.booking.publicId,
        customerName: item.booking.customer.user.name,
        customerPhone: item.booking.customer.user.phone,
        startDate: item.booking.startAt.toISOString(),
        endDate: item.booking.endAt.toISOString(),
        status: item.booking.status,
        days: item.booking.days,
      }));

      // ----- Distinct booked calendar days within the range (no double count) --
      const bookedDaySet = new Set<number>();
      // Human-readable booked ranges (clamped to window), "12-05 to 15-05".
      const bookedRangeLabels: string[] = [];

      vehicle.bookingItems.forEach((item) => {
        const bs = item.booking.startAt;
        const be = item.booking.endAt;
        const overlapStart = bs > start ? bs : start;
        const overlapEnd = be < end ? be : end;
        if (overlapStart > overlapEnd) return;

        const sDay = dayStart(overlapStart);
        const eDay = dayStart(overlapEnd);
        for (
          let d = sDay.getTime();
          d <= eDay.getTime();
          d += MS_PER_DAY
        ) {
          // index relative to range start, keyed for distinctness
          bookedDaySet.add(Math.round((d - rangeStartDay.getTime()) / MS_PER_DAY));
        }
        bookedRangeLabels.push(`${ddmm(sDay)} to ${ddmm(eDay)}`);
      });

      const bookedDaysInRange = bookedDaySet.size;
      const availableDaysInRange = Math.max(0, totalDays - bookedDaysInRange);
      const bookedDatesInRange = bookedRangeLabels.join(", ");

      const utilizationRate =
        totalDays > 0
          ? parseFloat(((bookedDaysInRange / totalDays) * 100).toFixed(1))
          : 0;

      totalAvailableDays += availableDaysInRange;
      totalBookedDays += bookedDaysInRange;

      // ----- Current status (Available / Booked / Maintenance) -----------------
      const isCurrentlyBooked = bookings.some(
        (b) =>
          new Date(b.startDate) <= now &&
          new Date(b.endDate) >= now &&
          (b.status === "PICKED_UP" || b.status === "CONFIRMED"),
      );

      let currentStatus: "Available" | "Booked" | "Maintenance";
      if (vehicle.status === "MAINTENANCE") {
        currentStatus = "Maintenance";
      } else if (isCurrentlyBooked || vehicle.status === "OUT_FOR_RENTAL") {
        currentStatus = "Booked";
      } else {
        currentStatus = "Available";
      }

      if (currentStatus === "Booked") currentlyRented++;
      else if (currentStatus === "Available") currentlyAvailable++;

      // ----- Next Available From -----------------------------------------------
      // max(today, MAX(endAt)+1) over CONFIRMED/PICKED_UP bookings ending today
      // or later; "today / Available" when there are none.
      let nextAvailableFrom: Date = todayStart;
      const futureEnds = bookings
        .filter((b) => new Date(b.endDate) >= todayStart)
        .map((b) => new Date(b.endDate));
      if (futureEnds.length > 0) {
        const maxEnd = new Date(
          Math.max(...futureEnds.map((d) => d.getTime())),
        );
        const dayAfter = dayStart(maxEnd);
        dayAfter.setDate(dayAfter.getDate() + 1);
        nextAvailableFrom = dayAfter > todayStart ? dayAfter : todayStart;
      }

      // Upcoming bookings (start in the future) — kept for summary widget.
      upcomingBookings += bookings.filter(
        (b) => new Date(b.startDate) > now,
      ).length;

      return {
        vehicleId: vehicle.publicId,
        regNo: vehicle.regNo,
        make: vehicle.make,
        model: vehicle.model,
        vehicleName: `${vehicle.make} ${vehicle.model}`,
        category: vehicle.category.name,
        branch: vehicle.branch.name,
        status: vehicle.status,
        currentStatus,
        totalDays,
        bookedDays: bookedDaysInRange,
        availableDays: availableDaysInRange,
        freeDays: availableDaysInRange,
        utilizationRate,
        nextAvailableFrom: nextAvailableFrom.toISOString(),
        bookedDatesInRange,
        bookings,
      };
    });

    // Sort: most free days first (spec §4.6).
    vehicleData.sort((a, b) => b.freeDays - a.freeDays);

    const visibleVehicles = showOnlyAvailable
      ? vehicleData.filter((v) => v.freeDays > 0)
      : vehicleData;

    // ----- Category breakdown (backward-compatible widget) ---------------------
    const categoryBreakdown = categoriesList.map((category) => {
      const categoryVehicles = vehicleData.filter(
        (v) => v.category === category.name,
      );
      const total = categoryVehicles.length;
      const available = categoryVehicles.filter(
        (v) => v.currentStatus === "Available",
      ).length;
      const rented = categoryVehicles.filter(
        (v) => v.currentStatus === "Booked",
      ).length;
      const maintenance = categoryVehicles.filter(
        (v) => v.currentStatus === "Maintenance",
      ).length;
      const avgUtilization =
        total > 0
          ? parseFloat(
              (
                categoryVehicles.reduce((s, v) => s + v.utilizationRate, 0) /
                total
              ).toFixed(1),
            )
          : 0;
      return {
        category: category.name,
        total,
        available,
        rented,
        maintenance,
        inactive: 0, // inactive vehicles are excluded per spec §4.6
        avgUtilization,
      };
    });

    const overallUtilization =
      totalVehicles > 0 && totalDays > 0
        ? parseFloat(
            ((totalBookedDays / (totalVehicles * totalDays)) * 100).toFixed(1),
          )
        : 0;

    const summary = {
      totalVehicles,
      currentlyAvailable,
      currentlyRented,
      inMaintenance: vehicleData.filter(
        (v) => v.currentStatus === "Maintenance",
      ).length,
      inactive: 0, // excluded per spec §4.6
      upcomingBookings,
      overallUtilization,
      dateRange: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        totalDays,
      },
    };

    const reportData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        dateRange: {
          startDate: start.toISOString().split("T")[0],
          endDate: end.toISOString().split("T")[0],
        },
        branch: branchPublicId ?? "All Branches",
        availableOnly: showOnlyAvailable,
      },
      summary,
      categoryBreakdown,
      vehicles: visibleVehicles,
    };

    // ----- Export -------------------------------------------------------------
    if (exportFormat === "xlsx") {
      const filename = `vehicle-availability-${csvDate(start)}-${csvDate(end)}`;
      return await exportVehicleAvailabilityToExcel(res, reportData, filename);
    }

    if (exportFormat === "csv") {
      // Spec §4.6 column order.
      const columns = [
        "Vehicle Reg No",
        "Vehicle Name",
        "Category",
        "Branch",
        "Current Status",
        "Next Available From",
        "Booked Dates in Range",
        "Total Booked Days",
        "Total Free Days",
      ];
      const rows = visibleVehicles.map((v) => ({
        "Vehicle Reg No": v.regNo,
        "Vehicle Name": v.vehicleName,
        Category: v.category,
        Branch: v.branch,
        "Current Status": v.currentStatus,
        "Next Available From":
          v.currentStatus === "Available" &&
          dayStart(new Date(v.nextAvailableFrom)).getTime() ===
            todayStart.getTime()
            ? "Available"
            : csvDate(v.nextAvailableFrom),
        "Booked Dates in Range": v.bookedDatesInRange,
        "Total Booked Days": v.bookedDays,
        "Total Free Days": v.freeDays,
      }));
      return exportRowsToCSV(res, {
        columns,
        rows,
        filename: `vehicle-availability-${csvDate(start)}-${csvDate(end)}`,
      });
    }

    return res.status(StatusCode.OK).json({
      message: "Vehicle availability report generated successfully",
      data: reportData,
    });
  } catch (error) {
    console.error("Get Vehicle Availability Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Failed to generate vehicle availability report",
    });
  }
};

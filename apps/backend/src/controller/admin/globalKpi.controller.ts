import { prisma, BookingStatus } from "@repo/database/client";
import { Request, Response } from "express";
import {
  resolveReportRange,
  parseCategoryIds,
  buildBookingWhere,
  buildBookingSnapshotWhere,
  buildVehicleWhere,
  getPaidByBooking,
  REVENUE_BOOKING_STATUSES,
} from "../../utils/reporting/index.js";

/**
 * Global Reports dashboard — all 6 KPI cards from a single endpoint sharing one
 * filter context (spec §A). Conformed to spec: revenue anchors on startAt
 * (booking_start_date), category filter applied to every card, Pending Revenue =
 * outstanding on confirmed bookings, Total Customers = distinct customers with
 * bookings in range (with all-time in the sub-label).
 *
 * Response shape is kept backward-compatible with the existing frontend.
 */
export const getGlobalKpiStats = async (req: Request, res: Response) => {
  try {
    const { branchId, branch, categoryId, categories } = req.query;

    const branchPublicId =
      branchId && String(branchId) !== "all"
        ? String(branchId)
        : branch && String(branch) !== "all"
          ? String(branch)
          : undefined;

    const categoryPublicIds = parseCategoryIds(categories ?? categoryId);

    const { start, end, prevStart, prevEnd } = resolveReportRange({
      preset: req.query.preset,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      from: req.query.from,
      to: req.query.to,
    });

    const baseFilter = { branchPublicId, categoryPublicIds };

    // ---- 2 & 6. Revenue (selected) + Avg Booking Value (current vs previous) ----
    const [revCurAgg, revPrevAgg] = await Promise.all([
      prisma.booking.aggregate({
        _sum: { totalFinal: true },
        _count: true,
        where: buildBookingWhere({ ...baseFilter, from: start, to: end }),
      }),
      prisma.booking.aggregate({
        _sum: { totalFinal: true },
        _count: true,
        where: buildBookingWhere({
          ...baseFilter,
          from: prevStart,
          to: prevEnd,
        }),
      }),
    ]);

    const revenueCurrent = Number(revCurAgg._sum.totalFinal || 0);
    const revenuePrev = Number(revPrevAgg._sum.totalFinal || 0);
    const bookingsCurrent = revCurAgg._count;
    const bookingsPrev = revPrevAgg._count;

    const pct = (cur: number, prev: number): number =>
      prev > 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? 100 : 0;

    const avgCurrent = bookingsCurrent > 0 ? revenueCurrent / bookingsCurrent : 0;
    const avgPrev = bookingsPrev > 0 ? revenuePrev / bookingsPrev : 0;

    // ---- 4. Pending Revenue: outstanding on CONFIRMED bookings (snapshot) ----
    const confirmedBookings = await prisma.booking.findMany({
      where: buildBookingSnapshotWhere({
        ...baseFilter,
        statuses: [BookingStatus.CONFIRMED],
      }),
      select: { id: true, totalFinal: true },
    });
    const paidMap = await getPaidByBooking(confirmedBookings.map((b) => b.id));
    let pendingAmount = 0;
    let pendingCount = 0;
    for (const b of confirmedBookings) {
      const paid = paidMap.get(b.id)?.total ?? 0;
      const total = Number(b.totalFinal);
      if (paid < total) {
        pendingAmount += total - paid;
        pendingCount += 1;
      }
    }

    // ---- 3. Active Bookings (picked up right now) ----
    const activeNowWhere = buildBookingSnapshotWhere({
      ...baseFilter,
      statuses: [BookingStatus.PICKED_UP],
    });
    const activeBookingsCount = await prisma.booking.count({
      where: activeNowWhere,
    });
    // Trend: bookings overlapping the end of the previous window.
    const activePrevCount = await prisma.booking.count({
      where: {
        ...buildBookingSnapshotWhere({
          ...baseFilter,
          statuses: [BookingStatus.PICKED_UP, BookingStatus.RETURNED],
        }),
        startAt: { lte: prevEnd },
        endAt: { gte: prevEnd },
      },
    });

    // ---- 1. Fleet Utilization = active bookings now / total vehicles ----
    const totalVehicles = await prisma.vehicle.count({
      where: buildVehicleWhere(baseFilter),
    });
    const utilizationCurrent =
      totalVehicles > 0 ? (activeBookingsCount / totalVehicles) * 100 : 0;
    const utilizationPrev =
      totalVehicles > 0 ? (activePrevCount / totalVehicles) * 100 : 0;

    // ---- 5. Total Customers: distinct with bookings in range + all-time ----
    const [distinctInRange, distinctInPrev, allTimeCustomers] =
      await Promise.all([
        prisma.booking.findMany({
          where: buildBookingWhere({ ...baseFilter, from: start, to: end }),
          select: { customerId: true },
          distinct: ["customerId"],
        }),
        prisma.booking.findMany({
          where: buildBookingWhere({
            ...baseFilter,
            from: prevStart,
            to: prevEnd,
          }),
          select: { customerId: true },
          distinct: ["customerId"],
        }),
        prisma.customer.count({
          where: {
            deletedAt: null,
            ...(branchPublicId
              ? { user: { branch: { publicId: branchPublicId } } }
              : {}),
          },
        }),
      ]);
    const customersInRange = distinctInRange.length;
    const customersInPrev = distinctInPrev.length;

    return res.json({
      totalFleetUtilization: {
        current: Number(utilizationCurrent.toFixed(1)),
        trend: Number((utilizationCurrent - utilizationPrev).toFixed(1)),
      },
      revenueThisMonth: {
        current: revenueCurrent,
        previous: revenuePrev,
        trend: Number(pct(revenueCurrent, revenuePrev).toFixed(1)),
      },
      activeBookings: {
        count: activeBookingsCount,
        trend: Number(pct(activeBookingsCount, activePrevCount).toFixed(1)),
      },
      pendingRevenue: {
        amount: pendingAmount,
        count: pendingCount,
      },
      totalCustomers: {
        // count = distinct customers with bookings in the selected range (spec)
        count: customersInRange,
        // all-time registered customers (shown in the sub-label)
        allTime: allTimeCustomers,
        growth: Number(pct(customersInRange, customersInPrev).toFixed(1)),
      },
      avgBookingValue: {
        amount: Math.round(avgCurrent),
        trend: Number(pct(avgCurrent, avgPrev).toFixed(1)),
      },
    });
  } catch (error) {
    console.error("Error fetching global KPI stats:", error);
    return res
      .status(500)
      .json({ message: "Failed to fetch global KPI stats" });
  }
};

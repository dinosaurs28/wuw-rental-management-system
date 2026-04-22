import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { BookingStatus } from "@repo/database/client";
import { exportDailySummaryToExcel } from "../../utils/exportToExcel.js";
import { exportDailySummaryToCSV } from "../../utils/exportToCSV.js";

/**
 * Daily Summary Report Controller
 * GET /api/dashboard/reports/daily-summary
 *
 * Query Parameters:
 * - date: YYYY-MM-DD (required) - The date for the report
 * - branchId: string (optional) - Filter by specific branch public ID
 * - export: 'xlsx' | 'csv' (optional) - Export format
 */
export const GetDailySummary = async (req: Request, res: Response) => {
  try {
    const { date, branchId, export: exportFormat } = req.query;

    if (!date || typeof date !== "string") {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Date parameter is required (format: YYYY-MM-DD)",
      });
    }

    const reportDate = new Date(date);
    if (isNaN(reportDate.getTime())) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid date format. Use YYYY-MM-DD",
      });
    }

    const startOfDay = new Date(reportDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(reportDate);
    endOfDay.setHours(23, 59, 59, 999);

    const yesterday = new Date(reportDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStart = new Date(yesterday);
    yesterdayStart.setHours(0, 0, 0, 0);
    const yesterdayEnd = new Date(yesterday);
    yesterdayEnd.setHours(23, 59, 59, 999);

    let branchFilter: { id: number } | undefined;
    let branchName: string = "All Branches";

    if (branchId) {
      const branch = await prisma.branch.findUnique({
        where: { publicId: branchId as string },
        select: { id: true, name: true },
      });
      if (!branch) {
        return res.status(StatusCode.NOT_FOUND).json({ message: "Branch not found" });
      }
      branchFilter = { id: branch.id };
      branchName = branch.name;
    }

    // =========================================================================
    // Execute all queries in parallel
    // =========================================================================
    const [
      newBookingsData,
      collectionsByMethodData,
      advanceCollectedData,
      damageApprovedData,
      safetyDepositCollectedData,
      invoicedTodayData,
      damagesData,
      maintenanceData,
      vehicleStatusData,
      yesterdayRevenueData,
      pickedUpCount,
      returnedCount,
      cancelledCount,
      activeBookingsCount,
      availableVehiclesStart,
    ] = await Promise.all([

      // Bookings created today — committed booking value (totalFinal at booking time)
      prisma.booking.aggregate({
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay },
          branchId: branchFilter?.id,
          deletedAt: null,
        },
        _sum: { totalFinal: true, totalDeposit: true },
        _count: true,
      }),

      // All payments collected today — grouped by method (CASH/ONLINE/SPLIT)
      prisma.paymentTransaction.groupBy({
        by: ["method"],
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay },
          status: { in: ["COLLECTED", "CONFIRMED"] },
          branchId: branchFilter?.id,
        },
        _sum: { totalAmount: true },
        _count: true,
      }),

      // Advance payments collected today — use Booking.advanceAmount where advancePaidAt is today.
      // PaymentTransaction.purpose is never set to ADVANCE in the current flow (BOOKING sessions
      // always get FULL_PAYMENT). The booking model has the accurate advance amount & paid-at date.
      prisma.booking.aggregate({
        where: {
          isAdvancePayment: true,
          advancePaidAt: { gte: startOfDay, lte: endOfDay },
          branchId: branchFilter?.id,
          deletedAt: null,
        },
        _sum: { advanceAmount: true },
        _count: true,
      }),

      // Damage fees charged today — finalCost from approved damage reports.
      // Damage fees are collected as part of the return session (REMAINING_BALANCE) and
      // are not separately tracked in PaymentTransaction. Using approved finalCost is the
      // most accurate "damage charged today" figure available.
      prisma.damageReport.aggregate({
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay },
          status: "APPROVED",
          booking: branchFilter ? { branchId: branchFilter.id } : undefined,
        },
        _sum: { finalCost: true },
        _count: true,
      }),

      // Safety deposit collected today — use Booking.safetyDeposit where safetyDepositPaidAt is today.
      // Safety deposit is added via a ledger entry (not a PaymentTransaction with purpose=SAFETY_DEPOSIT),
      // so the booking model field is the correct source.
      prisma.booking.aggregate({
        where: {
          safetyDepositPaidAt: { gte: startOfDay, lte: endOfDay },
          branchId: branchFilter?.id,
          deletedAt: null,
        },
        _sum: { safetyDeposit: true },
        _count: true,
      }),

      // Invoices finalized today — actual billed amount (computed at vehicle return)
      prisma.invoice.aggregate({
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay },
          status: { in: ["FINALIZED", "PAID"] },
          booking: branchFilter ? { branchId: branchFilter.id } : undefined,
        },
        _sum: { total: true },
        _count: true,
      }),

      // All damage reports filed today — estimated cost + count
      prisma.damageReport.aggregate({
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay },
          booking: branchFilter ? { branchId: branchFilter.id } : undefined,
        },
        _count: true,
        _sum: { estimatedCost: true },
      }),

      // Maintenance records today
      prisma.vehicleMaintenanceRecord.aggregate({
        where: {
          servicedAt: { gte: startOfDay, lte: endOfDay },
          vehicle: branchFilter ? { branchId: branchFilter.id } : undefined,
        },
        _count: true,
        _sum: { cost: true },
      }),

      // Vehicle status counts (current snapshot)
      prisma.vehicle.groupBy({
        by: ["status"],
        where: { branchId: branchFilter?.id, deletedAt: null },
        _count: true,
      }),

      // Yesterday's revenue for comparison
      prisma.booking.aggregate({
        where: {
          createdAt: { gte: yesterdayStart, lte: yesterdayEnd },
          branchId: branchFilter?.id,
          deletedAt: null,
        },
        _sum: { totalFinal: true },
        _count: true,
      }),

      prisma.booking.count({
        where: {
          updatedAt: { gte: startOfDay, lte: endOfDay },
          status: BookingStatus.PICKED_UP,
          branchId: branchFilter?.id,
        },
      }),

      prisma.booking.count({
        where: {
          updatedAt: { gte: startOfDay, lte: endOfDay },
          status: BookingStatus.RETURNED,
          branchId: branchFilter?.id,
        },
      }),

      prisma.booking.count({
        where: {
          updatedAt: { gte: startOfDay, lte: endOfDay },
          status: BookingStatus.CANCELLED,
          branchId: branchFilter?.id,
        },
      }),

      prisma.booking.count({
        where: {
          status: BookingStatus.PICKED_UP,
          branchId: branchFilter?.id,
          deletedAt: null,
        },
      }),

      prisma.vehicle.count({
        where: { status: "AVAILABLE", branchId: branchFilter?.id, deletedAt: null },
      }),
    ]);

    // Pending damage approvals (separate sequential query — tiny)
    const pendingDamagesCount = await prisma.damageReport.count({
      where: {
        status: "PENDING",
        booking: branchFilter ? { branchId: branchFilter.id } : undefined,
      },
    });

    // =========================================================================
    // Compute aggregates
    // =========================================================================

    // Booking value = totalFinal committed at booking creation time
    const bookingValue = Number(newBookingsData._sum.totalFinal || 0);

    // Invoiced amount = actual billed value from finalized invoices today
    const invoicedAmount = Number(invoicedTodayData._sum.total || 0);

    // Collections by method
    const collectionsByMethod = collectionsByMethodData.reduce(
      (acc, txn) => {
        const amount = Number(txn._sum.totalAmount || 0);
        if (txn.method === "CASH") acc.cash += amount;
        else if (txn.method === "ONLINE") acc.online += amount;
        else if (txn.method === "SPLIT") acc.split += amount;
        return acc;
      },
      { cash: 0, online: 0, split: 0 },
    );

    const totalCollected =
      collectionsByMethod.cash +
      collectionsByMethod.online +
      collectionsByMethod.split;

    // Advance: sum of Booking.advanceAmount where advancePaidAt = today
    const advanceCollected = Number(advanceCollectedData._sum.advanceAmount || 0);
    // Damage approved: finalCost from approved damage reports today (charged, collected via return settlement)
    const damageFeesCollected = Number(damageApprovedData._sum.finalCost || 0);
    const damageApprovedCount = damageApprovedData._count;
    // Safety deposit: sum of Booking.safetyDeposit where safetyDepositPaidAt = today
    const safetyDepositCollected = Number(safetyDepositCollectedData._sum.safetyDeposit || 0);

    const collectionsBreakdown = collectionsByMethodData.map((txn) => ({
      method: txn.method,
      amount: Number(txn._sum.totalAmount || 0),
      count: txn._count,
    }));

    // Vehicle fleet counts
    const availableCount = vehicleStatusData.find((v) => v.status === "AVAILABLE")?._count || 0;
    const rentedCount = vehicleStatusData.find((v) => v.status === "OUT_FOR_RENTAL")?._count || 0;
    const totalVehicles = vehicleStatusData.reduce((sum, v) => sum + v._count, 0);
    const currentUtilization =
      totalVehicles > 0 ? ((rentedCount / totalVehicles) * 100).toFixed(1) : "0.0";

    // Comparison vs yesterday
    const yesterdayRevenue = Number(yesterdayRevenueData._sum.totalFinal || 0);
    const revenueVsYesterday =
      yesterdayRevenue !== 0
        ? (((bookingValue - yesterdayRevenue) / yesterdayRevenue) * 100).toFixed(1)
        : "0.0";
    const bookingsVsYesterday =
      yesterdayRevenueData._count !== 0
        ? (((newBookingsData._count - yesterdayRevenueData._count) / yesterdayRevenueData._count) * 100).toFixed(1)
        : "0.0";

    // =========================================================================
    // Build response
    // =========================================================================
    const reportData = {
      metadata: {
        date,
        branch: branchName,
        generatedAt: new Date().toISOString(),
      },

      // Revenue section — clearly separates booking value, billed value, and collected
      revenue: {
        bookingValue,           // Value committed at booking creation today (totalFinal)
        invoicedAmount,         // Actual billed amount from invoices finalized today (after return charges)
        invoicedCount: invoicedTodayData._count,
        advanceCollected,       // Advance payments collected today
        safetyDepositCollected, // Safety deposit collected today
        damageFeesCollected,    // Damage fees collected today
        totalCollected,         // All payments collected today (all purposes, all methods)
      },

      bookings: {
        newBookings: newBookingsData._count,
        pickups: pickedUpCount,
        returns: returnedCount,
        cancellations: cancelledCount,
        active: activeBookingsCount,
      },

      vehicles: {
        availableStartOfDay: availableVehiclesStart,
        availableEndOfDay: availableCount,
        rentedOut: pickedUpCount,
        returned: returnedCount,
        currentUtilization: parseFloat(currentUtilization),
      },

      collections: {
        cash: collectionsByMethod.cash,
        online: collectionsByMethod.online,
        split: collectionsByMethod.split,
        total: totalCollected,
        breakdown: collectionsBreakdown,
        // Purpose-wise breakdown
        byPurpose: {
          advance: advanceCollected,
          safetyDeposit: safetyDepositCollected,
          damageFees: damageFeesCollected,
        },
      },

      damages: {
        newReports: damagesData._count,
        totalEstimatedCost: Number(damagesData._sum.estimatedCost || 0), // estimated at report filing
        approvedCount: damageApprovedCount,
        totalFinalCost: damageFeesCollected, // final cost from approved reports (collected via return settlement)
        collected: damageFeesCollected,
        pendingApproval: pendingDamagesCount,
      },

      maintenance: {
        vehiclesServiced: maintenanceData._count,
        totalCost: Number(maintenanceData._sum.cost || 0),
      },

      comparison: {
        revenueVsYesterday: parseFloat(revenueVsYesterday),
        bookingsVsYesterday: parseFloat(bookingsVsYesterday),
        revenueVsLastWeekSameDay: 0,
      },
    };

    if (exportFormat === "xlsx") {
      return await exportDailySummaryToExcel(res, reportData, `daily-summary-${date}`);
    }
    if (exportFormat === "csv") {
      return exportDailySummaryToCSV(res, reportData, `daily-summary-${date}`);
    }

    return res.status(StatusCode.OK).json({
      message: "Daily summary generated successfully",
      data: reportData,
    });
  } catch (error) {
    console.error("Get Daily Summary Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Failed to generate daily summary",
    });
  }
};

import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { BookingStatus, DepositMethod } from "@repo/database/client";
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

    // Validate date parameter
    if (!date || typeof date !== "string") {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Date parameter is required (format: YYYY-MM-DD)",
      });
    }

    // Parse date and create date range for the day
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

    // Yesterday's dates for comparison
    const yesterday = new Date(reportDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStart = new Date(yesterday);
    yesterdayStart.setHours(0, 0, 0, 0);
    const yesterdayEnd = new Date(yesterday);
    yesterdayEnd.setHours(23, 59, 59, 999);

    // Find branch if branchId is provided
    let branchFilter: { id: number } | undefined;
    let branchName: string = "All Branches";

    if (branchId) {
      const branch = await prisma.branch.findUnique({
        where: { publicId: branchId as string },
        select: { id: true, name: true },
      });

      if (!branch) {
        return res.status(StatusCode.NOT_FOUND).json({
          message: "Branch not found",
        });
      }

      branchFilter = { id: branch.id };
      branchName = branch.name;
    }

    // ========================================================================
    // Execute all queries in parallel for optimal performance
    // ========================================================================

    const [
      // New bookings aggregate
      newBookingsData,

      // Deposits grouped by method
      depositsData,

      // Damage reports
      damagesData,

      // Maintenance records
      maintenanceData,

      // Vehicle status counts
      vehicleStatusData,

      // Yesterday's revenue for comparison
      yesterdayRevenueData,

      // Booking status transitions for today
      pickedUpCount,
      returnedCount,
      cancelledCount,

      // Active bookings (current)
      activeBookingsCount,

      // Available vehicles start of day (approximation)
      availableVehiclesStart,
    ] = await Promise.all([
      // New bookings created today with aggregates
      prisma.booking.aggregate({
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay },
          branchId: branchFilter?.id,
          deletedAt: null,
        },
        _sum: {
          totalFinal: true,
          totalDeposit: true,
        },
        _count: true,
      }),

      // Deposits collected today grouped by method
      prisma.deposit.groupBy({
        by: ["method"],
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay },
          booking: branchFilter ? { branchId: branchFilter.id } : undefined,
        },
        _sum: {
          amount: true,
        },
        _count: true,
      }),

      // Damage reports filed today
      prisma.damageReport.aggregate({
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay },
          booking: branchFilter ? { branchId: branchFilter.id } : undefined,
        },
        _count: true,
        _sum: {
          estimatedCost: true,
        },
      }),

      // Maintenance done today
      prisma.vehicleMaintenanceRecord.aggregate({
        where: {
          servicedAt: { gte: startOfDay, lte: endOfDay },
          vehicle: branchFilter ? { branchId: branchFilter.id } : undefined,
        },
        _count: true,
        _sum: {
          cost: true,
        },
      }),

      // Vehicle status counts (current)
      prisma.vehicle.groupBy({
        by: ["status"],
        where: {
          branchId: branchFilter?.id,
          deletedAt: null,
        },
        _count: true,
      }),

      // Yesterday's revenue for comparison
      prisma.booking.aggregate({
        where: {
          createdAt: { gte: yesterdayStart, lte: yesterdayEnd },
          branchId: branchFilter?.id,
          deletedAt: null,
        },
        _sum: {
          totalFinal: true,
        },
        _count: true,
      }),

      // Pickups today (bookings that changed to PICKED_UP status)
      prisma.booking.count({
        where: {
          updatedAt: { gte: startOfDay, lte: endOfDay },
          status: BookingStatus.PICKED_UP,
          branchId: branchFilter?.id,
        },
      }),

      // Returns today (bookings that changed to RETURNED status)
      prisma.booking.count({
        where: {
          updatedAt: { gte: startOfDay, lte: endOfDay },
          status: BookingStatus.RETURNED,
          branchId: branchFilter?.id,
        },
      }),

      // Cancellations today
      prisma.booking.count({
        where: {
          updatedAt: { gte: startOfDay, lte: endOfDay },
          status: BookingStatus.CANCELLED,
          branchId: branchFilter?.id,
        },
      }),

      // Active bookings (picked up but not returned)
      prisma.booking.count({
        where: {
          status: BookingStatus.PICKED_UP,
          branchId: branchFilter?.id,
          deletedAt: null,
        },
      }),

      // Available vehicles now
      prisma.vehicle.count({
        where: {
          status: "AVAILABLE",
          branchId: branchFilter?.id,
          deletedAt: null,
        },
      }),
    ]);

    // ========================================================================
    // Process and format the data
    // ========================================================================

    // Revenue calculations
    const totalRevenue = Number(newBookingsData._sum.totalFinal || 0);
    const totalDeposit = Number(newBookingsData._sum.totalDeposit || 0);
    const yesterdayRevenue = Number(yesterdayRevenueData._sum.totalFinal || 0);

    // Collections breakdown
    const collectionsByMethod = depositsData.reduce(
      (acc, deposit) => {
        const amount = Number(deposit._sum.amount || 0);
        const method = deposit.method;

        if (method === DepositMethod.CASH) {
          acc.cash += amount;
        } else if (method === DepositMethod.UPI) {
          acc.upi += amount;
        } else if (method === DepositMethod.ONLINE_RAZORPAY) {
          acc.online += amount;
        }

        return acc;
      },
      { cash: 0, upi: 0, online: 0 },
    );

    const totalCollected =
      collectionsByMethod.cash +
      collectionsByMethod.upi +
      collectionsByMethod.online;

    // Collections breakdown array
    const collectionsBreakdown = depositsData.map((deposit) => ({
      method: deposit.method,
      amount: Number(deposit._sum.amount || 0),
      count: deposit._count,
    }));

    // Vehicle counts
    const availableCount =
      vehicleStatusData.find((v) => v.status === "AVAILABLE")?._count || 0;
    const rentedCount =
      vehicleStatusData.find((v) => v.status === "OUT_FOR_RENTAL")?._count || 0;
    const totalVehicles = vehicleStatusData.reduce(
      (sum, v) => sum + v._count,
      0,
    );

    // Calculate utilization rate
    const currentUtilization =
      totalVehicles > 0
        ? ((rentedCount / totalVehicles) * 100).toFixed(1)
        : "0.0";

    // Comparison calculations
    const revenueVsYesterday =
      yesterdayRevenue !== 0
        ? (
            ((totalRevenue - yesterdayRevenue) / yesterdayRevenue) *
            100
          ).toFixed(1)
        : "0.0";

    const bookingsVsYesterday =
      yesterdayRevenueData._count !== 0
        ? (
            ((newBookingsData._count - yesterdayRevenueData._count) /
              yesterdayRevenueData._count) *
            100
          ).toFixed(1)
        : "0.0";

    // Pending damage approvals (status PENDING)
    const pendingDamagesCount = await prisma.damageReport.count({
      where: {
        status: "PENDING",
        booking: branchFilter ? { branchId: branchFilter.id } : undefined,
      },
    });

    // ========================================================================
    // Build response object
    // ========================================================================

    const reportData = {
      metadata: {
        date: date,
        branch: branchName,
        generatedAt: new Date().toISOString(),
      },
      revenue: {
        newBookings: totalRevenue,
        advanceCollected: totalRevenue - totalDeposit, // Approximation
        depositCollected: totalCollected,
        totalCollected: totalCollected,
      },
      bookings: {
        newBookings: newBookingsData._count,
        pickups: pickedUpCount,
        returns: returnedCount,
        cancellations: cancelledCount,
        active: activeBookingsCount,
      },
      vehicles: {
        availableStartOfDay: availableVehiclesStart, // Approximation
        availableEndOfDay: availableCount,
        rentedOut: pickedUpCount,
        returned: returnedCount,
        currentUtilization: parseFloat(currentUtilization),
      },
      collections: {
        cash: collectionsByMethod.cash,
        upi: collectionsByMethod.upi,
        online: collectionsByMethod.online,
        total: totalCollected,
        breakdown: collectionsBreakdown,
      },
      damages: {
        newReports: damagesData._count,
        totalEstimatedCost: Number(damagesData._sum.estimatedCost || 0),
        pendingApproval: pendingDamagesCount,
      },
      maintenance: {
        vehiclesServiced: maintenanceData._count,
        totalCost: Number(maintenanceData._sum.cost || 0),
      },
      comparison: {
        revenueVsYesterday: parseFloat(revenueVsYesterday),
        bookingsVsYesterday: parseFloat(bookingsVsYesterday),
        revenueVsLastWeekSameDay: 0, // TODO: Implement if needed
      },
    };

    // ========================================================================
    // Handle export if requested
    // ========================================================================

    if (exportFormat === "xlsx") {
      const filename = `daily-summary-${date}`;
      return await exportDailySummaryToExcel(res, reportData, filename);
    }

    if (exportFormat === "csv") {
      const filename = `daily-summary-${date}`;
      return exportDailySummaryToCSV(res, reportData, filename);
    }

    // Return JSON response
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

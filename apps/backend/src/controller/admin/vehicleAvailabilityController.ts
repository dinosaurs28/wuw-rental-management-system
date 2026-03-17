import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { exportVehicleAvailabilityToExcel } from "../../utils/exportToExcel.js";
import { exportVehicleAvailabilityToCSV } from "../../utils/exportToCSV.js";

/**
 * Vehicle Availability Report Controller
 * GET /api/dashboard/reports/vehicle-availability
 *
 * Query Parameters:
 * - startDate: string (required) - Format: YYYY-MM-DD
 * - endDate: string (required) - Format: YYYY-MM-DD
 * - branchId: string (optional) - Filter by branch
 * - categoryId: number (optional) - Filter by vehicle category
 * - export: 'xlsx' | 'csv' (optional)
 */
export const GetVehicleAvailability = async (req: Request, res: Response) => {
  try {
    const {
      startDate,
      endDate,
      branchId,
      categoryId,
      export: exportFormat,
    } = req.query;

    if (!startDate || !endDate) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Start date and end date are required",
      });
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // Build filter conditions
    const vehicleFilter: any = {
      deletedAt: null,
    };

    if (branchId && branchId !== "all") {
      const branch = await prisma.branch.findUnique({
        where: { publicId: branchId as string },
      });
      if (branch) {
        vehicleFilter.branchId = branch.id;
      }
    }

    if (categoryId) {
      vehicleFilter.categoryId = parseInt(categoryId as string);
    }

    // ========================================================================
    // Fetch all vehicles and their bookings in the date range
    // ========================================================================

    const [vehicles, totalVehicles, categories] = await Promise.all([
      // Get all vehicles with their bookings
      prisma.vehicle.findMany({
        where: vehicleFilter,
        include: {
          category: {
            select: {
              name: true,
              id: true,
            },
          },
          branch: {
            select: {
              name: true,
              publicId: true,
            },
          },
          bookingItems: {
            where: {
              booking: {
                OR: [
                  {
                    startAt: {
                      lte: end,
                    },
                    endAt: {
                      gte: start,
                    },
                  },
                ],
                status: {
                  in: ["HOLD", "CONFIRMED", "PICKED_UP"],
                },
                deletedAt: null,
              },
            },
            include: {
              booking: {
                include: {
                  customer: {
                    include: {
                      user: {
                        select: {
                          name: true,
                          phone: true,
                        },
                      },
                    },
                  },
                },
              },
            },
            orderBy: {
              booking: {
                startAt: "asc",
              },
            },
          },
        },
        orderBy: [{ status: "asc" }, { regNo: "asc" }],
      }),

      // Total vehicle count
      prisma.vehicle.count({
        where: vehicleFilter,
      }),

      // Categories summary
      prisma.vehicleCategory.findMany({
        select: {
          id: true,
          name: true,
        },
      }),
    ]);

    // ========================================================================
    // Calculate availability metrics
    // ========================================================================

    const totalDays =
      Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
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

      // Calculate booked days in the date range
      let bookedDaysInRange = 0;
      bookings.forEach((booking) => {
        const bookingStart = new Date(booking.startDate);
        const bookingEnd = new Date(booking.endDate);

        const overlapStart = bookingStart > start ? bookingStart : start;
        const overlapEnd = bookingEnd < end ? bookingEnd : end;

        if (overlapStart <= overlapEnd) {
          const days =
            Math.ceil(
              (overlapEnd.getTime() - overlapStart.getTime()) /
                (1000 * 60 * 60 * 24),
            ) + 1;
          bookedDaysInRange += days;
        }
      });

      const availableDaysInRange = totalDays - bookedDaysInRange;
      const utilizationRate =
        totalDays > 0
          ? ((bookedDaysInRange / totalDays) * 100).toFixed(1)
          : "0.0";

      totalAvailableDays += availableDaysInRange;
      totalBookedDays += bookedDaysInRange;

      // Check current status
      const now = new Date();
      const isCurrentlyRented = bookings.some(
        (b) =>
          new Date(b.startDate) <= now &&
          new Date(b.endDate) >= now &&
          b.status === "PICKED_UP",
      );

      if (isCurrentlyRented) {
        currentlyRented++;
      } else if (vehicle.status === "AVAILABLE") {
        currentlyAvailable++;
      }

      // Count upcoming bookings
      const upcoming = bookings.filter((b) => new Date(b.startDate) > now);
      upcomingBookings += upcoming.length;

      return {
        vehicleId: vehicle.publicId,
        regNo: vehicle.regNo,
        make: vehicle.make,
        model: vehicle.model,
        category: vehicle.category.name,
        branch: vehicle.branch.name,
        status: vehicle.status,
        totalDays,
        bookedDays: bookedDaysInRange,
        availableDays: availableDaysInRange,
        utilizationRate: parseFloat(utilizationRate),
        bookings,
        currentStatus: isCurrentlyRented ? "RENTED" : vehicle.status,
      };
    });

    // ========================================================================
    // Category-wise breakdown
    // ========================================================================

    const categoryBreakdown = categories.map((category) => {
      const categoryVehicles = vehicleData.filter(
        (v) => v.category === category.name,
      );
      const total = categoryVehicles.length;
      const available = categoryVehicles.filter(
        (v) => v.currentStatus === "AVAILABLE",
      ).length;
      const rented = categoryVehicles.filter(
        (v) => v.currentStatus === "RENTED",
      ).length;
      const maintenance = categoryVehicles.filter(
        (v) => v.currentStatus === "MAINTENANCE",
      ).length;
      const inactive = categoryVehicles.filter(
        (v) => v.currentStatus === "INACTIVE",
      ).length;

      const avgUtilization =
        total > 0
          ? (
              categoryVehicles.reduce((sum, v) => sum + v.utilizationRate, 0) /
              total
            ).toFixed(1)
          : "0.0";

      return {
        category: category.name,
        total,
        available,
        rented,
        maintenance,
        inactive,
        avgUtilization: parseFloat(avgUtilization),
      };
    });

    // ========================================================================
    // Summary metrics
    // ========================================================================

    const overallUtilization =
      totalVehicles > 0 && totalDays > 0
        ? ((totalBookedDays / (totalVehicles * totalDays)) * 100).toFixed(1)
        : "0.0";

    const summary = {
      totalVehicles,
      currentlyAvailable,
      currentlyRented,
      inMaintenance: vehicles.filter((v) => v.status === "MAINTENANCE").length,
      inactive: vehicles.filter((v) => v.status === "INACTIVE").length,
      upcomingBookings,
      overallUtilization: parseFloat(overallUtilization),
      dateRange: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        totalDays,
      },
    };

    // ========================================================================
    // Build response
    // ========================================================================

    const reportData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        dateRange: {
          startDate: start.toISOString().split("T")[0],
          endDate: end.toISOString().split("T")[0],
        },
        branch: branchId && branchId !== "all" ? branchId : "All Branches",
      },
      summary,
      categoryBreakdown,
      vehicles: vehicleData,
    };

    // ========================================================================
    // Handle export if requested
    // ========================================================================

    if (exportFormat === "xlsx") {
      const filename = `vehicle-availability-${start.toISOString().split("T")[0]}-${end.toISOString().split("T")[0]}`;
      return await exportVehicleAvailabilityToExcel(res, reportData, filename);
    }

    if (exportFormat === "csv") {
      const filename = `vehicle-availability-${start.toISOString().split("T")[0]}-${end.toISOString().split("T")[0]}`;
      return exportVehicleAvailabilityToCSV(res, reportData, filename);
    }

    // Return JSON response
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

import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { exportVehicleHistoryToExcel } from "../../utils/exportToExcel.js";
import { exportVehicleHistoryToCSV } from "../../utils/exportToCSV.js";

/**
 * Vehicle History Report Controller
 * GET /api/dashboard/reports/vehicle-history/:vehicleId
 *
 * Path Parameters:
 * - vehicleId: string (required) - Vehicle public ID
 *
 * Query Parameters:
 * - export: 'xlsx' | 'csv' (optional)
 */
export const GetVehicleHistory = async (req: Request, res: Response) => {
  try {
    const { vehicleId } = req.params;
    const { export: exportFormat } = req.query;

    if (!vehicleId) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Vehicle ID is required",
      });
    }

    // Find vehicle
    const vehicle = await prisma.vehicle.findUnique({
      where: { publicId: vehicleId },
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
          },
        },
      },
    });

    if (!vehicle) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Vehicle not found",
      });
    }

    // ========================================================================
    // Execute all queries in parallel
    // ========================================================================

    const [
      // Booking history
      bookingHistory,

      // Booking count
      totalBookingsCount,

      // Financial metrics from bookings
      revenueMetrics,

      // Maintenance records
      maintenanceRecords,

      // Damage reports
      damageReports,

      // Current status info
      activeBooking,
    ] = await Promise.all([
      // Booking history with customer details
      prisma.bookingItem.findMany({
        where: {
          vehicleId: vehicle.id,
          booking: {
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
              damages: {
                select: {
                  id: true,
                  estimatedCost: true,
                },
              },
            },
          },
        },
        orderBy: {
          booking: {
            startAt: "desc",
          },
        },
        take: 100, // Limit to last 100 bookings
      }),

      // Total bookings count
      prisma.bookingItem.count({
        where: {
          vehicleId: vehicle.id,
          booking: {
            deletedAt: null,
          },
        },
      }),

      // Revenue aggregation
      prisma.bookingItem.aggregate({
        where: {
          vehicleId: vehicle.id,
          booking: {
            deletedAt: null,
          },
        },
        _sum: {
          finalTotal: true,
        },
      }),

      // Maintenance records
      prisma.vehicleMaintenanceRecord.findMany({
        where: {
          vehicleId: vehicle.id,
        },
        orderBy: {
          servicedAt: "desc",
        },
        take: 50,
      }),

      // Damage reports
      prisma.damageReport.findMany({
        where: {
          booking: {
            items: {
              some: {
                vehicleId: vehicle.id,
              },
            },
          },
        },
        include: {
          booking: {
            select: {
              publicId: true,
              customer: {
                include: {
                  user: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 20,
      }),

      // Check for active booking (PICKED_UP status)
      prisma.bookingItem.findFirst({
        where: {
          vehicleId: vehicle.id,
          booking: {
            status: "PICKED_UP",
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
      }),
    ]);

    // ========================================================================
    // Calculate performance metrics
    // ========================================================================

    const totalRevenue = Number(revenueMetrics._sum.finalTotal || 0);

    // Calculate total maintenance cost
    const totalMaintenanceCost = maintenanceRecords.reduce(
      (sum, record) => sum + Number(record.cost || 0),
      0,
    );

    // Calculate total damage cost
    const totalDamageCost = damageReports.reduce(
      (sum, report) => sum + Number(report.estimatedCost || 0),
      0,
    );

    // Net profitability
    const netProfitability =
      totalRevenue - totalMaintenanceCost - totalDamageCost;

    // Calculate utilization rate (approximate based on booking days)
    const totalDays = bookingHistory.reduce(
      (sum, item) => sum + item.booking.days,
      0,
    );

    // Assuming vehicle was added X days ago, calculate utilization
    const vehicleAge = Math.floor(
      (Date.now() - vehicle.createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );
    const utilizationRate =
      vehicleAge > 0 ? ((totalDays / vehicleAge) * 100).toFixed(1) : "0.0";

    // Calculate ROI (purchase price not tracked in schema)
    // If you need ROI calculation, add purchasePrice field to Vehicle model
    const roi = "0.0";

    // Average revenue per booking
    const avgRevenuePerBooking =
      totalBookingsCount > 0
        ? (totalRevenue / totalBookingsCount).toFixed(0)
        : "0";

    // ========================================================================
    // Format booking history
    // ========================================================================

    const formattedBookingHistory = bookingHistory.map((item) => ({
      bookingId: item.booking.publicId,
      customerName: item.booking.customer.user.name,
      customerPhone: item.booking.customer.user.phone,
      startDate: item.booking.startAt.toISOString(),
      endDate: item.booking.endAt.toISOString(),
      days: item.booking.days,
      revenue: Number(item.finalTotal),
      depositAmount: Number(item.booking.totalDeposit),
      status: item.booking.status,
      damageReported: item.booking.damages.length > 0,
      returnCondition: item.booking.damages.length > 0 ? "Damaged" : "Good",
    }));

    // Format maintenance history
    const formattedMaintenanceHistory = maintenanceRecords.map((record) => ({
      id: record.id,
      date: record.servicedAt.toISOString(),
      description: record.description,
      cost: Number(record.cost || 0),
      // odometer, servicedBy, nextServiceDue: not available in schema
    }));

    // Format damage history
    const formattedDamageHistory = damageReports.map((report) => ({
      id: report.id,
      bookingId: report.booking.publicId,
      customerName: report.booking.customer.user.name,
      reportedDate: report.createdAt.toISOString(),
      notes: report.notes, // JSON field
      severity: report.severity,
      estimatedCost: Number(report.estimatedCost || 0),
      finalCost: Number(report.finalCost || 0),
      status: report.status,
      // images/photos: not included in query
    }));

    // ========================================================================
    // Build response
    // ========================================================================

    const reportData = {
      vehicle: {
        id: vehicle.publicId,
        regNo: vehicle.regNo,
        make: vehicle.make,
        model: vehicle.model,
        category: vehicle.category.name,
        branch: vehicle.branch.name,
        status: vehicle.status,
        currentOdometer: vehicle.odo,
        insuranceExpiry: vehicle.insuranceExpiry?.toISOString() || null,
        // purchasePrice, permitExpiry, year: not available in schema
      },
      performanceMetrics: {
        totalRevenue,
        totalBookings: totalBookingsCount,
        avgRevenuePerBooking: parseFloat(avgRevenuePerBooking),
        utilizationRate: parseFloat(utilizationRate),
        totalMaintenanceCost,
        totalDamageCost,
        netProfitability,
        roi: parseFloat(roi),
        vehicleAge,
      },
      currentStatus: {
        isActive: !!activeBooking,
        currentBooking: activeBooking
          ? {
              bookingId: activeBooking.booking.publicId,
              customerName: activeBooking.booking.customer.user.name,
              customerPhone: activeBooking.booking.customer.user.phone,
              startDate: activeBooking.booking.startAt.toISOString(),
              expectedReturn: activeBooking.booking.endAt.toISOString(),
            }
          : null,
      },
      bookingHistory: {
        data: formattedBookingHistory,
        totalCount: totalBookingsCount,
        pagination: {
          currentPage: 1,
          totalPages: Math.ceil(totalBookingsCount / 100),
        },
      },
      maintenanceHistory: formattedMaintenanceHistory,
      damageHistory: formattedDamageHistory,
      upcomingAlerts: {
        insuranceExpiry: vehicle.insuranceExpiry
          ? {
              date: vehicle.insuranceExpiry.toISOString(),
              daysRemaining: Math.floor(
                (vehicle.insuranceExpiry.getTime() - Date.now()) /
                  (1000 * 60 * 60 * 24),
              ),
            }
          : null,
        // permitExpiry, nextServiceDue: not available in schema
        permitExpiry: null,
        nextServiceDue: null,
      },
    };

    // ========================================================================
    // Handle export if requested
    // ========================================================================

    if (exportFormat === "xlsx") {
      const filename = `vehicle-history-${vehicle.regNo.replace(/\s/g, "-")}`;
      return await exportVehicleHistoryToExcel(res, reportData, filename);
    }

    if (exportFormat === "csv") {
      const filename = `vehicle-history-${vehicle.regNo.replace(/\s/g, "-")}`;
      return exportVehicleHistoryToCSV(res, reportData, filename);
    }

    // Return JSON response
    return res.status(StatusCode.OK).json({
      message: "Vehicle history generated successfully",
      data: reportData,
    });
  } catch (error) {
    console.error("Get Vehicle History Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Failed to generate vehicle history report",
    });
  }
};

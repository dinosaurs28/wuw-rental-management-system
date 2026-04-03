import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { BookingStatus, PaymentStatus } from "@repo/database/client";
import { exportSalesReportToExcel } from "../../utils/exportToExcel.js";
import { exportSalesReportToCSV } from "../../utils/exportToCSV.js";

/**
 * Sales Report Controller
 * GET /api/dashboard/reports/sales
 *
 * Query Parameters:
 * - startDate: YYYY-MM-DD (required)
 * - endDate: YYYY-MM-DD (required)
 * - branchId: string (optional) - Filter by branch public ID
 * - status: BookingStatus (optional) - Filter by booking status
 * - paymentStatus: PaymentStatus (optional) - Filter by payment status
 * - page: number (optional, default: 1)
 * - limit: number (optional, default: 50, max: 100)
 * - export: 'xlsx' | 'csv' (optional)
 */
export const GetSalesReport = async (req: Request, res: Response) => {
  try {
    const {
      startDate,
      endDate,
      branchId,
      status,
      paymentStatus,
      page = "1",
      limit = "50",
      export: exportFormat,
    } = req.query;

    // Validate required parameters
    if (!startDate || !endDate) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "startDate and endDate are required (format: YYYY-MM-DD)",
      });
    }

    // Parse and validate dates
    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid date format. Use YYYY-MM-DD",
      });
    }

    // Set time boundaries
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // Pagination
    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const whereClause: any = {
      createdAt: { gte: start, lte: end },
      deletedAt: null,
    };

    // Branch filter
    let branchFilter: { id: number } | undefined;
    if (branchId) {
      const branch = await prisma.branch.findUnique({
        where: { publicId: branchId as string },
        select: { id: true },
      });

      if (!branch) {
        return res.status(StatusCode.NOT_FOUND).json({
          message: "Branch not found",
        });
      }

      whereClause.branchId = branch.id;
      branchFilter = { id: branch.id };
    }

    // Status filter — default to revenue statuses when not explicitly filtered
    if (
      status &&
      Object.values(BookingStatus).includes(status as BookingStatus)
    ) {
      whereClause.status = status as BookingStatus;
    } else {
      // Revenue = confirmed/active/returned bookings (excludes HOLD, CANCELLED, HOLD_EXPIRED)
      whereClause.status = { in: [BookingStatus.CONFIRMED, BookingStatus.PICKED_UP, BookingStatus.RETURNED] };
    }

    // Payment status filter
    if (
      paymentStatus &&
      Object.values(PaymentStatus).includes(paymentStatus as PaymentStatus)
    ) {
      whereClause.paymentStatus = paymentStatus as PaymentStatus;
    }

    // ========================================================================
    // Execute queries in parallel
    // ========================================================================

    const [
      // Paginated bookings data
      bookings,

      // Total count for pagination
      totalCount,

      // Summary aggregates
      summaryMetrics,

      // Breakdown by status
      statusBreakdown,

      // Breakdown by branch
      branchBreakdown,

      // Breakdown by category (via vehicle relation)
      // This requires a more complex query
    ] = await Promise.all([
      // Fetch bookings with all related data
      prisma.booking.findMany({
        where: whereClause,
        include: {
          customer: {
            include: {
              user: {
                select: {
                  name: true,
                  phone: true,
                  email: true,
                },
              },
            },
          },
          items: {
            include: {
              vehicle: {
                select: {
                  regNo: true,
                  make: true,
                  model: true,
                  category: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
          branch: {
            select: {
              name: true,
            },
          },
          invoice: {
            select: {
              publicId: true,
              tax: true,
              total: true,
              status: true,
            },
          },
          deposit: {
            select: {
              amount: true,
              method: true,
            },
          },
          createdBy: {
            select: {
              name: true,
            },
          },
        },
        skip: exportFormat ? undefined : skip,
        take: exportFormat ? undefined : limitNum,
        orderBy: { createdAt: "desc" },
      }),

      // Total count
      prisma.booking.count({ where: whereClause }),

      // Summary aggregates
      prisma.booking.aggregate({
        where: whereClause,
        _sum: {
          totalFinal: true,
          totalDeposit: true,
          totalBase: true,
          totalDiscount: true,
        },
        _avg: {
          totalFinal: true,
        },
        _count: true,
      }),

      // Breakdown by status
      prisma.booking.groupBy({
        by: ["status"],
        where: whereClause,
        _sum: {
          totalFinal: true,
        },
        _count: true,
      }),

      // Breakdown by branch
      prisma.booking.groupBy({
        by: ["branchId"],
        where: whereClause,
        _sum: {
          totalFinal: true,
        },
        _count: true,
      }),
    ]);

    // Get branch names for breakdown
    const branchIds = branchBreakdown.map((b) => b.branchId);
    const branchesData = await prisma.branch.findMany({
      where: { id: { in: branchIds } },
      select: { id: true, name: true },
    });

    const branchMap = Object.fromEntries(
      branchesData.map((b) => [b.id, b.name]),
    );

    // Category breakdown (manual aggregation from bookings)
    const categoryBreakdown = bookings.reduce((acc: any, booking) => {
      booking.items.forEach((item) => {
        const categoryName = item.vehicle.category.name;
        if (!acc[categoryName]) {
          acc[categoryName] = {
            category: categoryName,
            count: 0,
            revenue: 0,
          };
        }
        acc[categoryName].count++;
        acc[categoryName].revenue += Number(item.finalTotal || 0);
      });
      return acc;
    }, {});

    // ========================================================================
    // Format response data
    // ========================================================================

    // Calculate tax collected (from invoices)
    const taxCollected = bookings.reduce((sum, booking) => {
      return sum + Number(booking.invoice?.tax || 0);
    }, 0);

    // Calculate net revenue (after discounts)
    const totalRevenue = Number(summaryMetrics._sum.totalFinal || 0);
    const totalDiscounts = Number(summaryMetrics._sum.totalDiscount || 0);
    const netRevenue = totalRevenue - totalDiscounts;

    // Collected amount per booking from PaymentTransaction (COLLECTED or CONFIRMED,
    // excluding safety deposits and refunds which are not rental revenue)
    const REVENUE_PURPOSES = ["ADVANCE", "REMAINING_BALANCE", "FULL_PAYMENT", "EXTENSION", "DAMAGE_FEE"];
    const bookingIds = bookings.map((b) => b.id);
    const collectedTxns = await prisma.paymentTransaction.findMany({
      where: {
        bookingId: { in: bookingIds },
        status: { in: ["COLLECTED", "CONFIRMED"] },
        purpose: { in: REVENUE_PURPOSES as any },
      },
      select: { bookingId: true, totalAmount: true },
    });
    const collectedByBooking = collectedTxns.reduce<Record<number, number>>((acc, t) => {
      acc[t.bookingId] = (acc[t.bookingId] ?? 0) + Number(t.totalAmount);
      return acc;
    }, {});

    const outstandingAmount = bookings.reduce((sum, booking) => {
      const collected = collectedByBooking[booking.id] ?? 0;
      const due = Math.max(0, Number(booking.totalFinal) - collected);
      return sum + due;
    }, 0);

    // Format bookings data
    const formattedBookings = bookings.map((booking) => ({
      bookingId: booking.publicId,
      bookingDate: booking.createdAt.toISOString(),
      invoiceNumber: booking.invoice?.publicId || "N/A",
      customer: {
        name: booking.customer.user.name,
        phone: booking.customer.user.phone,
        email: booking.customer.user.email,
      },
      vehicle: {
        regNo: booking.items[0]?.vehicle.regNo || "N/A",
        details: booking.items[0]
          ? `${booking.items[0].vehicle.make} ${booking.items[0].vehicle.model}`
          : "N/A",
      },
      period: {
        startDate: booking.startAt.toISOString(),
        endDate: booking.endAt.toISOString(),
        days: booking.days,
      },
      financial: {
        baseAmount: Number(booking.totalBase),
        discount: Number(booking.totalDiscount),
        taxableAmount:
          Number(booking.totalBase) - Number(booking.totalDiscount),
        cgst: Number(booking.invoice?.tax || 0) / 2,
        sgst: Number(booking.invoice?.tax || 0) / 2,
        totalTax: Number(booking.invoice?.tax || 0),
        depositAmount: Number(booking.totalDeposit),
        totalAmount: Number(booking.totalFinal),
        amountPaid: collectedByBooking[booking.id] ?? 0,
        balanceAmount: Math.max(0, Number(booking.totalFinal) - (collectedByBooking[booking.id] ?? 0)),
      },
      payment: {
        depositMethod: booking.depositMethod || "N/A",
        paymentStatus: booking.paymentStatus,
        transactionId: booking.transactionId || undefined,
      },
      status: booking.status,
      branch: booking.branch.name,
      createdBy: booking.createdBy.name,
    }));

    // Calculate pagination
    const totalPages = Math.ceil(totalCount / limitNum);

    const reportData = {
      metadata: {
        period: {
          start: startDate,
          end: endDate,
        },
        filters: {
          branch: branchFilter ? branchMap[branchFilter.id] : "All Branches",
          status: status || "All",
        },
        generatedAt: new Date().toISOString(),
      },
      summary: {
        totalRevenue,
        totalBookings: summaryMetrics._count,
        averageBookingValue: Number(summaryMetrics._avg.totalFinal || 0),
        taxCollected,
        depositsCollected: Number(summaryMetrics._sum.totalDeposit || 0),
        netRevenue,
        outstandingAmount,
      },
      breakdown: {
        byStatus: statusBreakdown.map((item) => ({
          status: item.status,
          count: item._count,
          revenue: Number(item._sum.totalFinal || 0),
        })),
        byBranch: branchBreakdown.map((item) => ({
          branch: branchMap[item.branchId] || "Unknown",
          count: item._count,
          revenue: Number(item._sum.totalFinal || 0),
        })),
        byCategory: Object.values(categoryBreakdown),
      },
      data: formattedBookings,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalRecords: totalCount,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      },
    };

    // ========================================================================
    // Handle export if requested
    // ========================================================================

    if (exportFormat === "xlsx") {
      const filename = `sales-report-${startDate}-${endDate}`;
      return await exportSalesReportToExcel(res, reportData, filename);
    }

    if (exportFormat === "csv") {
      const filename = `sales-report-${startDate}-${endDate}`;
      return exportSalesReportToCSV(res, reportData, filename);
    }

    // Return JSON response
    return res.status(StatusCode.OK).json({
      message: "Sales report generated successfully",
      data: reportData,
    });
  } catch (error) {
    console.error("Get Sales Report Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Failed to generate sales report",
    });
  }
};

import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { exportCollectionToExcel } from "../../utils/exportToExcel.js";
import { exportCollectionToCSV } from "../../utils/exportToCSV.js";

/**
 * Collection Report Controller
 * GET /api/dashboard/reports/collection
 *
 * Query Parameters:
 * - startDate: string (required) - Format: YYYY-MM-DD
 * - endDate: string (required) - Format: YYYY-MM-DD
 * - branchId: string (optional) - Filter by branch
 * - paymentMethod: 'CASH' | 'UPI' | 'ONLINE' | 'all' (optional) - Default: 'all'
 * - export: 'xlsx' | 'csv' (optional)
 */
export const GetCollectionReport = async (req: Request, res: Response) => {
  try {
    const {
      startDate,
      endDate,
      branchId,
      paymentMethod = "all",
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

    // Build filter conditions for payments
    const paymentFilter: any = {
      createdAt: {
        gte: start,
        lte: end,
      },
    };

    if (paymentMethod && paymentMethod !== "all") {
      paymentFilter.method =
        paymentMethod === "ONLINE" ? "ONLINE_RAZORPAY" : paymentMethod;
    }

    // Build filter for branch
    let branchFilter: any = {};
    if (branchId && branchId !== "all") {
      const branch = await prisma.branch.findUnique({
        where: { publicId: branchId as string },
      });
      if (branch) {
        branchFilter = { branchId: branch.id };
      }
    }

    // ========================================================================
    // Fetch payment data
    // ========================================================================

    const [payments, branches] = await Promise.all([
      prisma.payment.findMany({
        where: {
          ...paymentFilter,
          invoice: {
            booking: branchFilter.branchId
              ? {
                  branchId: branchFilter.branchId,
                }
              : undefined,
          },
        },
        include: {
          invoice: {
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
                  branch: {
                    select: {
                      id: true,
                      name: true,
                      publicId: true,
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
      }),

      // Fetch all branches for breakdown
      prisma.branch.findMany({
        where: {
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          publicId: true,
        },
      }),
    ]);

    // ========================================================================
    // Calculate summary metrics
    // ========================================================================

    const totalCollected = payments.reduce(
      (sum, payment) => sum + Number(payment.amount),
      0,
    );
    const totalTransactions = payments.length;

    // Payment method breakdown
    const methodBreakdown = {
      CASH: {
        amount: 0,
        count: 0,
      },
      UPI: {
        amount: 0,
        count: 0,
      },
      ONLINE_RAZORPAY: {
        amount: 0,
        count: 0,
      },
    };

    payments.forEach((payment) => {
      if (payment.method in methodBreakdown) {
        methodBreakdown[payment.method].amount += Number(payment.amount);
        methodBreakdown[payment.method].count += 1;
      }
    });

    // Branch-wise breakdown
    const branchBreakdown: Record<string, any> = {};
    branches.forEach((branch) => {
      branchBreakdown[branch.id] = {
        branchName: branch.name,
        branchId: branch.publicId,
        totalCollected: 0,
        transactionCount: 0,
        byMethod: {
          CASH: 0,
          UPI: 0,
          ONLINE_RAZORPAY: 0,
        },
      };
    });

    payments.forEach((payment) => {
      const branchId = payment.invoice.booking.branch.id;
      if (branchBreakdown[branchId]) {
        branchBreakdown[branchId].totalCollected += Number(payment.amount);
        branchBreakdown[branchId].transactionCount += 1;
        if (payment.method in branchBreakdown[branchId].byMethod) {
          branchBreakdown[branchId].byMethod[payment.method] += Number(
            payment.amount,
          );
        }
      }
    });

    // Daily collection trend (group by date)
    const dailyTrend: Record<
      string,
      { date: string; amount: number; count: number }
    > = {};
    payments.forEach((payment) => {
      const dateKey = payment.createdAt.toISOString().split("T")[0] as string;
      if (!dailyTrend[dateKey]) {
        dailyTrend[dateKey] = {
          date: dateKey,
          amount: 0,
          count: 0,
        };
      }
      dailyTrend[dateKey]!.amount += Number(payment.amount);
      dailyTrend[dateKey]!.count += 1;
    });

    // ========================================================================
    // Format payment details
    // ========================================================================

    const paymentDetails = payments.map((payment) => ({
      paymentId: payment.publicId,
      bookingId: payment.invoice.booking.publicId,
      customerName: payment.invoice.booking.customer.user.name,
      customerPhone: payment.invoice.booking.customer.user.phone,
      amount: Number(payment.amount),
      method: payment.method,
      // type: payment.type, // property does not exist on Payment
      branch: payment.invoice.booking.branch.name,
      collectedAt: payment.createdAt.toISOString(),
    }));

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
        paymentMethod: paymentMethod || "All Methods",
      },
      summary: {
        totalCollected,
        totalTransactions,
        averageTransaction:
          totalTransactions > 0 ? totalCollected / totalTransactions : 0,
        methodBreakdown,
      },
      branchBreakdown: Object.values(branchBreakdown),
      dailyTrend: Object.values(dailyTrend).sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
      payments: paymentDetails,
    };

    // ========================================================================
    // Handle export if requested
    // ========================================================================

    if (exportFormat === "xlsx") {
      const filename = `collection-report-${start.toISOString().split("T")[0]}-${end.toISOString().split("T")[0]}`;
      return await exportCollectionToExcel(res, reportData, filename);
    }

    if (exportFormat === "csv") {
      const filename = `collection-report-${start.toISOString().split("T")[0]}-${end.toISOString().split("T")[0]}`;
      return exportCollectionToCSV(res, reportData, filename);
    }

    // Return JSON response
    return res.status(StatusCode.OK).json({
      message: "Collection report generated successfully",
      data: reportData,
    });
  } catch (error) {
    console.error("Get Collection Report Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Failed to generate collection report",
    });
  }
};

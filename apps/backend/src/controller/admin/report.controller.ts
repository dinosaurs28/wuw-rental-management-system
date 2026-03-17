import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { BookingStatus, PaymentStatus } from "@repo/database/client";

export const GetBranchRevenue = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, branchId, reportType } = req.query; // reportType: 'revenue_only' | 'net_profit' (default)

    // Date Filtering
    const start = startDate ? new Date(startDate as string) : new Date(0); // Beginning of time if not specified
    const end = endDate ? new Date(endDate as string) : new Date();

    // Branch Filtering
    const branchWhere = branchId ? { publicId: branchId as string } : {};

    // 1. Fetch Branches
    const branches = await prisma.branch.findMany({
      where: branchWhere,
      select: { id: true, publicId: true, name: true },
    });

    const report = await Promise.all(
      branches.map(async (branch) => {
        const revenueAgg = await prisma.booking.aggregate({
          where: {
            branchId: branch.id,
            OR: [
              { status: BookingStatus.CONFIRMED },
              { paymentStatus: PaymentStatus.SUCCESS },
            ],
            createdAt: {
              gte: start,
              lte: end,
            },
          },
          _sum: {
            totalFinal: true,
          },
        });

        let totalExpenses = 0;

        if (reportType !== "revenue_only") {
          const expenseAgg = await prisma.vehicleMaintenanceRecord.aggregate({
            where: {
              vehicle: {
                branchId: branch.id,
              },
              servicedAt: {
                gte: start,
                lte: end,
              },
            },
            _sum: {
              cost: true,
            },
          });
          totalExpenses = Number(expenseAgg._sum.cost || 0);
        }

        const totalRevenue = Number(revenueAgg._sum.totalFinal || 0);

        return {
          branchId: branch.publicId,
          branchName: branch.name,
          totalRevenue,
          totalExpenses:
            reportType === "revenue_only" ? undefined : totalExpenses,
          netProfit: totalRevenue - totalExpenses,
          currency: "INR", // Or configured currency
        };
      }),
    );

    return res.status(StatusCode.OK).json({
      message: "Revenue report generated successfully",
      dateRange: { start, end },
      data: report,
    });
  } catch (error) {
    console.error("Get Branch Revenue Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};

import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";

export const GetRevenueStats = async (req: Request, res: Response) => {
    const branchId = req.branch_Id;

    const { date } = req.query;

    try {
        const targetDate = date ? new Date(date as string) : new Date();
        if (date && isNaN(targetDate.getTime())) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Invalid Date Format"
            });
        }

        const dateKey = targetDate.toISOString().split('T')[0];
        const cacheKey = `branch:${branchId}:revenue_stats:${dateKey}`;
        const cachedData = await redis.get(cacheKey);

        if (cachedData) {
            return res.status(StatusCode.OK).json({
                message: "Revenue stats fetched successfully (cached)",
                data: JSON.parse(cachedData)
            });
        }

        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        const startOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
        const endOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);
        endOfMonth.setHours(23, 59, 59, 999);

        const totalRevenueAgg = await prisma.booking.aggregate({
            _sum: {
                totalFinal: true
            },
            where: {
                branchId: branchId,
                status: {
                    not: BookingStatus.CANCELLED
                }
            }
        });

        const monthRevenueAgg = await prisma.booking.aggregate({
            _sum: {
                totalFinal: true
            },
            where: {
                branchId: branchId,
                status: {
                    not: BookingStatus.CANCELLED
                },
                createdAt: {
                    gte: startOfMonth,
                    lte: endOfMonth
                }
            }
        });

        const todayRevenueAgg = await prisma.booking.aggregate({
            _sum: {
                totalFinal: true
            },
            where: {
                branchId: branchId,
                status: {
                    not: BookingStatus.CANCELLED
                },
                createdAt: {
                    gte: startOfDay,
                    lte: endOfDay
                }
            }
        });

        const stats = {
            totalRevenue: totalRevenueAgg._sum.totalFinal || 0,
            monthRevenue: monthRevenueAgg._sum.totalFinal || 0,
            todayRevenue: todayRevenueAgg._sum.totalFinal || 0,
            generatedAt: new Date().toISOString()
        };

        await redis.setex(cacheKey, 300, JSON.stringify(stats));

        return res.status(StatusCode.OK).json({
            message: "Revenue stats fetched successfully",
            data: stats
        });

    } catch (error) {
        console.error("Revenue Stats Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error fetching revenue stats"
        });
    }
}

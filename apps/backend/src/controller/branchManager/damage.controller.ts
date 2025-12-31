import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";

export const GetDamageReports = async (req: Request, res: Response) => {
    const branchId = req.branch_Id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const { date } = req.query;

    let dateFilter: any = {};
    let dateKey: string | undefined = 'all';

    if (date) {
        const targetDate = new Date(date as string);
        if (!isNaN(targetDate.getTime())) {
            const startOfDay = new Date(targetDate);
            startOfDay.setHours(0, 0, 0, 0);

            const endOfDay = new Date(targetDate);
            endOfDay.setHours(23, 59, 59, 999);

            dateFilter = {
                createdAt: {
                    gte: startOfDay,
                    lte: endOfDay
                }
            };
            dateKey = targetDate.toISOString().split('T')[0] as string;
        }
    }

    try {
        const cacheKey = `branch:${branchId}:damage_reports:${dateKey}:${page}:${limit}`;
        const cachedData = await redis.get(cacheKey);

        if (cachedData) {
            return res.status(StatusCode.OK).json({
                message: "Damage reports fetched successfully (cached)",
                data: JSON.parse(cachedData)
            });
        }

        const whereCondition = {
            booking: {
                branchId: branchId
            },
            damageCharges: {
                gt: 0
            },
            ...dateFilter
        };

        const totalCount = await prisma.invoice.count({
            where: whereCondition
        });

        const reports = await prisma.invoice.findMany({
            where: whereCondition,
            select: {
                id: true,
                publicId: true,
                damageCharges: true,
                total: true,
                createdAt: true,
                booking: {
                    select: {
                        publicId: true,
                        customer: {
                            select: {
                                user: {
                                    select: {
                                        name: true,
                                        email: true
                                    }
                                }
                            }
                        },
                        items: {
                            select: {
                                vehicle: {
                                    select: {
                                        make: true,
                                        model: true,
                                        regNo: true
                                    }
                                }
                            }
                        }
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: limit,
            skip: skip
        });

        const responseData = {
            reports,
            pagination: {
                total: totalCount,
                page: page,
                limit: limit,
                totalPages: Math.ceil(totalCount / limit)
            }
        };

        await redis.setex(cacheKey, 60, JSON.stringify(responseData));

        return res.status(StatusCode.OK).json({
            message: "Damage reports fetched successfully",
            data: responseData
        });

    } catch (error) {
        console.error("Damage Reports Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error fetching damage reports"
        });
    }
}

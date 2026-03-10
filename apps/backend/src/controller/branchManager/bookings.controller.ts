import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { TimezoneService } from "../../services/timezone/timezone.service.js";

export const GetActiveBookings = async (req: Request, res: Response) => {
    const branchId = req.branch_Id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const { date } = req.query;

    let dateFilter: any = {};
    let dateKey: string | undefined = 'all';

    if (date) {
        const targetDateDt = TimezoneService.parseISO(date as string);
        if (targetDateDt.isValid) {
            const startOfDayDt = TimezoneService.startOfDay(targetDateDt);
            const endOfDayDt = TimezoneService.endOfDay(targetDateDt);

            dateFilter = {
                startAt: {
                    gte: TimezoneService.toPrisma(startOfDayDt),
                    lte: TimezoneService.toPrisma(endOfDayDt)
                }
            };
            dateKey = targetDateDt.toFormat('yyyy-MM-dd');
        }
    }

    try {
        const cacheKey = `branch:${branchId}:active_bookings:${dateKey}:${page}:${limit}`;
        const cachedData = await redis.get(cacheKey);

        if (cachedData) {
            return res.status(StatusCode.OK).json({
                message: "Active bookings fetched successfully (cached)",
                data: JSON.parse(cachedData)
            });
        }

        const totalCount = await prisma.booking.count({
            where: {
                branchId: branchId,
                status: BookingStatus.CONFIRMED,
                ...dateFilter
            }
        });

        const bookings = await prisma.booking.findMany({
            where: {
                branchId: branchId,
                status: BookingStatus.CONFIRMED,
                ...dateFilter
            },
            select: {
                id: true,
                publicId: true,
                startAt: true,
                endAt: true,
                totalFinal: true,
                status: true,
                customer: {
                    select: {
                        id: true,
                        publicId: true,
                        user: {
                            select: {
                                name: true,
                                email: true,
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
                                regNo: true,
                                images: {
                                    where: {
                                        isThumbnail: true
                                    },
                                    take: 1,
                                    select: {
                                        file: {
                                            select: {
                                                url: true
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            orderBy: {
                startAt: 'asc'
            },
            take: limit,
            skip: skip
        });

        const responseData = {
            bookings,
            pagination: {
                total: totalCount,
                page: page,
                limit: limit,
                totalPages: Math.ceil(totalCount / limit)
            }
        };

        await redis.setex(cacheKey, 60, JSON.stringify(responseData));

        return res.status(StatusCode.OK).json({
            message: "Active bookings fetched successfully",
            data: responseData
        });

    } catch (error) {
        console.error("Active Bookings Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error fetching active bookings"
        });
    }
}

export const GetPendingApprovals = async (req: Request, res: Response) => {
    const branchId = req.branch_Id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const { date } = req.query;

    let dateFilter: any = {};
    let dateKey: string | undefined = 'all';

    if (date) {
        const targetDateDt = TimezoneService.parseISO(date as string);
        if (targetDateDt.isValid) {
            const startOfDayDt = TimezoneService.startOfDay(targetDateDt);
            const endOfDayDt = TimezoneService.endOfDay(targetDateDt);

            dateFilter = {
                startAt: {
                    gte: TimezoneService.toPrisma(startOfDayDt),
                    lte: TimezoneService.toPrisma(endOfDayDt)
                }
            };
            dateKey = targetDateDt.toFormat('yyyy-MM-dd');
        }
    }

    try {
        const cacheKey = `branch:${branchId}:pending_approvals:${dateKey}:${page}:${limit}`;
        const cachedData = await redis.get(cacheKey);

        if (cachedData) {
            return res.status(StatusCode.OK).json({
                message: "Pending approvals fetched successfully (cached)",
                data: JSON.parse(cachedData)
            });
        }

        const totalCount = await prisma.booking.count({
            where: {
                branchId: branchId,
                status: BookingStatus.PICKED_UP,
                ...dateFilter
            }
        });

        const bookings = await prisma.booking.findMany({
            where: {
                branchId: branchId,
                status: BookingStatus.PICKED_UP,
                ...dateFilter
            },
            select: {
                id: true,
                publicId: true,
                startAt: true,
                endAt: true,
                totalFinal: true,
                status: true,
                customer: {
                    select: {
                        id: true,
                        publicId: true,
                        user: {
                            select: {
                                name: true,
                                email: true,
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
                                regNo: true,
                                images: {
                                    where: {
                                        isThumbnail: true
                                    },
                                    take: 1,
                                    select: {
                                        file: {
                                            select: {
                                                url: true
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            orderBy: {
                startAt: 'asc'
            },
            take: limit,
            skip: skip
        });

        const responseData = {
            bookings,
            pagination: {
                total: totalCount,
                page: page,
                limit: limit,
                totalPages: Math.ceil(totalCount / limit)
            }
        };

        await redis.setex(cacheKey, 60, JSON.stringify(responseData));

        return res.status(StatusCode.OK).json({
            message: "Pending approvals fetched successfully",
            data: responseData
        });

    } catch (error) {
        console.error("Pending Approvals Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error fetching pending approvals"
        });
    }
}

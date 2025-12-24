import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { BookingStatus, prisma } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";

export const returnController = async (req: Request, res: Response) => {
    try {
        const branchId = req.branch_Id;
        const { date } = req.query;

        let filterDate = new Date();

        if (date) {
            const parsedDate = new Date(date as string);
            if (!isNaN(parsedDate.getTime())) {
                filterDate = parsedDate;
            }
        }
        const startOfDay = new Date(filterDate);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(filterDate);
        endOfDay.setHours(23, 59, 59, 999);

        const cacheKey = `returns:${branchId}:${startOfDay.toISOString()}`;
        const cachedData = await redis.get(cacheKey);

        if (cachedData) {
            return res.status(StatusCode.OK).json({
                message: "Return bookings fetched successfully",
                data: JSON.parse(cachedData)
            });
        }

        const bookings = await prisma.booking.findMany({
            where: {
                branchId: branchId,
                endAt: {
                    gte: startOfDay,
                    lte: endOfDay
                },
                status: {
                    in: [BookingStatus.PICKED_UP]
                }
            },
            select: {
                publicId: true,
                startAt: true,
                endAt: true,
                status: true,
                totalFinal: true,
                customer: {
                    select: {
                        user: {
                            select: {
                                publicId: true,
                                name: true,
                                email: true,
                                // phone: true 
                            }
                        }
                    }
                },
                items: {
                    select: {
                        vehicle: {
                            select: {
                                publicId: true,
                                make: true,
                                model: true,
                                regNo: true,
                                status: true,
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
                endAt: 'asc'
            }
        });

        if (bookings.length === 0) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "No Returns Scheduled for this Date"
            })
        }

        await redis.setex(cacheKey, 60, JSON.stringify(bookings));

        return res.status(StatusCode.OK).json({
            message: "Return bookings fetched successfully",
            data: bookings
        });

    } catch (error) {
        console.error("Error fetching return bookings:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error While Fetching Returns"
        });
    }
}

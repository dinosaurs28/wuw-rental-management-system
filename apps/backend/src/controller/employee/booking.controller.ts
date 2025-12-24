import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";

export const BookingController = async (req: Request, res: Response) => {
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

        filterDate.setHours(0, 0, 0, 0);

        const cacheKey = `bookings:${branchId}:${filterDate.toISOString()}`;
        const cachedData = await redis.get(cacheKey);

        if (cachedData) {
            return res.status(StatusCode.OK).json({
                message: "Upcoming bookings fetched successfully",
                data: JSON.parse(cachedData)
            });
        }

        const bookings = await prisma.booking.findMany({
            where: {
                branchId: branchId,
                startAt: {
                    gte: filterDate
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
                                name: true,
                                // phone: true // Assuming phone is on User, otherwise check Schema
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
                startAt: 'asc'
            }
        });

        if (bookings.length === 0) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "No Upcoming Bookings Found"
            })
        }
        await redis.setex(cacheKey, 60, JSON.stringify(bookings));

        return res.status(StatusCode.OK).json({
            message: "Upcoming bookings fetched successfully",
            data: bookings
        });

    } catch (error) {
        console.error("Error fetching bookings:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error While Fetching Bookings"
        });
    }
}

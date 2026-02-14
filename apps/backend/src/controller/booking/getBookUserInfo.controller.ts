import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";

export const getUserBookings = async (req: Request, res: Response) => {
    try {
        const userPublicId = req.public_Id;

        if (!userPublicId) {
            return res.status(StatusCode.UNAUTHORIZED).json({
                message: "Unauthorized",
            });
        }
        const user = await prisma.user.findUnique({
            where: { publicId: userPublicId },
            select: {
                customerProfile: {
                    select: { id: true },
                },
            },
        });

        if (!user?.customerProfile) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Customer profile not found",
            });
        }

        const customerId = user.customerProfile.id;

        const page = Number(req.query.page || 1);
        const limit = Number(req.query.limit || 10);
        if (!Number.isInteger(page) || !Number.isInteger(limit)) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Pagination parameters (page, limit) must be valid numbers",
            });
        }
        const skip = (page - 1) * limit;

        const bookings = await prisma.booking.findMany({
            where: {
                customerId,
                deletedAt: null,
            },
            orderBy: {
                createdAt: "desc",
            },
            skip,
            take: limit,
            include: {
                items: {
                    include: {
                        vehicle: {
                            select: {
                                publicId: true,
                                make: true,
                                model: true,
                                images: {
                                    where: { isThumbnail: true },
                                    include: { file: true },
                                    take: 1,
                                },
                            },
                        },
                    },
                },
            },
        });


        const totalCount = await prisma.booking.count({
            where: {
                customerId,
                deletedAt: null,
            },
        });


        const data = bookings.map((booking) => ({
            id: booking.id, // Numeric ID for backend operations (e.g., invoice generation)
            bookingId: booking.publicId,
            status: booking.status,
            paymentStatus: booking.paymentStatus,
            startAt: booking.startAt,
            endAt: booking.endAt,
            days: booking.days,
            total: booking.totalFinal,
            createdAt: booking.createdAt,
            vehicles: booking.items.map((item) => ({
                publicId: item.vehicle.publicId,
                make: item.vehicle.make,
                model: item.vehicle.model,
                thumbnail:
                    item.vehicle.images[0]?.file.url || null,
                finalTotal: item.finalTotal,
            })),
        }));

        return res.status(StatusCode.OK).json({
            message: "Bookings fetched successfully",
            meta: {
                page,
                limit,
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
            },
            data,
        });
    } catch (error) {
        console.error("Error fetching user bookings:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal server error while fetching bookings",
        });
    }
};

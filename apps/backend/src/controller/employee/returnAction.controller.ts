import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, VehicleStatus } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";

export const CompleteReturn = async (req: Request, res: Response) => {
    const { bookingId } = req.params;
    const branchId = req.branch_Id;

    try {
        const booking = await prisma.booking.findFirst({
            where: {
                publicId: bookingId,
                branchId: branchId
            },
            include: {
                items: {
                    select: {
                        vehicleId: true
                    }
                }
            }
        });

        if (!booking) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "Booking not found or access denied"
            });
        }

        if (booking.status !== BookingStatus.PICKED_UP) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: `Cannot complete return. Current status: ${booking.status}`
            });
        }

        const actingUserPublicId = req.public_Id;
        const actingUser = await prisma.user.findUnique({
            where: { publicId: actingUserPublicId },
            select: { id: true }
        });

        if (!actingUser) {
            return res.status(StatusCode.UNAUTHORIZED).json({
                message: "Unauthorized: User not found"
            });
        }

        const vehicleIds = booking.items.map(item => item.vehicleId);

        await prisma.$transaction(async (tx) => {
            await tx.booking.update({
                where: { id: booking.id },
                data: {
                    status: BookingStatus.RETURNED
                }
            });

            await tx.vehicle.updateMany({
                where: {
                    id: { in: vehicleIds }
                },
                data: {
                    status: VehicleStatus.AVAILABLE
                }
            });

            await tx.staffActivityLog.create({
                data: {
                    publicId: createID(),
                    staffId: actingUser.id,
                    action: "VEHICLE_RETURN",
                    entity: "Booking",
                    entityId: booking.publicId
                }
            });
        });

        return res.status(StatusCode.OK).json({
            message: "Return Processed Successfully. Vehicle is now AVAILABLE."
        });

    } catch (error) {
        console.error("Return Action Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error during Return"
        });
    }
}

import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, KycType, KycStatus, VehicleStatus } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";

export const PickupController = async (req: Request, res: Response) => {
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
                },
                customer: {
                    select: {
                        id: true,
                        kycs: {
                            where: {
                                type: KycType.DL,
                                status: KycStatus.APPROVED
                            }
                        }
                    }
                }
            }
        });

        if (!booking) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "Booking not found or access denied"
            });
        }

        if (booking.status !== BookingStatus.CONFIRMED) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: `Cannot pick up vehicle. Current status: ${booking.status}`
            });
        }


        if (!booking.customer.kycs || booking.customer.kycs.length === 0) {
            return res.status(StatusCode.FORBIDDEN).json({
                message: "Pickup Denied: Customer does not have an APPROVED Driving License (DL)."
            });
        }

        const vehicleIds = booking.items.map(item => item.vehicleId);

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

        await prisma.$transaction(async (tx) => {
            await tx.booking.update({
                where: { id: booking.id },
                data: {
                    status: BookingStatus.PICKED_UP
                }
            });

            await tx.vehicle.updateMany({
                where: {
                    id: { in: vehicleIds }
                },
                data: {
                    status: VehicleStatus.OUT_FOR_RENTAL
                }
            });

            await tx.staffActivityLog.create({
                data: {
                    publicId: createID(),
                    staffId: actingUser.id,
                    action: "VEHICLE_PICKUP",
                    entity: "Booking",
                    entityId: booking.publicId
                }
            });
        });

        return res.status(StatusCode.OK).json({
            message: "Vehicle Pickup Successful. Status updated to OUT_FOR_RENTAL."
        });

    } catch (error) {
        console.error("Pickup Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error during Pickup"
        });
    }
}

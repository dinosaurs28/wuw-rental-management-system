import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, VehicleStatus, BookingPhotoType } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";

const getFileUrl = (filename: string) => `/uploads/${filename}`;

export const UploadReturnImage = async (req: Request, res: Response) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "File is required"
            });
        }

        const filePublicId = createID();
        const fileRecord = await prisma.fileObject.create({
            data: {
                publicId: filePublicId,
                key: file.filename,
                url: getFileUrl(file.filename),
                mime: file.mimetype,
                size: file.size,
            }
        });

        return res.status(StatusCode.CREATED).json({
            message: "Return Image Uploaded Successfully",
            fileId: fileRecord.publicId,
            url: fileRecord.url
        });

    } catch (error) {
        console.error("Error uploading return image:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error during upload"
        });
    }
}

export const CompleteReturn = async (req: Request, res: Response) => {
    const { bookingId } = req.params;
    const { returnImageIds } = req.body;
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

            if (returnImageIds && Array.isArray(returnImageIds) && returnImageIds.length > 0) {
                const files = await tx.fileObject.findMany({
                    where: { publicId: { in: returnImageIds } }
                });

                if (files.length !== returnImageIds.length) {
                    throw new Error("Invalid return image IDs provided");
                }

                await tx.bookingPhoto.createMany({
                    data: files.map(f => ({
                        publicId: createID(),
                        bookingId: booking.id,
                        fileId: f.id,
                        type: BookingPhotoType.POST_RETURN
                    }))
                });
            }

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

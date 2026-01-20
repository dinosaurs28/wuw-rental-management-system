import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode";
import { prisma, BookingStatus, BookingPhotoType, VehicleReturnDisposition, DamageReportStatus } from "@repo/database/client";
import { createID } from "../../utils/nanoID";
import { createDamageReportSchema } from "@repo/schemas";

const getFileUrl = (filename: string) => `/uploads/${filename}`;

export const UploadDamageImage = async (req: Request, res: Response) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "File is required"
            });
        }

        // Create FileObject record
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
            message: "Damage Image Uploaded Successfully",
            fileId: fileRecord.publicId,
            url: fileRecord.url
        });

    } catch (error) {
        console.error("Error uploading damage image:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error during upload"
        });
    }
};

export const CreateDamageReport = async (req: Request, res: Response) => {
    try {
        const validation = createDamageReportSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Invalid inputs",
                errors: validation.error.errors
            });
        }

        const { bookingId, odo, fuelLevel, severity, damageImageIds, notes, returnImageIds } = validation.data;
        const staffId = req.public_Id;
        const branchId = req.branch_Id;

        // 2. Fetch Booking & Validate Constraints
        const booking = await prisma.booking.findUnique({
            where: { publicId: bookingId },
            include: {
                branch: true,
                items: {
                    include: { vehicle: true }
                }
            }
        });

        if (!booking) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "Booking not found"
            });
        }

        // Check Branch
        if (booking.branchId !== branchId) {
            return res.status(StatusCode.FORBIDDEN).json({
                message: "Access Denied: Booking does not belong to your branch"
            });
        }

        // Check Status
        const ALLOWED_STATUSES: BookingStatus[] = [BookingStatus.CONFIRMED, BookingStatus.PICKED_UP];
        if (!ALLOWED_STATUSES.includes(booking.status)) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: `Invalid Booking Status. Expected CONFIRMED or PICKED_UP, got ${booking.status}`
            });
        }

        // Get Vehicle from items
        const vehicleItem = booking.items[0];
        if (!vehicleItem || !vehicleItem.vehicle) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Booking has no vehicle assigned"
            });
        }
        const vehicleId = vehicleItem.vehicle.id;

        // 3. Get Staff DB ID
        const staffUser = await prisma.user.findUnique({
            where: { publicId: staffId },
            select: { id: true }
        });
        if (!staffUser) {
            return res.status(StatusCode.UNAUTHORIZED).json({ message: "Staff user not found" });
        }

        // 4. Create Damage Report & Link Photos Transaction
        const damageReportPublicId = createID();

        const result = await prisma.$transaction(async (tx) => {
            // Create Damage Report
            const report = await tx.damageReport.create({
                data: {
                    publicId: damageReportPublicId,
                    bookingId: booking.id,
                    vehicleId: vehicleId,
                    status: DamageReportStatus.PENDING,
                    severity: severity,
                    estimatedCost: 0,
                    notes: notes ?? {},
                }
            });

            // Link Damage Images
            if (damageImageIds.length > 0) {
                // First find the FileObject IDs
                const files = await tx.fileObject.findMany({
                    where: { publicId: { in: damageImageIds } }
                });

                if (files.length !== damageImageIds.length) {
                    throw new Error("Some image IDs were invalid");
                }

                await tx.bookingPhoto.createMany({
                    data: files.map(f => ({
                        publicId: createID(),
                        bookingId: booking.id,
                        fileId: f.id,
                        type: BookingPhotoType.DAMAGE,
                        damageReportId: report.id
                    }))
                });
            }

            // Link Return Images
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

            // Capture ODO & Fuel Level - Update Vehicle
            await tx.vehicle.update({
                where: { id: vehicleId },
                data: {
                    odo: odo,
                    fuelLevel: fuelLevel
                }
            });

            // Log Staff Activity
            await tx.staffActivityLog.create({
                data: {
                    publicId: createID(),
                    staffId: staffUser.id,
                    action: "CREATE_DAMAGE_REPORT",
                    entity: "DamageReport",
                    entityId: report.publicId
                }
            });

            return report;
        });

        return res.status(StatusCode.CREATED).json({
            message: "Damage Report Created Successfully",
            reportId: result.id
        });

    } catch (error) {
        console.error("Error creating damage report:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error"
        });
    }
};

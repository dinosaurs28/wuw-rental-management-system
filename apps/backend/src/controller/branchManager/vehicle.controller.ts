import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { imageQueue } from "../../lib/queue.client.js";
import { VehicleStatus } from "@repo/database/client";
import { editVehicleSchema } from "@repo/schemas";
export const AddVehicle = async (req: Request, res: Response) => {
    const branchId = req.branch_Id;
    const {
        make,
        model,
        regNo,
        odo,
        insuranceExpiry,
        baseDailyPrice,
        categoryId
    } = req.body;

    const files = req.files as Express.Multer.File[];

    try {
        // Validation
        if (!make || !model || !regNo || !baseDailyPrice || !categoryId) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Missing required vehicle fields"
            });
        }

        const existingVehicle = await prisma.vehicle.findUnique({
            where: { regNo }
        });

        if (existingVehicle) {
            return res.status(StatusCode.CONFLICT).json({
                message: "Vehicle with this Registration Number already exists"
            });
        }

        const vehicle = await prisma.vehicle.create({
            data: {
                publicId: createID(),
                branchId: branchId,
                categoryId: parseInt(categoryId),
                make,
                model,
                regNo,
                odo: parseInt(odo) || 0,
                insuranceExpiry: new Date(insuranceExpiry),
                baseDailyPrice: parseFloat(baseDailyPrice),
                status: VehicleStatus.AVAILABLE
            }
        });
        if (files && files.length > 0) {
            const jobPromises = files.map(file => {
                return imageQueue.add('process-vehicle-image', {
                    filePath: file.path,
                    vehicleId: vehicle.id,
                    mimeType: file.mimetype,
                    originalName: file.originalname
                });
            });

            await Promise.all(jobPromises);
        }

        return res.status(StatusCode.CREATED).json({
            message: "Vehicle added successfully. Images are processing in background.",
            data: {
                vehicleId: vehicle.publicId,
                status: "processing"
            }
        });

    } catch (error) {
        console.error("Add Vehicle Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error adding vehicle"
        });
    }
}

export const EditVehicle = async (req: Request, res: Response) => {
    const { vehicleId } = req.params;
    const branchId = req.branch_Id;
    const files = req.files as Express.Multer.File[];

    try {
        const validation = editVehicleSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(StatusCode.BAD_REQUEST).json({
                message: "Invalid update data",
                errors: validation.error.format()
            });
        }

        const data = validation.data;

        const vehicle = await prisma.vehicle.findUnique({
            where: { publicId: vehicleId },
            include: { images: true }
        });

        if (!vehicle || vehicle.branchId !== branchId) {
            return res.status(StatusCode.NOT_FOUND).json({
                message: "Vehicle not found or access denied"
            });
        }

        if (data.regNo && data.regNo !== vehicle.regNo) {
            const existingVehicle = await prisma.vehicle.findUnique({
                where: { regNo: data.regNo }
            });
            if (existingVehicle) {
                return res.status(StatusCode.CONFLICT).json({
                    message: "Vehicle with this Registration Number already exists"
                });
            }
        }

        // Handle Image Deletion
        if (data.deleteImageIds) {
            try {
                const idsToDelete = JSON.parse(data.deleteImageIds);
                if (Array.isArray(idsToDelete) && idsToDelete.length > 0) {
                    const imagesToDelete = await prisma.vehicleImage.findMany({
                        where: {
                            vehicleId: vehicle.id,
                            publicId: { in: idsToDelete }
                        }
                    });

                    if (imagesToDelete.length > 0) {
                        await prisma.vehicleImage.deleteMany({
                            where: {
                                id: { in: imagesToDelete.map(img => img.id) }
                            }
                        });
                    }
                }
            } catch (e) {
                console.warn("Failed to parse deleteImageIds", e);
            }
        }

        const updateData: any = { ...data };
        delete updateData.deleteImageIds;
        if (data.insuranceExpiry) {
            updateData.insuranceExpiry = new Date(data.insuranceExpiry);
        }

        if (data.status) {
            updateData.status = data.status as VehicleStatus;
        }

        await prisma.vehicle.update({
            where: { id: vehicle.id },
            data: updateData
        });

        // Handle New Images
        if (files && files.length > 0) {
            const jobPromises = files.map(file => {
                return imageQueue.add('process-vehicle-image', {
                    filePath: file.path,
                    vehicleId: vehicle.id,
                    mimeType: file.mimetype,
                    originalName: file.originalname
                });
            });
            await Promise.all(jobPromises);
        }

        return res.status(StatusCode.OK).json({
            message: "Vehicle updated successfully",
        });

    } catch (error) {
        console.error("Edit Vehicle Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error editing vehicle"
        });
    }
}

export const GetInsuranceExpiryReport = async (req: Request, res: Response) => {
    const branchId = req.branch_Id;
    const { q } = req.query;

    const whereClause: any = {
        branchId: branchId,
        deletedAt: null
    };

    if (q) {
        const search = q as string;
        whereClause.OR = [
            { regNo: { contains: search, mode: 'insensitive' } },
            { make: { contains: search, mode: 'insensitive' } },
            { model: { contains: search, mode: 'insensitive' } }
        ];
    }

    try {
        const vehicles = await prisma.vehicle.findMany({
            where: whereClause,
            select: {
                id: true,
                publicId: true,
                make: true,
                model: true,
                regNo: true,
                insuranceExpiry: true,
                images: {
                    where: { isThumbnail: true },
                    select: {
                        file: {
                            select: { url: true }
                        }
                    },
                    take: 1
                },
                insuranceRecords: {
                    orderBy: { validTill: 'desc' },
                    take: 1,
                    select: {
                        policyNumber: true,
                        provider: true,
                        validTill: true
                    }
                }
            },
            orderBy: {
                insuranceExpiry: 'asc' // Soonest expiry first
            }
        });

        const reportData = vehicles.map(v => {
            const latestInsurance = v.insuranceRecords[0];
            return {
                vehicleName: `${v.make} ${v.model}`,
                thumbnail: v.images[0]?.file.url || null,
                make: v.make,
                model: v.model,
                regNo: v.regNo,
                policyNumber: latestInsurance?.policyNumber || "N/A",
                provider: latestInsurance?.provider || "N/A",
                expiryDate: v.insuranceExpiry
            };
        });

        return res.status(StatusCode.OK).json({
            data: reportData
        });

    } catch (error) {
        console.error("GetInsuranceExpiryReport Error:", error);
        return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
            message: "Internal Server Error fetching insurance report"
        });
    }
}


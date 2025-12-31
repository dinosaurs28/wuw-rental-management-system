import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { imageQueue } from "../../lib/queue.client.js";
import { VehicleStatus } from "@repo/database/client";

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

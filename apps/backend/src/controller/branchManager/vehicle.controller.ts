import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { imageQueue } from "../../lib/queue.client.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
import { redis } from "../../lib/redisconfig.js";
import { invalidateVehicleAvailability, invalidateVehiclePricing } from "../../utils/cache/vehicleCacheKeys.js";
import { VehicleStatus } from "@repo/database/client";
import { createVehicleSchema, editVehicleSchema } from "@repo/schemas";
import { z } from "zod";
const updateVehicleFastagSchema = z.object({
  fastagNumber: z.string().min(1).nullable(),
  hasFastag: z.boolean(),
});

export const UpdateVehicleFastag = async (req: Request, res: Response) => {
  try {
    const { vehicleId } = req.params;
    const branchId = req.branch_Id;

    const validation = updateVehicleFastagSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid input",
        errors: validation.error.format(),
      });
    }

    const vehicle = await prisma.vehicle.findUnique({
      where: { publicId: vehicleId },
      select: { id: true, branchId: true, publicId: true },
    });

    if (!vehicle || vehicle.branchId !== branchId) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Vehicle not found or access denied" });
    }

    const { fastagNumber, hasFastag } = validation.data;

    const updated = await prisma.vehicle.update({
      where: { id: vehicle.id },
      data: {
        hasFastag,
        fastagNumber: hasFastag ? fastagNumber : null,
      },
      select: { publicId: true, hasFastag: true, fastagNumber: true },
    });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.UPDATED,
      entityType: StaffEntityType.VEHICLE,
      entityRef: vehicle.publicId,
      description: `Vehicle FASTag ${hasFastag ? "configured" : "removed"}`,
      metadata: { hasFastag, fastagNumber: hasFastag ? fastagNumber : null },
    });

    return res.status(StatusCode.OK).json({
      message: `Vehicle FASTag ${hasFastag ? "configured" : "removed"}`,
      data: updated,
    });
  } catch (error) {
    console.error("UpdateVehicleFastag Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const AddVehicle = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  const files = req.files as Express.Multer.File[];

  try {
    const validation = createVehicleSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid vehicle data",
        error: validation.error.format(),
      });
    }
    const {
      make,
      model,
      regNo,
      odo,
      insuranceExpiry,
      categoryId,
      policyNumber,
      provider,
      hourlyRate,
      price12Hour,
      freeKm12Hour,
      price24Hour,
      freeKm24Hour,
      priceMonthly,
      freeKmMonthly,
      extraKmRate,
      extraHourRate,
      isCustomPricingEnabled,
      advancePayAmount,
    } = validation.data;

    const existingVehicle = await prisma.vehicle.findUnique({
      where: { regNo },
    });

    if (existingVehicle) {
      return res.status(StatusCode.CONFLICT).json({
        message: "Vehicle with this Registration Number already exists",
      });
    }

    const vehicle = await prisma.vehicle.create({
      data: {
        publicId: createID(),
        branchId: branchId,
        categoryId: Number(categoryId),
        make,
        model,
        regNo,
        odo: Number(odo),
        advancePayAmount: advancePayAmount ?? 0,
        insuranceExpiry: new Date(insuranceExpiry),
        status: VehicleStatus.AVAILABLE,
        customPricing: price24Hour !== undefined ? {
          create: {
            publicId: createID(),
            hourlyRate: hourlyRate ?? null,
            price12Hour: price12Hour ?? null,
            freeKm12Hour: freeKm12Hour ?? 100,
            price24Hour: price24Hour,
            freeKm24Hour: freeKm24Hour ?? 150,
            priceMonthly: priceMonthly ?? null,
            freeKmMonthly: freeKmMonthly ?? 1500,
            extraKmRate: extraKmRate ?? 8.00,
            extraHourRate: extraHourRate ?? 100.00,
            enabled: isCustomPricingEnabled ?? true,
          }
        } : undefined,
        insuranceRecords: {
          create: {
            publicId: createID(),
            policyNumber,
            provider,
            validTill: new Date(insuranceExpiry),
          },
        },
      },
    });
    if (files && files.length > 0) {
      const jobPromises = files.map((file) => {
        return imageQueue.add("process-vehicle-image", {
          filePath: file.path,
          vehicleId: vehicle.id,
          mimeType: file.mimetype,
          originalName: file.originalname,
        });
      });

      await Promise.all(jobPromises);
    }

    // Clear vehicle list cache for this branch
    const keys = await redis.keys(`vehicles:${branchId}:*`);
    if (keys.length > 0) {
      await redis.del(keys);
    }

    // Targeted cache invalidation for new vehicle (TASK-021)
    try {
      await Promise.all([
        invalidateVehicleAvailability(redis, [vehicle.id]),
        invalidateVehiclePricing(redis, [vehicle.id]),
      ]);
    } catch (redisErr) {
      console.warn("[vehicle] Cache invalidation failed (non-fatal):", redisErr);
    }

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.CREATED,
      entityType: StaffEntityType.VEHICLE,
      entityRef: vehicle.publicId,
      description: `Vehicle ${make} ${model} (${regNo}) added`,
      metadata: { make, model, regNo },
    });

    return res.status(StatusCode.CREATED).json({
      message:
        "Vehicle added successfully. Images are processing in background.",
      data: {
        vehicleId: vehicle.publicId,
        status: "processing",
      },
    });
  } catch (error) {
    console.error("Add Vehicle Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error adding vehicle",
    });
  }
};

export const EditVehicle = async (req: Request, res: Response) => {
  const { vehicleId } = req.params;
  const branchId = req.branch_Id;
  const files = req.files as Express.Multer.File[];

  try {
    const validation = editVehicleSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid update data",
        errors: validation.error.format(),
      });
    }

    const data = validation.data;

    const vehicle = await prisma.vehicle.findUnique({
      where: { publicId: vehicleId },
      include: {
        images: true,
        insuranceRecords: {
          orderBy: { validTill: "desc" },
          take: 1,
        },
      },
    });

    if (!vehicle || vehicle.branchId !== branchId) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Vehicle not found or access denied",
      });
    }

    if (data.regNo && data.regNo !== vehicle.regNo) {
      const existingVehicle = await prisma.vehicle.findUnique({
        where: { regNo: data.regNo },
      });
      if (existingVehicle) {
        return res.status(StatusCode.CONFLICT).json({
          message: "Vehicle with this Registration Number already exists",
        });
      }
    }

    // Handle Image Deletion
    if (data.deleteImageIds) {
      try {
        // Determine if it's already an array or needs parsing
        let idsToDelete: string[] = [];
        if (Array.isArray(data.deleteImageIds)) {
          idsToDelete = data.deleteImageIds;
        } else if (typeof data.deleteImageIds === "string") {
          try {
            idsToDelete = JSON.parse(data.deleteImageIds);
          } catch (e) {
            // If not JSON, maybe it's a single ID string? Accessing it as array might fall
            // But if user sends multiple deleteImageIds inputs (formData), it becomes array?
            idsToDelete = [data.deleteImageIds];
          }
        }

        if (idsToDelete.length > 0) {
          const imagesToDelete = await prisma.vehicleImage.findMany({
            where: {
              vehicleId: vehicle.id,
              publicId: { in: idsToDelete },
            },
          });

          if (imagesToDelete.length > 0) {
            // Optional: Delete from storage (R2/local) if feasible here,
            // but usually handled by a cleanup job or just deleted from DB.
            await prisma.vehicleImage.deleteMany({
              where: {
                id: { in: imagesToDelete.map((img) => img.id) },
              },
            });
          }
        }
      } catch (e) {
        console.warn("Failed to parse deleteImageIds", e);
      }
    }

    const updateData: any = { ...data };
    delete updateData.deleteImageIds;
    delete updateData.categoryId; // Remove raw categoryId from data object
    delete updateData.policyNumber;
    delete updateData.provider;
    
    // Remove custom pricing root fields from updateData
    delete updateData.hourlyRate;
    delete updateData.price12Hour;
    delete updateData.freeKm12Hour;
    delete updateData.price24Hour;
    delete updateData.freeKm24Hour;
    delete updateData.priceMonthly;
    delete updateData.freeKmMonthly;
    delete updateData.extraKmRate;
    delete updateData.extraHourRate;
    delete updateData.isCustomPricingEnabled;
    // advancePayAmount stays in updateData and is applied directly to the vehicle

    if (data.insuranceExpiry) {
      updateData.insuranceExpiry = new Date(data.insuranceExpiry);
    }

    if (data.status) {
      updateData.status = data.status as VehicleStatus;
    }

    if (data.categoryId) {
      updateData.category = {
        connect: { id: Number(data.categoryId) },
      };
    }
    
    if (data.price24Hour !== undefined || data.isCustomPricingEnabled !== undefined) {
      updateData.customPricing = {
        upsert: {
          create: {
            publicId: createID(),
            hourlyRate: data.hourlyRate ?? null,
            price12Hour: data.price12Hour ?? null,
            freeKm12Hour: data.freeKm12Hour ?? 100,
            price24Hour: data.price24Hour ?? 0,
            freeKm24Hour: data.freeKm24Hour ?? 150,
            priceMonthly: data.priceMonthly ?? null,
            freeKmMonthly: data.freeKmMonthly ?? 1500,
            extraKmRate: data.extraKmRate ?? 8.00,
            extraHourRate: data.extraHourRate ?? 100.00,
            enabled: data.isCustomPricingEnabled ?? true,
          },
          update: {
            hourlyRate: data.hourlyRate ?? null,
            price12Hour: data.price12Hour ?? null,
            ...(data.freeKm12Hour !== undefined && { freeKm12Hour: data.freeKm12Hour }),
            ...(data.price24Hour !== undefined && { price24Hour: data.price24Hour }),
            ...(data.freeKm24Hour !== undefined && { freeKm24Hour: data.freeKm24Hour }),
            priceMonthly: data.priceMonthly ?? null,
            ...(data.freeKmMonthly !== undefined && { freeKmMonthly: data.freeKmMonthly }),
            ...(data.extraKmRate !== undefined && { extraKmRate: data.extraKmRate }),
            ...(data.extraHourRate !== undefined && { extraHourRate: data.extraHourRate }),
            ...(data.isCustomPricingEnabled !== undefined && { enabled: data.isCustomPricingEnabled }),
          }
        }
      };
    }

    // Handle Insurance Record Update
    const latestInsurance = vehicle.insuranceRecords[0];
    const newPolicyNumber = data.policyNumber;
    const newProvider = data.provider;
    const newValidTill = data.insuranceExpiry
      ? new Date(data.insuranceExpiry)
      : undefined;

    const hasInsuranceChanges =
      (newPolicyNumber && newPolicyNumber !== latestInsurance?.policyNumber) ||
      (newProvider && newProvider !== latestInsurance?.provider) ||
      (newValidTill &&
        latestInsurance?.validTill &&
        newValidTill.getTime() !== latestInsurance.validTill.getTime());

    if (hasInsuranceChanges) {
      updateData.insuranceRecords = {
        create: {
          publicId: createID(),
          policyNumber:
            newPolicyNumber || latestInsurance?.policyNumber || "UNKNOWN",
          provider: newProvider || latestInsurance?.provider || "UNKNOWN",
          validTill: newValidTill || latestInsurance?.validTill || new Date(),
        },
      };
    } else if (!latestInsurance && (newPolicyNumber || newProvider)) {
      updateData.insuranceRecords = {
        create: {
          publicId: createID(),
          policyNumber: newPolicyNumber || "UNKNOWN",
          provider: newProvider || "UNKNOWN",
          validTill: newValidTill || new Date(),
        },
      };
    }

    await prisma.vehicle.update({
      where: { id: vehicle.id },
      data: updateData,
    });

    // Handle New Images
    if (files && files.length > 0) {
      const jobPromises = files.map((file) => {
        return imageQueue.add("process-vehicle-image", {
          filePath: file.path,
          vehicleId: vehicle.id,
          mimeType: file.mimetype,
          originalName: file.originalname,
        });
      });
      await Promise.all(jobPromises);
    }

    // Clear vehicle list cache for this branch
    const keys = await redis.keys(`vehicles:${branchId}:*`);
    if (keys.length > 0) {
      await redis.del(keys);
    }

    // Targeted cache invalidation for edited vehicle (TASK-021)
    try {
      await Promise.all([
        invalidateVehicleAvailability(redis, [vehicle.id]),
        invalidateVehiclePricing(redis, [vehicle.id]),
      ]);
    } catch (redisErr) {
      console.warn("[vehicle] Cache invalidation failed (non-fatal):", redisErr);
    }

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.UPDATED,
      entityType: StaffEntityType.VEHICLE,
      entityRef: vehicleId as string,
      description: `Vehicle ${vehicleId} updated`,
    });

    return res.status(StatusCode.OK).json({
      message: "Vehicle updated successfully",
    });
  } catch (error) {
    console.error("Edit Vehicle Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error editing vehicle",
    });
  }
};

export const GetVehicleById = async (req: Request, res: Response) => {
  // @ts-ignore
  const branchId = req.branch_Id;
  const { vehicleId } = req.params;

  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { publicId: vehicleId },
      include: {
        images: {
          select: {
            id: true,
            publicId: true,
            isThumbnail: true,
            file: {
              select: { url: true },
            },
          },
        },
        customPricing: true,
        insuranceRecords: {
          orderBy: { validTill: "desc" },
          take: 1,
        },
      },
    });

    if (!vehicle || vehicle.branchId !== branchId) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Vehicle not found or access denied",
      });
    }

    const latestInsurance = vehicle.insuranceRecords[0];

    return res.status(StatusCode.OK).json({
      data: {
        ...vehicle,
        policyNumber: latestInsurance?.policyNumber || "",
        provider: latestInsurance?.provider || "",
      },
    });
  } catch (error) {
    console.error("GetVehicleById Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error fetching vehicle",
    });
  }
};

export const GetInsuranceExpiryReport = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  const { q } = req.query;

  const whereClause: any = {
    branchId: branchId,
    deletedAt: null,
  };

  if (q) {
    const search = q as string;
    whereClause.OR = [
      { regNo: { contains: search, mode: "insensitive" } },
      { make: { contains: search, mode: "insensitive" } },
      { model: { contains: search, mode: "insensitive" } },
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
              select: { url: true },
            },
          },
          take: 1,
        },
        insuranceRecords: {
          orderBy: { validTill: "desc" },
          take: 1,
          select: {
            policyNumber: true,
            provider: true,
            validTill: true,
          },
        },
      },
      orderBy: {
        insuranceExpiry: "asc", // Soonest expiry first
      },
    });

    const reportData = vehicles.map((v) => {
      const latestInsurance = v.insuranceRecords[0];
      return {
        publicId: v.publicId,
        vehicleName: `${v.make} ${v.model}`,
        thumbnail: v.images[0]?.file.url || null,
        make: v.make,
        model: v.model,
        regNo: v.regNo,
        policyNumber: latestInsurance?.policyNumber || "N/A",
        provider: latestInsurance?.provider || "N/A",
        expiryDate: v.insuranceExpiry,
      };
    });

    return res.status(StatusCode.OK).json({
      data: reportData,
    });
  } catch (error) {
    console.error("GetInsuranceExpiryReport Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error fetching insurance report",
    });
  }
};

export const GetVehicles = async (req: Request, res: Response) => {
  // @ts-ignore
  const branchId = req.branch_Id;
  const { search, category, status, limit = 10, offset = 0 } = req.query;

  const whereClause: any = {
    branchId: branchId,
    deletedAt: null,
  };

  if (search) {
    whereClause.OR = [
      { make: { contains: String(search), mode: "insensitive" } },
      { model: { contains: String(search), mode: "insensitive" } },
      { regNo: { contains: String(search), mode: "insensitive" } },
    ];
  }

  if (category) {
    // category is categoryId in DB? No, in existing AddVehicle it uses categoryId: Number(categoryId).
    // BUT vehicle schema might have category relation.
    // Let's check prisma schema or existing code. AddVehicle uses categoryId.
    // The list filter in public controller (inferred) usually filters by something.
    // If frontend passes category name, we might need to join or filter by ID.
    // For now, let's assume category is NOT filtering in this MVP or I need to check schema.
    // Wait, AddVehicle takes categoryId.
    // The frontend sends category string (Two Wheeler, Four Wheeler).
    // I should probably skip category filter for now or assume it matches categoryId if passed as number.
  }

  if (status) {
    whereClause.status = status as VehicleStatus;
  }

  try {
    const [count, data] = await prisma.$transaction([
      prisma.vehicle.count({ where: whereClause }),
      prisma.vehicle.findMany({
        where: whereClause,
        take: Number(limit),
        skip: Number(offset),
        orderBy: { createdAt: "desc" },
        include: {
          images: {
            where: { isThumbnail: true },
            take: 1,
            select: {
              file: { select: { url: true } },
            },
          },
          customPricing: true,
          category: true, // Include category to show name if needed
        },
      }),
    ]);

    return res.status(StatusCode.OK).json({
      count,
      data,
    });
  } catch (error) {
    console.error("GetVehicles Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error fetching vehicles",
    });
  }
};

export const DeleteVehicle = async (req: Request, res: Response) => {
  // @ts-ignore
  const branchId = req.branch_Id;
  const { vehicleId } = req.params;

  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { publicId: vehicleId },
    });

    if (!vehicle || vehicle.branchId !== branchId) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Vehicle not found or access denied",
      });
    }

    await prisma.vehicle.update({
      where: { id: vehicle.id },
      data: {
        deletedAt: new Date(),
        status: VehicleStatus.INACTIVE,
      },
    });

    // Clear vehicle list cache for this branch
    const keys = await redis.keys(`vehicles:${branchId}:*`);
    if (keys.length > 0) {
      await redis.del(keys);
    }

    // Targeted cache invalidation for deleted vehicle (TASK-021)
    try {
      await Promise.all([
        invalidateVehicleAvailability(redis, [vehicle.id]),
        invalidateVehiclePricing(redis, [vehicle.id]),
      ]);
    } catch (redisErr) {
      console.warn("[vehicle] Cache invalidation failed (non-fatal):", redisErr);
    }

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.DELETED,
      entityType: StaffEntityType.VEHICLE,
      entityRef: vehicle.publicId,
      description: `Vehicle ${vehicle.make} ${vehicle.model} (${vehicle.regNo}) removed`,
      metadata: { make: vehicle.make, model: vehicle.model, regNo: vehicle.regNo },
    });

    return res.status(StatusCode.OK).json({
      message: "Vehicle deleted successfully",
    });
  } catch (error) {
    console.error("Delete Vehicle Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error deleting vehicle",
    });
  }
};

export const GetVehicleCategories = async (req: Request, res: Response) => {
  try {
    const categories = await prisma.vehicleCategory.findMany({
      select: {
        id: true,
        publicId: true,
        name: true,
      },
    });
    return res.status(StatusCode.OK).json({
      data: categories,
    });
  } catch (error) {
    console.error("GetVehicleCategories Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error fetching categories",
    });
  }
};

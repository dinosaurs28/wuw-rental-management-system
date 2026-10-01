import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { updateVehicleUseCasesSchema } from "@repo/schemas";
import { redis } from "../../lib/redisconfig.js";
import { invalidateGroupListingCache } from "../../utils/cache/vehicleCacheKeys.js";

/**
 * Get All Vehicles (Admin)
 * GET /admin/dashboard/vehicles
 *
 * Returns all vehicles across all branches for admin access
 */
export const GetAllVehicles = async (req: Request, res: Response) => {
  try {
    const vehicles = await prisma.vehicle.findMany({
      where: {
        deletedAt: null,
      },
      include: {
        category: {
          select: {
            name: true,
          },
        },
        branch: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(StatusCode.OK).json({
      message: "Vehicles fetched successfully",
      data: vehicles,
    });
  } catch (error) {
    console.error("Get All Vehicles Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Failed to fetch vehicles",
    });
  }
};

/**
 * Update Vehicle Trip-type Tags (Admin)
 * PATCH /admin/dashboard/vehicles/:publicId/use-cases
 *
 * Body: { useCases: ("HIGHWAY" | "HILL_STATION" | "LONG_DRIVE")[] } — replaces the full set;
 * an empty array clears all tags.
 */
export const UpdateVehicleUseCases = async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;
    const validation = updateVehicleUseCasesSchema.safeParse(req.body ?? {});
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "INVALID_USE_CASES",
        message: "Trip types must be any of HIGHWAY, HILL_STATION, LONG_DRIVE",
      });
    }

    const vehicle = await prisma.vehicle.findFirst({
      where: { publicId, deletedAt: null },
      select: { id: true },
    });
    if (!vehicle) {
      return res.status(StatusCode.NOT_FOUND).json({
        success: false,
        code: "VEHICLE_NOT_FOUND",
        message: "Vehicle not found",
      });
    }

    const updated = await prisma.vehicle.update({
      where: { id: vehicle.id },
      data: { useCases: { set: validation.data.useCases } },
      select: { publicId: true, useCases: true },
    });

    try {
      await invalidateGroupListingCache(redis);
    } catch (redisErr) {
      console.warn("[vehicle] Cache invalidation failed (non-fatal):", redisErr);
    }

    return res.status(StatusCode.OK).json({
      success: true,
      message: "Vehicle trip types updated",
      data: updated,
    });
  } catch (error) {
    console.error("Update Vehicle Use Cases Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Failed to update vehicle trip types",
    });
  }
};

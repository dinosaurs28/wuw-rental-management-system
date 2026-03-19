/**
 * Feature Flag Controller (Admin Only)
 *
 * Follows project pattern: named exports, req/res typed, StatusCode used.
 * All routes are protected by AdminCheck middleware in the route file.
 */

import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { featureFlagService } from "../../services/feature-flag/feature-flag.service.js";
import { flagSeederService } from "../../services/feature-flag/flag-seeder.service.js";
import { FeatureFlagKey } from "../../config/feature-flags.config.js";

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM-LEVEL FLAGS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/feature-flags
 * Get all feature flags with their status.
 */
export const GetAllFlags = async (req: Request, res: Response) => {
  try {
    const flags = await featureFlagService.getAllFlags();
    return res.status(StatusCode.OK).json({
      message: "Feature flags fetched successfully",
      data: { flags },
    });
  } catch (error) {
    console.error("GetAllFlags error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Server Error" });
  }
};

/**
 * PUT /api/admin/feature-flags/:flagKey
 * Update a system-level feature flag.
 * Body: { enabled: boolean, config?: object }
 */
export const UpdateFlag = async (req: Request, res: Response) => {
  try {
    const flagKey = req.params.flagKey as string;
    const { enabled, config } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Field 'enabled' (boolean) is required",
      });
    }

    const updated = await featureFlagService.updateFlag(
      flagKey as FeatureFlagKey,
      enabled,
      config
    );

    return res.status(StatusCode.OK).json({
      message: "Feature flag updated successfully",
      data: updated,
    });
  } catch (error: any) {
    console.error("UpdateFlag error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: error.message || "Internal Server Error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// BRANCH-LEVEL FLAGS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/feature-flags/branches/:branchId
 * Get all flag statuses for a branch (shows source: branch | system).
 */
export const GetBranchFlags = async (req: Request, res: Response) => {
  try {
    const branchId = parseInt(req.params.branchId as string, 10);
    if (isNaN(branchId)) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: "Invalid branchId" });
    }

    const flags = await featureFlagService.getBranchFlags(branchId);
    return res.status(StatusCode.OK).json({
      message: "Branch flags fetched successfully",
      data: { branchId, flags },
    });
  } catch (error) {
    console.error("GetBranchFlags error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Server Error" });
  }
};

/**
 * PUT /api/admin/feature-flags/branches/:branchId/:flagKey
 * Set a branch-specific flag override.
 * Body: { enabled: boolean, config?: object }
 */
export const SetBranchFlag = async (req: Request, res: Response) => {
  try {
    const branchId = parseInt(req.params.branchId as string, 10);
    const flagKey = req.params.flagKey as string;
    const { enabled, config } = req.body;

    if (isNaN(branchId)) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: "Invalid branchId" });
    }
    if (typeof enabled !== "boolean") {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Field 'enabled' (boolean) is required",
      });
    }

    const result = await featureFlagService.setBranchFlag(
      branchId,
      flagKey as FeatureFlagKey,
      enabled,
      config
    );

    return res.status(StatusCode.OK).json({
      message: "Branch flag override set successfully",
      data: result,
    });
  } catch (error: any) {
    console.error("SetBranchFlag error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: error.message || "Internal Server Error" });
  }
};

/**
 * DELETE /api/admin/feature-flags/branches/:branchId/:flagKey
 * Remove a branch flag override (reverts to system default).
 */
export const RemoveBranchFlag = async (req: Request, res: Response) => {
  try {
    const branchId = parseInt(req.params.branchId as string, 10);
    const flagKey = req.params.flagKey as string;

    if (isNaN(branchId)) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: "Invalid branchId" });
    }

    await featureFlagService.removeBranchFlag(
      branchId,
      flagKey as FeatureFlagKey
    );

    return res.status(StatusCode.OK).json({
      message: "Branch flag override removed. Reverted to system default.",
    });
  } catch (error: any) {
    console.error("RemoveBranchFlag error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: error.message || "Internal Server Error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// VEHICLE-LEVEL FLAGS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/feature-flags/vehicles/:vehicleId
 * Get all flag statuses for a vehicle.
 */
export const GetVehicleFlags = async (req: Request, res: Response) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId as string, 10);
    if (isNaN(vehicleId)) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: "Invalid vehicleId" });
    }

    const flags = await featureFlagService.getVehicleFlags(vehicleId);
    return res.status(StatusCode.OK).json({
      message: "Vehicle flags fetched successfully",
      data: { vehicleId, flags },
    });
  } catch (error) {
    console.error("GetVehicleFlags error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Server Error" });
  }
};

/**
 * PUT /api/admin/feature-flags/vehicles/:vehicleId/:flagKey
 * Set a vehicle-specific flag override.
 * Body: { enabled: boolean, config?: object }
 */
export const SetVehicleFlag = async (req: Request, res: Response) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId as string, 10);
    const flagKey = req.params.flagKey as string;
    const { enabled, config } = req.body;

    if (isNaN(vehicleId)) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: "Invalid vehicleId" });
    }
    if (typeof enabled !== "boolean") {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Field 'enabled' (boolean) is required",
      });
    }

    const result = await featureFlagService.setVehicleFlag(
      vehicleId,
      flagKey as FeatureFlagKey,
      enabled,
      config
    );

    return res.status(StatusCode.OK).json({
      message: "Vehicle flag override set successfully",
      data: result,
    });
  } catch (error: any) {
    console.error("SetVehicleFlag error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: error.message || "Internal Server Error" });
  }
};

/**
 * DELETE /api/admin/feature-flags/vehicles/:vehicleId/:flagKey
 * Remove a vehicle flag override.
 */
export const RemoveVehicleFlag = async (req: Request, res: Response) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId as string, 10);
    const flagKey = req.params.flagKey as string;

    if (isNaN(vehicleId)) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: "Invalid vehicleId" });
    }

    await featureFlagService.removeVehicleFlag(
      vehicleId,
      flagKey as FeatureFlagKey
    );

    return res.status(StatusCode.OK).json({
      message: "Vehicle flag override removed.",
    });
  } catch (error: any) {
    console.error("RemoveVehicleFlag error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: error.message || "Internal Server Error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/feature-flags/seed
 * Seed default flags (safe to re-run).
 */
export const SeedDefaultFlags = async (req: Request, res: Response) => {
  try {
    const result = await flagSeederService.seedDefaultFlags();
    return res.status(StatusCode.OK).json({
      message: "Feature flags seeded successfully",
      data: result,
    });
  } catch (error) {
    console.error("SeedDefaultFlags error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Server Error" });
  }
};

/**
 * POST /api/admin/feature-flags/clear-cache
 * Clear the in-memory flag cache.
 */
export const ClearFlagCache = async (req: Request, res: Response) => {
  try {
    await featureFlagService.clearCache();
    return res.status(StatusCode.OK).json({
      message: "Feature flag cache cleared successfully",
    });
  } catch (error) {
    console.error("ClearFlagCache error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Server Error" });
  }
};

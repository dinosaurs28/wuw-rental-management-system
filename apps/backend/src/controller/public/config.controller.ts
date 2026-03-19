/**
 * Config Controller (Public API)
 *
 * Provides feature flag status to the frontend.
 * Returns only boolean values (no internal config) for security.
 */

import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { featureFlagService } from "../../services/feature-flag/feature-flag.service.js";
import { FeatureFlagKey } from "../../config/feature-flags.config.js";

/**
 * GET /api/config/features
 * Get enabled features for frontend.
 *
 * Query params:
 *   branchId  (optional) – returns branch-level flags
 *   vehicleId (optional) – returns vehicle-level flags
 *
 * Response: { features: { [flagKey]: boolean } }
 */
export const GetEnabledFeatures = async (req: Request, res: Response) => {
  try {
    const branchId = req.query.branchId
      ? parseInt(req.query.branchId as string, 10)
      : undefined;
    const vehicleId = req.query.vehicleId
      ? parseInt(req.query.vehicleId as string, 10)
      : undefined;

    const allKeys = Object.values(FeatureFlagKey);
    const features: Record<string, boolean> = {};

    await Promise.all(
      allKeys.map(async (key) => {
        let enabled: boolean;
        if (vehicleId) {
          enabled = await featureFlagService.isEnabledForVehicle(key, vehicleId);
        } else if (branchId) {
          enabled = await featureFlagService.isEnabledForBranch(key, branchId);
        } else {
          enabled = await featureFlagService.isEnabled(key);
        }
        features[key] = enabled;
      })
    );

    return res.status(StatusCode.OK).json({
      message: "Features fetched successfully",
      data: { features },
    });
  } catch (error) {
    console.error("GetEnabledFeatures error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Server Error" });
  }
};

/**
 * GET /api/config/features/:flagKey
 * Check if a specific feature is enabled.
 *
 * Query params:
 *   branchId  (optional)
 *   vehicleId (optional)
 *
 * Response: { flagKey: string, enabled: boolean }
 */
export const IsFeatureEnabled = async (req: Request, res: Response) => {
  try {
    const flagKey = req.params.flagKey as string;
    const branchId = req.query.branchId
      ? parseInt(req.query.branchId as string, 10)
      : undefined;
    const vehicleId = req.query.vehicleId
      ? parseInt(req.query.vehicleId as string, 10)
      : undefined;

    // Validate flag key
    const validKeys = Object.values(FeatureFlagKey) as string[];
    if (!validKeys.includes(flagKey)) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: `Feature flag '${flagKey}' not found`,
      });
    }

    let enabled: boolean;
    if (vehicleId) {
      enabled = await featureFlagService.isEnabledForVehicle(
        flagKey as FeatureFlagKey,
        vehicleId
      );
    } else if (branchId) {
      enabled = await featureFlagService.isEnabledForBranch(
        flagKey as FeatureFlagKey,
        branchId
      );
    } else {
      enabled = await featureFlagService.isEnabled(flagKey as FeatureFlagKey);
    }

    return res.status(StatusCode.OK).json({
      data: { flagKey, enabled },
    });
  } catch (error) {
    console.error("IsFeatureEnabled error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Server Error" });
  }
};

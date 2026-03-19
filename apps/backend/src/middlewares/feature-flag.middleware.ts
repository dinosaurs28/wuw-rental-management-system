/**
 * Feature Flag Middleware
 *
 * Protect routes based on feature flags.
 */

import { Request, Response, NextFunction } from "express";
import { featureFlagService } from "../services/feature-flag/feature-flag.service.js";
import { FeatureFlagKey } from "../config/feature-flags.config.js";
import { StatusCode } from "../types/statusCode.js";

/**
 * Require a SYSTEM-level feature to be enabled.
 *
 * Usage:
 *   router.get('/hourly-pricing',
 *     requireFeature(FeatureFlagKey.HOURLY_RENTAL_ENABLED),
 *     controller.getHourlyPricing
 *   );
 */
export const requireFeature = (flagKey: FeatureFlagKey) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const isEnabled = await featureFlagService.isEnabled(flagKey);
      if (!isEnabled) {
        return res.status(StatusCode.FORBIDDEN).json({
          message: "This feature is not enabled",
          feature: flagKey,
        });
      }
      next();
    } catch (error) {
      console.error("Feature flag check failed:", error);
      return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
        message: "Failed to check feature availability",
      });
    }
  };
};

/**
 * Require a BRANCH-level feature to be enabled.
 *
 * Reads branchId from req.body[branchIdField] or req.params[branchIdField].
 * Falls back to req.branch_Id (set by ManagerCheck middleware).
 *
 * Usage:
 *   router.post('/bookings',
 *     requireBranchFeature(FeatureFlagKey.SAFETY_DEPOSIT_REQUIRED),
 *     controller.createBooking
 *   );
 */
export const requireBranchFeature = (
  flagKey: FeatureFlagKey,
  branchIdField: string = "branchId"
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawId =
        req.body[branchIdField] ||
        req.params[branchIdField] ||
        (req as any).branch_Id;

      if (!rawId) {
        return res.status(StatusCode.BAD_REQUEST).json({
          message: "Branch ID required for feature check",
        });
      }

      const branchId = parseInt(rawId as string, 10);
      const isEnabled = await featureFlagService.isEnabledForBranch(
        flagKey,
        branchId
      );

      if (!isEnabled) {
        return res.status(StatusCode.FORBIDDEN).json({
          message: "This feature is not enabled for this branch",
          feature: flagKey,
        });
      }

      next();
    } catch (error) {
      console.error("Branch feature flag check failed:", error);
      return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
        message: "Failed to check feature availability",
      });
    }
  };
};

/**
 * Public Config Routes
 *
 * Mounted at: /api/config
 * Provides feature flag status to authenticated frontend clients.
 */

import { Router } from "express";
import {
  GetEnabledFeatures,
  IsFeatureEnabled,
} from "../../controller/public/config.controller.js";

const router: Router = Router();

// GET /api/config/features?branchId=1&vehicleId=10
router.get("/features", GetEnabledFeatures);

// GET /api/config/features/:flagKey?branchId=1
router.get("/features/:flagKey", IsFeatureEnabled);

export default router;

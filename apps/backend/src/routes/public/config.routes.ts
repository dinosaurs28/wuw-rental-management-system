/**
 * Public Config Routes
 *
 * Mounted at: /api/config
 * Provides feature flag status. These routes are intentionally UNGATED — the
 * mobile app reads them while browsing as a guest, before any account exists.
 * Do not add auth middleware here without checking the guest paths in
 * mobile/app/_layout.tsx first; gating public content is what got the iOS app
 * rejected under App Store guideline 5.1.1(v).
 */

import { Router } from "express";
import {
  GetEnabledFeatures,
  IsFeatureEnabled,
} from "../../controller/public/config.controller.js";
import { GetPublicWhatsAppConfig } from "../../controller/public/whatsapp-config.controller.js";

const router: Router = Router();

// GET /api/config/features?branchId=1&vehicleId=10
router.get("/features", GetEnabledFeatures);

// GET /api/config/features/:flagKey?branchId=1
router.get("/features/:flagKey", IsFeatureEnabled);

// GET /api/config/whatsapp
router.get("/whatsapp", GetPublicWhatsAppConfig);

export default router;

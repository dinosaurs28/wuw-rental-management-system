/**
 * Feature Flag Admin Routes
 *
 * Mounted at: /api/admin/feature-flags
 * All routes are protected by AdminCheck middleware.
 *
 * Pattern matches project: Router → Controller → Service
 */

import { Router } from "express";
import { AdminCheck } from "../../middlewares/adminCheck.middleware.js";
import {
  GetAllFlags,
  UpdateFlag,
  GetBranchFlags,
  SetBranchFlag,
  RemoveBranchFlag,
  GetVehicleFlags,
  SetVehicleFlag,
  RemoveVehicleFlag,
  SeedDefaultFlags,
  ClearFlagCache,
} from "../../controller/admin/feature-flag.controller.js";

const router: Router = Router();

// ── System-level ─────────────────────────────────────────────────────────────
router.get("/", AdminCheck, GetAllFlags);
router.put("/:flagKey", AdminCheck, UpdateFlag);

// ── Utility ──────────────────────────────────────────────────────────────────
router.post("/seed", AdminCheck, SeedDefaultFlags);
router.post("/clear-cache", AdminCheck, ClearFlagCache);

// ── Branch-level ─────────────────────────────────────────────────────────────
router.get("/branches/:branchId", AdminCheck, GetBranchFlags);
router.put("/branches/:branchId/:flagKey", AdminCheck, SetBranchFlag);
router.delete("/branches/:branchId/:flagKey", AdminCheck, RemoveBranchFlag);

// ── Vehicle-level ─────────────────────────────────────────────────────────────
router.get("/vehicles/:vehicleId", AdminCheck, GetVehicleFlags);
router.put("/vehicles/:vehicleId/:flagKey", AdminCheck, SetVehicleFlag);
router.delete("/vehicles/:vehicleId/:flagKey", AdminCheck, RemoveVehicleFlag);

export default router;

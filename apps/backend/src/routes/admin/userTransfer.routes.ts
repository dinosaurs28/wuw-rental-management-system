import { Router } from "express";
import { AdminCheck } from "../../middlewares/adminCheck.middleware.js";
import {
  GetBranchStaffingStats,
  GetBranchUsers,
  TransferUser,
} from "../../controller/admin/userTransfer.controller.js";

const router: Router = Router();

router.get("/stats", AdminCheck, GetBranchStaffingStats);
router.get("/users", AdminCheck, GetBranchUsers);
router.patch("/:userPublicId/transfer", AdminCheck, TransferUser);

export default router;

import { Router } from "express";
import { AdminCheck } from "../../middlewares/adminCheck.middleware.js";
import {
  GetAdminStaffActivity,
  GetAdminStaffActivityById,
} from "../../controller/admin/staffActivity.controller.js";

const router: Router = Router();

router.get("/logs", AdminCheck, GetAdminStaffActivity);
router.get("/logs/:publicId", AdminCheck, GetAdminStaffActivityById);

export default router;

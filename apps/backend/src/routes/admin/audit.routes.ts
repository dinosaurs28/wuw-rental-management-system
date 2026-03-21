import { Router } from "express";
import { AdminCheck } from "../../middlewares/adminCheck.middleware.js";
import {
  GetAdminAuditLogs,
  GetAdminAuditStats,
  GetAdminAuditLogById,
} from "../../controller/admin/audit.controller.js";

const router: Router = Router();

router.get("/logs", AdminCheck, GetAdminAuditLogs);
router.get("/logs/stats", AdminCheck, GetAdminAuditStats);
router.get("/logs/:publicId", AdminCheck, GetAdminAuditLogById);

export default router;

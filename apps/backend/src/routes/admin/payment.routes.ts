import { Router } from "express";
import { AdminCheck } from "../../middlewares/adminCheck.middleware.js";
import {
  GetBranchPaymentConfig,
  AdminUpdateBranchPaymentConfig,
} from "../../controller/admin/payment-config.controller.js";

const router: Router = Router();

router.use(AdminCheck);

router.get("/config/:branchId", GetBranchPaymentConfig);
router.patch("/config/:branchId", AdminUpdateBranchPaymentConfig);

export default router;

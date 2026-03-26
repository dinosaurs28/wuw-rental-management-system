import { Router } from "express";
import { AdminCheck } from "../../middlewares/adminCheck.middleware.js";
import {
  GetWhatsAppConfig,
  UpsertWhatsAppConfig,
  ClearWhatsAppConfigCache,
} from "../../controller/admin/whatsapp-config.controller.js";

const router: Router = Router();

router.get("/", AdminCheck, GetWhatsAppConfig);
router.put("/", AdminCheck, UpsertWhatsAppConfig);
router.delete("/cache", AdminCheck, ClearWhatsAppConfigCache);

export default router;

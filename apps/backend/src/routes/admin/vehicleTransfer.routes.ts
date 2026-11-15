import { Router } from "express";
import { AdminCheck } from "../../middlewares/adminCheck.middleware.js";
import { GetVehicleTransfers, TransferVehicle } from "../../controller/admin/vehicleTransfer.controller.js";

const router: Router = Router();

router.post("/:vehiclePublicId", AdminCheck, TransferVehicle);
router.get("/:vehiclePublicId/history", AdminCheck, GetVehicleTransfers);

export default router;

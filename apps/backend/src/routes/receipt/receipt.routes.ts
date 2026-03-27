import { Router } from "express";
import { getReceipt } from "../../controller/receipt.controller.js";
import { authCheckJwt } from "../../middlewares/authCheck.middlewares.js";

const router: Router = Router();

// GET /api/receipts/:bookingId — fetch return receipt + PDF URL
router.get("/:bookingId", authCheckJwt, getReceipt);

export default router;

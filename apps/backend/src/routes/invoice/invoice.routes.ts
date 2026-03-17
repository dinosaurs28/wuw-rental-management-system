import { Router } from "express";
import {
  downloadInvoice,
  getInvoiceStatus,
} from "../../controller/invoice.controller.js";
import { authCheckJwt } from "../../middlewares/authCheck.middlewares.js";

const router: Router = Router();

// Main endpoint - user clicks "Download Invoice"
router.post("/download", authCheckJwt, downloadInvoice);

// Check generation status
router.get("/status/:invoiceId", authCheckJwt, getInvoiceStatus);

export default router;

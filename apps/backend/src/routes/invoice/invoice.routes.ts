import { Router } from "express";
import {
  downloadInvoice,
  getInvoiceStatus,
  regenerateInvoice,
} from "../../controller/invoice.controller.js";
import { authCheckJwt } from "../../middlewares/authCheck.middlewares.js";

const router: Router = Router();

// Main endpoint - user clicks "Download Invoice"
router.post("/download", authCheckJwt, downloadInvoice);

// Force-regenerate (nulls cache and queues fresh PDF)
router.post("/regenerate", authCheckJwt, regenerateInvoice);

// Check generation status
router.get("/status/:invoiceId", authCheckJwt, getInvoiceStatus);

export default router;

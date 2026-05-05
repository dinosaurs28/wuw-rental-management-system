import { Router } from "express";
import { checkPayment } from "../../controller/payment/checkPayment.controller.js";
import { phonePeWebhook } from "../../controller/payment/phonePeWebhook.controller.js";
import { authCheckJwt } from "../../middlewares/authCheck.middlewares.js";

const router: Router = Router();

router.get("/status/:transactionId", authCheckJwt, checkPayment);
router.post("/phonepe/webhook", phonePeWebhook);

export default router;

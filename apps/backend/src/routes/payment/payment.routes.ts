import { Router } from "express";
import { checkPayment } from "../../controller/payment/checkPayment.controller.js";

const router: Router = Router();

router.get("/status/:transactionId", checkPayment);

export default router;

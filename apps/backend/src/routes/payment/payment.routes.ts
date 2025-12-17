import { Router } from "express";
import { checkPayment } from "../../controller/payment/checkPayment.controller";

const router:Router=Router()


router.get("/status/:transactionId",checkPayment)

export default router
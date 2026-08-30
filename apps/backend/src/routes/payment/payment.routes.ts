import { Router } from "express";
import { checkPayment } from "../../controller/payment/checkPayment.controller.js";
import { verifyPayment } from "../../controller/payment/verifyPayment.controller.js";
import { razorpayWebhook } from "../../controller/payment/razorpayWebhook.controller.js";
import { authCheckJwt } from "../../middlewares/authCheck.middlewares.js";
import { EmployeeCheck } from "../../middlewares/employeeCheck.middlewares.js";
import { ManagerCheck } from "../../middlewares/managerCheck.middlewares.js";

const router: Router = Router();

router.get("/status/:transactionId", authCheckJwt, checkPayment);

// The three role gates are mutually exclusive — authCheckJwt rejects anything
// that is not CUSTOMER, EmployeeCheck only admits STAFF and ManagerCheck only
// MANAGER — so the same handler is mounted once per audience. The Razorpay
// checkout signature is the real authority here; the gate only establishes that
// a logged-in session is making the call.
router.post("/verify", authCheckJwt, verifyPayment);
router.post("/staff/verify", EmployeeCheck, verifyPayment);
router.post("/manager/verify", ManagerCheck, verifyPayment);
// No auth — Razorpay calls this; the x-razorpay-signature HMAC is the auth.
router.post("/razorpay/webhook", razorpayWebhook);

export default router;

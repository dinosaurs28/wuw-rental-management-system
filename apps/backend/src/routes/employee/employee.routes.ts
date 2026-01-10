import { Router } from "express";
import { Login } from "../../controller/employee/login.controller";
import { EmployeeCheck } from "../../middlewares/employeeCheck.middlewares";
import { BookingController } from "../../controller/employee/booking.controller";
import { returnController } from "../../controller/employee/return.controller";
import { GetBookingKyc, VerifyKyc } from "../../controller/employee/kyc.controller";
import { PickupController } from "../../controller/employee/pickup.controller";
import { CompleteReturn } from "../../controller/employee/returnAction.controller";
import { InitiateWalkin } from "../../controller/employee/walkin/initiate.controller";
import { VerifyWalkinOtp } from "../../controller/employee/walkin/verify.controller";
import { CompleteWalkinProfile } from "../../controller/employee/walkin/complete.controller";
const router:Router=Router()

router.post("/auth/login", Login)
router.get("/booking", EmployeeCheck, BookingController)
router.get("/return", EmployeeCheck, returnController)
router.get("/kyc/:bookingId", EmployeeCheck, GetBookingKyc)
router.patch("/kyc/:kycId/status", EmployeeCheck, VerifyKyc)
router.post("/pickup/:bookingId", EmployeeCheck, PickupController)
router.post("/return/:bookingId/complete", EmployeeCheck, CompleteReturn)
router.post("/walkin/initiate", EmployeeCheck, InitiateWalkin)
router.post("/walkin/verify", EmployeeCheck, VerifyWalkinOtp)
router.post("/walkin/complete", EmployeeCheck, CompleteWalkinProfile)

export default router
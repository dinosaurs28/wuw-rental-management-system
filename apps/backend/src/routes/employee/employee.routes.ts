import { Router } from "express";
import { Login } from "../../controller/employee/login.controller";
import { EmployeeCheck } from "../../middlewares/employeeCheck.middlewares";
import { BookingController } from "../../controller/employee/booking.controller";
import { returnController } from "../../controller/employee/return.controller";
import { GetBookingKyc, VerifyKyc } from "../../controller/employee/kyc.controller";

const router:Router=Router()

router.post("/auth/login",Login)
router.get("/booking",EmployeeCheck,BookingController)
router.get("/return",EmployeeCheck,returnController)
router.get("/kyc/:bookingId", EmployeeCheck, GetBookingKyc)
router.patch("/kyc/:kycId/status", EmployeeCheck, VerifyKyc)

export default router
import { Router } from "express";
import { Login } from "../../controller/employee/login.controller";
import { searchVehicles, getEmployeeVehicleDetails } from "../../controller/employee/vehicle.controller";
import { createEmployeeBooking } from "../../controller/employee/booking.controller";
import { EmployeeCheck } from "../../middlewares/employeeCheck.middlewares";
import { BookingController } from "../../controller/employee/booking.controller";
import { returnController } from "../../controller/employee/return.controller";
import { GetBookingKyc, VerifyKyc } from "../../controller/employee/kyc.controller";
import { PickupController } from "../../controller/employee/pickup.controller";
import { CompleteReturn } from "../../controller/employee/returnAction.controller";
import { InitiateWalkin } from "../../controller/employee/walkin/initiate.controller";
import { VerifyWalkinOtp } from "../../controller/employee/walkin/verify.controller";
import { CompleteWalkinProfile } from "../../controller/employee/walkin/complete.controller";
import { SearchCustomer } from "../../controller/employee/customer/search.controller";
import { upload } from "../../middlewares/upload.middleware";
import { CheckCustomerPublicId } from "../../middlewares/checkCustomer.middleware";
import { UpdateWalkinKycStatus, UploadWalkinKyc } from "../../controller/employee/walkin/kyc.controller";
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
router.post("/walkin/kyc/upload", EmployeeCheck, upload.single('file'), CheckCustomerPublicId, UploadWalkinKyc)
router.post("/walkin/kyc/status", EmployeeCheck, UpdateWalkinKycStatus)
router.get("/vehicles/search", EmployeeCheck, searchVehicles)
router.get("/vehicles/:id", EmployeeCheck, getEmployeeVehicleDetails)
router.post("/booking/create", EmployeeCheck, createEmployeeBooking)
router.get("/customer/search", EmployeeCheck, SearchCustomer)

export default router
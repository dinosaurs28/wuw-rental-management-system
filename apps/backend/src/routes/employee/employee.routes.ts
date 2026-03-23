import { Router } from "express";
import { Login } from "../../controller/employee/login.controller.js";
import {
  searchVehicles,
  getEmployeeVehicleDetails,
} from "../../controller/employee/vehicle.controller.js";
import {
  createEmployeeBooking,
  GetBookingDetails,
} from "../../controller/employee/booking.controller.js";
import { EmployeeCheck } from "../../middlewares/employeeCheck.middlewares.js";
import { BookingController } from "../../controller/employee/booking.controller.js";
import { returnController } from "../../controller/employee/return.controller.js";
import {
  GetBookingKyc,
  VerifyKyc,
} from "../../controller/employee/kyc.controller.js";
import { PickupController } from "../../controller/employee/pickup.controller.js";
import {
  UploadPickupImage,
  DeletePickupImage,
} from "../../controller/employee/pickupAction.controller.js";
import {
  CompleteReturn,
  UploadReturnImage,
  DeleteReturnImage,
} from "../../controller/employee/returnAction.controller.js";
import { InitiateWalkin } from "../../controller/employee/walkin/initiate.controller.js";
import { VerifyWalkinOtp } from "../../controller/employee/walkin/verify.controller.js";
import { CompleteWalkinProfile } from "../../controller/employee/walkin/complete.controller.js";
import { SearchCustomer } from "../../controller/employee/customer/search.controller.js";
import { GetCustomerDetails } from "../../controller/employee/customer/get.controller.js";
import { upload } from "../../middlewares/upload.middleware.js";
import { CheckCustomerPublicId } from "../../middlewares/checkCustomer.middleware.js";
import {
  UpdateWalkinKycStatus,
  UploadWalkinKyc,
} from "../../controller/employee/walkin/kyc.controller.js";
import {
  CreateDamageReport,
  UploadDamageImage,
} from "../../controller/employee/damage.controller.js";
import { GetCustomerKyc } from "../../controller/employee/walkin/getKyc.controller.js";
import { DeleteKycDocument } from "../../controller/user/kyc.controller.js";
import {
  InitiateRemainingPayment,
  CheckRemainingPaymentStatus,
  CheckRemainingPaymentByTransaction,
} from "../../controller/employee/remainingPayment.controller.js";
import {
  GetPickupCaptureConfig,
  GetPickupCaptures,
} from "../../controller/employee/captureConfig.controller.js";
import extensionRouter from "./extension.routes.js";
import { SubmitChargeOverride } from "../../controller/employee/charge-override.controller.js";
import {
  ComputeReturnCharges,
  GetChargeBreakdown,
} from "../../controller/employee/return-charge.controller.js";
import {
  InitiateSettlement,
  ConfirmSettlement,
} from "../../controller/employee/settlement.controller.js";

const router: Router = Router();

router.post("/auth/login", Login);
router.get("/booking", EmployeeCheck, BookingController);
router.get("/return", EmployeeCheck, returnController);
router.get("/kyc/:bookingId", EmployeeCheck, GetBookingKyc);
router.patch("/kyc/:kycId/status", EmployeeCheck, VerifyKyc);
router.get("/pickup/:bookingId", EmployeeCheck, GetBookingDetails);
router.get("/pickup/:bookingId/capture-config", EmployeeCheck, GetPickupCaptureConfig);
router.get("/return/:bookingId/pickup-captures", EmployeeCheck, GetPickupCaptures);
router.post(
  "/pickup/upload",
  EmployeeCheck,
  upload.single("file"),
  UploadPickupImage,
);
router.delete("/pickup/image/:publicId", EmployeeCheck, DeletePickupImage);
router.get("/payment/remaining-status/:transactionId", EmployeeCheck, CheckRemainingPaymentByTransaction);
router.post("/pickup/:bookingId/initiate-remaining-payment", EmployeeCheck, InitiateRemainingPayment);
router.get("/pickup/:bookingId/remaining-payment/status", EmployeeCheck, CheckRemainingPaymentStatus);
router.post("/pickup/:bookingId", EmployeeCheck, PickupController);
router.post(
  "/return/upload",
  EmployeeCheck,
  upload.single("file"),
  UploadReturnImage,
);
router.delete("/return/image/:publicId", EmployeeCheck, DeleteReturnImage);
router.get("/return/:bookingId", EmployeeCheck, GetBookingDetails);
router.post("/return/:bookingId/initiate-remaining-payment", EmployeeCheck, InitiateRemainingPayment);
router.get("/return/:bookingId/remaining-payment/status", EmployeeCheck, CheckRemainingPaymentStatus);
router.post("/return/:bookingId/complete", EmployeeCheck, CompleteReturn);
router.post("/walkin/initiate", EmployeeCheck, InitiateWalkin);
router.post("/walkin/verify", EmployeeCheck, VerifyWalkinOtp);
router.post("/walkin/complete", EmployeeCheck, CompleteWalkinProfile);
router.post(
  "/walkin/kyc/upload",
  EmployeeCheck,
  upload.single("file"),
  CheckCustomerPublicId,
  UploadWalkinKyc,
);
router.get("/walkin/kyc/:customerPublicId", EmployeeCheck, GetCustomerKyc);
router.post("/walkin/kyc/status", EmployeeCheck, UpdateWalkinKycStatus);
router.delete("/walkin/kyc", EmployeeCheck, DeleteKycDocument);
router.get("/vehicles/search", EmployeeCheck, searchVehicles);
router.get("/vehicles/:id", EmployeeCheck, getEmployeeVehicleDetails);
router.post("/booking/create", EmployeeCheck, createEmployeeBooking);
router.get("/customer/search", EmployeeCheck, SearchCustomer);
router.get("/customer/:publicId", EmployeeCheck, GetCustomerDetails);
router.post(
  "/damage/upload",
  EmployeeCheck,
  upload.single("file"),
  UploadDamageImage,
);
router.post("/damage/report", EmployeeCheck, CreateDamageReport);
router.use("/extensions", extensionRouter);

// ── Charge Engine ─────────────────────────────────────────────────────────────

// Return charge computation
router.post("/bookings/:bookingId/return-charges", EmployeeCheck, ComputeReturnCharges);
router.get("/bookings/:bookingId/charges", EmployeeCheck, GetChargeBreakdown);

// Employee charge overrides
router.post(
  "/bookings/:bookingPublicId/charges/:chargeEntryPublicId/override",
  EmployeeCheck,
  SubmitChargeOverride,
);

// Settlement
router.get("/bookings/:bookingId/settlement", EmployeeCheck, InitiateSettlement);
router.post("/bookings/:bookingId/settlement/confirm", EmployeeCheck, ConfirmSettlement);

export default router;

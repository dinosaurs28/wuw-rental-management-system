import { Router } from "express";
import { EmployeeCheck } from "../../middlewares/employeeCheck.middlewares.js";
import {
  RecordPayment,
  ListBookingPayments,
  GetFinancialState,
} from "../../controller/branchManager/payment-transaction.controller.js";
import {
  OpenShift,
  GetMyActiveShift,
  CloseShift,
  ListMyShifts,
  GetMyShiftDetails,
} from "../../controller/branchManager/cash-shift.controller.js";
import { UploadPaymentProof, GetPaymentProof } from "../../controller/employee/paymentProof.controller.js";
import { handleImageUpload } from "../../middlewares/upload.middleware.js";
import { PAYMENT_PROOF_MAX_BYTES } from "../../services/payment/payment-proof.service.js";

const router: Router = Router();

router.use(EmployeeCheck);

// UPI payment-proof photo (#3): upload first, then send its id as proof_file_id
router.post("/proof", handleImageUpload("file", { maxBytes: PAYMENT_PROOF_MAX_BYTES }), UploadPaymentProof);
router.get("/proof/:proofFileId", GetPaymentProof);

// Booking financial state & transactions (read-only for payment panel)
router.get("/bookings/:bookingPublicId/financial-state", GetFinancialState);
router.get("/bookings/:bookingPublicId/transactions", ListBookingPayments);

// Record payment (employee collects cash / online at pickup)
router.post("/transactions", RecordPayment);

// Cash shift lifecycle (employee-owned)
router.post("/shifts", OpenShift);
router.get("/shifts/me/active", GetMyActiveShift);
// Own shift history (declared after /me/active so "active" never reads as a publicId)
router.get("/shifts/me", ListMyShifts);
router.get("/shifts/me/:publicId", GetMyShiftDetails);
router.post("/shifts/:publicId/close", CloseShift);

export default router;

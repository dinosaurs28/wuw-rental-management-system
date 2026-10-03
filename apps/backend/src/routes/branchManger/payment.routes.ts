import { Router } from "express";
import { ManagerCheck } from "../../middlewares/managerCheck.middlewares.js";
import {
  GetMyBranchPaymentConfig,
  UpdateMyBranchPaymentConfig,
} from "../../controller/branchManager/payment-config.controller.js";
import {
  RecordPayment,
  GetPaymentTransaction,
  ListBookingPayments,
  GetFinancialState,
  ListPendingCash,
  ListBranchTransactions,
} from "../../controller/branchManager/payment-transaction.controller.js";
import {
  ConfirmCashPayment,
  RejectCashPayment,
} from "../../controller/branchManager/cash-confirmation.controller.js";
import {
  ListPendingSettlements,
  GetSettlementSummary,
  RecordSettlementPayment,
  RefundSettlementDeposit,
} from "../../controller/branchManager/settlement.controller.js";
import {
  RequestRefund,
  ListPendingRefunds,
  GetRefund,
  ApproveRefund,
  RejectRefund,
  CompleteRefund,
} from "../../controller/branchManager/refund.controller.js";
import {
  OpenShift,
  GetMyActiveShift,
  CloseShift,
  GetShiftDetails,
  ListBranchShifts,
  ReconcileShift,
} from "../../controller/branchManager/cash-shift.controller.js";
import {
  ListPendingPaymentBookings,
  GetRecheckInfo,
  RecheckPaymentWithGateway,
  ManualConfirmPayment,
} from "../../controller/branchManager/payment-recheck.controller.js";

import { UploadPaymentProof, GetPaymentProof } from "../../controller/employee/paymentProof.controller.js";
import { handleImageUpload } from "../../middlewares/upload.middleware.js";
import { PAYMENT_PROOF_MAX_BYTES } from "../../services/payment/payment-proof.service.js";

const router: Router = Router();

router.use(ManagerCheck);

// UPI payment-proof photo (#3): credit clearance by UPI; viewing a proof again
router.post("/proof", handleImageUpload("file", { maxBytes: PAYMENT_PROOF_MAX_BYTES }), UploadPaymentProof);
router.get("/proof/:proofFileId", GetPaymentProof);

// Payment config
router.get("/config", GetMyBranchPaymentConfig);
router.patch("/config", UpdateMyBranchPaymentConfig);

// Payment transactions
router.get("/transactions", ListBranchTransactions);
router.post("/transactions", RecordPayment);
router.get("/transactions/:publicId", GetPaymentTransaction);
router.get("/bookings/:bookingPublicId/transactions", ListBookingPayments);
router.get("/bookings/:bookingPublicId/financial-state", GetFinancialState);

// Cash confirmation (manager actions)
router.get("/cash/pending", ListPendingCash);
router.post("/cash/:publicId/confirm", ConfirmCashPayment);
router.post("/cash/:publicId/reject", RejectCashPayment);

// Settlements
router.get("/settlements", ListPendingSettlements);
router.get("/settlements/:bookingPublicId", GetSettlementSummary);
router.post("/settlements/:bookingPublicId/pay", RecordSettlementPayment);
// Legacy drop: pay the safety deposit back per the drop's choice (#6)
router.post("/settlements/:bookingPublicId/refund-deposit", RefundSettlementDeposit);

// Refunds
router.post("/refunds", RequestRefund);
router.get("/refunds/pending", ListPendingRefunds);
router.get("/refunds/:publicId", GetRefund);
router.post("/refunds/:publicId/approve", ApproveRefund);
router.post("/refunds/:publicId/reject", RejectRefund);
router.post("/refunds/:publicId/complete", CompleteRefund);

// Payment recheck
router.get("/recheck", ListPendingPaymentBookings);
router.get("/recheck/:bookingId", GetRecheckInfo);
router.post("/recheck/:bookingId/gateway-check", RecheckPaymentWithGateway);
router.post("/recheck/:bookingId/manual-confirm", ManualConfirmPayment);

// Cash shifts
router.post("/shifts", OpenShift);
router.get("/shifts/me/active", GetMyActiveShift);
router.post("/shifts/:publicId/close", CloseShift);
router.get("/shifts/:publicId", GetShiftDetails);
router.get("/shifts", ListBranchShifts);
router.post("/shifts/:publicId/reconcile", ReconcileShift);

export default router;

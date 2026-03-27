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

const router: Router = Router();

router.use(ManagerCheck);

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

// Refunds
router.post("/refunds", RequestRefund);
router.get("/refunds/pending", ListPendingRefunds);
router.get("/refunds/:publicId", GetRefund);
router.post("/refunds/:publicId/approve", ApproveRefund);
router.post("/refunds/:publicId/reject", RejectRefund);
router.post("/refunds/:publicId/complete", CompleteRefund);

// Cash shifts
router.post("/shifts", OpenShift);
router.get("/shifts/me/active", GetMyActiveShift);
router.post("/shifts/:publicId/close", CloseShift);
router.get("/shifts/:publicId", GetShiftDetails);
router.get("/shifts", ListBranchShifts);
router.post("/shifts/:publicId/reconcile", ReconcileShift);

export default router;

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
} from "../../controller/branchManager/cash-shift.controller.js";

const router: Router = Router();

router.use(EmployeeCheck);

// Booking financial state & transactions (read-only for payment panel)
router.get("/bookings/:bookingPublicId/financial-state", GetFinancialState);
router.get("/bookings/:bookingPublicId/transactions", ListBookingPayments);

// Record payment (employee collects cash / online at pickup)
router.post("/transactions", RecordPayment);

// Cash shift lifecycle (employee-owned)
router.post("/shifts", OpenShift);
router.get("/shifts/me/active", GetMyActiveShift);
router.post("/shifts/:publicId/close", CloseShift);

export default router;

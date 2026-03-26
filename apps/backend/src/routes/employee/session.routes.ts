import { Router } from "express";
import { EmployeeCheck } from "../../middlewares/employeeCheck.middlewares.js";
import {
  GetPaymentSession,
  GetActiveSession,
  AddDepositToSession,
  RecordPayment,
  RecordRefund,
} from "../../controller/employee/paymentSession.controller.js";
import {
  InitiatePickupSession,
  GetPickupSession,
} from "../../controller/employee/pickupSession.controller.js";
import {
  ComputeReturnSession,
  GetReturnSession,
} from "../../controller/employee/returnSession.controller.js";

const router: Router = Router();

// ── Generic session endpoints ─────────────────────────────────────────────────
router.get("/sessions/:sessionPublicId", EmployeeCheck, GetPaymentSession);
router.get("/bookings/:bookingId/active-session", EmployeeCheck, GetActiveSession);
router.post("/sessions/:sessionPublicId/add-deposit", EmployeeCheck, AddDepositToSession);
router.post("/sessions/:sessionPublicId/record-payment", EmployeeCheck, RecordPayment);
router.post("/sessions/:sessionPublicId/record-refund", EmployeeCheck, RecordRefund);

// ── Pickup session ────────────────────────────────────────────────────────────
router.post("/bookings/:bookingId/pickup-session/initiate", EmployeeCheck, InitiatePickupSession);
router.get("/bookings/:bookingId/pickup-session", EmployeeCheck, GetPickupSession);

// ── Return session ────────────────────────────────────────────────────────────
router.post("/bookings/:bookingId/return/session/compute", EmployeeCheck, ComputeReturnSession);
router.get("/bookings/:bookingId/return/session", EmployeeCheck, GetReturnSession);

export default router;

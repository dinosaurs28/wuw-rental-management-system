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
  AbandonPickupSession,
  ApplyDiscountToPickupSession,
  RemoveDiscountFromPickupSession,
  AddDepositToPickupSession,
  RemoveDepositFromPickupSession,
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
router.post("/bookings/:bookingId/pickup-session/abandon", EmployeeCheck, AbandonPickupSession);
router.post("/bookings/:bookingId/pickup-session/apply-discount", EmployeeCheck, ApplyDiscountToPickupSession);
router.delete("/bookings/:bookingId/pickup-session/remove-discount", EmployeeCheck, RemoveDiscountFromPickupSession);
router.post("/bookings/:bookingId/pickup-session/add-deposit", EmployeeCheck, AddDepositToPickupSession);
router.delete("/bookings/:bookingId/pickup-session/remove-deposit", EmployeeCheck, RemoveDepositFromPickupSession);

// ── Return session ────────────────────────────────────────────────────────────
router.post("/bookings/:bookingId/return/session/compute", EmployeeCheck, ComputeReturnSession);
router.get("/bookings/:bookingId/return/session", EmployeeCheck, GetReturnSession);

export default router;

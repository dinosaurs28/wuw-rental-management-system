import { Router } from "express";
import { EmployeeCheck } from "../../middlewares/employeeCheck.middlewares.js";
import {
  ApplyCoupon,
  RemoveCoupon,
  GetBookingDiscountSummary,
} from "../../controller/branchManager/booking-discount.controller.js";
import { ApplyManualDiscount } from "../../controller/branchManager/manual-discount.controller.js";

const router: Router = Router();

router.use(EmployeeCheck);

// ── Booking coupon & manual discount (employee-accessible) ────────────────────
router.get("/bookings/:bookingId/discount-summary", GetBookingDiscountSummary);
router.post("/bookings/:bookingId/apply-coupon", ApplyCoupon);
router.delete("/bookings/:bookingId/apply-coupon", RemoveCoupon);
router.post("/bookings/:bookingId/manual-discount", ApplyManualDiscount);

export default router;

import { Router } from "express";
import { ManagerCheck } from "../../middlewares/managerCheck.middlewares.js";
import {
  GetDurationSlabs,
  CreateDurationSlab,
  UpdateDurationSlab,
  DeleteDurationSlab,
} from "../../controller/branchManager/discount-slabs.controller.js";
import {
  GetBranchDiscountConfig,
  UpdateBranchDiscountConfig,
} from "../../controller/branchManager/discount-config.controller.js";
import {
  ApplyManualDiscount,
  ApproveManualDiscount,
  RejectManualDiscount,
  GetPendingManualDiscounts,
  GetManualDiscount,
} from "../../controller/branchManager/manual-discount.controller.js";
import {
  ApplyCoupon,
  RemoveCoupon,
  GetBookingDiscountSummary,
} from "../../controller/branchManager/booking-discount.controller.js";
import {
  CreateManagerCoupon,
  ListManagerCoupons,
  GetManagerCouponLimits,
} from "../../controller/branchManager/manager-coupon.controller.js";

const router: Router = Router();

router.use(ManagerCheck);

// ── Branch discount config ────────────────────────────────────────────────────
router.get("/config", GetBranchDiscountConfig);
router.patch("/config", UpdateBranchDiscountConfig);

// ── Duration discount slabs ───────────────────────────────────────────────────
router.get("/slabs", GetDurationSlabs);
router.post("/slabs", CreateDurationSlab);
router.patch("/slabs/:id", UpdateDurationSlab);
router.delete("/slabs/:id", DeleteDurationSlab);

// ── Manual discounts ──────────────────────────────────────────────────────────
router.get("/manual-discounts/pending", GetPendingManualDiscounts);
router.get("/manual-discounts/:publicId", GetManualDiscount);
router.post("/manual-discounts/:publicId/approve", ApproveManualDiscount);
router.post("/manual-discounts/:publicId/reject", RejectManualDiscount);

// ── Manager coupon creation ───────────────────────────────────────────────────
router.get("/coupons/limits", GetManagerCouponLimits);
router.get("/coupons", ListManagerCoupons);
router.post("/coupons", CreateManagerCoupon);

// ── Booking coupon & manual discount application ──────────────────────────────
router.post("/bookings/:bookingId/apply-coupon", ApplyCoupon);
router.delete("/bookings/:bookingId/apply-coupon", RemoveCoupon);
router.post("/bookings/:bookingId/manual-discount", ApplyManualDiscount);
router.get("/bookings/:bookingId/discount-summary", GetBookingDiscountSummary);

export default router;

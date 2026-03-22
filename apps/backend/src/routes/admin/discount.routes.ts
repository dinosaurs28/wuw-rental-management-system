import { Router } from "express";
import { AdminCheck } from "../../middlewares/adminCheck.middleware.js";
import {
  ListDiscountRules,
  GetDiscountRule,
  CreateDiscountRule,
  UpdateDiscountRule,
  DeactivateDiscountRule,
  GenerateCouponCode,
  ListManagerCreatedCoupons,
  AdminUpdateBranchDiscountConfig,
} from "../../controller/admin/discount-rule.controller.js";

const router: Router = Router();

// All routes require admin authentication
router.use(AdminCheck);

// Coupon code generation
router.post("/generate-code", GenerateCouponCode);

// Manager coupon monitoring
router.get("/manager-coupons", ListManagerCreatedCoupons);

// Branch discount config (admin-level guardrail control)
router.patch("/branch-config/:branchId", AdminUpdateBranchDiscountConfig);

// Discount rule CRUD
router.get("/", ListDiscountRules);
router.post("/", CreateDiscountRule);
router.get("/:publicId", GetDiscountRule);
router.patch("/:publicId", UpdateDiscountRule);
router.post("/:publicId/deactivate", DeactivateDiscountRule);

export default router;

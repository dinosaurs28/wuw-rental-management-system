import { z } from "zod";

// ─── Discount Rule ────────────────────────────────────────────────────────────

// Base object (no refinements) — allows calling .partial()/.omit() for update schema
const createDiscountRuleBase = z.object({
  code: z.string().min(3).max(32).regex(/^[A-Z0-9_\-]+$/i, "Code must be alphanumeric with hyphens/underscores only"),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  discountType: z.enum(["PERCENTAGE", "FLAT"]),
  value: z.number().positive(),
  maxDiscountCap: z.number().positive().optional(),
  scope: z.enum(["GLOBAL", "BRANCH", "USER"]).default("GLOBAL"),
  applicableBranchIds: z.array(z.number().int().positive()).default([]),
  targetCustomerIds: z.array(z.number().int().positive()).default([]),
  newCustomersOnly: z.boolean().default(false),
  minBookingCount: z.number().int().min(0).optional(),
  maxBookingCount: z.number().int().min(0).optional(),
  minBookingAmount: z.number().min(0).optional(),
  maxBookingAmount: z.number().min(0).optional(),
  applicableVehicleCategoryIds: z.array(z.number().int().positive()).default([]),
  minRentalDays: z.number().int().min(1).optional(),
  maxRentalDays: z.number().int().min(1).optional(),
  applicablePaymentPlans: z.array(z.enum(["FULL", "ADVANCE", "BOTH"])).default([]),
  allowPartialPayment: z.boolean().default(true),
  minAdvanceAfterDiscount: z.number().min(0).optional(),
  allowPostBooking: z.boolean().default(false),
  allowPostInvoice: z.boolean().default(false),
  totalUsageLimit: z.number().int().positive().optional(),
  perUserLimit: z.number().int().positive().optional(),
  perBranchLimit: z.number().int().positive().optional(),
  perDayLimit: z.number().int().positive().optional(),
  stackable: z.boolean().default(false),
  priority: z.number().int().min(0).default(0),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

export const createDiscountRuleSchema = createDiscountRuleBase
  .refine((d) => new Date(d.endDate) > new Date(d.startDate), {
    message: "endDate must be after startDate",
    path: ["endDate"],
  })
  .refine(
    (d) => {
      if (d.discountType === "PERCENTAGE" && d.value > 100) return false;
      return true;
    },
    { message: "PERCENTAGE discount value cannot exceed 100", path: ["value"] },
  );

// Derived from base (not the refined schema) so .partial()/.omit() work on ZodObject
export const updateDiscountRuleSchema = createDiscountRuleBase.partial().omit({ code: true });

// ─── Duration Discount Slabs ─────────────────────────────────────────────────

const createDurationSlabBase = z.object({
  minDays: z.number().int().min(1),
  maxDays: z.number().int().min(1).optional(),
  discountType: z.enum(["PERCENTAGE", "FLAT"]),
  value: z.number().positive(),
  label: z.string().max(50).optional(),
});

export const createDurationSlabSchema = createDurationSlabBase
  .refine((d) => !d.maxDays || d.maxDays >= d.minDays, {
    message: "maxDays must be >= minDays",
    path: ["maxDays"],
  })
  .refine(
    (d) => {
      if (d.discountType === "PERCENTAGE" && d.value > 100) return false;
      return true;
    },
    { message: "PERCENTAGE value cannot exceed 100", path: ["value"] },
  );

export const updateDurationSlabSchema = createDurationSlabBase.partial();

// ─── Branch Discount Config ───────────────────────────────────────────────────

// Fields a MANAGER can update for their own branch
export const updateBranchDiscountConfigSchema = z.object({
  durationDiscountEnabled: z.boolean().optional(),
  stackWithCoupon: z.boolean().optional(),
  maxCombinedDiscountPercent: z.number().min(0).max(100).optional().nullable(),
  managerApprovalThreshold: z.number().min(0).optional(),
  maxManualDiscountsPerEmployeePerDay: z.number().int().min(1).max(50).optional(),
});

// Fields only an ADMIN can change — controls what managers are allowed to do
export const updateBranchDiscountConfigAdminSchema = updateBranchDiscountConfigSchema.extend({
  managerCouponCreationEnabled: z.boolean().optional(),
  maxManagerCouponDiscountPercent: z.number().min(1).max(100).optional(),
  maxManagerCouponFlatAmount: z.number().min(1).optional(),
  maxManagerCouponValidityDays: z.number().int().min(1).max(90).optional(),
  maxManagerCouponUsageLimit: z.number().int().min(1).max(100).optional(),
  maxManagerCouponsPerDay: z.number().int().min(1).max(20).optional(),
});

// ─── Manager Coupon Creation ──────────────────────────────────────────────────

export const createManagerCouponSchema = z
  .object({
    // Manager only picks type and value — all caps are enforced server-side
    discountType: z.enum(["PERCENTAGE", "FLAT"]),
    value: z.number().positive(),
    name: z.string().min(1).max(100),
    description: z.string().max(300).optional(),
    // Validity: how many days from now (capped to maxManagerCouponValidityDays)
    validityDays: z.number().int().min(1).max(90).default(7),
    // Total number of uses (capped to maxManagerCouponUsageLimit)
    usageLimit: z.number().int().min(1).max(100).default(5),
    // How many times each customer can use this coupon
    perUserLimit: z.number().int().min(1).max(10).default(1),
    // Optionally target specific customers (friends/relatives)
    targetCustomerIds: z.array(z.number().int().positive()).default([]),
    // Mandatory reason — why is this coupon being created?
    reason: z.string().min(5, "Please provide a reason of at least 5 characters").max(300),
  })
  .refine(
    (d) => {
      if (d.discountType === "PERCENTAGE" && d.value > 100) return false;
      return true;
    },
    { message: "PERCENTAGE value cannot exceed 100", path: ["value"] },
  );

// ─── Manager Coupon Edit ──────────────────────────────────────────────────────

export const updateManagerCouponSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  value: z.number().positive().optional(),
  usageLimit: z.number().int().min(1).max(100).optional(),
  perUserLimit: z.number().int().min(1).max(10).optional(),
  targetCustomerIds: z.array(z.number().int().positive()).optional(),
  extendDays: z.number().int().min(1).max(90).optional(),
  reason: z.string().min(5).max(300).optional(),
});

// ─── Apply Coupon ─────────────────────────────────────────────────────────────

export const applyCouponSchema = z.object({
  couponCode: z.string().min(1).max(32),
  paymentPlan: z.enum(["FULL", "ADVANCE"]).default("FULL"),
});

// ─── Apply Manual Discount ────────────────────────────────────────────────────

export const applyManualDiscountSchema = z.object({
  amount: z.number().positive(),
  reason: z.string().min(5, "Please provide a reason of at least 5 characters").max(500),
});

// ─── Coupon Code Generator ────────────────────────────────────────────────────

export const generateCouponCodeSchema = z.object({
  pattern: z.enum(["BRANCH_PREFIX", "EMPLOYEE_LINKED", "PROMOTIONAL"]),
  branchCode: z.string().max(4).optional(),
  employeeId: z.string().max(8).optional(),
  length: z.number().int().min(4).max(12).default(6),
});

// ─── Reject Manual Discount ───────────────────────────────────────────────────

export const rejectManualDiscountSchema = z.object({
  rejectionReason: z.string().min(5).max(500),
});

// ─── List Discount Rules Query ────────────────────────────────────────────────

export const listDiscountRulesQuerySchema = z.object({
  isActive: z
    .string()
    .optional()
    .transform((v) => (v === "true" ? true : v === "false" ? false : undefined)),
  scope: z.enum(["GLOBAL", "BRANCH", "USER"]).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

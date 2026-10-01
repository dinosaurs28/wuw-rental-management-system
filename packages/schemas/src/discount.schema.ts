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
  // Validity is a range of IST calendar days: the server stores 00:00 IST of the
  // start day to 23:59:59.999 IST of the end day. Send e.g. "2026-10-31T00:00:00+05:30"
  // (a "Z" instant is read as the IST day it falls on). Same-day coupons are allowed.
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }),
});

/** IST calendar day (YYYY-MM-DD) an ISO instant falls on. */
const istDay = (iso: string): string =>
  new Date(new Date(iso).getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);

type DiscountRuleShape = {
  [K in keyof z.infer<typeof createDiscountRuleBase>]?: z.infer<typeof createDiscountRuleBase>[K] | null;
};

/**
 * Cross-field rules shared by create and update. On update only the fields sent
 * are checked here; the service re-checks the merged row against what is stored.
 */
export function discountRuleIssues(d: DiscountRuleShape): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (d.startDate && d.endDate && istDay(d.endDate) < istDay(d.startDate)) {
    issues.push({ path: "endDate", message: "Valid To can't be before Valid From" });
  }
  if (d.discountType === "PERCENTAGE" && d.value != null && d.value > 100) {
    issues.push({ path: "value", message: "PERCENTAGE discount value cannot exceed 100" });
  }
  if (d.scope === "BRANCH" && d.applicableBranchIds != null && d.applicableBranchIds.length === 0) {
    issues.push({ path: "applicableBranchIds", message: "Pick at least one branch for a branch coupon" });
  }
  if (d.scope === "USER" && d.targetCustomerIds != null && d.targetCustomerIds.length === 0) {
    issues.push({ path: "targetCustomerIds", message: "Pick at least one customer for a customer coupon" });
  }
  if (d.minBookingAmount != null && d.maxBookingAmount != null && d.maxBookingAmount < d.minBookingAmount) {
    issues.push({ path: "maxBookingAmount", message: "Maximum booking amount can't be below the minimum" });
  }
  if (d.minRentalDays != null && d.maxRentalDays != null && d.maxRentalDays < d.minRentalDays) {
    issues.push({ path: "maxRentalDays", message: "Maximum rental days can't be below the minimum" });
  }
  if (d.minBookingCount != null && d.maxBookingCount != null && d.maxBookingCount < d.minBookingCount) {
    issues.push({ path: "maxBookingCount", message: "Maximum booking count can't be below the minimum" });
  }
  return issues;
}

const addDiscountRuleIssues = (d: DiscountRuleShape, ctx: z.RefinementCtx) => {
  for (const issue of discountRuleIssues(d)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
  }
};

// A BRANCH coupon needs its branches (an empty list used to apply everywhere)
// and a USER coupon its customers.
export const createDiscountRuleSchema = createDiscountRuleBase
  .superRefine((d, ctx) => addDiscountRuleIssues(d, ctx));

// Derived from base (not the refined schema) so .partial()/.omit() work on ZodObject.
// isActive lets an admin reactivate a deactivated rule. The optional limits
// accept null on update so an admin can clear one (the service stores null).
export const updateDiscountRuleSchema = createDiscountRuleBase
  .partial()
  .omit({ code: true })
  .extend({
    isActive: z.boolean().optional(),
    description: z.string().max(500).nullable().optional(),
    maxDiscountCap: z.number().positive().nullable().optional(),
    minBookingCount: z.number().int().min(0).nullable().optional(),
    maxBookingCount: z.number().int().min(0).nullable().optional(),
    minBookingAmount: z.number().min(0).nullable().optional(),
    maxBookingAmount: z.number().min(0).nullable().optional(),
    minRentalDays: z.number().int().min(1).nullable().optional(),
    maxRentalDays: z.number().int().min(1).nullable().optional(),
    minAdvanceAfterDiscount: z.number().min(0).nullable().optional(),
    totalUsageLimit: z.number().int().positive().nullable().optional(),
    perUserLimit: z.number().int().positive().nullable().optional(),
    perBranchLimit: z.number().int().positive().nullable().optional(),
    perDayLimit: z.number().int().positive().nullable().optional(),
  })
  .superRefine((d, ctx) => addDiscountRuleIssues(d, ctx));

// ─── Duration Discount Slabs ─────────────────────────────────────────────────

// A slab matches a rental of at least minDays FULL 24-hour periods (minDays × 24 h)
// up to maxDays (null = no upper limit); only the highest matching slab applies.
// A FLAT value is ₹ off per vehicle.
const createDurationSlabBase = z.object({
  minDays: z.number().int().min(1),
  maxDays: z.number().int().min(1).nullable().optional(),
  discountType: z.enum(["PERCENTAGE", "FLAT"]),
  value: z.number().positive(),
  label: z.string().max(50).nullable().optional(),
});

type DurationSlabShape = {
  minDays: number;
  maxDays?: number | null;
  discountType: "PERCENTAGE" | "FLAT";
  value: number;
};

/** Cross-field slab rules — also run by the server on the merged row of an update. */
export function durationSlabIssues(d: DurationSlabShape): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (d.maxDays != null && d.maxDays < d.minDays) {
    issues.push({ path: "maxDays", message: "maxDays must be >= minDays" });
  }
  if (d.discountType === "PERCENTAGE" && d.value > 100) {
    issues.push({ path: "value", message: "PERCENTAGE value cannot exceed 100" });
  }
  return issues;
}

export const createDurationSlabSchema = createDurationSlabBase.superRefine((d, ctx) => {
  for (const issue of durationSlabIssues(d)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
  }
});

// Partial input shape; send maxDays: null to make a slab open-ended
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
  // Optional — the server uses the booking's own plan (isAdvancePayment)
  paymentPlan: z.enum(["FULL", "ADVANCE"]).optional(),
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

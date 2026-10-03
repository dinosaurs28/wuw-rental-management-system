import apiClient from "@/lib/axios";
import type { PaymentFlow, PaymentOptions } from "@/lib/paymentPlan";

/**
 * Server-priced breakdown with the coupon applied (coupon is pre-GST, so GST
 * drops with it). Render totals from this, never `oldTotal − discountAmount`.
 */
export interface CouponPricing {
  basePrice: number;
  durationDiscountAmount: number;
  durationDiscountPercent: number;
  durationDiscountLabel: string | null;
  /** A slab matched but the coupon replaced it (no stacking) — hide the duration line. */
  durationSuppressed: boolean;
  couponDiscountAmount: number;
  /** Total discount (duration + coupon). */
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  taxRate: number;
  /** Rental after discounts + GST, no deposit. */
  finalTotal: number;
  deposit: number;
  /** finalTotal + deposit. */
  payableTotal: number;
  // GST-inclusive rent view (item 17; absent from older servers):
  // rentInclGst − discountInclGst = rentAfterDiscountInclGst = rentWithoutGst + gst.
  // basePrice / discountAmount / taxableAmount above are rent WITHOUT GST.
  rentInclGst?: number;
  durationDiscountInclGst?: number;
  couponDiscountInclGst?: number;
  manualDiscountInclGst?: number;
  discountInclGst?: number;
  rentAfterDiscountInclGst?: number;
  rentWithoutGst?: number;
  gst?: number;
  cgst?: number;
  sgst?: number;
}

export interface CouponValidationResult {
  valid: true;
  couponCode: string;
  /** Coupon layer only (pre-GST). */
  discountAmount: string;
  /** What the coupon takes off the GST-inclusive rent (item 17) — show this one. */
  discountInclGst?: string;
  discountType?: string;
  discountValue?: string;
  // Absent from servers older than the Oct 2026 coupon fixes
  pricing?: CouponPricing;
  payableTotal?: number;
  /** Plan the coupon was checked for (the effective plan). */
  paymentFlow?: PaymentFlow;
  /** The sent paymentFlow isn't allowed for these amounts/branch. */
  paymentFlowAdjusted?: boolean;
  /** Recomputed with the post-coupon total — re-check the plan chooser with it. */
  paymentOptions?: PaymentOptions;
}

export interface CouponValidationError {
  valid: false;
  code: string;
  reason: string;
}

export type CouponValidation = CouponValidationResult | CouponValidationError;

/**
 * What an accepted coupon takes off what the customer pays: the discount on the
 * GST-inclusive rent (item 17). Older servers only sent the pre-GST amount.
 */
export function couponSavingInclGst(result: CouponValidationResult): number {
  const v =
    result.discountInclGst ??
    result.pricing?.couponDiscountInclGst ??
    result.pricing?.couponDiscountAmount ??
    result.discountAmount;
  return Number(v) || 0;
}

/** Amounts are on the GST-inclusive rent (item 17): finalTotal = rent incl. GST after discounts. */
export interface DiscountSummary {
  bookingPublicId: string;
  durationDiscountAmount: string;
  couponCode: string | null;
  couponDiscountAmount: string;
  manualDiscountAmount: string;
  totalDiscountAmount: string;
  finalTotal: string;
  manualDiscount?: {
    publicId: string;
    amount: string;
    reason: string;
    status: string;
    appliedBy: string;
    requiresApproval: boolean;
  } | null;
}

export interface ManualDiscount {
  publicId: string;
  bookingPublicId: string;
  amount: string;
  reason: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  appliedBy: string;
  requestedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  managerNote: string | null;
  requiresApproval: boolean;
  booking?: {
    publicId: string;
    customer?: {
      user: { name: string };
    };
    totalFinal: string;
  };
}

/** Branch discount config as GET returns it — Prisma Decimals arrive as strings. */
export interface DiscountConfig {
  durationDiscountEnabled: boolean;
  stackWithCoupon: boolean;
  /** null = no combined cap. */
  maxCombinedDiscountPercent: number | string | null;
  managerApprovalThreshold: number | string;
  maxManualDiscountsPerEmployeePerDay: number;
}

/** The five fields a manager can PATCH (numbers, not Decimal strings). */
export interface DiscountConfigUpdate {
  durationDiscountEnabled: boolean;
  stackWithCoupon: boolean;
  maxCombinedDiscountPercent: number | null;
  managerApprovalThreshold: number;
  maxManualDiscountsPerEmployeePerDay: number;
}

export interface DurationSlab {
  id: number;
  branchId: number;
  minDays: number;
  /** null = open-ended. */
  maxDays: number | null;
  discountType: "PERCENTAGE" | "FLAT";
  /** Decimal string. */
  value: string;
  label: string | null;
}

export interface DurationSlabInput {
  minDays: number;
  /** null = open-ended (also clears it on update). */
  maxDays: number | null;
  discountType: "PERCENTAGE" | "FLAT";
  value: number;
  label: string | null;
}

export interface ManagerCoupon {
  publicId: string;
  code: string;
  name: string;
  description: string | null;
  discountType: "PERCENTAGE" | "FLAT";
  value: string;
  totalUsageLimit: number | null;
  startDate: string;
  endDate: string;
  isActive: boolean;
  targetCustomerIds: number[];
  createdAt: string;
  createdBy: { publicId: string; name: string; role: string };
  _count: { usageLogs: number };
}

export type DiscountScope = "GLOBAL" | "BRANCH" | "USER";
export type CouponPaymentPlan = "FULL" | "ADVANCE" | "BOTH";

export interface AdminDiscountRule {
  publicId: string;
  code: string;
  name: string;
  description: string | null;
  discountType: "PERCENTAGE" | "FLAT";
  value: string;
  maxDiscountCap: string | null;
  scope: DiscountScope;
  applicableBranchIds: number[];
  targetCustomerIds: number[];
  newCustomersOnly: boolean;
  minBookingCount: number | null;
  maxBookingCount: number | null;
  applicableVehicleCategoryIds: number[];
  applicablePaymentPlans: CouponPaymentPlan[];
  allowPartialPayment: boolean;
  totalUsageLimit: number | null;
  perUserLimit: number | null;
  perBranchLimit: number | null;
  perDayLimit: number | null;
  minBookingAmount: string | null;
  maxBookingAmount: string | null;
  minRentalDays: number | null;
  maxRentalDays: number | null;
  startDate: string;
  endDate: string;
  isActive: boolean;
  stackable: boolean;
  priority: number;
  createdBy: { name: string; publicId: string };
  _count: { usageLogs: number };
}

/** Restriction fields shared by create and update (null clears a limit on update). */
export interface DiscountRuleLimits {
  maxDiscountCap: number | null;
  applicableBranchIds: number[];
  targetCustomerIds: number[];
  newCustomersOnly: boolean;
  minBookingCount: number | null;
  maxBookingCount: number | null;
  minBookingAmount: number | null;
  maxBookingAmount: number | null;
  applicableVehicleCategoryIds: number[];
  minRentalDays: number | null;
  maxRentalDays: number | null;
  applicablePaymentPlans: CouponPaymentPlan[];
  allowPartialPayment: boolean;
  totalUsageLimit: number | null;
  perUserLimit: number | null;
  perBranchLimit: number | null;
  perDayLimit: number | null;
  stackable: boolean;
  priority: number;
}

/** Undefined/null fields are dropped (create takes no nulls). */
type CreateRuleLimits = { [K in keyof DiscountRuleLimits]?: Exclude<DiscountRuleLimits[K], null> };

export interface AdminManagerCoupon {
  publicId: string;
  code: string;
  name: string;
  description: string | null;
  discountType: "PERCENTAGE" | "FLAT";
  value: string;
  totalUsageLimit: number | null;
  startDate: string;
  endDate: string;
  isActive: boolean;
  applicableBranchIds: number[];
  createdAt: string;
  createdBy: { publicId: string; name: string; role: string };
  _count: { usageLogs: number };
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export const adminDiscountService = {
  listRules: async (params?: {
    isActive?: boolean;
    scope?: DiscountScope;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: { rules: AdminDiscountRule[]; total: number; page: number; pageSize: number } }> => {
    const res = await apiClient.get("/admin/discount-rules", { params });
    return res.data;
  },

  /**
   * Dates are whole IST days: send `${day}T00:00:00+05:30` / `${day}T23:59:59.999+05:30`.
   * 400 INVALID_DISCOUNT_RULE (with errors[]) / 409 COUPON_CODE_EXISTS carry a message.
   */
  createRule: async (data: {
    code: string;
    name: string;
    description?: string;
    discountType: "PERCENTAGE" | "FLAT";
    value: number;
    scope: DiscountScope;
    startDate: string;
    endDate: string;
  } & CreateRuleLimits): Promise<{ message: string; data: { publicId: string; code: string } }> => {
    const res = await apiClient.post("/admin/discount-rules", data);
    return res.data;
  },

  updateRule: async (
    publicId: string,
    data: Partial<DiscountRuleLimits & {
      name: string;
      description: string;
      value: number;
      scope: DiscountScope;
      startDate: string;
      endDate: string;
      /** true reactivates a deactivated rule. */
      isActive: true;
    }>,
  ): Promise<{ message: string; data: AdminDiscountRule }> => {
    const res = await apiClient.patch(`/admin/discount-rules/${publicId}`, data);
    return res.data;
  },

  reactivateRule: async (publicId: string): Promise<{ message: string; data: AdminDiscountRule }> => {
    const res = await apiClient.patch(`/admin/discount-rules/${publicId}`, { isActive: true });
    return res.data;
  },

  deactivateRule: async (publicId: string): Promise<{ message: string }> => {
    const res = await apiClient.post(`/admin/discount-rules/${publicId}/deactivate`);
    return res.data;
  },

  generateCode: async (): Promise<{ data: { code: string } }> => {
    const res = await apiClient.post("/admin/discount-rules/generate-code", { pattern: "PROMOTIONAL" });
    return res.data;
  },

  listManagerCoupons: async (params?: {
    isActive?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: AdminManagerCoupon[]; total: number }> => {
    const res = await apiClient.get("/admin/discount-rules/manager-coupons", { params });
    return res.data;
  },
};

// ── Public (no auth) ─────────────────────────────────────────────────────────

export interface CouponValidateParams {
  couponCode: string;
  vehiclePublicId?: string;
  groupKey?: string;
  startAt: string;
  endAt: string;
  /** Plan the customer picked; omitted = the branch's default plan. */
  paymentFlow?: PaymentFlow;
}

export const discountPublicService = {
  validateCoupon: async (params: CouponValidateParams): Promise<{ data: CouponValidation }> => {
    const res = await apiClient.post("/public/discount/validate", params);
    return res.data;
  },
};

// ── Customer (authenticated) ──────────────────────────────────────────────────

export const discountCustomerService = {
  validateCoupon: async (params: CouponValidateParams): Promise<{ data: CouponValidation }> => {
    const res = await apiClient.post("/user/discount/validate", params);
    return res.data;
  },
};

// ── Employee ─────────────────────────────────────────────────────────────────

export const employeeDiscountService = {
  getDiscountSummary: async (bookingId: string): Promise<{ data: DiscountSummary | null }> => {
    const res = await apiClient.get(`/employee/discount/bookings/${bookingId}/discount-summary`);
    return res.data;
  },

  applyCoupon: async (bookingId: string, couponCode: string): Promise<{ message: string; data: any }> => {
    const res = await apiClient.post(`/employee/discount/bookings/${bookingId}/apply-coupon`, { couponCode });
    return res.data;
  },

  removeCoupon: async (bookingId: string): Promise<{ message: string; data: any }> => {
    const res = await apiClient.delete(`/employee/discount/bookings/${bookingId}/apply-coupon`);
    return res.data;
  },

  applyManualDiscount: async (
    bookingId: string,
    data: { amount: number; reason: string },
  ): Promise<{ message: string; data: { requiresApproval: boolean; publicId: string; amount: string } }> => {
    const res = await apiClient.post(`/employee/discount/bookings/${bookingId}/manual-discount`, data);
    return res.data;
  },
};

// ── Manager ──────────────────────────────────────────────────────────────────

export const managerDiscountService = {
  // Config
  getConfig: async (): Promise<{ data: DiscountConfig }> => {
    const res = await apiClient.get("/branchManager/discount/config");
    return res.data;
  },

  updateConfig: async (data: Partial<DiscountConfigUpdate>): Promise<{ message: string; data: DiscountConfig }> => {
    const res = await apiClient.patch("/branchManager/discount/config", data);
    return res.data;
  },

  // Slabs — 400 INVALID_SLAB / 409 SLAB_OVERLAP carry a message
  getSlabs: async (): Promise<{ data: DurationSlab[] }> => {
    const res = await apiClient.get("/branchManager/discount/slabs");
    return res.data;
  },

  createSlab: async (data: DurationSlabInput): Promise<{ message: string; data: DurationSlab }> => {
    const res = await apiClient.post("/branchManager/discount/slabs", data);
    return res.data;
  },

  updateSlab: async (
    id: number,
    data: Partial<DurationSlabInput>,
  ): Promise<{ message: string; data: DurationSlab }> => {
    const res = await apiClient.patch(`/branchManager/discount/slabs/${id}`, data);
    return res.data;
  },

  deleteSlab: async (id: number): Promise<{ message: string }> => {
    const res = await apiClient.delete(`/branchManager/discount/slabs/${id}`);
    return res.data;
  },

  // Manual discounts
  getPendingManualDiscounts: async (): Promise<{ data: ManualDiscount[] }> => {
    const res = await apiClient.get("/branchManager/discount/manual-discounts/pending");
    return res.data;
  },

  getManualDiscount: async (publicId: string): Promise<{ data: ManualDiscount }> => {
    const res = await apiClient.get(`/branchManager/discount/manual-discounts/${publicId}`);
    return res.data;
  },

  approveManualDiscount: async (
    publicId: string,
    managerNote?: string,
  ): Promise<{ message: string; data: any }> => {
    const res = await apiClient.post(`/branchManager/discount/manual-discounts/${publicId}/approve`, { managerNote });
    return res.data;
  },

  rejectManualDiscount: async (
    publicId: string,
    managerNote?: string,
  ): Promise<{ message: string; data: any }> => {
    const res = await apiClient.post(`/branchManager/discount/manual-discounts/${publicId}/reject`, { managerNote });
    return res.data;
  },

  // Coupons
  getCoupons: async (): Promise<{ data: ManagerCoupon[] }> => {
    const res = await apiClient.get("/branchManager/discount/coupons");
    return res.data;
  },

  getCouponLimits: async (): Promise<{ data: { canCreate: boolean; remaining: number } }> => {
    const res = await apiClient.get("/branchManager/discount/coupons/limits");
    return res.data;
  },

  createCoupon: async (data: {
    name: string;
    discountType: "PERCENTAGE" | "FLAT";
    value: number;
    reason: string;
    validityDays?: number;
    usageLimit?: number;
    perUserLimit?: number;
    targetCustomerIds?: number[];
    description?: string;
  }): Promise<{ message: string; data: ManagerCoupon }> => {
    const res = await apiClient.post("/branchManager/discount/coupons", data);
    return res.data;
  },

  updateCoupon: async (
    publicId: string,
    data: {
      name?: string;
      value?: number;
      usageLimit?: number;
      perUserLimit?: number;
      targetCustomerIds?: number[];
      extendDays?: number;
      reason?: string;
    },
  ): Promise<{ message: string }> => {
    const res = await apiClient.patch(`/branchManager/discount/coupons/${publicId}`, data);
    return res.data;
  },

  deactivateCoupon: async (publicId: string): Promise<{ message: string }> => {
    const res = await apiClient.patch(`/branchManager/discount/coupons/${publicId}/deactivate`);
    return res.data;
  },

  searchCustomer: async (q: string): Promise<{ data: Array<{ customerProfileId: number; name: string; phone: string; publicId: string }> }> => {
    const res = await apiClient.get("/branchManager/discount/coupons/customer-search", { params: { q } });
    return res.data;
  },

  // Booking discount
  getDiscountSummary: async (bookingId: string): Promise<{ data: DiscountSummary | null }> => {
    const res = await apiClient.get(`/branchManager/discount/bookings/${bookingId}/discount-summary`);
    return res.data;
  },

  applyCoupon: async (bookingId: string, couponCode: string): Promise<{ message: string; data: any }> => {
    const res = await apiClient.post(`/branchManager/discount/bookings/${bookingId}/apply-coupon`, { couponCode });
    return res.data;
  },
};

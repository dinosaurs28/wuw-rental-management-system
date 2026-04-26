import apiClient from "@/lib/axios";

export interface CouponValidationResult {
  valid: true;
  couponCode: string;
  discountAmount: string;
  discountType?: string;
  discountValue?: string;
}

export interface CouponValidationError {
  valid: false;
  code: string;
  reason: string;
}

export type CouponValidation = CouponValidationResult | CouponValidationError;

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

export interface DiscountConfig {
  durationDiscountEnabled: boolean;
  stackWithCoupons: boolean;
  maxCombinedDiscountPercent: number;
  managerApprovalThreshold: number;
  maxManualDiscountsPerDay: number;
}

export interface DurationSlab {
  id: number;
  publicId: string;
  minDays: number;
  maxDays: number | null;
  discountType: "PERCENTAGE" | "FLAT";
  discountValue: string;
  label: string | null;
  isActive: boolean;
}

export interface ManagerCoupon {
  publicId: string;
  code: string;
  name: string;
  discountType: "PERCENTAGE" | "FLAT";
  discountValue: string;
  maxDiscountCap: string | null;
  totalUsageLimit: number | null;
  perCustomerLimit: number | null;
  usageCount: number;
  validFrom: string | null;
  validTo: string | null;
  minBookingAmount: string | null;
  minRentalDays: number | null;
  isActive: boolean;
}

export interface AdminDiscountRule {
  publicId: string;
  code: string;
  name: string;
  description: string | null;
  discountType: "PERCENTAGE" | "FLAT";
  value: string;
  maxDiscountCap: string | null;
  scope: "GLOBAL" | "BRANCH";
  applicableBranchIds: number[];
  totalUsageLimit: number | null;
  perUserLimit: number | null;
  minBookingAmount: string | null;
  minRentalDays: number | null;
  startDate: string;
  endDate: string;
  isActive: boolean;
  stackable: boolean;
  priority: number;
  createdBy: { name: string; publicId: string };
  _count: { usageLogs: number };
}

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
    scope?: "GLOBAL" | "BRANCH";
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: { rules: AdminDiscountRule[]; total: number; page: number; pageSize: number } }> => {
    const res = await apiClient.get("/admin/discount-rules", { params });
    return res.data;
  },

  createRule: async (data: {
    code: string;
    name: string;
    description?: string;
    discountType: "PERCENTAGE" | "FLAT";
    value: number;
    maxDiscountCap?: number;
    scope: "GLOBAL" | "BRANCH";
    startDate: string;
    endDate: string;
    totalUsageLimit?: number;
    perUserLimit?: number;
    minBookingAmount?: number;
    minRentalDays?: number;
    stackable?: boolean;
    priority?: number;
  }): Promise<{ message: string; data: { publicId: string; code: string } }> => {
    const res = await apiClient.post("/admin/discount-rules", data);
    return res.data;
  },

  updateRule: async (
    publicId: string,
    data: Partial<{
      name: string;
      description: string;
      value: number;
      maxDiscountCap: number | null;
      startDate: string;
      endDate: string;
      totalUsageLimit: number | null;
      perUserLimit: number | null;
      minBookingAmount: number | null;
      minRentalDays: number | null;
      stackable: boolean;
      priority: number;
    }>,
  ): Promise<{ message: string; data: AdminDiscountRule }> => {
    const res = await apiClient.patch(`/admin/discount-rules/${publicId}`, data);
    return res.data;
  },

  deactivateRule: async (publicId: string): Promise<{ message: string }> => {
    const res = await apiClient.post(`/admin/discount-rules/${publicId}/deactivate`);
    return res.data;
  },

  generateCode: async (): Promise<{ data: { code: string } }> => {
    const res = await apiClient.post("/admin/discount-rules/generate-code", {});
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

export const discountPublicService = {
  validateCoupon: async (params: {
    couponCode: string;
    vehiclePublicId?: string;
    groupKey?: string;
    startAt: string;
    endAt: string;
  }): Promise<{ data: CouponValidation }> => {
    const res = await apiClient.post("/public/discount/validate", params);
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

  updateConfig: async (data: Partial<DiscountConfig>): Promise<{ message: string; data: DiscountConfig }> => {
    const res = await apiClient.patch("/branchManager/discount/config", data);
    return res.data;
  },

  // Slabs
  getSlabs: async (): Promise<{ data: DurationSlab[] }> => {
    const res = await apiClient.get("/branchManager/discount/slabs");
    return res.data;
  },

  createSlab: async (data: {
    minDays: number;
    maxDays?: number;
    discountType: "PERCENTAGE" | "FLAT";
    discountValue: number;
    label?: string;
  }): Promise<{ message: string; data: DurationSlab }> => {
    const res = await apiClient.post("/branchManager/discount/slabs", data);
    return res.data;
  },

  updateSlab: async (
    id: number,
    data: {
      minDays?: number;
      maxDays?: number;
      discountType?: "PERCENTAGE" | "FLAT";
      discountValue?: number;
      label?: string;
      isActive?: boolean;
    },
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
    targetCustomerIds?: number[];
    description?: string;
  }): Promise<{ message: string; data: ManagerCoupon }> => {
    const res = await apiClient.post("/branchManager/discount/coupons", data);
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

import axios from "axios";
import type { PaymentOptions } from "@/lib/paymentPlan";

const API_URL = import.meta.env.VITE_API_URL;

// Trip-type tags (#16) — exact enum strings used by the backend
export const VEHICLE_USE_CASES = ["HIGHWAY", "HILL_STATION", "LONG_DRIVE"] as const;
export type VehicleUseCase = (typeof VEHICLE_USE_CASES)[number];
export const VEHICLE_USE_CASE_LABELS: Record<VehicleUseCase, string> = {
  HIGHWAY: "Highway",
  HILL_STATION: "Hill Station",
  LONG_DRIVE: "Long Drive",
};

export interface VehicleFilters {
  branch?: string;
  category?: string;
  search?: string;
  status?: string;
  sort?: "price_low_to_high" | "price_high_to_low";
  limit?: number;
  offset?: number;
  start?: string;
  end?: string;
  useCases?: VehicleUseCase[];
}

export interface VehicleImage {
  file: {
    url: string;
  };
}

// Public-facing grouped vehicle (from /public/vehicles — one entry per make+model+category+branch)
export interface PublicVehicle {
  groupKey: string;
  make: string;
  model: string;
  category: string;
  typeClass?: "TWO_WHEELER" | "FOUR_WHEELER" | "OTHER";
  branch: string;
  /** Optional: cached payloads may lack it for ~60 s after a deploy. */
  branchPublicId?: string;
  availableCount: number;
  useCases?: VehicleUseCase[];
  imageUrl: VehicleImage[];
  pricing: {
    daily: number;
    hourly?: number;
    halfDay?: number;
  };
  pricingDetails?: {
    /** Period total (not a per-day rate). */
    price: number;
    finalPrice: number;
    type: "HOURLY" | "HALF_DAY" | "FULL_DAY" | "MULTI_DAY" | "MONTHLY";
    /** What the price covers, e.g. "5 hours", "12 hours", "1 day + 2 hours". */
    billedAs?: string;
    billedAsType?: BilledAsType;
    /** Duration-slab saving already inside finalPrice (absent when none). */
    discountAmount?: number;
    discountPercent?: number;
    discountLabel?: string | null;
    // GST inside finalPrice (item 17: price and finalPrice are GST-inclusive).
    // Absent when the branch has no GST rule.
    rentWithoutGst?: number;
    gst?: number;
    cgst?: number;
    sgst?: number;
  };
}

/**
 * GST-inclusive rent fields on a pricing result (item 17). Absent only on a
 * quote cached before they existed; `rentInclGstView` in lib/gst falls back.
 */
export interface PricingInclGstFields {
  /** Rent incl. GST before discounts — the price. */
  rentInclGst?: number;
  durationDiscountInclGst?: number;
  couponDiscountInclGst?: number;
  manualDiscountInclGst?: number;
  discountInclGst?: number;
  /** Rent incl. GST after discounts (= finalTotal). */
  rentAfterDiscountInclGst?: number;
  /** Rent without GST after discounts. */
  rentWithoutGst?: number;
  gst?: number;
  cgst?: number;
  sgst?: number;
}

/** How a price was actually worked out (may differ from the duration's period type). */
export type BilledAsType = "HOURLY" | "HALF_DAY" | "FULL_DAY" | "MULTI_DAY" | "MONTHLY";

// Group details response (from /public/vehicles/group/:groupKey)
export interface VehicleGroupDetails {
  groupKey: string;
  make: string;
  model: string;
  category: string;
  branch: string;
  /** Optional: cached payloads may lack it for ~60 s after a deploy. */
  branchPublicId?: string;
  availableCount: number;
  totalCount: number;
  useCases?: VehicleUseCase[];
  images: string[];
  pricing: { daily: number | null };
  deposit: number;
  availability: boolean | null;
  advancePayAmount: number;
  customerPaymentMode?: 'ADVANCE_ONLY' | 'FULL_ONLY' | 'BOTH';
  /** Plans the customer may pick (server). Optional: cached payloads may lack it for ~30 s after a deploy. */
  paymentOptions?: PaymentOptions;
  pricingDetails: (PricingInclGstFields & {
    /** Rent WITHOUT GST before discounts (taxable terms). */
    basePrice: number;
    /** Combined discount (duration slab + coupon), taxable terms. */
    discountAmount: number;
    discountPercent: number;
    // Duration-slab layer (absent on quotes cached before they existed)
    durationDiscountAmount?: number;
    durationDiscountPercent?: number;
    durationDiscountLabel?: string | null;
    durationDiscountType?: "PERCENTAGE" | "FLAT" | null;
    couponDiscountAmount?: number;
    deposit: number;
    taxAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    taxRate: number;
    // Server GST rates; null for up to 60 s on a pricing result cached before they existed.
    cgstRate?: number | null;
    sgstRate?: number | null;
    /** Rent incl. GST after discounts. */
    finalTotal: number;
    freeKmLimit: number;
    extraKmRate: number;
    pricingBreakdown: {
      periodType: "HOURLY" | "HALF_DAY" | "FULL_DAY" | "MULTI_DAY" | "MONTHLY";
      duration: { billableDuration: number; days: number; hours: number; minutes: number };
      applicablePrice: number;
      priceSource: string;
      /** What the price covers, e.g. "5 hours", "1 day + 2 hours" (absent on stale cached quotes). */
      billedAs?: string;
      billedAsType?: BilledAsType;
    };
  }) | null;
}

export interface VehicleGroupDetailsResponse {
  message?: string;
  data: VehicleGroupDetails;
}

// Manager vehicle (from /branchManager/dashboard/vehicles)
/** Why customers don't see a car (BM vehicles list; item 7). */
export type VehicleHiddenReason =
  | "INSURANCE_EXPIRED"
  | "DAMAGE_REVIEW_PENDING"
  | "STATUS_MAINTENANCE"
  | "STATUS_INACTIVE"
  | "NO_PRICE"
  | "MANUAL_OUT_FOR_RENTAL"
  | "OVERDUE_RETURN";

export const VEHICLE_HIDDEN_REASON_LABEL: Record<VehicleHiddenReason, string> = {
  INSURANCE_EXPIRED: "Insurance expired",
  DAMAGE_REVIEW_PENDING: "Damage review pending",
  STATUS_MAINTENANCE: "In maintenance",
  STATUS_INACTIVE: "Inactive",
  NO_PRICE: "No 24-hour price set",
  MANUAL_OUT_FOR_RENTAL: "Set Out for Rental by hand (no rental behind it)",
  OVERDUE_RETURN: "Not back from a rental (overdue)",
};

export interface ManagerVehicle {
  publicId: string;
  make: string;
  model: string;
  regNo: string;
  status: string;
  /** Absent from older servers. */
  insuranceExpiry?: string;
  /** Why customers can't see or book it; empty = listed. Absent from older servers. */
  hiddenReasons?: VehicleHiddenReason[];
  /** The overdue rental behind OVERDUE_RETURN; null / absent otherwise. */
  overdueRental?: { bookingId: string; endAt: string } | null;
  useCases?: VehicleUseCase[];
  category: {
    name: string;
  };
  images: VehicleImage[];
  customPricing?: {
    price24Hour: string | number;
    /** GST-inclusive daily total and its rent without GST (item 17; absent from older servers). */
    totalRent24Hour?: string | number | null;
    rentWithoutGst24Hour?: string | number | null;
  };
}

// Legacy alias for backward compatibility
export type Vehicle = PublicVehicle;

export interface PublicVehiclesResponse {
  count: number;
  data: PublicVehicle[];
}

export interface ManagerVehiclesResponse {
  count: number;
  data: ManagerVehicle[];
}

// Legacy alias
export type VehiclesResponse = PublicVehiclesResponse;

// Public vehicles endpoint (for customer-facing pages)
export const fetchPublicVehicles = async (
  filters: VehicleFilters,
): Promise<PublicVehiclesResponse> => {
  try {
    const params = new URLSearchParams();

    if (filters.branch) params.append("branch", filters.branch);
    if (filters.category) params.append("category", filters.category);
    if (filters.search) params.append("search", filters.search);
    if (filters.limit) params.append("limit", filters.limit.toString());
    if (filters.offset) params.append("offset", filters.offset.toString());
    if (filters.start) params.append("start", filters.start);
    if (filters.end) params.append("end", filters.end);
    if (filters.useCases && filters.useCases.length > 0)
      params.append("useCases", filters.useCases.join(","));

    const response = await axios.get<PublicVehiclesResponse>(
      `${API_URL}/public/vehicles`,
      {
        params,
        withCredentials: true,
      },
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching public vehicles:", error);
    throw error;
  }
};

// Manager vehicles endpoint (for branch manager dashboard)
export const fetchManagerVehicles = async (
  filters: VehicleFilters,
): Promise<ManagerVehiclesResponse> => {
  try {
    const params = new URLSearchParams();

    if (filters.branch) params.append("branch", filters.branch);
    if (filters.category) params.append("category", filters.category);
    if (filters.search) params.append("search", filters.search);
    if (filters.status) params.append("status", filters.status);
    if (filters.limit) params.append("limit", filters.limit.toString());
    if (filters.offset) params.append("offset", filters.offset.toString());

    const response = await axios.get<ManagerVehiclesResponse>(
      `${API_URL}/branchManager/dashboard/vehicles`,
      {
        params,
        withCredentials: true,
      },
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching manager vehicles:", error);
    throw error;
  }
};

// Legacy alias for backward compatibility
export const fetchVehicles = fetchPublicVehicles;

// Vehicle Details Types
export interface VehicleDetails {
  publicId: string;
  make: string;
  model: string;
  year: number;
  regNo: string;
  odo: number;
  status: "AVAILABLE" | "MAINTENANCE" | "NOT_AVAILABLE";
  availability?: boolean;
  seats?: number;
  transmission?: string;
  fuelType?: string;
  description?: string;
  categoryId: number;
  category?: {
    name: string;
  };
  branch?: string;
  branchId: string;
  /** Optional: cached payloads may lack it for ~60 s after a deploy. */
  branchPublicId?: string;
  images: {
    id: string;
    publicId: string;
    isThumbnail: boolean;
    file: {
      url: string;
    };
  }[];
  baseDailyPrice: number;
  insuranceRecords?: {
    policyNumber: string;
    provider: string;
    validTill: string;
  }[];
  policyNumber?: string;
  provider?: string;
  insuranceExpiry?: string;
  customPricing?: {
    hourlyRate?: number;
    price12Hour?: number;
    freeKm12Hour?: number;
    price24Hour?: number;
    freeKm24Hour?: number;
    priceMonthly?: number;
    freeKmMonthly?: number;
    extraKmRate?: number;
    extraHourRate?: number;
    enabled?: boolean;
    // GST-inclusive totals and their rent without GST (item 17; BM GET vehicle).
    // Decimal strings from the server; null when not set / no branch GST rule.
    totalRent12Hour?: number | string | null;
    totalRent24Hour?: number | string | null;
    rentWithoutGst12Hour?: number | string | null;
    rentWithoutGst24Hour?: number | string | null;
  } | null;
  /** BM GET vehicle: the branch GST rule for the form's live preview (null = no rule). */
  gstRates?: { cgstRate: number; sgstRate: number } | null;
  advancePayAmount?: number;
  fuelBar?: number | null;
  customerPaymentMode?: 'ADVANCE_ONLY' | 'FULL_ONLY' | 'BOTH';
  /** Plans the customer may pick (server). Optional: cached payloads may lack it for ~60 s after a deploy. */
  paymentOptions?: PaymentOptions;
  hasFastag?: boolean;
  fastagNumber?: string;
  useCases?: VehicleUseCase[];
  pricing: {
    daily: number;
  };
  deposit: number;
  pricingDetails: (PricingInclGstFields & {
    /** Rent WITHOUT GST before discounts (taxable terms). */
    basePrice: number;
    /** Combined discount (duration slab + coupon), taxable terms. */
    discountAmount: number;
    discountPercent: number;
    // Duration-slab layer (absent on quotes cached before they existed)
    durationDiscountAmount?: number;
    durationDiscountPercent?: number;
    durationDiscountLabel?: string | null;
    durationDiscountType?: "PERCENTAGE" | "FLAT" | null;
    couponDiscountAmount?: number;
    deposit: number;
    taxAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    taxRate: number;
    // Server GST rates; null for up to 60 s on a pricing result cached before they existed.
    cgstRate?: number | null;
    sgstRate?: number | null;
    finalTotal: number;
    freeKmLimit: number;
    extraKmRate: number;
    pricingBreakdown: {
      periodType: "HOURLY" | "HALF_DAY" | "FULL_DAY" | "MULTI_DAY" | "MONTHLY";
      duration: {
        billableDuration: number;
        days: number;
        hours: number;
        minutes: number;
      };
      applicablePrice: number;
      priceSource: string;
      /** What the price covers, e.g. "5 hours", "1 day + 2 hours" (absent on stale cached quotes). */
      billedAs?: string;
      billedAsType?: BilledAsType;
    };
  }) | null;
}

export interface VehicleDetailsResponse {
  message?: string;
  data: VehicleDetails;
}

export interface VehicleDetailsParams {
  vehicleId: string;
  startDate?: string;
  endDate?: string;
}

export const fetchVehicleGroupDetails = async (
  groupKey: string,
  startDate?: string,
  endDate?: string,
): Promise<VehicleGroupDetailsResponse> => {
  try {
    const response = await axios.get<VehicleGroupDetailsResponse>(
      `${API_URL}/public/vehicles/group/${encodeURIComponent(groupKey)}`,
      {
        params: { start: startDate, end: endDate },
        withCredentials: true,
      },
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching vehicle group details:", error);
    throw error;
  }
};

export const fetchVehicleDetails = async (
  params: VehicleDetailsParams,
): Promise<VehicleDetailsResponse> => {
  try {
    const response = await axios.get<VehicleDetailsResponse>(
      `${API_URL}/public/vehicles/${params.vehicleId}`,
      {
        params: {
          start: params.startDate,
          end: params.endDate,
        },
        withCredentials: true,
      },
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching vehicle details:", error);
    throw error;
  }
};

export const fetchManagerVehicleDetails = async (
  vehicleId: string,
): Promise<VehicleDetailsResponse> => {
  try {
    const response = await axios.get<VehicleDetailsResponse>(
      `${API_URL}/branchManager/dashboard/vehicle/${vehicleId}`,
      {
        withCredentials: true,
      },
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching manager vehicle details:", error);
    throw error;
  }
};

export const createVehicle = async (
  formData: FormData,
): Promise<VehicleDetailsResponse> => {
  try {
    const response = await axios.post<VehicleDetailsResponse>(
      `${API_URL}/branchManager/dashboard/vehicle/add`,
      formData,
      {
        headers: { "Content-Type": "multipart/form-data" },
        withCredentials: true,
      },
    );
    return response.data;
  } catch (error) {
    console.error("Error creating vehicle:", error);
    throw error;
  }
};

export const updateVehicle = async (
  vehicleId: string,
  formData: FormData,
): Promise<VehicleDetailsResponse> => {
  try {
    const response = await axios.put<VehicleDetailsResponse>(
      `${API_URL}/branchManager/dashboard/vehicle/edit/${vehicleId}`,
      formData,
      {
        headers: { "Content-Type": "multipart/form-data" },
        withCredentials: true,
      },
    );
    return response.data;
  } catch (error) {
    console.error("Error updating vehicle:", error);
    throw error;
  }
};

export const deleteVehicle = async (vehicleId: string): Promise<void> => {
  try {
    await axios.delete(
      `${API_URL}/branchManager/dashboard/vehicle/${vehicleId}`,
      { withCredentials: true },
    );
  } catch (error) {
    console.error("Error deleting vehicle:", error);
    throw error;
  }
};

export interface Category {
  id: number;
  publicId: string;
  name: string;
}

export interface CategoriesResponse {
  data: Category[];
}

export interface InsuranceExpiryReportItem {
  publicId: string;
  vehicleName: string;
  thumbnail: string | null;
  make: string;
  model: string;
  regNo: string;
  policyNumber: string;
  provider: string;
  expiryDate: string;
}

export interface InsuranceExpiryReportResponse {
  data: InsuranceExpiryReportItem[];
  total: number;
  page: number;
  limit: number;
  summary: { expired: number; expiringSoon: number };
}

export const fetchInsuranceExpiryReport = async (params: {
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<InsuranceExpiryReportResponse> => {
  const query = new URLSearchParams();
  if (params.search) query.append("q", params.search);
  if (params.status) query.append("status", params.status);
  if (params.page) query.append("page", String(params.page));
  if (params.limit) query.append("limit", String(params.limit));

  const response = await axios.get<InsuranceExpiryReportResponse>(
    `${API_URL}/branchManager/dashboard/reports/insurance-expiry`,
    { params: query, withCredentials: true },
  );
  return response.data;
};

export const fetchVehicleCategories = async (): Promise<Category[]> => {
  try {
    const response = await axios.get<CategoriesResponse>(
      `${API_URL}/branchManager/dashboard/categories`,
      {
        withCredentials: true,
      },
    );
    return response.data.data;
  } catch (error) {
    console.error("Error fetching categories:", error);
    return [];
  }
};

export const fetchPublicVehicleCategories = async (): Promise<Category[]> => {
  try {
    const response = await axios.get<CategoriesResponse>(
      `${API_URL}/public/categories`,
      {
        withCredentials: true,
      },
    );
    return response.data.data;
  } catch (error) {
    console.error("Error fetching public categories:", error);
    return [];
  }
};

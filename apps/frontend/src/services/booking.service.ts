import apiClient from "@/lib/axios";
import { isAxiosError } from "axios";
import { format } from "date-fns";
import type { RazorpayOrder } from "@/lib/razorpay";
import type { BookingListCounts, BookingListType } from "@/types/overdueReturns";
import type { DlStatus, UpdateDlStatusBody } from "@/services/dlStatus.service";
import type {
  KmSegments,
  LegacyReturnCharges,
  RentalTimeline,
  ReturnLateSummary,
  SwapChargePreview,
} from "@/types/drop";
import type { ReturnKmSummary } from "@/services/paymentSession.service";
import type { PaymentFlowReason, PaymentOptions } from "@/lib/paymentPlan";

// Existing Customer Interfaces...
// Types for booking summary request
export interface CreateBookingSummaryRequest {
  vehicles?: string[];   // Direct vehicle public IDs (admin/employee flow)
  groupKeys?: string[];  // Group keys for atomic vehicle assignment (public flow)
  start: string;
  end: string;
  /** KYC picture (X2) — optional; sent only when the customer picked a document. */
  file_public_id?: string;
  payment_type: "CASH" | "ONLINE";
  payment_flow?: "FULL" | "ADVANCE";
  couponCode?: string;
}

// Types for booking summary response
export interface BookingItem {
  publicId: string;
  make: string;
  model: string;
  category: string;
  branch: string;
  days: number;
  baseTotal: number;
  discountAmount: number;
  discountPercent: number;
  deposit: number;
  finalTotal: number;
  // GST-inclusive rent of this vehicle (item 17; absent from older servers)
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
  /** What the base price covers, e.g. "5 hours", "1 day + 2 hours" (#5). */
  pricingBreakdown?: {
    periodType?: string;
    billedAs?: string;
    billedAsType?: "HOURLY" | "HALF_DAY" | "FULL_DAY" | "MULTI_DAY" | "MONTHLY";
  };
}

export interface BookingTotals {
  grandBaseTotal: number;
  grandDiscountTotal: number;
  grandTaxTotal: number;
  grandCGSTTotal?: number;
  grandSGSTTotal?: number;
  taxRate?: number;
  /** Server CGST / SGST rates (%) for the booking's branch — label with these, never taxRate/2. */
  cgstRate?: number;
  sgstRate?: number;
  grandDeposit: number;
  grandFinalTotal: number;
  isAdvancePayment?: boolean;
  advanceAmount?: number;
  remainingBalance?: number;
  /** Customer booking create: amount of the Razorpay order (advance or full). */
  payNowAmount?: number;
  /** Customer booking create: balance due at pickup (0 for FULL). */
  dueAtPickup?: number;
  /** Duration-slab layer (pre-GST); + grandCouponDiscountTotal = grandDiscountTotal. */
  grandDurationDiscountTotal?: number;
  /** Coupon layer (pre-GST). */
  grandCouponDiscountTotal?: number;
  /** Slab label, e.g. "Weekly" (null if none). */
  durationDiscountLabel?: string | null;
  appliedCouponCode?: string | null;
  razorpay: RazorpayOrder | null;
  encryptedFinalPrice: string | null;
  transactionId: string | null;
  // GST-inclusive rent (item 17; absent from older servers). grandBaseTotal /
  // grandDiscountTotal / the layer totals above are rent WITHOUT GST.
  // grandRentAfterDiscountInclGst = grandRentInclGst − grandDiscountInclGst
  //                               = grandRentWithoutGst + grandTaxTotal.
  grandRentInclGst?: number;
  grandDurationDiscountInclGst?: number;
  grandCouponDiscountInclGst?: number;
  grandManualDiscountInclGst?: number;
  grandDiscountInclGst?: number;
  grandRentAfterDiscountInclGst?: number;
  grandRentWithoutGst?: number;
}

/**
 * The GST-inclusive rent of a booking's totals (item 17). Older servers (GST
 * added on top of the pre-GST rent) read the same way from the classic totals:
 * rent after discounts = base − discount + GST.
 */
export function bookingTotalsInclGst(t: Pick<
  BookingTotals,
  | "grandBaseTotal"
  | "grandDiscountTotal"
  | "grandTaxTotal"
  | "grandDurationDiscountTotal"
  | "grandCouponDiscountTotal"
  | "grandRentInclGst"
  | "grandDurationDiscountInclGst"
  | "grandCouponDiscountInclGst"
  | "grandManualDiscountInclGst"
  | "grandDiscountInclGst"
  | "grandRentAfterDiscountInclGst"
  | "grandRentWithoutGst"
>): {
  rent: number;
  durationDiscount: number;
  couponDiscount: number;
  manualDiscount: number;
  discount: number;
  rentAfterDiscount: number;
  rentWithoutGst: number;
  gst: number;
} {
  const n = (v: number | string | null | undefined) => Number(v ?? 0) || 0;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  if (t.grandRentInclGst != null && t.grandRentAfterDiscountInclGst != null) {
    return {
      rent: n(t.grandRentInclGst),
      durationDiscount: n(t.grandDurationDiscountInclGst),
      couponDiscount: n(t.grandCouponDiscountInclGst),
      manualDiscount: n(t.grandManualDiscountInclGst),
      discount: n(t.grandDiscountInclGst),
      rentAfterDiscount: n(t.grandRentAfterDiscountInclGst),
      rentWithoutGst: n(t.grandRentWithoutGst),
      gst: n(t.grandTaxTotal),
    };
  }
  const rentWithoutGst = r2(n(t.grandBaseTotal) - n(t.grandDiscountTotal));
  const rentAfterDiscount = r2(rentWithoutGst + n(t.grandTaxTotal));
  return {
    rent: r2(rentAfterDiscount + n(t.grandDiscountTotal)),
    durationDiscount: n(t.grandDurationDiscountTotal),
    couponDiscount: n(t.grandCouponDiscountTotal),
    manualDiscount: 0,
    discount: n(t.grandDiscountTotal),
    rentAfterDiscount,
    rentWithoutGst,
    gst: n(t.grandTaxTotal),
  };
}

export interface CreateBookingSummaryResponse {
  message: string;
  holdId: string;
  payment_type: "CASH" | "ONLINE";
  /** The plan actually charged (the server converts a plan the branch/amounts don't allow). */
  payment_flow: "FULL" | "ADVANCE";
  /** null when the request carried no payment_flow (item 18: the plan is the server's). */
  paymentFlowRequested?: "FULL" | "ADVANCE" | null;
  paymentFlowAdjusted?: boolean;
  paymentFlowAdjustReason?: PaymentFlowReason | null;
  /** Show as an inline notice when the plan was adjusted. */
  paymentFlowAdjustMessage?: string | null;
  paymentOptions?: PaymentOptions;
  isAdvancePayment: boolean;
  expiresIn: number;
  expiresAt: string;
  data: {
    items: BookingItem[];
    startDate: string;
    endDate: string;
    totals: BookingTotals;
  };
}

export interface CreateEmployeeBookingResponse {
  message: string;
  data: {
    bookingId: string;
    publicId?: string; // Mapped for frontend consistency
    razorpay: RazorpayOrder | null;
    status: string;
    startDate: string;
    endDate: string;
    transactionId: string;
    totals: BookingTotals;
    items: any[];
    expiresAt: string;
    expiresIn: number;
    /** Stored period type, e.g. "HALF_DAY", "MONTHLY" (#5/#17). */
    rentalPeriodType?: "HOURLY" | "HALF_DAY" | "FULL_DAY" | "MULTI_DAY" | "MONTHLY";
    plan?: "STANDARD" | "MONTHLY";
  };
}

// Online payment status response
export interface PaymentStatusResponse {
  status: "Success" | "Pending" | "Failed";
  message?: string;
  redirectURL?: string;
}

// Cash payment confirmation request/response
export interface ConfirmCashPaymentRequest {
  encryptedFinalPrice: string;
  transactionId: string;
  payment_type?: string;
}

export interface ConfirmCashPaymentResponse {
  status: "Success" | "Failed";
  message: string;
  redirectURL?: string;
}

// --- EMPLOYEE INTERFACES & SERVICE ---

export interface FrozenChargeConfig {
  extraKmEnabled: boolean;
  extraTimeEnabled: boolean;
  fuelModuleEnabled: boolean;
  fastagModuleEnabled: boolean;
  gracePolicyEnabled: boolean;
  graceType: "AUTOMATIC" | "MANUAL";
  graceMinutes: number;
  employeeOverrideEnabled: boolean;
  safetyDepositEnabled: boolean;
  safetyDepositRequiresApproval: boolean;
  damageModuleEnabled: boolean;
}

export interface ChargeEntry {
  chargeType: string;
  moduleKey: string;
  label: string;
  originalAmount: string;
  finalAmount: string;
  quantity: string | null;
  unitRate: string | null;
  isOverridden: boolean;
  notes: string | null;
}

export interface ChargeBreakdown {
  bookingId: string;
  subtotal: string;
  waivedTotal: string;
  finalTotal: string;
  charges: ChargeEntry[];
}

export interface EmployeeBooking {
  publicId: string;
  startAt: string;
  endAt: string;
  status: string;
  totalFinal: string;
  isAdvancePayment?: boolean;
  advanceAmount?: string;
  remainingBalance?: string;
  remainingPaidAt?: string | null;
  remainingPaidDuring?: string | null;
  requiresManagerConfirmation?: boolean;
  frozenChargeConfig?: FrozenChargeConfig | null;
  startOdometer?: number | null;
  safetyDeposit?: string | null;
  days?: number;
  /** HOURLY | HALF_DAY | FULL_DAY | MULTI_DAY | MONTHLY (null on old rows). */
  rentalPeriodType?: string | null;
  /** Daily / Monthly tab the booking belongs to (list endpoints only). */
  bookingType?: BookingListType;
  freeKmLimit?: number | null;
  effectiveFreeKmLimit?: number | null;
  extraKmRate?: number | null;
  pickupFuelLevel?: string | null;
  licenseCollectedAt?: string | null;
  licenseReturnedAt?: string | null;
  /** Original licence custody chosen at pickup (#3); null = not recorded. Details + Fleet lists. */
  dlStatus?: DlStatus;
  /** What was left instead of the licence (DEPOSIT only). */
  dlDepositNote?: string | null;
  /** Last time the DL status was set (details only). */
  dlStatusUpdatedAt?: string | null;
  /** Plan-based free km for the booked period (same helper the server bills extra km with). */
  kmAllowance?: {
    includedKm: number;
    extraKmRate: string;
    extraKmEnabled: boolean;
    autoKmSkipped?: "VEHICLE_SWAPPED" | null;
    /** A mid-rental swap was recorded without readings — staff enter the extra km at drop. */
    manualExtraKmAllowed?: boolean;
    /** includedKm = free km of the original period + free km the extensions add (#7). */
    freeKmOriginal?: number;
    freeKmExtensions?: number;
  } | null;
  /** Return details only: original / extended / late rental time (drop screen). */
  rentalTimeline?: RentalTimeline;
  /** Return details only: odometer segments across mid-rental swaps (null unless PICKED_UP). */
  kmSegments?: KmSegments | null;
  /** Return details only: vehicle-swap differences billed on the drop bill. */
  swapCharges?: SwapChargePreview[];
  /** Fuel bars captured at the original pickup (pickupFuelLevel is the current vehicle's start). */
  originalPickupFuelLevel?: string | null;
  /** Actual return time (set once the drop completes). */
  returnedAt?: string | null;
  usePaymentSessions?: boolean;
  branch?: {
    chargeConfig?: { usePaymentSessions: boolean } | null;
  };
  customer: {
    /**
     * Pickup / return details only (X2, staff): the customer's full normalised
     * DL number to check against the card; null = none on file — the pickup
     * must send one (422 DL_NUMBER_REQUIRED otherwise).
     */
    drivingLicenceNumber?: string | null;
    user: {
      publicId: string;
      name: string;
      phone?: string;
      email?: string;
    };
  };
  items: {
    vehicle: {
      publicId: string;
      make: string;
      model: string;
      regNo: string;
      status: string;
      category: string;
      odo: number;
      fuelLevel: number;
      fuelBar?: number | null;
      hasFastag?: boolean;
      images: {
        file: {
          url: string;
        };
      }[];
    };
  }[];
}

/** One Daily / Monthly tab of the Fleet pickup or return queue. */
export interface EmployeeBookingQueue {
  data: EmployeeBooking[];
  /** Both tabs' row counts; null if the server sent none. */
  counts: BookingListCounts | null;
}

const fetchEmployeeQueue = async (
  path: "/employee/booking" | "/employee/return",
  date: Date,
  type: BookingListType,
): Promise<EmployeeBookingQueue> => {
  try {
    const response = await apiClient.get<{
      data?: EmployeeBooking[];
      counts?: BookingListCounts;
    }>(path, { params: { date: format(date, "yyyy-MM-dd"), type } });
    return { data: response.data.data ?? [], counts: response.data.counts ?? null };
  } catch (error) {
    // With `type` the server answers 200 + []; a 404 (older server) still means empty.
    if (isAxiosError<{ counts?: BookingListCounts }>(error) && error.response?.status === 404) {
      return { data: [], counts: error.response.data?.counts ?? null };
    }
    throw error;
  }
};

export const bookingService = {
  // --- CUSTOMER METHODS ---
  /**
   * Create a booking summary and initiate payment
   * POST /public/vehicles/booking
   * Returns payment details (a razorpay order for online, encryptedFinalPrice for cash)
   */
  createBookingSummary: async (
    data: CreateBookingSummaryRequest,
  ): Promise<CreateBookingSummaryResponse> => {
    const response = await apiClient.post<CreateBookingSummaryResponse>(
      "/public/vehicles/booking",
      data,
    );
    return response.data;
  },

  /**
   * Verify online payment status (customer-facing, CUSTOMER role only)
   * GET /payment/status/:transactionId
   */
  verifyOnlinePayment: async (
    transactionId: string,
  ): Promise<PaymentStatusResponse> => {
    const response = await apiClient.get<PaymentStatusResponse>(
      `/payment/status/${transactionId}`,
    );
    return response.data;
  },

  /**
   * Verify booking payment status from the employee side (STAFF role)
   * GET /employee/booking/payment-status/:transactionId
   */
  verifyEmployeePayment: async (
    transactionId: string,
  ): Promise<PaymentStatusResponse> => {
    const response = await apiClient.get<PaymentStatusResponse>(
      `/employee/booking/payment-status/${transactionId}`,
    );
    return response.data;
  },

  /**
   * Cancel a booking hold manually
   * DELETE /user/booking/hold/:holdId
   */
  cancelHold: async (holdId: string): Promise<{ message: string }> => {
    const response = await apiClient.delete<{ message: string }>(
      `/user/booking/hold/${holdId}`,
    );
    return response.data;
  },

  /**
   * Confirm cash payment
   * POST /user/payment/cash
   */
  confirmCashPayment: async (
    data: ConfirmCashPaymentRequest,
  ): Promise<ConfirmCashPaymentResponse> => {
    const response = await apiClient.post<ConfirmCashPaymentResponse>(
      "/user/payment/cash",
      data,
    );
    return response.data;
  },

  // --- EMPLOYEE METHODS ---

  /**
   * Get details for pickup process
   * GET /employee/pickup/:bookingId
   */
  getPickupDetails: async (bookingId: string) => {
    const response = await apiClient.get<{ data: EmployeeBooking }>(
      `/employee/pickup/${bookingId}`,
    );
    return response.data.data;
  },

  // Fetch Pickups
  getEmployeeBookings: async (date?: Date) => {
    try {
      const query = date ? `?date=${format(date, "yyyy-MM-dd")}` : "";
      const response = await apiClient.get<{ data: EmployeeBooking[] }>(
        `/employee/booking${query}`,
      );
      return response.data.data;
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        return [];
      }
      throw error;
    }
  },

  // Fetch Returns
  getEmployeeReturns: async (date?: Date) => {
    try {
      const query = date ? `?date=${format(date, "yyyy-MM-dd")}` : "";
      const response = await apiClient.get<{ data: EmployeeBooking[] }>(
        `/employee/return${query}`,
      );
      return response.data.data;
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        return [];
      }
      throw error;
    }
  },

  /**
   * Pickup queue for one Daily / Monthly tab (GET /employee/booking?type=).
   * Daily is scoped to `date` (IST day); Monthly ignores it and lists every
   * CONFIRMED monthly booking. `counts` covers both tabs.
   */
  getEmployeePickupQueue: (date: Date, type: BookingListType) =>
    fetchEmployeeQueue("/employee/booking", date, type),

  /**
   * Return queue for one Daily / Monthly tab (GET /employee/return?type=).
   * Daily is the IST day's returns; Monthly lists every PICKED_UP monthly booking.
   */
  getEmployeeReturnQueue: (date: Date, type: BookingListType) =>
    fetchEmployeeQueue("/employee/return", date, type),

  // Upload Pickup Image
  uploadPickupImage: async (formData: FormData) => {
    const response = await apiClient.post<{ fileId: string; url: string }>(
      "/employee/pickup/upload",
      formData,
      {
        headers: { "Content-Type": "multipart/form-data" },
      },
    );
    return response.data;
  },

  // Delete Pickup Image
  deletePickupImage: async (publicId: string) => {
    const response = await apiClient.delete(
      `/employee/pickup/image/${publicId}`,
    );
    return response.data;
  },

  // Approve Pickup
  approvePickup: async (
    bookingId: string,
    data: {
      odo: number;
      fuelLevel: number;
      pickupImageIds?: string[];
      /** Original licence custody (#3) — optional (X1): omitted / null = not recorded. */
      dlStatus?: UpdateDlStatusBody["dlStatus"] | null;
      /** Required for DEPOSIT (≤ 200 chars); omitted otherwise. */
      dlDepositNote?: string | null;
      /**
       * Customer's DL number typed at the counter (X2) — saved to the customer.
       * Required when none is on file (422 DL_NUMBER_REQUIRED); 400 INVALID_DL_NUMBER.
       */
      drivingLicenceNumber?: string;
    },
  ) => {
    const response = await apiClient.post(
      `/employee/pickup/${bookingId}`,
      data,
    );
    return response.data;
  },

  // Get Return Details
  getReturnDetails: async (bookingId: string) => {
    const response = await apiClient.get<{ data: EmployeeBooking }>(
      `/employee/return/${bookingId}`,
    );
    return response.data.data;
  },

  // Upload Return Image
  uploadReturnImage: async (formData: FormData) => {
    const response = await apiClient.post<{ fileId: string; url: string }>(
      "/employee/return/upload",
      formData,
      {
        headers: { "Content-Type": "multipart/form-data" },
      },
    );
    return response.data;
  },

  // Delete Return Image
  deleteReturnImage: async (publicId: string) => {
    const response = await apiClient.delete(
      `/employee/return/image/${publicId}`,
    );
    return response.data;
  },

  // Complete Return — legacy drop (branches without Unified Payments)
  completeReturn: async (
    bookingId: string,
    data: {
      returnImageIds: string[];
      requireManagerConfirmation?: boolean;
      /** Odometer at drop — extra km is worked out on the server and collected by the manager. */
      endOdometer?: number;
      /** Only used when kmAllowance.manualExtraKmAllowed (swap without readings). */
      manualExtraKm?: number;
      /** MANUAL grace branches only. */
      applyGrace?: boolean;
      /** Drops the automatic late charge (audit-logged). */
      waiveLateCharge?: { reason: string } | null;
      /** Safety deposit (#6): SET_OFF (default) or REFUND_IN_FULL — the branch manager settles it. */
      safetyDepositHandling?: "SET_OFF" | "REFUND_IN_FULL";
    },
  ) => {
    const response = await apiClient.post<{
      message: string;
      returnedAt?: string;
      /** null when no end odometer was sent */
      km?: ReturnKmSummary | null;
      late?: ReturnLateSummary;
      returnCharges?: LegacyReturnCharges;
      /** The deposit choice recorded with the return (#6); null when no deposit is held. */
      safetyDeposit?: {
        handling: "SET_OFF" | "REFUND_IN_FULL";
        amount: string;
        settledBy: "BRANCH_MANAGER";
      } | null;
    }>(
      `/employee/return/${bookingId}/complete`,
      data,
    );
    return response.data;
  },

  // Compute Return Charges (charge engine)
  computeReturnCharges: async (
    bookingId: string,
    data: {
      endOdometer: number;
      returnFuelLevel?: string;
      fuelDeficitCharge?: number;
      fuelSkipReason?: string;
      fastagAmount?: number;
      fastagNotes?: string;
      applyGrace?: boolean;
    },
  ): Promise<{ message: string; data: ChargeBreakdown }> => {
    const response = await apiClient.post(
      `/employee/bookings/${bookingId}/return-charges`,
      data,
    );
    return response.data;
  },

  // Upload Damage Image
  uploadDamageImage: async (formData: FormData) => {
    const response = await apiClient.post<{ fileId: string; url: string }>(
      "/employee/damage/upload",
      formData,
      {
        headers: { "Content-Type": "multipart/form-data" },
      },
    );
    return response.data;
  },

  // Report Damage
  reportDamage: async (data: {
    bookingId: string;
    odo: number;
    fuelLevel: number;
    severity: string;
    damageImageIds: string[];
    notes: any;
    returnImageIds: string[];
  }) => {
    const response = await apiClient.post("/employee/damage/report", data);
    return response.data;
  },

  // Initiate remaining payment (for advance bookings)
  initiateRemainingPayment: async (
    bookingId: string,
    context: "pickup" | "return",
    data: {
      /** UPI = counter UPI backed by proof_file_id; SPLIT = cashAmount + onlineAmount; CREDIT needs collateral (#11). */
      method: "CASH" | "UPI" | "ONLINE" | "SPLIT" | "CREDIT";
      proof_file_id?: string;
      cashAmount?: number;
      onlineAmount?: number;
      collateral?: string;
    },
  ) => {
    const paidDuring = context === "pickup" ? "PICKUP" : "RETURN";
    const { method: picked, ...extra } = data;
    const method = picked === "ONLINE" ? "ONLINE_RAZORPAY" : picked;
    const response = await apiClient.post<{
      success: boolean;
      message: string;
      data?: {
        razorpay?: RazorpayOrder;
        transactionId?: string;
        amountCollected?: string;
        /** CREDIT: the balance left owed against the collateral. */
        amountOnCredit?: string;
        method?: string;
        paidDuring?: string;
      };
    }>(`/employee/${context}/${bookingId}/initiate-remaining-payment`, { method, paidDuring, ...extra });
    return {
      ...response.data,
      razorpay: response.data.data?.razorpay,
      transactionId: response.data.data?.transactionId,
    };
  },

  // Check remaining payment status
  checkRemainingPaymentStatus: async (
    bookingId: string,
    context: "pickup" | "return",
  ) => {
    const response = await apiClient.get<{
      status: "SUCCESS" | "PENDING" | "FAILED";
      message?: string;
      redirectURL?: string;
    }>(`/employee/${context}/${bookingId}/remaining-payment/status`);
    return response.data;
  },

  // Search Customers
  searchCustomers: async (query: string) => {
    const response = await apiClient.get<{
      message: string;
      customers: {
        publicId: string;
        name: string;
        /** null for a walk-in placeholder email. */
        email: string | null;
        phone: string;
        customerProfile: {
          isProfileCompleted: boolean;
          publicId: string;
          /** Empty required fields (#1). Absent on old cached results. */
          missingFields?: string[];
          drivingLicenceNumber?: string | null;
          /** "XXXX XXXX 1234" — the full number is never in search results. */
          aadhaarNumberMasked?: string | null;
        } | null;
      }[];
    }>(`/employee/customer/search?q=${encodeURIComponent(query)}`);
    return response.data;
  },

  // Get Pickup Pricing Rules (for confirmation popup)
  getPickupPricingRules: async (bookingId: string): Promise<{
    vehicle: { make: string; model: string; regNo: string };
    pricing: {
      freeKm24Hour: number;
      freeKmMonthly: number;
      extraKmRate: string;
      extraHourRate: string;
      price24Hour: string;
      /** Free km for THIS booking's whole period; null = can't be worked out (absent on older servers). */
      includedKm?: number | null;
      /** false ⇒ extra km is not charged at this branch. */
      extraKmEnabled?: boolean;
      source?: "vehicle_custom" | "branch_default";
    } | null;
    /**
     * This booking's allowance (same as booking details' kmAllowance).
     * includedKm = freeKmOriginal + freeKmExtensions (#7); the split and the
     * extensions counted are absent from older servers.
     */
    kmAllowance?: {
      includedKm: number;
      extraKmRate: string;
      extraKmEnabled: boolean;
      freeKmOriginal?: number;
      freeKmExtensions?: number;
      extensionCount?: number;
    } | null;
    frozenChargeConfig: FrozenChargeConfig | null;
    rentalPeriod: { start: string; end: string };
  }> => {
    const response = await apiClient.get(
      `/employee/pickup/${bookingId}/pricing-rules`,
    );
    return response.data.data;
  },

  /**
   * Cancel an employee booking hold manually
   * DELETE /employee/booking/hold/:holdId
   */
  cancelEmployeeHold: async (holdId: string): Promise<{ message: string }> => {
    const response = await apiClient.delete<{ message: string }>(
      `/employee/booking/hold/${holdId}`,
    );
    return response.data;
  },

  // Create Booking (Employee)
  createEmployeeBooking: async (data: {
    vehicles: string[];
    customer_public_id: string;
    /** KYC picture (X2) — optional; omitted when staff attach no document. */
    customer_kyc_id?: string;
    start: string;
    end: string;
    /** ONLINE = Razorpay; SPLIT = cash + UPI; CREDIT = owed against collateral (#11). */
    payment_type: "CASH" | "ONLINE" | "UPI" | "SPLIT" | "CREDIT";
    /** 12-digit UPI UTR — older clients only; new UIs send proof_file_id. */
    utr?: string;
    /** Photo of the customer's UPI payment screen (#3) — UPI and the UPI part of SPLIT. */
    proof_file_id?: string;
    /** SPLIT: the cash part (the UPI part is the rest of the total). */
    cash_amount?: number;
    /** SPLIT (optional): the UPI part — cash + UPI must equal the total. */
    upi_amount?: number;
    /** CREDIT: what was taken from the customer until it is cleared. */
    collateral?: string;
    /** QrPhotoView.publicId of the customer's current QR code photo (409 QR_PHOTO_MISMATCH if replaced). */
    qr_photo_id?: string;
    /** Counter plan: MONTHLY = 30–180 days, pickup within 15 days (omitted = STANDARD). */
    plan?: "STANDARD" | "MONTHLY";
  }): Promise<CreateEmployeeBookingResponse> => {
    const response = await apiClient.post<CreateEmployeeBookingResponse>(
      "/employee/booking/create",
      data,
    );

    // Map publicId for consistency if needed by frontend components
    if (response.data?.data && !response.data.data.publicId) {
      response.data.data.publicId = response.data.data.bookingId;
    }

    return response.data;
  },

};

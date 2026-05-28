import apiClient from "@/lib/axios";
import { format } from "date-fns";

// Existing Customer Interfaces...
// Types for booking summary request
export interface CreateBookingSummaryRequest {
  vehicles?: string[];   // Direct vehicle public IDs (admin/employee flow)
  groupKeys?: string[];  // Group keys for atomic vehicle assignment (public flow)
  start: string;
  end: string;
  file_public_id: string;
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
}

export interface BookingTotals {
  grandBaseTotal: number;
  grandDiscountTotal: number;
  grandTaxTotal: number;
  grandCGSTTotal?: number;
  grandSGSTTotal?: number;
  taxRate?: number;
  grandDeposit: number;
  grandFinalTotal: number;
  isAdvancePayment?: boolean;
  advanceAmount?: number;
  remainingBalance?: number;
  paymentURL: string | null;
  encryptedFinalPrice: string | null;
  transactionId: string | null;
}

export interface CreateBookingSummaryResponse {
  message: string;
  holdId: string;
  payment_type: "CASH" | "ONLINE";
  payment_flow: "FULL" | "ADVANCE";
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
    paymentURL: string | null;
    status: string;
    startDate: string;
    endDate: string;
    transactionId: string;
    totals: BookingTotals;
    items: any[];
    expiresAt: string;
    expiresIn: number;
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
  freeKmLimit?: number | null;
  effectiveFreeKmLimit?: number | null;
  extraKmRate?: number | null;
  pickupFuelLevel?: string | null;
  usePaymentSessions?: boolean;
  branch?: {
    chargeConfig?: { usePaymentSessions: boolean } | null;
  };
  customer: {
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
      hasFastag?: boolean;
      images: {
        file: {
          url: string;
        };
      }[];
    };
  }[];
}

export const bookingService = {
  // --- CUSTOMER METHODS ---
  /**
   * Create a booking summary and initiate payment
   * POST /public/vehicles/booking
   * Returns payment details (paymentURL for online, encryptedFinalPrice for cash)
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
    data: { odo: number; fuelLevel: number; pickupImageIds?: string[] },
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

  // Complete Return (No Damage)
  completeReturn: async (
    bookingId: string,
    data: { returnImageIds: string[]; requireManagerConfirmation?: boolean },
  ) => {
    const response = await apiClient.post(
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
    data: { method: "CASH" | "UPI" | "ONLINE" },
  ) => {
    const paidDuring = context === "pickup" ? "PICKUP" : "RETURN";
    const method = data.method === "ONLINE" ? "ONLINE_RAZORPAY" : data.method;
    const response = await apiClient.post<{
      success: boolean;
      message: string;
      data?: {
        paymentURL?: string;
        transactionId?: string;
        amountCollected?: string;
        method?: string;
        paidDuring?: string;
      };
    }>(`/employee/${context}/${bookingId}/initiate-remaining-payment`, { method, paidDuring });
    return {
      ...response.data,
      paymentURL: response.data.data?.paymentURL,
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
        email: string;
        phone: string;
        customerProfile: {
          isProfileCompleted: boolean;
          publicId: string;
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
    customer_kyc_id: string;
    start: string;
    end: string;
    payment_type: "CASH" | "ONLINE";
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

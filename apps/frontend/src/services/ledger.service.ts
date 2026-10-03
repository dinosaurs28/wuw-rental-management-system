import apiClient from "@/lib/axios";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CreditStatus = "PENDING" | "PARTIALLY_CLEARED" | "CLEARED";

export interface CreditSection {
  sectionKey: string;
  label: string;
  amount: number;
  isCleared: boolean;
  clearedAt?: string | null;
  clearedRef?: string | null;
  isCustom?: boolean;
  // Fleet credit at the counter (#11) — absent on sections the BM added by hand
  source?: "FLEET_CREDIT";
  purpose?: "REMAINING_BALANCE" | "EXTENSION" | "FULL_PAYMENT";
  /** What was taken from the customer until it is cleared. */
  collateral?: string;
  reference?: { type: "PAYMENT_SESSION" | "EXTENSION" | "WALKIN" | "REMAINING_PAYMENT"; publicId: string };
  createdAt?: string;
  createdByName?: string;
  clearedPaymentPublicIds?: string[];
  /** Closed without payment because the booking was cancelled (also isCleared; not in the totals). */
  voided?: boolean;
  voidReason?: string;
}

/** A payment a clearance recorded (#11), with the UPI photo when there is one (#3). */
export interface ClearancePayment {
  publicId: string;
  purpose: string;
  method: "CASH" | "ONLINE" | "SPLIT";
  status: string;
  totalAmount: string;
  cashAmount: string;
  onlineAmount: string;
  onlineGateway: string | null;
  onlineTransactionRef: string | null;
  createdAt: string;
  proofPhoto?: {
    proofFileId: string;
    publicId: string;
    url: string;
    mime: string;
    size: number;
    capturedAt: string;
    expiresIn: number;
  } | null;
  proofPhotoUrl?: string | null;
}

/** POST /ledger/entry/:id/clear (#11): Cash, UPI (photo) or Split. */
export interface ClearCreditPayload {
  sectionKeys: string[];
  paymentMethod: "CASH" | "UPI" | "SPLIT";
  proof_file_id?: string;
  cashAmount?: number;
  onlineAmount?: number;
  notes?: string;
}

export interface ChargeSection {
  sectionKey: string;
  label: string;
  amount: number;
  isCredited: boolean;
  isCleared: boolean;
  isCustom: boolean;
}

export interface BookingSummary {
  totalBase: string | number;
  totalDiscount: string | number;
  totalTax: string | number;
  totalFinal: string | number;
}

export interface BookingChargesResponse {
  bookingSummary: BookingSummary;
  sections: ChargeSection[];
  existingCreditStatus: CreditStatus | null;
  existingCreditPublicId: string | null;
}

export interface CreditClearance {
  publicId: string;
  clearedSectionKeys: string[];
  amountCleared: string | number;
  /** "ONLINE" on clearances recorded before UPI / split (#11). */
  /** ALREADY_PAID: a hand-added section the booking's payments already covered — no payment recorded */
  paymentMethod: "CASH" | "ONLINE" | "UPI" | "SPLIT" | "ALREADY_PAID";
  transactionRef: string | null;
  clearedAt: string;
  /** The payments this clearance recorded (absent on older servers). */
  payments?: ClearancePayment[];
}

export interface EligibleBookingVehicle {
  make: string;
  model: string;
  regNo: string;
}

export interface EligibleBooking {
  publicId: string;
  startAt: string;
  endAt: string;
  status: string;
  vehicle: EligibleBookingVehicle | null;
  creditStatus: CreditStatus | null;
  pendingAmount: string | number | null;
}

export interface CustomerCreditEntry {
  id: number;
  publicId: string;
  customerId: number;
  bookingId: number;
  branchId: number;
  sections: CreditSection[];
  totalAmount: string | number;
  clearedAmount: string | number;
  pendingAmount: string | number;
  status: CreditStatus;
  booking: {
    publicId: string;
    startAt: string;
    endAt: string;
    status: string;
    items?: Array<{ vehicle: EligibleBookingVehicle }>;
  };
  clearances: CreditClearance[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomerCreditSummary {
  customer: {
    publicId: string;
    name: string;
    phone: string;
    email: string;
  };
  stats: {
    totalEntries: number;
    totalAmount: string | number;
    clearedAmount: string | number;
    pendingAmount: string | number;
  };
}

export interface CustomerCreditRow {
  customerPublicId: string;
  name: string;
  phone: string;
  totalPending: string | number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

export const ledgerService = {
  searchCustomers: async (
    search?: string,
    page = 1,
    limit = 20
  ): Promise<PaginatedResponse<CustomerCreditRow>> => {
    const params: Record<string, any> = { page, limit };
    if (search) params.search = search;
    const res = await apiClient.get("/branchManager/ledger/customers", { params });
    return res.data;
  },

  getCustomerSummary: async (customerPublicId: string): Promise<CustomerCreditSummary> => {
    const res = await apiClient.get(`/branchManager/ledger/customer/${customerPublicId}`);
    return res.data.data;
  },

  getCustomerEntries: async (
    customerPublicId: string,
    page = 1,
    limit = 20
  ): Promise<PaginatedResponse<CustomerCreditEntry>> => {
    const res = await apiClient.get(`/branchManager/ledger/customer/${customerPublicId}/entries`, {
      params: { page, limit },
    });
    return res.data;
  },

  getEligibleBookings: async (customerPublicId: string): Promise<EligibleBooking[]> => {
    const res = await apiClient.get(`/branchManager/ledger/customer/${customerPublicId}/bookings`);
    return res.data.data;
  },

  getBookingCharges: async (bookingPublicId: string): Promise<BookingChargesResponse> => {
    const res = await apiClient.get(`/branchManager/ledger/booking/${bookingPublicId}/charges`);
    return res.data.data;
  },

  addCredit: async (
    bookingPublicId: string,
    sections: Array<{ sectionKey: string; label: string; amount: number }>
  ): Promise<CustomerCreditEntry> => {
    const res = await apiClient.post(`/branchManager/ledger/booking/${bookingPublicId}/credit`, { sections });
    return res.data.data;
  },

  getCreditEntry: async (creditPublicId: string): Promise<CustomerCreditEntry> => {
    const res = await apiClient.get(`/branchManager/ledger/entry/${creditPublicId}`);
    return res.data.data;
  },

  clearCredit: async (
    creditPublicId: string,
    sectionKeys: string[],
    paymentMethod: "CASH" | "ONLINE",
    transactionRef?: string
  ): Promise<CustomerCreditEntry> => {
    const res = await apiClient.post(`/branchManager/ledger/entry/${creditPublicId}/clear`, {
      sectionKeys,
      paymentMethod,
      transactionRef,
    });
    return res.data.data;
  },

  /**
   * Clears sections with the money that arrived (#11): records CONFIRMED payments.
   * Errors: 400 SPLIT_AMOUNT_MISMATCH, 409 CREDIT_EXCEEDS_DUE { due }, photo codes (#3).
   */
  clearCreditWithPayment: async (
    creditPublicId: string,
    payload: ClearCreditPayload
  ): Promise<CustomerCreditEntry> => {
    const res = await apiClient.post(`/branchManager/ledger/entry/${creditPublicId}/clear`, payload);
    return res.data.data;
  },
};

import apiClient from "@/lib/axios";

// Customers tab (G9) — branch manager and Fleet Executive portals. Money = 2-dp strings, dates = ISO UTC.

export type CustomerFilter = "all" | "blacklisted" | "credit" | "branch";
export type RentBucket = "upcoming" | "active" | "past";

export interface CustomerRentCounts {
  upcoming: number;
  active: number;
  past: number;
  total: number;
}

export interface CustomerRow {
  customerPublicId: string;
  userPublicId: string;
  name: string;
  phone: string;
  alternatePhone: string | null;
  email: string | null;
  registeredAt: string;
  isProfileCompleted: boolean;
  isBlacklisted: boolean;
  blacklistReason: string | null;
  blacklistedAt: string | null;
  rents: CustomerRentCounts;
  lastRentAt: string | null;
  hasRentAtBranch: boolean;
  pendingCredit: string;
  pendingCreditAtBranch: string;
}

export interface CustomerListResponse {
  data: CustomerRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface BranchRef {
  publicId: string;
  name: string;
}

export interface RentVehicle {
  publicId: string;
  make: string;
  model: string;
  regNo: string;
}

export interface RentRow {
  publicId: string;
  status: string;
  bucket: RentBucket;
  awaitingPayment: boolean;
  type: "DAILY" | "MONTHLY";
  source: "ONLINE" | "COUNTER";
  branch: BranchRef;
  isOwnBranch: boolean;
  vehicles: RentVehicle[];
  startAt: string;
  endAt: string;
  originalEndAt: string | null;
  returnedAt: string | null;
  cancelledAt: string | null;
  holdExpiresAt: string | null;
  createdAt: string;
  isOverdue: boolean;
  extensionCount: number;
  paymentStatus: string;
  amounts: {
    totalFinal: string;
    rentAmount: string;
    refundableDeposit: string;
    paid: string;
    pendingConfirmation: string;
    creditPending: string;
  };
}

export interface CreditPendingSection {
  sectionKey: string;
  label: string;
  amount: number | string;
  isCleared: boolean;
  collateral?: string | null;
  [key: string]: unknown;
}

export interface CustomerCreditEntry {
  creditPublicId: string;
  bookingPublicId: string;
  branch: BranchRef;
  isOwnBranch: boolean;
  status: string;
  totalAmount: string;
  clearedAmount: string;
  pendingAmount: string;
  createdAt: string;
  pendingSections: CreditPendingSection[];
}

export interface CustomerDetail {
  customer: {
    customerPublicId: string;
    userPublicId: string;
    name: string;
    phone: string;
    alternatePhone: string | null;
    email: string | null;
    address: {
      line1: string | null;
      city: string | null;
      state: string | null;
      zipCode: string | null;
      country: string | null;
    };
    registeredAt: string;
    isProfileCompleted: boolean;
    drivingLicenceNumberMasked: string | null;
    aadhaarNumberMasked: string | null;
  };
  blacklist: {
    isBlacklisted: boolean;
    reason: string | null;
    blacklistedAt: string | null;
    blacklistedBy: {
      name: string;
      role: string;
      branch: BranchRef | null;
    } | null;
  };
  credit: {
    pendingTotal: string;
    pendingAtBranch: string;
    entries: CustomerCreditEntry[];
  };
  rents: Record<RentBucket, RentRow[]>;
  counts: Record<RentBucket, number>;
  hasMore: Record<RentBucket, boolean>;
}

export interface RentsPage {
  bucket: RentBucket;
  data: RentRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ProofPhoto {
  url: string;
  mime: string;
  expiresIn: number | null;
}

export interface DrawerTransaction {
  publicId: string;
  purpose: string;
  method: string;
  status: string;
  isRefund: boolean;
  totalAmount: string;
  cashAmount: string;
  onlineAmount: string;
  onlineTransactionRef: string | null;
  onlineGateway: string | null;
  collectedBy: string | null;
  collectedAt: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  notes: string | null;
  createdAt: string;
  proofPhoto: ProofPhoto | null;
}

export interface BookingDrawerData {
  booking: {
    publicId: string;
    status: string;
    type: "DAILY" | "MONTHLY";
    source: "ONLINE" | "COUNTER";
    createdBy: { name: string; role: string } | null;
    branch: BranchRef;
    isOwnBranch: boolean;
    vehicles: RentVehicle[];
    days: number | null;
    startAt: string;
    endAt: string;
    originalEndAt: string | null;
    returnedAt: string | null;
    cancelledAt: string | null;
    cancellationReason: string | null;
    holdExpiresAt: string | null;
    createdAt: string;
    couponCode: string | null;
    paymentStatus: string;
    isAdvancePayment: boolean;
    advanceAmount: string | null;
  };
  breakdown: {
    rental: {
      rentWithoutGst: string;
      discount: string;
      taxableAmount: string;
      cgst: string | null;
      sgst: string | null;
      gst: string;
      gstRate: string | null;
      rentInclGst: string;
      refundableDeposit: string;
      total: string;
    };
    extensions: {
      items: {
        publicId: string;
        status: string;
        trigger: string | null;
        oldEndAt: string;
        newEndAt: string;
        baseAmount: string | null;
        discountAmount: string | null;
        taxableAmount: string | null;
        cgst: string | null;
        sgst: string | null;
        gst: string | null;
        gstRate: string | null;
        amount: string;
        includedInTotal: boolean;
        createdAt: string;
      }[];
      total: string;
    };
    totalFinal: string;
    returnCharges: {
      items: {
        source: "DROP_BILL" | "LEGACY_DROP" | "DAMAGE";
        type: string;
        label: string;
        isDiscount: boolean;
        amount: string;
        gst: string;
        total: string;
      }[];
      dropBill: string;
      legacy: string;
      damageOutsideBill: string;
      total: string;
    };
    safetyDeposit: {
      amount: string;
      charged: string;
      credited: string;
      held: string;
      refunded: boolean;
      setOff: boolean;
    };
    totalOwed: string;
  };
  payments: {
    lifecycleState: string;
    totalCollectedConfirmed: string;
    totalCollectedPending: string;
    totalRefunded: string;
    amountDue: string;
    transactions: DrawerTransaction[];
  };
  credit: {
    creditPublicId: string;
    status: string;
    totalAmount: string;
    clearedAmount: string;
    pendingAmount: string;
    createdAt: string;
    sections: CreditPendingSection[];
    clearances: {
      publicId: string;
      amountCleared: string;
      paymentMethod: string;
      transactionRef: string | null;
      clearedAt: string;
      clearedBy: string | null;
    }[];
  } | null;
}

export interface BlacklistResult {
  customerPublicId: string;
  isBlacklisted: boolean;
  reason: string | null;
  blacklistedAt: string | null;
  openRents?: { upcoming: number; active: number };
}

/**
 * One client per portal: the branch manager and the Fleet Executive hit the
 * same handlers (same data, rules and shapes) under their own API prefix.
 */
export const makeCustomersService = (base: string) => ({
  list: async (params: {
    search?: string;
    filter?: CustomerFilter;
    page?: number;
    limit?: number;
  }): Promise<CustomerListResponse> => {
    const res = await apiClient.get(base, { params });
    return res.data;
  },

  get: async (customerId: string): Promise<CustomerDetail> => {
    const res = await apiClient.get(`${base}/${encodeURIComponent(customerId)}`);
    return res.data.data;
  },

  rents: async (
    customerId: string,
    bucket: RentBucket,
    page: number,
    limit = 20,
  ): Promise<RentsPage> => {
    const res = await apiClient.get(`${base}/${encodeURIComponent(customerId)}/rents`, {
      params: { bucket, page, limit },
    });
    return res.data;
  },

  booking: async (customerId: string, bookingId: string): Promise<BookingDrawerData> => {
    const res = await apiClient.get(
      `${base}/${encodeURIComponent(customerId)}/bookings/${encodeURIComponent(bookingId)}`,
    );
    return res.data.data;
  },

  blacklist: async (
    customerId: string,
    reason: string,
  ): Promise<{ message: string; data: BlacklistResult }> => {
    const res = await apiClient.post(`${base}/${encodeURIComponent(customerId)}/blacklist`, {
      reason,
    });
    return res.data;
  },

  unblacklist: async (customerId: string, note?: string): Promise<{ message: string }> => {
    const res = await apiClient.post(
      `${base}/${encodeURIComponent(customerId)}/unblacklist`,
      note ? { note } : {},
    );
    return res.data;
  },
});

export type CustomersService = ReturnType<typeof makeCustomersService>;

export const managerCustomersService = makeCustomersService("/branchManager/customers");
export const employeeCustomersService = makeCustomersService("/employee/customers");

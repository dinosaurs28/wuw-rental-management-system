// Customers tab (Fleet) — GET/POST /api/employee/customers/*, the same
// handlers and shapes as the branch manager's Customers tab
// (apps/frontend/src/services/managerCustomers.service.ts). Money = 2-dp
// strings, dates = ISO UTC. "Branch" / "yours" = the signed-in Fleet
// Executive's branch.

export type CustomerFilter = 'all' | 'blacklisted' | 'credit' | 'branch';
export type RentBucket = 'upcoming' | 'active' | 'past';

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
  success: boolean;
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
  /** HOLD — the customer hasn't paid yet */
  awaitingPayment: boolean;
  type: 'DAILY' | 'MONTHLY';
  source: 'ONLINE' | 'COUNTER';
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

export interface CreditSection {
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
  pendingSections: CreditSection[];
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
    blacklistedBy: { name: string; role: string; branch: BranchRef | null } | null;
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
  success: boolean;
  bucket: RentBucket;
  data: RentRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CustomerBookingTransaction {
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
  /** Private-bucket photos are presigned for 15 minutes (expiresIn seconds). */
  proofPhoto: { url: string; mime: string; expiresIn: number | null } | null;
}

export interface CustomerBookingDetail {
  booking: {
    publicId: string;
    status: string;
    type: 'DAILY' | 'MONTHLY';
    source: 'ONLINE' | 'COUNTER';
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
        source: 'DROP_BILL' | 'LEGACY_DROP' | 'DAMAGE';
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
    transactions: CustomerBookingTransaction[];
  };
  credit: {
    creditPublicId: string;
    status: string;
    totalAmount: string;
    clearedAmount: string;
    pendingAmount: string;
    createdAt: string;
    sections: CreditSection[];
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
  /** Existing bookings are not cancelled by a blacklist. */
  openRents?: { upcoming: number; active: number };
}

/** Server limits for the blacklist reason / removal note (customer-blacklist.service). */
export const BLACKLIST_REASON_MIN = 3;
export const BLACKLIST_REASON_MAX = 500;

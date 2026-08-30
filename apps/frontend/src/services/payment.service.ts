import apiClient from "@/lib/axios";

// ── Types ────────────────────────────────────────────────────────────────────

export type PaymentPurpose =
  | "FULL_PAYMENT"
  | "ADVANCE"
  | "REMAINING_BALANCE"
  | "EXTENSION_FEE"
  | "EXTENSION"
  | "DAMAGE_FEE";

export type PaymentMethod = "CASH" | "ONLINE" | "SPLIT";
export type OnlineGateway = "UPI" | "Razorpay" | "Other";

export type LifecycleState =
  | "UNPAID"
  | "PARTIALLY_PAID"
  | "PAID_PENDING_CONFIRMATION"
  | "FULLY_PAID"
  | "OVERPAID"
  | "REFUNDED";

export type TransactionStatus =
  | "INITIATED"
  | "COLLECTED"
  | "CONFIRMED"
  | "REJECTED"
  | "FAILED"
  | "REFUNDED";

export interface BranchTransaction {
  transactionPublicId: string;
  bookingPublicId: string;
  customerName: string;
  amount: string;
  method: PaymentMethod;
  purpose: PaymentPurpose;
  status: TransactionStatus;
  onlineTransactionRef: string | null;
  employeeName: string | null;
  confirmedByName: string | null;
  collectedAt: string;
  confirmedAt: string | null;
  createdAt: string;
}

export type ShiftStatus = "OPEN" | "CLOSED" | "DISCREPANCY_FLAGGED";
export type RefundStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "COMPLETED";
export type RefundMethod = "CASH" | "ONLINE";

export interface FinancialState {
  lifecycleState: LifecycleState;
  totalDue: string;
  totalCollected: string;
  totalPendingConfirmation: string;
  amountRemaining: string;
}

export interface PaymentTransaction {
  publicId: string;
  purpose: PaymentPurpose;
  method: PaymentMethod;
  totalAmount: string;
  cashAmount?: string;
  onlineAmount?: string;
  onlineTransactionRef?: string;
  onlineGateway?: string;
  status: TransactionStatus;
  collectedAt: string;
  collectedBy: string;
  notes?: string;
  bookingPublicId: string;
  customerName?: string;
}

export interface PendingCashItem {
  transactionPublicId: string;
  bookingPublicId: string;
  customerName: string;
  amount: string;
  employeeName: string;
  collectedAt: string;
  purpose: PaymentPurpose;
}

export interface SettlementItem {
  bookingPublicId: string;
  customerName: string;
  vehicleRegNo: string;
  netPayable: string;
}

export interface SettlementSummary {
  bookingPublicId: string;
  customerName: string;
  rentalBalanceRemaining: string;
  damageCharges: string;
  extensionCharges: string;
  alreadyPaid: string;
  netPayable: string;
}

export interface RefundItem {
  publicId: string;
  bookingPublicId: string;
  customerName: string;
  amount: string;
  method: RefundMethod;
  reason: string;
  status: RefundStatus;
  requestedBy: string;
  requestedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  onlineTransactionRef?: string;
}

export interface CashShift {
  publicId: string;
  employeeName: string;
  openedAt: string;
  closedAt?: string;
  expectedTotal?: string;
  actualTotal?: string;
  pendingTotal?: string;
  discrepancyExplanation?: string;
  managerNote?: string;
  status: ShiftStatus;
}

export interface RecordPaymentPayload {
  bookingPublicId: string;
  purpose: PaymentPurpose;
  method: PaymentMethod;
  totalAmount: number;
  cashAmount?: number;
  onlineAmount?: number;
  onlineTransactionRef?: string;
  onlineGateway?: string;
  notes?: string;
  idempotencyKey: string;
}

// ── Service ──────────────────────────────────────────────────────────────────

// ── Razorpay gateway ─────────────────────────────────────────────────────────

/** Signature payload returned by Razorpay Checkout on a successful payment. */
export interface RazorpayVerifyPayload {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface GatewayPaymentStatus {
  status: "Success" | "Pending" | "Failed";
  message?: string;
  redirectURL?: string;
}

/**
 * Which role gate the verifying session sits behind. The same handler is
 * mounted three times because `authCheckJwt`, `EmployeeCheck` and `ManagerCheck`
 * are mutually exclusive — a staff session calling the customer path gets a 403.
 */
export type PaymentRole = "customer" | "staff" | "manager";

const VERIFY_PATHS: Record<PaymentRole, string> = {
  customer: "/payment/verify",
  staff: "/payment/staff/verify",
  manager: "/payment/manager/verify",
};

export const razorpayService = {
  /**
   * Fast confirmation path — verifies the Checkout signature server-side.
   * Throws (400) when the signature does not match, (404) when the order id
   * belongs to neither a booking nor an extension.
   */
  verify: (payload: RazorpayVerifyPayload, role: PaymentRole = "customer") =>
    apiClient
      .post<{ status: "Success"; message?: string; redirectURL?: string }>(
        VERIFY_PATHS[role],
        payload,
      )
      .then((r) => r.data),

  /**
   * Fallback poll — the webhook may confirm a payment even when the browser
   * never reached the Checkout handler.
   */
  getStatus: (transactionId: string) =>
    apiClient
      .get<GatewayPaymentStatus>(`/payment/status/${transactionId}`)
      .then((r) => r.data),
};

export const paymentService = {
  // Booking financial state
  getFinancialState: (bookingPublicId: string) =>
    apiClient
      .get<{ data: FinancialState }>(
        `/branchManager/payment/bookings/${bookingPublicId}/financial-state`
      )
      .then((r) => r.data.data),

  // Transactions
  getTransactions: (bookingPublicId: string) =>
    apiClient
      .get<{ data: PaymentTransaction[] }>(
        `/branchManager/payment/bookings/${bookingPublicId}/transactions`
      )
      .then((r) => r.data.data),

  recordPayment: (payload: RecordPaymentPayload) =>
    apiClient
      .post<{ data: PaymentTransaction; message: string }>(
        `/branchManager/payment/transactions`,
        payload
      )
      .then((r) => r.data),

  getAllTransactions: (page = 1, pageSize = 20, status?: string) =>
    apiClient
      .get<{ transactions: BranchTransaction[]; total: number }>(
        `/branchManager/payment/transactions`,
        { params: { page, pageSize, ...(status ? { status } : {}) } }
      )
      .then((r) => ({ data: r.data.transactions, total: r.data.total })),

  // Cash confirmations
  getPendingCash: (page = 1, pageSize = 20) =>
    apiClient
      .get<{ transactions: PendingCashItem[]; total: number }>(
        `/branchManager/payment/cash/pending`,
        { params: { page, pageSize } }
      )
      .then((r) => ({ data: r.data.transactions, total: r.data.total })),

  confirmCash: (txnPublicId: string, notes?: string) =>
    apiClient
      .post<{ message: string }>(
        `/branchManager/payment/cash/${txnPublicId}/confirm`,
        { notes }
      )
      .then((r) => r.data),

  rejectCash: (txnPublicId: string, rejectionReason: string) =>
    apiClient
      .post<{ message: string }>(
        `/branchManager/payment/cash/${txnPublicId}/reject`,
        { rejectionReason }
      )
      .then((r) => r.data),

  // Settlements
  getSettlements: (page = 1, pageSize = 20) =>
    apiClient
      .get<{ settlements: SettlementItem[]; total: number }>(
        `/branchManager/payment/settlements`,
        { params: { page, pageSize } }
      )
      .then((r) => ({ data: r.data.settlements, total: r.data.total })),

  getSettlementSummary: (bookingPublicId: string) =>
    apiClient
      .get<{ data: SettlementSummary }>(
        `/branchManager/payment/settlements/${bookingPublicId}`
      )
      .then((r) => r.data.data),

  recordSettlement: (
    bookingPublicId: string,
    payload: Omit<RecordPaymentPayload, "bookingPublicId">
  ) =>
    apiClient
      .post<{ message: string }>(
        `/branchManager/payment/settlements/${bookingPublicId}/pay`,
        payload
      )
      .then((r) => r.data),

  // Refunds
  requestRefund: (payload: {
    bookingPublicId: string;
    amount: number;
    reason: string;
    method: RefundMethod;
  }) =>
    apiClient
      .post<{ data: RefundItem; message: string }>(
        `/branchManager/payment/refunds`,
        payload
      )
      .then((r) => r.data),

  getPendingRefunds: () =>
    apiClient
      .get<{ data: RefundItem[] }>(`/branchManager/payment/refunds/pending`)
      .then((r) => r.data.data),

  getRefund: (publicId: string) =>
    apiClient
      .get<{ data: RefundItem }>(`/branchManager/payment/refunds/${publicId}`)
      .then((r) => r.data.data),

  approveRefund: (publicId: string) =>
    apiClient
      .post<{ message: string }>(
        `/branchManager/payment/refunds/${publicId}/approve`
      )
      .then((r) => r.data),

  rejectRefund: (publicId: string, rejectionReason: string) =>
    apiClient
      .post<{ message: string }>(
        `/branchManager/payment/refunds/${publicId}/reject`,
        { rejectionReason }
      )
      .then((r) => r.data),

  completeRefund: (publicId: string, onlineTransactionRef?: string) =>
    apiClient
      .post<{ message: string }>(
        `/branchManager/payment/refunds/${publicId}/complete`,
        { onlineTransactionRef }
      )
      .then((r) => r.data),

  // Cash Shifts
  openShift: () =>
    apiClient
      .post<{ data: CashShift; message: string }>(
        `/branchManager/payment/shifts`,
        {}
      )
      .then((r) => r.data),

  getActiveShift: () =>
    apiClient
      .get<{ data: CashShift | null }>(
        `/branchManager/payment/shifts/me/active`
      )
      .then((r) => r.data.data),

  closeShift: (
    publicId: string,
    payload: { actualTotal: number; discrepancyExplanation?: string }
  ) =>
    apiClient
      .post<{ data: CashShift; message: string }>(
        `/branchManager/payment/shifts/${publicId}/close`,
        payload
      )
      .then((r) => r.data),

  getAllShifts: (page = 1, pageSize = 20, filters?: { from?: string; to?: string; status?: string }) =>
    apiClient
      .get<{ shifts: CashShift[]; total: number }>(
        `/branchManager/payment/shifts`,
        { params: { page, pageSize, ...filters } }
      )
      .then((r) => ({ data: r.data.shifts, total: r.data.total })),

  getShift: (publicId: string) =>
    apiClient
      .get<{ data: CashShift }>(
        `/branchManager/payment/shifts/${publicId}`
      )
      .then((r) => r.data.data),

  reconcileShift: (publicId: string, discrepancyExplanation: string) =>
    apiClient
      .post<{ message: string }>(
        `/branchManager/payment/shifts/${publicId}/reconcile`,
        { discrepancyExplanation }
      )
      .then((r) => r.data),

  // Payment Recheck
  listPendingPayments: (page = 1, limit = 20) =>
    apiClient
      .get<{ data: PendingPaymentBooking[]; pagination: { total: number; totalPages: number } }>(
        `/branchManager/payment/recheck`,
        { params: { page, limit } }
      )
      .then((r) => r.data),

  getRecheckInfo: (bookingPublicId: string) =>
    apiClient
      .get<{ data: RecheckBookingInfo }>(
        `/branchManager/payment/recheck/${bookingPublicId}`
      )
      .then((r) => r.data.data),

  gatewayRecheck: (bookingPublicId: string) =>
    apiClient
      .post<GatewayCheckResult>(
        `/branchManager/payment/recheck/${bookingPublicId}/gateway-check`
      )
      .then((r) => r.data),

  manualConfirmPayment: (bookingPublicId: string, managerNote?: string) =>
    apiClient
      .post<{ success: boolean; message: string; newStatus: string }>(
        `/branchManager/payment/recheck/${bookingPublicId}/manual-confirm`,
        { managerNote }
      )
      .then((r) => r.data),
};

// ── Payment Recheck ───────────────────────────────────────────────────────────

export type GatewayResult =
  | "SUCCESS"
  | "PENDING"
  | "FAILED"
  | "GATEWAY_UNREACHABLE"
  | "ALREADY_SUCCESS";

export interface RecheckBookingInfo {
  publicId: string;
  status: string;
  paymentStatus: string;
  transactionId: string | null;
  totalFinal: string;
  totalDeposit: string;
  isAdvancePayment: boolean;
  advanceAmount: string | null;
  remainingBalance: string | null;
  startAt: string;
  endAt: string;
  createdAt: string;
  holdExpiresAt: string | null;
  isRecheckable: boolean;
  customer: {
    publicId: string;
    user: { name: string; email: string; phone: string | null };
  };
  items: {
    vehicle: {
      make: string;
      model: string;
      regNo: string;
      images: { file: { url: string } }[];
    };
  }[];
  paymentTransactions: {
    publicId: string;
    status: string;
    method: string;
    purpose: string;
    totalAmount: string;
    onlineTransactionRef: string | null;
    onlineGateway: string | null;
    createdAt: string;
  }[];
}

export interface PendingPaymentBooking {
  publicId: string;
  transactionId: string | null;
  totalFinal: string;
  isAdvancePayment: boolean;
  advanceAmount: string | null;
  startAt: string;
  endAt: string;
  createdAt: string;
  holdExpiresAt: string | null;
  customer: { user: { name: string; phone: string | null } };
  items: { vehicle: { make: string; model: string; regNo: string } }[];
}

export interface GatewayCheckResult {
  gatewayResult: GatewayResult;
  message: string;
  newStatus?: string;
  gatewayCode?: string;
}

// ── Employee Payment Service ──────────────────────────────────────────────────
// Mirrors the subset of paymentService that employees are authorised to use.
// All paths hit /employee/payment/... with EmployeeCheck middleware.

export const employeePaymentService = {
  getFinancialState: (bookingPublicId: string) =>
    apiClient
      .get<{ data: FinancialState }>(
        `/employee/payment/bookings/${bookingPublicId}/financial-state`
      )
      .then((r) => r.data.data),

  getTransactions: (bookingPublicId: string) =>
    apiClient
      .get<{ data: PaymentTransaction[] }>(
        `/employee/payment/bookings/${bookingPublicId}/transactions`
      )
      .then((r) => r.data.data),

  recordPayment: (payload: RecordPaymentPayload) =>
    apiClient
      .post<{ data: PaymentTransaction; message: string }>(
        `/employee/payment/transactions`,
        payload
      )
      .then((r) => r.data),

  openShift: () =>
    apiClient
      .post<{ data: CashShift; message: string }>(
        `/employee/payment/shifts`,
        {}
      )
      .then((r) => r.data),

  getActiveShift: () =>
    apiClient
      .get<{ data: CashShift | null }>(
        `/employee/payment/shifts/me/active`
      )
      .then((r) => r.data.data),

  closeShift: (
    publicId: string,
    payload: { actualTotal: number; discrepancyExplanation?: string }
  ) =>
    apiClient
      .post<{ data: CashShift; message: string }>(
        `/employee/payment/shifts/${publicId}/close`,
        payload
      )
      .then((r) => r.data),
};

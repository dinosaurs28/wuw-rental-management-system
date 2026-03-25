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

  // Cash confirmations
  getPendingCash: (page = 1, pageSize = 20) =>
    apiClient
      .get<{ data: PendingCashItem[]; total: number }>(
        `/branchManager/payment/cash/pending`,
        { params: { page, pageSize } }
      )
      .then((r) => r.data),

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
      .get<{ data: SettlementItem[]; total: number }>(
        `/branchManager/payment/settlements`,
        { params: { page, pageSize } }
      )
      .then((r) => r.data),

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

  getAllShifts: (page = 1, pageSize = 20) =>
    apiClient
      .get<{ data: CashShift[]; total: number }>(
        `/branchManager/payment/shifts`,
        { params: { page, pageSize } }
      )
      .then((r) => r.data),

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
};

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

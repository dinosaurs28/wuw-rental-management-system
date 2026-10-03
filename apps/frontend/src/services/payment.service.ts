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
  // Additive (#3): the UPI payment-screen photo and the cash / UPI split. Absent on older servers.
  proofPhoto?: PaymentProofPhoto | null;
  proofPhotoUrl?: string | null;
  onlineGateway?: string | null;
  cashAmount?: string;
  onlineAmount?: string;
}

export type ShiftStatus = "OPEN" | "CLOSED" | "DISCREPANCY_FLAGGED";
export type RefundStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "COMPLETED";
export type RefundMethod = "CASH" | "ONLINE";

/** GET .../bookings/:id/financial-state (money as strings) */
export interface FinancialState {
  lifecycleState: LifecycleState;
  /** Booking.totalFinal (rental incl. GST, refundable deposit, confirmed extensions) */
  totalFinal: string;
  /** Money in (refund rows excluded) */
  totalCollectedConfirmed: string;
  totalCollectedPending: string;
  totalRefunded: string;
  /** max(0, totalOwed − (confirmed − refunds paid out)) */
  amountDue: string;
  /** Drop / return charges outside totalFinal, incl. GST, after the drop discount. Absent on older servers. */
  returnCharges?: string;
  /** Refundable safety deposit taken and not yet credited back at drop. Absent on older servers. */
  safetyDepositHeld?: string;
  /** totalFinal + returnCharges + safety deposit held. Absent on older servers. */
  totalOwed?: string;
  /** Part of amountDue that is on credit (#11) — min(amountDue, credit still pending). */
  creditPending?: string;
  /** The booking's customer credit (#11), null when none. */
  credit?: BookingCreditState | null;
  /** Legacy drop's deposit choice (#6), null when none recorded. */
  safetyDepositHandling?: "SET_OFF" | "REFUND_IN_FULL" | null;
}

/** A booking's CustomerCreditEntry as the financial state reports it (#11). */
export interface BookingCreditState {
  creditEntryPublicId: string;
  status: "PENDING" | "PARTIALLY_CLEARED" | "CLEARED";
  total: string;
  cleared: string;
  pending: string;
  /** Collateral notes of the pending sections. */
  collateral: string[];
  pendingSections: Array<{
    sectionKey: string;
    label: string;
    amount: string | number;
    collateral: string | null;
    purpose: string | null;
    createdAt: string | null;
  }>;
}

/** `proofPhoto` on transaction rows (#3): the UPI payment-screen photo, presigned for 15 minutes. */
export interface PaymentProofPhoto {
  proofFileId: string;
  publicId: string;
  url: string;
  mime: string;
  size: number;
  capturedAt: string;
  expiresIn: number;
}

/** Additive proof fields on transaction rows (absent on older servers). */
export interface ProofPhotoRowFields {
  proofPhoto?: PaymentProofPhoto | null;
  proofPhotoUrl?: string | null;
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

export interface PendingCashItem extends ProofPhotoRowFields {
  transactionPublicId: string;
  bookingPublicId: string;
  customerName: string;
  amount: string;
  employeeName: string;
  collectedAt: string;
  purpose: PaymentPurpose;
  // Additive (#3 / #12): counter UPI and split payments wait here too. Absent on older servers.
  method?: PaymentMethod;
  isUpi?: boolean;
  cashAmount?: string;
  onlineAmount?: string;
  onlineGateway?: string | null;
  onlineTransactionRef?: string | null;
  notes?: string | null;
}

export interface SettlementItem {
  bookingPublicId: string;
  customerName: string;
  vehicleRegNo: string;
  netPayable: string;
  /** Part of netPayable on customer credit (#11). Absent on older servers. */
  creditPending?: string;
}

export interface SettlementSummary {
  bookingPublicId: string;
  customerName: string;
  rentalBalanceRemaining: string;
  damageCharges: string;
  extensionCharges: string;
  /**
   * Return charges outside the rental total, incl. GST — a legacy drop's extra km / late return /
   * swap difference, or the drop bill — included in netPayable. Absent on older servers.
   */
  returnCharges?: string;
  /** Paid, less refunds paid out */
  alreadyPaid: string;
  netPayable: string;
  /** Refundable safety deposit taken and not yet credited back at drop. Absent on older servers. */
  safetyDepositHeld?: string;
  /** Refunds paid out. Absent on older servers. */
  refunded?: string;
  /** What netPayable is measured against. Absent on older servers. */
  totalOwed?: string;
  /** Still owed on credit (#11) — part of netPayable until the BM clears it. */
  creditPending?: string;
  /**
   * What Settlements collects: netPayable less the money on credit (≥ 0). Credit is
   * collected only on the Customer Credit page. Absent on older servers.
   */
  payableExcludingCredit?: string;
  /** For the Customer Credit page link (/manager/ledger/:customerPublicId). Absent on older servers. */
  customerPublicId?: string;
  /** Collateral notes of the credit still pending. */
  creditCollateral?: string[];
  /** Legacy drop's deposit choice (#6); null when none recorded. */
  safetyDepositHandling?: "SET_OFF" | "REFUND_IN_FULL" | null;
  /** Safety deposit still to pay back to the customer (#6) — refund-deposit pays it. */
  safetyDepositToRefund?: string;
}

/** POST /branchManager/payment/settlements/:id/refund-deposit (#6, legacy drop). */
export interface DepositRefundResult {
  refund: {
    publicId: string;
    method: "CASH" | "UPI";
    amount: string;
    status: string;
    remainingToRefund: string;
  };
  settlement: SettlementSummary;
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
  /** Legacy key: on new servers it equals the expected drawer (`expectedClosing`). */
  expectedTotal?: string;
  actualTotal?: string;
  pendingTotal?: string;
  discrepancyExplanation?: string;
  managerNote?: string;
  status: ShiftStatus;
  // Shift money figures (2-dp strings). Optional because older responses lack them.
  isOpen?: boolean;
  branchName?: string | null;
  openingCash?: string;
  cashCollected?: string;
  cashRefunded?: string;
  expectedClosing?: string;
  closingCash?: string | null;
  variance?: string | null;
  pendingCash?: string;
  confirmedCash?: string;
  rejectedCash?: string;
  upiCollected?: string;
}

// ── Cash shift views (D10 contract) ──────────────────────────────────────────
// Money is a 2-dp string; closingCash/variance are null while the shift is OPEN.

export interface ShiftView {
  publicId: string;
  status: ShiftStatus;
  isOpen: boolean;
  /** IST date (YYYY-MM-DD) the shift opened on — the day filters and totals use. */
  istDate: string;
  openedAt: string;
  closedAt: string | null;
  employeePublicId: string;
  employeeName: string;
  branchName: string | null;
  openingCash: string;
  cashCollected: string;
  cashRefunded: string;
  expectedClosing: string;
  closingCash: string | null;
  variance: string | null;
  pendingCash: string;
  confirmedCash: string;
  rejectedCash: string;
  upiCollected: string;
  transactionCount: number;
  discrepancyExplanation: string | null;
  reconciledByName: string | null;
  reconciledAt: string | null;
  /** Closed before the opening-cash change: stored figures don't add up as an equation. */
  legacyVariance: boolean;
}

export type ShiftTransactionPurpose =
  | "ADVANCE"
  | "REMAINING_BALANCE"
  | "FULL_PAYMENT"
  | "EXTENSION"
  | "DAMAGE_FEE"
  | "SAFETY_DEPOSIT"
  | "OVERPAYMENT_REFUND"
  | "CANCELLATION_REFUND";

export interface ShiftTransaction {
  publicId: string;
  bookingPublicId: string;
  customerName: string | null;
  purpose: ShiftTransactionPurpose;
  method: PaymentMethod;
  /** The transaction's CURRENT status (may have changed after the shift closed). */
  status: TransactionStatus;
  /** OUT = refund paid from the drawer. */
  direction: "IN" | "OUT";
  totalAmount: string;
  cashAmount: string;
  onlineAmount: string;
  onlineGateway: string | null;
  onlineTransactionRef: string | null;
  collectedAt: string | null;
  confirmedAt: string | null;
  rejectedAt: string | null;
  createdAt: string | null;
  collectedByName: string | null;
  confirmedByName: string | null;
  rejectedByName: string | null;
  rejectionReason: string | null;
  notes: string | null;
  /** Recorded after the close snapshot, so not part of the shift's figures. */
  linkedAfterClose: boolean;
  /** UPI payment-screen photo (#3); absent on older servers. */
  proofPhoto?: PaymentProofPhoto | null;
  proofPhotoUrl?: string | null;
}

export interface ShiftDetail extends ShiftView {
  transactions: ShiftTransaction[];
}

export interface ShiftDayTotals {
  shiftCount: number;
  openCount: number;
  closedCount: number;
  flaggedCount: number;
  openingCash: string;
  cashCollected: string;
  cashRefunded: string;
  expectedClosing: string;
  /** Closed shifts only. */
  closingCash: string;
  /** Closed shifts only, leaving out legacy (old-rule) closes. */
  variance: string;
  pendingCash: string;
  upiCollected: string;
  /** Closed shifts flagged legacyVariance, whose variance is left out of `variance`. */
  legacyCount: number;
}

export type ShiftListStatus = "OPEN" | "CLOSED" | "DISCREPANCY_FLAGGED" | "ENDED";

export interface ShiftListFilters {
  status?: ShiftListStatus;
  /** Single IST day (YYYY-MM-DD); overrides from/to. */
  date?: string;
  from?: string;
  to?: string;
  /** Only shifts open right now; ignores dates and status. */
  openNow?: boolean;
  /** BM list only. */
  employeePublicId?: string;
}

export interface ShiftListResult<Row extends ShiftView = ShiftView> {
  data: Row[];
  total: number;
  /** Per IST day, newest first, over the whole filter (not just this page). */
  dailyTotals: Array<ShiftDayTotals & { date: string }>;
  summary: ShiftDayTotals | null;
  /** Shifts open right now, whatever the filters. */
  openNowCount: number;
}

/** BM list row: ShiftView plus the legacy keys the old page read. */
export type BranchShiftRow = ShiftView & Omit<CashShift, keyof ShiftView>;

const toShiftQuery = (page: number, pageSize: number, filters?: ShiftListFilters) => {
  const params: Record<string, string | number> = { page, pageSize };
  if (!filters) return params;
  if (filters.openNow) {
    params.openNow = "true";
  } else {
    if (filters.status) params.status = filters.status;
    if (filters.date) params.date = filters.date;
    else {
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
    }
  }
  if (filters.employeePublicId) params.employeePublicId = filters.employeePublicId;
  return params;
};

type ShiftListResponse<Row> = {
  shifts: Row[];
  total: number;
  dailyTotals?: Array<ShiftDayTotals & { date: string }>;
  summary?: ShiftDayTotals;
  openNowCount?: number;
};

const toShiftListResult = <Row extends ShiftView>(body: ShiftListResponse<Row>): ShiftListResult<Row> => ({
  data: body.shifts ?? [],
  total: body.total ?? 0,
  dailyTotals: body.dailyTotals ?? [],
  summary: body.summary ?? null,
  openNowCount: body.openNowCount ?? 0,
});

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
  /** Photo of the customer's UPI payment screen (#3) — replaces the UTR for UPI. */
  proof_file_id?: string;
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
      .post<{
        status: "Success";
        message?: string;
        redirectURL?: string;
        /**
         * A UPI QR had already paid this booking / extension (#2): it is
         * confirmed, and `message` says this second payment will be refunded.
         */
        duplicatePayment?: boolean;
      }>(
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

  /**
   * Legacy drop (#6): pay the held safety deposit back — all of
   * safetyDepositToRefund unless `amount` is sent. Cash comes off the BM's open shift.
   */
  refundSettlementDeposit: (
    bookingPublicId: string,
    payload: { method: "CASH" | "UPI"; amount?: number; proof_file_id?: string; notes?: string }
  ) =>
    apiClient
      .post<{ success: boolean; message: string; data: DepositRefundResult }>(
        `/branchManager/payment/settlements/${bookingPublicId}/refund-deposit`,
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

  getAllShifts: (page = 1, pageSize = 20, filters?: ShiftListFilters) =>
    apiClient
      .get<ShiftListResponse<BranchShiftRow>>(
        `/branchManager/payment/shifts`,
        { params: toShiftQuery(page, pageSize, filters) }
      )
      .then((r) => toShiftListResult(r.data)),

  getShift: (publicId: string) =>
    apiClient
      .get<{ data: ShiftDetail & Omit<CashShift, keyof ShiftView> }>(
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

  /** `openingCash` is the float counted into the drawer (0 allowed). */
  openShift: (openingCash?: number) =>
    apiClient
      .post<{ data: CashShift; message: string }>(
        `/employee/payment/shifts`,
        openingCash === undefined ? {} : { openingCash }
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

  /** The signed-in Fleet Executive's own shifts, across every branch. */
  getMyShifts: (page = 1, pageSize = 20, filters?: Omit<ShiftListFilters, "employeePublicId">) =>
    apiClient
      .get<ShiftListResponse<ShiftView>>(
        `/employee/payment/shifts/me`,
        { params: toShiftQuery(page, pageSize, filters) }
      )
      .then((r) => toShiftListResult(r.data)),

  getMyShift: (publicId: string) =>
    apiClient
      .get<{ data: ShiftDetail }>(
        `/employee/payment/shifts/me/${publicId}`
      )
      .then((r) => r.data.data),
};

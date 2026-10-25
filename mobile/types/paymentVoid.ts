// "Refund to customer" and void a payment from the staff app (Oct 2026) — the
// same endpoints and rules as the branch manager's web portal, scoped to the
// Fleet Executive's branch:
//   GET/POST /api/employee/bookings/:publicId/refund-to-customer
//   GET      /api/employee/bookings/:publicId/payments
//   POST     /api/employee/payments/:transactionPublicId/void   { reason }

/** A payment row's void state (absent on older servers). */
export interface PaymentVoidState {
  voided?: boolean;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidReason?: string | null;
  /** Its cash shift was already closed when voided: counted cash didn't change */
  voidShiftClosed?: boolean;
  /** CONFIRMED staff-recorded entry: the Void action shows */
  voidable?: boolean;
  /** Why it can't be voided (e.g. online gateway payment) */
  voidBlockedReason?: string | null;
}

export type StaffRefundMethod = 'CASH' | 'UPI' | 'BANK_TRANSFER';

export interface StaffRefundRow extends PaymentVoidState {
  publicId: string;
  amount: string;
  goodwillAmount: string;
  method: string;
  onlineGateway: string | null;
  reference: string | null;
  cashOutsideShift: boolean;
  notes: string | null;
  by: string | null;
  at: string;
  status?: string;
  /** Additive (Oct 25 2026): the refund's payment-success photo (presigned URL, 15 min) */
  proofPhotoUrl?: string | null;
}

export interface StaffRefundOptions {
  bookingPublicId: string;
  status: string;
  branch: { name: string };
  startAt: string;
  endAt: string;
  customer: { name: string; phone: string | null };
  vehicles: { make: string; model: string; regNo: string }[];
  money: {
    paid: string;
    refunded: string;
    /** paid − refunded: refunding more than this needs the confirmation tick */
    netReceived: string;
    pendingCash: string;
    owedBack: string;
    amountDue: string;
    safetyDepositHeld: string;
    depositToRefund: string;
  };
  cashShiftOpen: boolean;
  methods: { value: StaffRefundMethod; label: string }[];
  proofPhotoSupported: boolean;
  limits: { reasonMin: number; reasonMax: number; referenceMax: number };
  refunds: StaffRefundRow[];
}

export interface StaffRefundBody {
  amount: number;
  method: StaffRefundMethod;
  reason: string;
  reference?: string;
  proofFileId?: string;
  confirmOverReceived?: boolean;
  /** Same id for retries of one submission — the server refuses a second recording (409 DUPLICATE_REFUND) */
  requestId: string;
}

export interface StaffRefundResult {
  paymentTransactionPublicId: string;
  amount: string;
  methodLabel: string;
  goodwillAmount: string;
  overReceivedBy: string;
  cashOutsideShift: boolean;
  refundedAt: string;
}

export interface PaymentVoidResult {
  transactionPublicId: string;
  bookingPublicId: string;
  amount: string;
  isRefund: boolean;
  reason: string;
  voidedAt: string;
  shiftClosed: boolean;
  warning: string | null;
  effect: string;
  amountDueAfter: string;
}

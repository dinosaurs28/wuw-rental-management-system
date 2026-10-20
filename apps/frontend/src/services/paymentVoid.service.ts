import apiClient from "@/lib/axios";
import type { PaymentVoidState } from "@/services/payment.service";

/** Branch manager (own branch) or admin (any branch). */
export type PaymentVoidPortal = "manager" | "admin";

const base = (portal: PaymentVoidPortal) => (portal === "admin" ? "/admin" : "/branchManager");

/** One row of GET …/bookings/:publicId/payments (money as 2-dp strings). */
export interface BookingPaymentRow extends PaymentVoidState {
  publicId: string;
  purpose: string;
  method: string;
  status: string;
  isRefund: boolean;
  isCustomerRefund: boolean;
  cashOutsideShift: boolean;
  totalAmount: string;
  cashAmount: string;
  onlineAmount: string;
  goodwillAmount: string;
  onlineGateway: string | null;
  onlineTransactionRef: string | null;
  collectedBy: string | null;
  collectedAt: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  cashShift: { publicId: string; status: string } | null;
  notes: string | null;
  createdAt: string;
}

export interface BookingPayments {
  bookingPublicId: string;
  status: string;
  branch: { name: string };
  customer: { name: string; phone: string | null };
  money: { totalOwed: string; paid: string; pending: string; refunded: string; amountDue: string; lifecycleState: string };
  transactions: BookingPaymentRow[];
}

export interface PaymentVoidResult {
  transactionPublicId: string;
  bookingPublicId: string;
  bookingStatus: string;
  purpose: string;
  method: string;
  amount: string;
  isRefund: boolean;
  reason: string;
  voidedAt: string;
  shiftClosed: boolean;
  warning: string | null;
  cashShiftPublicId: string | null;
  refundRequestPublicId: string | null;
  depositRefundReopened: boolean;
  siblingRowsKept: number;
  effect: string;
  amountDueAfter: string;
}

export const paymentVoidService = {
  /** GET …/bookings/:publicId/payments — the booking's payment history with each row's void state. */
  bookingPayments: (bookingPublicId: string, portal: PaymentVoidPortal = "manager") =>
    apiClient
      .get<{ success: true; data: BookingPayments }>(`${base(portal)}/bookings/${encodeURIComponent(bookingPublicId)}/payments`, { timeout: 10000 })
      .then((r) => r.data.data),

  /** POST …/payments/:transactionPublicId/void { reason } — 409 when already voided / online / not confirmed. */
  voidPayment: (transactionPublicId: string, reason: string, portal: PaymentVoidPortal = "manager") =>
    apiClient
      .post<{ success: true; message: string; data: PaymentVoidResult }>(
        `${base(portal)}/payments/${encodeURIComponent(transactionPublicId)}/void`,
        { reason },
        { timeout: 20000 },
      )
      .then((r) => r.data),
};

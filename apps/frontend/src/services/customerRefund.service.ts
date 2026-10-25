import apiClient from "@/lib/axios";
import type { ProofPhotoInfo } from "@/components/payment/counter/ProofPhotoThumb";

/** How the money goes back to the customer (backend CUSTOMER_REFUND_METHODS) — paid out now. */
export type CustomerRefundMethod = "CASH" | "UPI" | "BANK_TRANSFER";

/** A "Refund to customer" already recorded on the booking. */
export interface CustomerRefundRow {
  publicId: string;
  amount: string;
  /** Part beyond what the booking owed the customer back (goodwill) */
  goodwillAmount: string;
  method: string;
  onlineGateway: string | null;
  reference: string | null;
  /** Cash paid out with no cash shift open */
  cashOutsideShift: boolean;
  notes: string | null;
  by: string | null;
  at: string;
  /** Additive (Oct 2026): void state — a voided refund isn't paid out (shown struck through) */
  status?: string;
  voided?: boolean;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidReason?: string | null;
  /** Additive (Oct 25 2026): the refund's payment-success photo(s) */
  proofPhoto?: ProofPhotoInfo | null;
  proofs?: ProofPhotoInfo[];
}

/** GET …/bookings/:publicId/refund-to-customer — what the Refund to customer dialog needs. */
export interface CustomerRefundOptions {
  bookingPublicId: string;
  status: string;
  branch: { name: string };
  startAt: string;
  endAt: string;
  customer: { name: string; phone: string | null };
  vehicles: { make: string; model: string; regNo: string }[];
  /** Money as 2-dp strings. */
  money: {
    paid: string;
    refunded: string;
    /** paid − refunded: refunding more than this needs the confirmation tick */
    netReceived: string;
    pendingCash: string;
    /** Paid beyond what the booking owes — refunded first */
    owedBack: string;
    amountDue: string;
    safetyDepositHeld: string;
    /** Legacy drop deposit still to refund in Settlements */
    depositToRefund: string;
  };
  cashShiftOpen: boolean;
  methods: { value: CustomerRefundMethod; label: string }[];
  proofPhotoSupported: boolean;
  /** Additive (Oct 25 2026): methods whose refund needs the payment-success photo */
  proofRequiredMethods?: CustomerRefundMethod[];
  limits: { reasonMin: number; reasonMax: number; referenceMax: number };
  refunds: CustomerRefundRow[];
}

export interface CustomerRefundBody {
  amount: number;
  method: CustomerRefundMethod;
  reason: string;
  reference?: string;
  proofFileId?: string;
  confirmOverReceived?: boolean;
  /** Same id for retries of one submission — the server refuses a second recording */
  requestId: string;
}

export interface CustomerRefundResult {
  paymentTransactionPublicId: string;
  refundRequestPublicId: string;
  bookingPublicId: string;
  bookingStatus: string;
  amount: string;
  method: CustomerRefundMethod;
  methodLabel: string;
  coveredAmount: string;
  goodwillAmount: string;
  netReceivedBefore: string;
  overReceivedBy: string;
  cashShiftPublicId: string | null;
  cashOutsideShift: boolean;
  reference: string | null;
  proofFileId: string | null;
  reason: string;
  refundedAt: string;
}

/** Branch manager (own branch) or admin (any branch). */
export type CustomerRefundPortal = "manager" | "admin";

const path = (portal: CustomerRefundPortal, bookingPublicId: string) =>
  `/${portal === "admin" ? "admin" : "branchManager"}/bookings/${encodeURIComponent(bookingPublicId)}/refund-to-customer`;

export const customerRefundService = {
  getOptions: (bookingPublicId: string, portal: CustomerRefundPortal = "manager") =>
    apiClient
      .get<{ success: true; data: CustomerRefundOptions }>(path(portal, bookingPublicId), { timeout: 10000 })
      .then((r) => r.data.data),

  refund: (bookingPublicId: string, body: CustomerRefundBody, portal: CustomerRefundPortal = "manager") =>
    apiClient
      .post<{ success: true; message: string; data: CustomerRefundResult }>(path(portal, bookingPublicId), body, {
        timeout: 20000,
      })
      .then((r) => r.data),
};

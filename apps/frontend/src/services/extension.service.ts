import apiClient from "@/lib/axios";
import type { RazorpayOrder } from "@/lib/razorpay";
import type { BranchScheduleConfig } from "@/services/branch.service";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExtensionStatus =
  | "PENDING_PAYMENT"
  | "PAYMENT_COLLECTED"
  | "CONFIRMED"
  | "REJECTED"
  | "CANCELLED";

export type ExtensionResolutionType =
  | "SAME_VEHICLE"
  | "SWAP_CURRENT_TO_OTHER"
  | "SWAP_FUTURE_BOOKING"
  | "PARTIAL_EXTENSION"
  | "NO_RESOLUTION";

export interface AlternativeVehicle {
  publicId: string;
  regNo: string;
  make: string;
  model: string;
}

export interface AffectedBookingSwap {
  bookingPublicId: string;
  newVehicle: AlternativeVehicle;
}

export interface ResolutionOption {
  type: ExtensionResolutionType;
  label: string;
  description: string;
  availableVehicles?: AlternativeVehicle[];
  affectedBookings?: AffectedBookingSwap[];
  partialNewEndAt?: string;
  additionalAmount: string;
  newTotalFinal: string;
}

/**
 * GST split of an extension charge (2-dp Decimal strings), stored on the
 * extension when it is priced: additionalAmount = taxableAmount + taxAmount,
 * taxableAmount = baseAmount − discountAmount, taxAmount = cgstAmount + sgstAmount,
 * taxRate = CGST% + SGST% (e.g. "18.00"). Optional: absent on older responses.
 */
export interface ExtensionGstSplit {
  baseAmount?: string;
  discountAmount?: string;
  taxableAmount?: string;
  taxAmount?: string;
  cgstAmount?: string;
  sgstAmount?: string;
  taxRate?: string;
}

export interface ExtensionPricing extends ExtensionGstSplit {
  originalDays: number;
  newDays: number;
  originalTotalFinal: string;
  newTotalFinal: string;
  /** Amount to collect, GST included. */
  additionalAmount: string;
  /** Current rental length in hours (startAt → current endAt). */
  originalHours?: number;
  /** Hours this quote adds. */
  extensionHours?: number;
}

export interface ExtensionEvaluation {
  extensionPublicId: string;
  bookingPublicId: string;
  currentEndAt: string;
  requestedEndAt: string;
  pricing: ExtensionPricing;
  resolutionOptions: ResolutionOption[];
  recommendedResolution: ExtensionResolutionType;
}

export interface BookingExtension extends ExtensionGstSplit {
  publicId: string;
  bookingPublicId: string;
  extensionStatus: ExtensionStatus;
  oldEndAt: string;
  requestedEndAt: string;
  actualNewEndAt?: string;
  additionalAmount: string;
  newTotalFinal: string;
  resolutionType?: ExtensionResolutionType;
  vehicleSwapOccurred: boolean;
  actorPublicId: string;
  actorRole: string;
  notes?: string;
  createdAt: string;
}

export interface DisplacedBooking {
  publicId: string;
  extensionDisplacedAt: string;
  displacedByExtensionId: number | null;
  status: string;
  startAt: string;
  endAt: string;
  customer: { name: string; phone: string | null; email: string | null };
  newVehicle: { regNo: string; make: string; model: string } | null;
  displacingExtension: { publicId: string; requestedEndAt: string } | null;
}

export interface CommitExtensionPayload {
  extensionPublicId: string;
  resolutionType: ExtensionResolutionType;
  selectedVehiclePublicId?: string;
  affectedBookingSwaps?: { bookingPublicId: string; newVehiclePublicId: string }[];
  partialNewEndAt?: string;
  idempotencyKey: string;
  /** Collect the charge right away (collect endpoint) instead of deferring it to a pickup session. */
  collectNow?: boolean;
}

export interface CommitExtensionResult extends ExtensionGstSplit {
  publicId: string;
  extensionStatus: ExtensionStatus;
  resolutionType: ExtensionResolutionType;
  additionalAmount: string;
  remainAmount: {
    extension: string;
  };
  /** True when the charge was deferred to the booking's pickup payment session. */
  usePaymentSession?: boolean;
}

export interface CollectExtensionResult {
  remainAmount: {
    extension: string;
  };
  payment: "pending" | "confirmed";
}

/**
 * Extension eligibility (#15 cap + #2 office hours). The cap/hours fields are
 * absent on the customer endpoint's early answers (booking not active, an
 * extension already pending), so treat them as optional.
 */
export interface ExtensionEligibility {
  eligible: boolean;
  reason: string | null;
  /** Customer endpoint only. */
  hoursUntilEnd?: number;
  /** Latest end an extension may request (ISO). */
  maxEndAt?: string;
  /** The booking already ends at the limit — nothing left to extend. */
  atCap?: boolean;
  /** 15, or 180 for monthly-plan bookings. */
  maxBookingDays?: number;
  isMonthly?: boolean;
  rentalPeriodType?: "HOURLY" | "HALF_DAY" | "FULL_DAY" | "MULTI_DAY" | "MONTHLY" | null;
  bookingStartAt?: string;
  currentEndAt?: string;
  branchPublicId?: string;
  /** Same shape as GET /public/branch/:id/schedule. */
  officeHours?: BranchScheduleConfig;
}

// ── Service ───────────────────────────────────────────────────────────────────

export const extensionService = {
  // ── Employee ────────────────────────────────────────────────────────────────

  employeeEvaluate: (bookingPublicId: string, newEndAt: string, notes?: string) =>
    apiClient
      .post<{ data: ExtensionEvaluation; message: string }>(
        `/employee/extensions/evaluate`,
        { bookingPublicId, newEndAt, notes }
      )
      .then((r) => r.data),

  employeeCommit: (payload: CommitExtensionPayload) =>
    apiClient
      .post<{ data: CommitExtensionResult; message: string }>(
        `/employee/extensions/commit`,
        payload
      )
      .then((r) => r.data),

  employeeCollect: (
    extensionPublicId: string,
    payload: { method: "CASH" | "ONLINE"; onlineTransactionRef?: string }
  ) =>
    apiClient
      .post<{ data: CollectExtensionResult; message: string }>(
        `/employee/extensions/${extensionPublicId}/collect`,
        payload
      )
      .then((r) => r.data),

  employeeCancel: (extensionPublicId: string) =>
    apiClient
      .post<{ message: string }>(
        `/employee/extensions/${extensionPublicId}/cancel`
      )
      .then((r) => r.data),

  listEmployeeExtensions: (
    page = 1,
    pageSize = 50,
    bookingPublicId?: string,
    status?: ExtensionStatus
  ) =>
    apiClient
      .get<{ data: { extensions: BookingExtension[]; total: number } }>(
        `/employee/extensions`,
        { params: { page, pageSize, bookingPublicId, status } }
      )
      .then((r) => r.data),

  // ── Manager ─────────────────────────────────────────────────────────────────

  managerEvaluate: (bookingPublicId: string, newEndAt: string, notes?: string) =>
    apiClient
      .post<{ data: ExtensionEvaluation; message: string }>(
        `/branchManager/extensions/evaluate`,
        { bookingPublicId, newEndAt, notes }
      )
      .then((r) => r.data),

  managerCommit: (payload: CommitExtensionPayload) =>
    apiClient
      .post<{ data: BookingExtension; message: string }>(
        `/branchManager/extensions/commit`,
        payload
      )
      .then((r) => r.data),

  managerCancel: (extensionPublicId: string) =>
    apiClient
      .post<{ message: string }>(
        `/branchManager/extensions/${extensionPublicId}/cancel`
      )
      .then((r) => r.data),

  listBranchExtensions: (
    page = 1,
    pageSize = 20,
    bookingPublicId?: string,
    status?: ExtensionStatus
  ) =>
    apiClient
      .get<{ data: { extensions: BookingExtension[]; total: number } }>(
        `/branchManager/extensions`,
        { params: { page, pageSize, bookingPublicId, status } }
      )
      .then((r) => r.data),

  getExtensionDetail: (publicId: string) =>
    apiClient
      .get<{ data: BookingExtension }>(`/branchManager/extensions/${publicId}`)
      .then((r) => r.data.data),

  getDisplacedBookings: () =>
    apiClient
      .get<{ data: DisplacedBooking[] }>(`/branchManager/extensions/displaced-bookings`)
      .then((r) => r.data.data),

  // ── Customer ────────────────────────────────────────────────────────────────

  customerCheckEligibility: (bookingPublicId: string) =>
    apiClient
      .get<{ data: ExtensionEligibility }>(`/user/bookings/${bookingPublicId}/extension-eligibility`)
      .then((r) => r.data.data),

  /** Fleet (STAFF): cap + office hours for a booking in the staff member's branch. */
  employeeCheckEligibility: (bookingPublicId: string) =>
    apiClient
      .get<{ data: ExtensionEligibility; message: string }>(
        `/employee/extensions/eligibility/${bookingPublicId}`,
      )
      .then((r) => r.data.data),

  /** Branch manager: cap + office hours for a booking in their branch. */
  managerCheckEligibility: (bookingPublicId: string) =>
    apiClient
      .get<{ data: ExtensionEligibility; message: string }>(
        `/branchManager/extensions/eligibility/${bookingPublicId}`,
      )
      .then((r) => r.data.data),

  customerEvaluate: (bookingPublicId: string, newEndAt: string, notes?: string) =>
    apiClient
      .post<{ data: ExtensionEvaluation; message: string }>(
        `/user/bookings/${bookingPublicId}/extensions/evaluate`,
        { newEndAt, notes }
      )
      .then((r) => r.data),

  /**
   * Opens a Razorpay order for the extension. A ₹0 extension needs no payment:
   * it comes back with no order, `extensionStatus: "CONFIRMED"` and `newEndAt`.
   * 409 when the vehicle is no longer free for the new dates.
   */
  customerInitiatePayment: (extensionPublicId: string) =>
    apiClient
      .post<{
        data: {
          razorpay: RazorpayOrder | null;
          transactionId: string | null;
          amount: number;
          extensionStatus?: "CONFIRMED";
          newEndAt?: string;
        };
        message: string;
      }>(`/user/extensions/${extensionPublicId}/initiate-payment`)
      .then((r) => r.data),

  verifyExtensionPayment: (merchantTransactionId: string) =>
    apiClient
      .post<{
        status: "CONFIRMED" | "PENDING" | "FAILED";
        message: string;
        data?: {
          newEndAt?: string;
          /**
           * FAILED means Razorpay reported a settled failure. An unreachable
           * gateway reports PENDING with gatewayState "UNKNOWN" — unknown must
           * never be rendered to the customer as a failure.
           */
          gatewayState?: "FAILED" | "PENDING" | "UNKNOWN";
          /**
           * Present when the backend refused a captured payment: the parent
           * booking was cancelled, or the extension is no longer active. The
           * accompanying `message` is written to be shown verbatim, so this is
           * only for telling the two apart.
           */
          reason?: "CANCELLED" | "EXTENSION_CLOSED";
        };
      }>(`/user/extensions/verify-payment/${merchantTransactionId}`)
      .then((r) => r.data),

  customerCancelExtension: (extensionPublicId: string) =>
    apiClient
      .post<{ message: string }>(`/user/extensions/${extensionPublicId}/cancel`)
      .then((r) => r.data),

  customerGetStatus: (extensionPublicId: string) =>
    apiClient
      .get<{ data: BookingExtension }>(`/user/extensions/${extensionPublicId}`)
      .then((r) => r.data.data),

  // ── Manager displaced bookings ───────────────────────────────────────────────

  resolveDisplacedBooking: (
    bookingPublicId: string,
    payload: {
      action: "CONFIRM_SWAP" | "CANCEL_WITH_REFUND" | "CANCEL_NO_REFUND";
      refundAmount?: number;
      refundMethod?: "CASH" | "ONLINE";
      notes?: string;
    }
  ) =>
    apiClient
      .post<{ message: string }>(
        `/branchManager/extensions/displaced-bookings/${bookingPublicId}/resolve`,
        payload
      )
      .then((r) => r.data),
};

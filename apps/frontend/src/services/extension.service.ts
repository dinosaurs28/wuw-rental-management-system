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

/**
 * Free km an extension adds to the drop allowance (#7): each whole 24 h →
 * freeKm24Hour, a remaining block of 12 h or more → freeKm12Hour, other hours →
 * 0 km (an extension under 12 h adds none). Server-computed; absent on older
 * responses, null when the vehicle's free km can't be read.
 */
export interface ExtensionFreeKm {
  km: number;
  minutes: number;
  fullDays: number;
  halfDay: boolean;
  minutesWithoutKm: number;
  freeKm24Hour: number;
  freeKm12Hour: number;
  /** e.g. "150 km for 1 day; no km for the other 2 h". */
  label: string;
}

/**
 * A festival / weekend part of an extension charge (staff responses only):
 * GST-inclusive, before any coupon, already inside additionalAmount.
 */
export interface ExtensionSpecialShare {
  /** e.g. "Dussehra pricing", "Weekend pricing" */
  label: string;
  /** 2-dp string, e.g. "300.00" (negative = a festival discount) */
  amount: string;
}

export interface ResolutionOption extends ExtensionGstSplit {
  type: ExtensionResolutionType;
  label: string;
  description: string;
  availableVehicles?: AlternativeVehicle[];
  affectedBookings?: AffectedBookingSwap[];
  partialNewEndAt?: string;
  /** The option's charge — a partial option priced for its own end (what its commit charges). */
  additionalAmount: string;
  newTotalFinal: string;
  /** A partial option's festival / weekend parts. */
  specialShare?: ExtensionSpecialShare[];
  /** Free km this option adds (a partial option: up to partialNewEndAt). */
  extensionFreeKm?: ExtensionFreeKm | null;
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
  /** Free km this quote adds to the drop allowance. */
  extensionFreeKm?: ExtensionFreeKm | null;
  /** Festival / weekend parts of additionalAmount (staff only; absent on older servers). */
  specialShare?: ExtensionSpecialShare[];
}

/**
 * How far the booking's current car can be extended (staff endpoints:
 * eligibility, evaluate, commit). Server-computed: availableUntil = 2 h
 * (extensionBufferHours) before the car's next pickup, rounded down, or the
 * rental-length cap — limitReason says which. Absent on older servers, null
 * when the server couldn't read it. Never sent to customers except
 * availableUntil.
 */
export interface ExtensionCarAvailability {
  vehicleRegNo?: string | null;
  /** Pickup of the car's next booking / checkout in progress (ISO); null = none. */
  nextBookingStartAt?: string | null;
  /** Its booking id (publicId). */
  nextBookingRef?: string | null;
  /** HOLD = a customer checkout in progress; LOCK = a branch manager's booking lock (no buffer before it). */
  nextBookingKind?: "BOOKING" | "HOLD" | "LOCK" | null;
  /** The lock's reason, for kind LOCK. */
  nextLockReason?: string | null;
  /** When the lock ends (ISO), for kind LOCK. */
  nextLockEndAt?: string | null;
  /** Latest return this car can be extended to (ISO). */
  availableUntil?: string | null;
  limitReason?: "NEXT_BOOKING" | "MAX_RENTAL_PERIOD" | null;
  /** False = no time left on this car (a swap may still be offered). */
  canExtend?: boolean | null;
  extensionBufferHours?: number | null;
}

export interface ExtensionEvaluation extends ExtensionCarAvailability {
  extensionPublicId: string;
  bookingPublicId: string;
  currentEndAt: string;
  /** The return before this quote (the server sends this; currentEndAt is a legacy name). */
  oldEndAt?: string;
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

export interface CommitExtensionResult extends ExtensionGstSplit, ExtensionCarAvailability {
  publicId: string;
  extensionStatus: ExtensionStatus;
  resolutionType: ExtensionResolutionType;
  additionalAmount: string;
  remainAmount: {
    extension: string;
  };
  /** Festival / weekend parts of additionalAmount (staff only). */
  specialShare?: ExtensionSpecialShare[];
  /** True when the charge was deferred to the booking's pickup payment session. */
  usePaymentSession?: boolean;
  /** Free km the committed extension adds to the drop allowance. */
  extensionFreeKm?: ExtensionFreeKm | null;
  /** The return before the extension and the one now held (a partial's end). ISO. */
  oldEndAt?: string;
  newEndAt?: string;
}

export interface CollectExtensionResult {
  remainAmount: {
    extension: string;
  };
  /** Cash / UPI / split: "pending" until the BM confirms; Credit: "confirmed". */
  payment: "pending" | "confirmed";
  /** Credit (#11): what was left owed and the collateral held. */
  credit?: {
    creditEntryPublicId: string;
    sectionKey: string;
    amount: string;
    collateral: string;
  } | null;
}

/**
 * Extension eligibility (#15 cap + #2 office hours). The cap/hours fields are
 * absent on the customer endpoint's early answers (booking not active, an
 * extension already pending), so treat them as optional.
 */
export interface ExtensionEligibility extends ExtensionCarAvailability {
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
  /**
   * Customer endpoint only: what a customer may add — +12 hours, +1 day …
   * up to maxEndAt. insideHours:false = that end is outside the branch's
   * return hours (show it disabled). Absent on the early answers.
   */
  packageOptions?: ExtensionPackageOption[];
}

/** A customer self-extension length (+12 h or + N × 24 h). */
export interface ExtensionPackageOption {
  hours: number;
  /** "12 hours", "1 day", "2 days" … */
  label: string;
  /** ISO. */
  newEndAt: string;
  insideHours: boolean;
  /** false = past the latest return the car is free for (availableUntil). Absent on older servers. */
  available?: boolean;
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
    payload: {
      /** UPI = counter UPI backed by proof_file_id; SPLIT = cashAmount + onlineAmount; CREDIT needs collateral (#12). */
      method: "CASH" | "ONLINE" | "UPI" | "SPLIT" | "CREDIT";
      onlineTransactionRef?: string;
      proof_file_id?: string;
      /** Every payment screenshot (1–3, slot order; the first = proof_file_id). */
      proof_file_ids?: string[];
      cashAmount?: number;
      onlineAmount?: number;
      collateral?: string;
    }
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

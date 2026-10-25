import apiClient from "@/lib/axios";

/** How the money goes back to the customer (backend MANUAL_CANCEL_REFUND_METHODS). */
export type ManualCancelRefundMethod = "CASH" | "UPI" | "BANK_TRANSFER" | "ORIGINAL_PAYMENT";
/** What an active rent's car becomes once its rent is cancelled. */
export type ManualCancelVehicleStatus = "AVAILABLE" | "MAINTENANCE" | "INACTIVE" | "OUT_FOR_RENTAL";
/** Where an active rent's car is (OUT_OF_BRANCH: not Available, no odometer). */
export type ManualCancelVehicleLocation = "AT_BRANCH" | "OUT_OF_BRANCH";

/** GET /branchManager/bookings/:publicId/cancel — what the Cancel rent dialog needs. */
export interface ManualCancelOptions {
  bookingPublicId: string;
  status: string;
  /** UPCOMING (confirmed) or ACTIVE (picked up); null for any other status. */
  stage: "UPCOMING" | "ACTIVE" | null;
  cancellable: boolean;
  blockedCode: string | null;
  blockedReason: string | null;
  startAt: string;
  endAt: string;
  rentalPeriodType: string | null;
  totalFinal: string;
  customer: { name: string; phone: string | null };
  vehicles: {
    publicId: string;
    make: string;
    model: string;
    regNo: string;
    status: string;
    odo: number;
  }[];
  /** Money as 2-dp strings. */
  money: {
    paid: string;
    /** Refunds paid out or committed (approved / awaiting approval) — one figure. */
    refunded: string;
    pendingCash: string;
    refundable: string;
    /** What "original online payment" can take: refundable, at most what Razorpay captured. */
    onlineRefundable: string;
  };
  /** A cash refund needs the manager's open cash shift. */
  cashShiftOpen: boolean;
  /** Counter credit still pending — written off by the cancel. */
  creditPending: string;
  couponCode: string | null;
  dlStatus: "COLLECTED" | "NOT_COLLECTED" | "DEPOSIT" | null;
  openPaymentSessions: number;
  openExtensions: number;
  refundMethods: { value: ManualCancelRefundMethod; label: string }[];
  vehicleStatuses: ManualCancelVehicleStatus[];
  /** Absent on servers before the location choice. */
  vehicleLocations?: { value: ManualCancelVehicleLocation; label: string }[];
  limits: { reasonMin: number; reasonMax: number; noteMax: number };
}

export interface ManualCancelBody {
  reason: string;
  /** proofFileId (Oct 25 2026): the refund's payment-success photo — required for UPI / bank transfer */
  refund: { amount: number; method?: ManualCancelRefundMethod; note?: string; proofFileId?: string };
  /** Active rents: where the car is. */
  vehicleLocation?: ManualCancelVehicleLocation;
  vehicleStatus?: ManualCancelVehicleStatus;
  /** Active rents back at the branch, optional: the car's reading (km). */
  odometer?: number;
}

export interface ManualCancelResult {
  booking: {
    publicId: string;
    status: "CANCELLED";
    previousStatus: string;
    stage: "UPCOMING" | "ACTIVE";
    cancelledAt: string;
    cancellationReason: string;
    cancellationSource: "MANUAL_BM";
  };
  refund: {
    /** Null for "original online payment" (completed later in Payments → Refunds). */
    paymentTransactionPublicId: string | null;
    refundRequestPublicId: string;
    status: "COMPLETED" | "APPROVED";
    amount: string;
    method: ManualCancelRefundMethod;
    methodLabel: string;
  } | null;
  vehicles: {
    publicId: string;
    regNo: string;
    status: string;
    changed: boolean;
    /** Why the chosen status wasn't set (another rental / damage review / drop damage). */
    keptReason?: "OTHER_RENTAL" | "DAMAGE_REVIEW" | "DROP_DAMAGE" | null;
  }[];
  vehicleLocation?: ManualCancelVehicleLocation | null;
  /** Names the cars whose status the cancel didn't set (also in the message). */
  vehicleNote?: string | null;
  releasedCouponUses: number;
  voidedCredit: string;
  abandonedPaymentSessions: number;
  cancelledExtensions: number;
}

const path = (bookingPublicId: string) => `/branchManager/bookings/${encodeURIComponent(bookingPublicId)}/cancel`;

export const manualCancelService = {
  getOptions: (bookingPublicId: string) =>
    apiClient
      .get<{ success: true; data: ManualCancelOptions }>(path(bookingPublicId), { timeout: 10000 })
      .then((r) => r.data.data),

  cancel: (bookingPublicId: string, body: ManualCancelBody) =>
    apiClient
      .post<{ success: true; message: string; data: ManualCancelResult }>(path(bookingPublicId), body, {
        timeout: 20000,
      })
      .then((r) => r.data),
};

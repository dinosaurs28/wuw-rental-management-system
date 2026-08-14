import {
  BookingStatus,
  PaymentTransactionStatus,
  PaymentPurpose,
} from "@repo/database/client";

/**
 * Canonical reporting conventions — the single source of truth for every admin
 * report and the dashboard. See docs/superpowers/specs/2026-05-30-admin-reports-spec-conformance-design.md.
 *
 * Spec status mapping: 'confirmed' -> CONFIRMED, 'active' -> PICKED_UP,
 * 'completed' -> RETURNED, 'cancelled' -> CANCELLED.
 */

/** Bookings that count as revenue (spec confirmed/active/completed). */
export const REVENUE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.PICKED_UP,
  BookingStatus.RETURNED,
];

/** spec label -> DB BookingStatus */
export const SPEC_STATUS_TO_DB: Record<string, BookingStatus> = {
  confirmed: BookingStatus.CONFIRMED,
  active: BookingStatus.PICKED_UP,
  completed: BookingStatus.RETURNED,
  cancelled: BookingStatus.CANCELLED,
};

/** DB BookingStatus -> human label used in report output. */
export const DB_STATUS_TO_SPEC: Partial<Record<BookingStatus, string>> = {
  [BookingStatus.CONFIRMED]: "Confirmed",
  [BookingStatus.PICKED_UP]: "Active",
  [BookingStatus.RETURNED]: "Completed",
  [BookingStatus.CANCELLED]: "Cancelled",
  [BookingStatus.HOLD]: "Hold",
  [BookingStatus.HOLD_EXPIRED]: "Hold Expired",
};

/** PaymentTransaction statuses that represent money actually received. */
export const COLLECTED_PAYMENT_STATUSES: PaymentTransactionStatus[] = [
  PaymentTransactionStatus.COLLECTED,
  PaymentTransactionStatus.CONFIRMED,
];

/**
 * Payment purposes that count toward rental revenue collection.
 * Excludes SAFETY_DEPOSIT, OVERPAYMENT_REFUND, CANCELLATION_REFUND (not revenue).
 */
export const REVENUE_PAYMENT_PURPOSES: PaymentPurpose[] = [
  PaymentPurpose.ADVANCE,
  PaymentPurpose.REMAINING_BALANCE,
  PaymentPurpose.FULL_PAYMENT,
  PaymentPurpose.EXTENSION,
  PaymentPurpose.DAMAGE_FEE,
];

/** Spec payment modes shown in cash-flow reports. */
export type SpecPaymentMode = "Cash" | "UPI" | "Gateway" | "Credit";

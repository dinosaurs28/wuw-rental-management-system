// Daily vs Monthly list tabs (#17) and the overdue / no-show return list (#8).
// Shapes mirror the backend contract (GET /employee/booking, /employee/return,
// /branchManager/dashboard/bookings/{active,pending,overdue},
// /employee/dashboard/overdue-returns).

import type { DlStatus } from "@/services/dlStatus.service";

/** Monthly = rentalPeriodType MONTHLY; everything else (including null) is Daily. */
export type BookingListType = "DAILY" | "MONTHLY";

/** Row counts for both tabs, returned whichever tab was asked for. */
export interface BookingListCounts {
  daily: number;
  monthly: number;
}

export type OverdueReturnState =
  | "OVERDUE"
  | "IN_GRACE"
  | "AWAITING_MANAGER_CONFIRMATION"
  | "RETURN_IN_PROGRESS";

export interface OverdueReturn {
  publicId: string;
  bookingType: BookingListType;
  rentalPeriodType: string | null;
  days: number;
  startAt: string;
  /** Expected return — the current endAt, after any extension. */
  endAt: string;
  /** Set once the booking has been extended. */
  originalEndAt: string | null;
  /** endAt formatted in IST by the server, e.g. "01 Oct 2026, 06:05 PM". */
  endAtDisplay: string;
  /** Minutes past endAt at `serverNow`. */
  overdueMinutes: number;
  returnState: OverdueReturnState;
  /** AUTOMATIC grace (no late charge yet); null = none — off, or MANUAL (staff apply it at the drop). */
  graceMinutes: number | null;
  graceEndsAt: string | null;
  /** Licence held at pickup (#3); null = not recorded. Optional: older servers omit it. */
  dlStatus?: DlStatus;
  /** DEPOSIT only: what the customer left instead. */
  dlDepositNote?: string | null;
  extensionCount: number;
  extensionPending: boolean;
  pendingExtension: {
    publicId: string;
    status: "PENDING_PAYMENT" | "PAYMENT_COLLECTED";
    requestedEndAt: string;
  } | null;
  customer: {
    publicId: string | null;
    name: string | null;
    phone: string | null;
    alternatePhone: string | null;
  };
  vehicles: {
    publicId: string;
    make: string;
    model: string;
    regNo: string;
    imageUrl: string | null;
  }[];
}

export interface OverdueReturnsResponse {
  success: boolean;
  message: string;
  data: OverdueReturn[];
  /** OVERDUE + IN_GRACE — vehicles not back yet. Use it for every "N overdue" badge. */
  overdueCount: number;
  counts: Record<OverdueReturnState, number> & { total: number };
  serverNow: string;
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

/** An overdue list plus the local clock reading taken when it arrived. */
export interface OverdueReturnsSnapshot extends OverdueReturnsResponse {
  /** Date.now() when the response was received; anchors the live overdue tick. */
  fetchedAt: number;
}

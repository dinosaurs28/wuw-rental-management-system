import apiClient from "@/lib/axios";
import type { BranchScheduleConfig } from "@/services/branch.service";

// Reschedule a CONFIRMED booking (not picked up yet) — Fleet (own branch) and
// Branch Manager (P4c). The pickup moves; the return moves by the same amount;
// the length and price stay the same. Since TODO 4 (periodReschedule) the start
// and the end move independently and the price follows (quote first). Contract: scratchpad contracts/PK.md §6.

export type RescheduleRole = "employee" | "manager";

export interface RescheduleBusyRange {
  vehiclePublicId: string;
  /**
   * BOOKING = another booking; HOLD = a checkout in progress (bookingPublicId
   * null for a Redis hold); LOCK = a branch manager's booking lock (lockReason).
   */
  kind: "BOOKING" | "HOLD" | "LOCK";
  lockReason?: string;
  bookingPublicId: string | null;
  bookingStatus: "CONFIRMED" | "PICKED_UP" | "HOLD" | null;
  startAt: string;
  endAt: string;
}

export interface RescheduleDlBusyRange {
  bookingPublicId: string;
  bookingStatus: string;
  startAt: string;
  endAt: string;
}

/** GET …/bookings/:publicId/reschedule — what the reschedule sheet needs. */
export interface RescheduleOptions {
  bookingPublicId: string;
  status: string;
  /** false ⇒ show `reason` and don't offer the move. */
  reschedulable: boolean;
  code: string | null;
  reason: string | null;
  startAt: string;
  endAt: string;
  /** Fixed: the new return = the new pickup + this (except a 12-hour package). */
  durationMinutes: number;
  durationLabel: string;
  /**
   * A 12-hour package (client item 6): the new return is the package's return
   * for the new pickup — pickup + 12 h, or closing that day (halfDayReturnFor).
   * Absent from older servers.
   */
  halfDayPackage?: boolean;
  isMonthly: boolean;
  rentalPeriodType: string | null;
  /** Now (to the minute) — slots from here, less pastToleranceMinutes. */
  earliestStartAt: string;
  latestStartAt: string;
  pastToleranceMinutes: number;
  branchPublicId: string;
  officeHours: BranchScheduleConfig;
  vehicles: Array<{ publicId: string; make: string; model: string; regNo: string }>;
  vehicleBusy: RescheduleBusyRange[];
  dlBusy: RescheduleDlBusyRange[];
  /** Reschedule rental period (TODO 4): newEndAt + the quote endpoint. Absent from older servers. */
  periodReschedule?: boolean;
  periodRules?: {
    pastSlackMinutes: number;
    minHours: number;
    maxRentalDays: number;
    monthlyMinDays: number;
    monthlyMaxDays: number;
    advanceBookingDays: number;
  };
}

/** Price side of a period reschedule (amounts are "1234.00"). */
export interface ReschedulePeriodPricing {
  oldTotal: string;
  newTotal: string;
  /** + more to pay, − less */
  difference: string;
  oldWindowRent: string;
  newWindowRent: string;
  priceChanged: boolean;
  couponCode: string | null;
  couponAppliesToNewWindow: boolean | null;
  netPaid: string;
  dueAtPickup: string;
  /** Paid beyond the new total — refund via "Refund to customer" (never automatic) */
  refundable: string;
  outcome: string;
  freeKm: { before: number | null; after: number | null };
  billedAs: { before: string | null; after: string | null };
  rentalPeriodType: string | null;
}

export interface ReschedulePeriodQuote {
  bookingPublicId: string;
  previous: { startAt: string; endAt: string; durationMinutes: number; durationLabel: string };
  next: { startAt: string; endAt: string; durationMinutes: number; durationLabel: string };
  pureShift: boolean;
  confirmationRequired: boolean;
  pricing: ReschedulePeriodPricing;
}

export interface RescheduleResult {
  booking: {
    publicId: string;
    status: string;
    startAt: string;
    endAt: string;
    durationMinutes: number;
    rentalPeriodType: string | null;
    branchPublicId: string;
    vehicles: Array<{ publicId: string; make: string; model: string; regNo: string }>;
  };
  previous: { startAt: string; endAt: string };
  /** + later, − earlier. */
  shiftMinutes: number;
  reason: string | null;
  releasedExtensionQuotePublicId: string | null;
  /** Period reschedule only */
  pricing?: ReschedulePeriodPricing;
}

const base = (role: RescheduleRole) => (role === "manager" ? "/branchManager" : "/employee");

export const rescheduleService = {
  getOptions: (role: RescheduleRole, bookingPublicId: string) =>
    apiClient
      .get<{ success: true; data: RescheduleOptions }>(
        `${base(role)}/bookings/${encodeURIComponent(bookingPublicId)}/reschedule`,
      )
      .then((r) => r.data.data),

  /**
   * newStartAt (+ newEndAt for a period reschedule): IST wall clock "YYYY-MM-DDTHH:mm".
   * A price change needs acceptPriceChange; expectedNewTotal guards a stale preview.
   */
  reschedule: (
    role: RescheduleRole,
    bookingPublicId: string,
    body: { newStartAt: string; newEndAt?: string; acceptPriceChange?: boolean; expectedNewTotal?: string; reason?: string },
  ) =>
    apiClient
      .post<{ success: true; message: string; data: RescheduleResult }>(
        `${base(role)}/bookings/${encodeURIComponent(bookingPublicId)}/reschedule`,
        body,
      )
      .then((r) => r.data),

  /** Preview of a new rental period: every check + the price difference (4xx as the POST). */
  quote: (role: RescheduleRole, bookingPublicId: string, body: { newStartAt: string; newEndAt: string }) =>
    apiClient
      .post<{ success: true; data: ReschedulePeriodQuote }>(
        `${base(role)}/bookings/${encodeURIComponent(bookingPublicId)}/reschedule/quote`,
        body,
      )
      .then((r) => r.data.data),
};

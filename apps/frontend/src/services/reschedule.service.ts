import apiClient from "@/lib/axios";
import type { BranchScheduleConfig } from "@/services/branch.service";

// Reschedule a CONFIRMED booking (not picked up yet) — Fleet (own branch) and
// Branch Manager (P4c). The pickup moves; the return moves by the same amount;
// the length and price stay the same. Contract: scratchpad contracts/PK.md §6.

export type RescheduleRole = "employee" | "manager";

export interface RescheduleBusyRange {
  vehiclePublicId: string;
  /** BOOKING = another booking; HOLD = a checkout in progress (bookingPublicId null for a Redis hold). */
  kind: "BOOKING" | "HOLD";
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
  /** Fixed: the new return = the new pickup + this. */
  durationMinutes: number;
  durationLabel: string;
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
}

const base = (role: RescheduleRole) => (role === "manager" ? "/branchManager" : "/employee");

export const rescheduleService = {
  getOptions: (role: RescheduleRole, bookingPublicId: string) =>
    apiClient
      .get<{ success: true; data: RescheduleOptions }>(
        `${base(role)}/bookings/${encodeURIComponent(bookingPublicId)}/reschedule`,
      )
      .then((r) => r.data.data),

  /** newStartAt: IST wall clock "YYYY-MM-DDTHH:mm". */
  reschedule: (role: RescheduleRole, bookingPublicId: string, body: { newStartAt: string; reason?: string }) =>
    apiClient
      .post<{ success: true; message: string; data: RescheduleResult }>(
        `${base(role)}/bookings/${encodeURIComponent(bookingPublicId)}/reschedule`,
        body,
      )
      .then((r) => r.data),
};

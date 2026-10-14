import apiClient from "@/lib/axios";
import type { DlStatus } from "@/services/dlStatus.service";
import type { BookingListType } from "@/types/overdueReturns";

/**
 * Completed pickups / returns (client item 1): the read-only summary and the
 * Edit Pickup / Edit Return endpoints.
 *   GET   /employee/{pickup|return}/:bookingId/summary
 *   PATCH /employee/{pickup|return}/:bookingId — only the fields sent change;
 *         409 EDIT_CHANGES_CHARGES (+ field) when a reading would change charges
 *         already computed or settled.
 */

/** PENDING = not done yet (the workflow handles it); null = not on that queue. */
export type CompletedState = "PENDING" | "COMPLETED" | "AWAITING_MANAGER";

export interface CompletionInfo {
  at: string | null;
  byName: string | null;
}

export interface SummaryPhoto {
  publicId: string;
  /** FileObject publicId — what removeFileIds takes. */
  fileId: string;
  url: string;
  /** Capture slot ("Front", "Odometer" …); null = extra photo. */
  label: string | null;
  createdAt: string;
}

export interface SummaryBillLine {
  label: string;
  /** Signed: charges +, discounts / payments −. */
  amount: string;
  kind: "CHARGE" | "DISCOUNT" | "PAYMENT";
}

interface SummaryBase {
  state: CompletedState | null;
  completed: CompletionInfo | null;
  booking: {
    publicId: string;
    status: string;
    startAt: string;
    endAt: string;
    returnedAt: string | null;
    totalFinal: string;
    days: number;
    rentalPeriodType: string | null;
    bookingType: BookingListType;
    usePaymentSessions: boolean;
    awaitingManager: boolean;
  };
  customer: { name: string; phone: string | null; drivingLicenceNumber: string | null };
  vehicles: { publicId: string; make: string; model: string; regNo: string }[];
  dl: { status: DlStatus; depositNote: string | null };
  photos: SummaryPhoto[];
}

export interface PickupSummary extends SummaryBase {
  phase: "PICKUP";
  odometer: number | null;
  /** "1".."10" */
  fuelLevel: string | null;
  /** ₹ on the FASTag at the handover — shown / editable only when hasFastag. */
  fastag: { hasFastag: boolean; balance: string | null };
  safetyDeposit: string;
  captureFields: { name: string; required: boolean }[];
  bill: { lines: SummaryBillLine[]; netPayable: string } | null;
  edit: {
    allowed: boolean;
    /** A drop already measured km from the pickup reading. */
    odometerCheckedAgainstCharges: boolean;
    /** The return is done: a FASTag balance that moves the FASTag charge is refused. */
    fastagCheckedAgainstCharges: boolean;
    dlStatusEditable: boolean;
    dlStatusLockedReason: string | null;
  };
}

export interface ReturnSummaryDamage {
  publicId: string;
  area: string;
  severity: string;
  description: string;
  amount: string;
  chargeCustomer: boolean;
  billedAtDrop: boolean;
  /** false once the branch manager reviewed it */
  editable: boolean;
  photos: { fileId: string; url: string }[];
}

export interface ReturnSummary extends SummaryBase {
  phase: "RETURN";
  odometer: {
    pickup: number | null;
    /** Start of the car handed back (after a swap). */
    start: number | null;
    end: number | null;
    kmDriven: number | null;
    freeKm: number | null;
    extraKm: number | null;
    swapCount: number;
    /** false: a swap was recorded without readings */
    measured: boolean;
  };
  fuel: { pickup: string | null; return: string | null };
  /** FASTag of the car handed back — shown / editable only when hasFastag. */
  fastag: {
    hasFastag: boolean;
    /** When the customer got the car */
    startBalance: string | null;
    /** At the drop */
    balance: string | null;
    /** Worked out from the readings; null = the charge was typed */
    usage: string | null;
  };
  damages: ReturnSummaryDamage[];
  bill: { settledBy: "DROP_BILL" | "BRANCH_MANAGER"; lines: SummaryBillLine[]; netPayable: string } | null;
  edit: { allowed: boolean; fuelEditable: boolean };
}

export interface EditPickupBody {
  odo?: number;
  pickupFuelLevel?: string;
  pickupFastagBalance?: number;
  dlStatus?: "COLLECTED" | "NOT_COLLECTED";
  drivingLicenceNumber?: string;
  addPhotos?: { fileId: string; label?: string | null }[];
  removeFileIds?: string[];
}

export interface EditReturnBody {
  endOdometer?: number;
  returnFuelLevel?: string;
  returnFastagBalance?: number;
  addPhotos?: { fileId: string }[];
  removeFileIds?: string[];
  damages?: {
    publicId: string;
    area?: string;
    description?: string;
    severity?: "Minor" | "Moderate" | "Severe";
    addPhotoIds?: string[];
    removeFileIds?: string[];
  }[];
}

export interface EditOperationResponse<T> {
  message: string;
  changed: string[];
  data: T;
}

export const completedOperationService = {
  getPickupSummary: async (bookingId: string) => {
    const response = await apiClient.get<{ data: PickupSummary }>(`/employee/pickup/${bookingId}/summary`);
    return response.data.data;
  },
  getReturnSummary: async (bookingId: string) => {
    const response = await apiClient.get<{ data: ReturnSummary }>(`/employee/return/${bookingId}/summary`);
    return response.data.data;
  },
  editPickup: async (bookingId: string, body: EditPickupBody) => {
    const response = await apiClient.patch<EditOperationResponse<PickupSummary>>(
      `/employee/pickup/${bookingId}`,
      body,
    );
    return response.data;
  },
  editReturn: async (bookingId: string, body: EditReturnBody) => {
    const response = await apiClient.patch<EditOperationResponse<ReturnSummary>>(
      `/employee/return/${bookingId}`,
      body,
    );
    return response.data;
  },
};

/** The booking is done for this phase: the summary opens, never the workflow. */
export function isCompletedForPhase(
  phase: "PICKUP" | "RETURN",
  booking: { status: string; requiresManagerConfirmation?: boolean } | null | undefined,
): boolean {
  if (!booking) return false;
  if (phase === "PICKUP") {
    return (
      booking.status === "PICKED_UP" ||
      booking.status === "RETURNED" ||
      (booking.status === "CONFIRMED" && !!booking.requiresManagerConfirmation)
    );
  }
  return booking.status === "RETURNED" || (booking.status === "PICKED_UP" && !!booking.requiresManagerConfirmation);
}

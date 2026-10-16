import apiClient from "@/lib/axios";
import type { DlStatus } from "@/services/dlStatus.service";
import type { PaymentSession } from "@/services/paymentSession.service";
import type { BookingListType } from "@/types/overdueReturns";

/**
 * Completed pickups / returns (client item 1): the read-only summary and the
 * Edit Pickup / Edit Return endpoints.
 *   GET   /employee/{pickup|return}/:bookingId/summary
 *   POST  /employee/{pickup|return}/:bookingId/edit/preview — the money difference, nothing saved
 *   PATCH /employee/{pickup|return}/:bookingId — only the fields sent change; the
 *         difference is settled on `adjustment.session` (record-payment / record-refund);
 *         409 EDIT_DELTA_CHANGED when it moved since `expectedDelta` (required when money
 *         moves: EDIT_CONFIRMATION_REQUIRED). An unsettled earlier difference is replaced
 *         (preview `supersedes`), unless a payment was started on it (ADJUSTMENT_PAYMENT_STARTED).
 */

/** One bill line of an edit's money difference (old → new). */
export interface AdjustmentLine {
  key: string;
  part: "PICKUP" | "DROP";
  entryType: string;
  referenceType: string | null;
  referenceId: string | null;
  label: string;
  oldAmount: string;
  newAmount: string;
  delta: string;
}

/** How an edit's difference is settled. */
export interface AdjustmentPlan {
  /** new − old: + collect, − refund */
  delta: string;
  action: "COLLECT" | "REFUND" | "NONE";
  amount: string;
  /** COUNTER = on the adjustment session now; BRANCH_MANAGER = legacy return charges in Settlements */
  settledBy: "COUNTER" | "BRANCH_MANAGER";
  methods: { collect: string[]; refund: string[] };
  lines: AdjustmentLine[];
  changedLines: number;
}

/** An edit's ADJUSTMENT session. */
export interface AdjustmentRecord {
  session: PaymentSession;
  operation: "PICKUP" | "RETURN" | null;
  lines: AdjustmentLine[];
  createdAt: string;
  completedAt: string | null;
}

export interface EditPreview {
  adjustment: AdjustmentPlan;
  drop: { flow: "DROP_BILL" | "LEGACY"; charges: string; depositHandling: "SET_OFF" | "REFUND_IN_FULL" } | null;
  pendingAdjustment: PaymentSession | null;
  /** The unsettled difference this save replaces (its money is worked out again in this one) */
  supersedes?: PaymentSession | null;
}

/** The drop's bill inputs as recorded / last edited (money as 2-dp strings). */
export interface DropEditInputs {
  endOdometer: number | null;
  manualExtraKm: number | null;
  returnFuelLevel: string | null;
  returnFastagBalance: string | null;
  fuelCharge: string;
  fastagAmount: string;
  fastagNotes: string | null;
  otherCharges: { label: string; amount: string }[];
  discount: { amount: string; reason: string } | null;
  applyGrace: boolean;
  waiveReason: string | null;
  depositHandling: "SET_OFF" | "REFUND_IN_FULL";
  damageAmounts: Record<string, string>;
}

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
  /** An edit's difference still to collect / refund */
  pendingAdjustment?: AdjustmentRecord | null;
  /** Edits whose difference was settled */
  adjustments?: AdjustmentRecord[];
}

export interface PickupSummary extends SummaryBase {
  phase: "PICKUP";
  odometer: number | null;
  /** "1".."10" */
  fuelLevel: string | null;
  /**
   * ₹ on the FASTag at the handover — editable for any car, required when the car
   * is marked as having a FASTag (vehicleHasFastag; absent on older servers).
   * hasFastag: it counts as a FASTag car for the booking (marked, or a balance read).
   */
  fastag: { hasFastag: boolean; vehicleHasFastag?: boolean; balance: string | null };
  safetyDeposit: string;
  /** Manual pickup discount given (₹ off the rent incl. GST; null = none; absent on older servers) */
  pickupDiscount?: { amount: string; reason: string | null; maxAmount: string } | null;
  captureFields: { name: string; required: boolean }[];
  bill: { lines: SummaryBillLine[]; netPayable: string } | null;
  edit: {
    allowed: boolean;
    /** Always false since the full edit (money changes are settled, not refused). */
    odometerCheckedAgainstCharges: boolean;
    fastagCheckedAgainstCharges: boolean;
    /** Corrected pickup readings re-price the completed drop. */
    readingsMoveDropCharges?: boolean;
    /** The safety deposit can be changed (car out, nothing recorded at the drop). */
    depositEditable?: boolean;
    depositLockedReason?: string | null;
    /** The manual pickup discount can be changed, up to discountMax (absent on older servers). */
    discountEditable?: boolean;
    discountMax?: string;
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
  /**
   * FASTag of the car handed back — shown / editable (and required) when hasFastag:
   * it counts as a FASTag car for the booking (marked, or a balance read at pickup / swap).
   */
  fastag: {
    hasFastag: boolean;
    vehicleHasFastag?: boolean;
    /** When the customer got the car */
    startBalance: string | null;
    /** At the drop */
    balance: string | null;
    /** Worked out from the readings; null = the charge was typed */
    usage: string | null;
  };
  damages: ReturnSummaryDamage[];
  bill: { settledBy: "DROP_BILL" | "BRANCH_MANAGER"; lines: SummaryBillLine[]; netPayable: string } | null;
  /** What the drop recorded, to prefill Edit Return */
  editState?: {
    flow: "DROP_BILL" | "LEGACY";
    inputs: DropEditInputs;
    /** The drop bill as charged now: the original plus earlier edits */
    billedLines: { entryType: string; referenceType: string | null; referenceId: string | null; label: string; amount: string }[];
    damages: { publicId: string; label: string; amount: string; editable: boolean }[];
  } | null;
  edit: { allowed: boolean; fuelEditable: boolean };
}

export interface EditPickupBody {
  /** New safety deposit total (car still out) */
  safetyDeposit?: number;
  /** Manual pickup discount (₹ off the rent incl. GST); null removes it */
  pickupDiscount?: { amount: number; reason?: string | null } | null;
  /** The difference the review showed */
  expectedDelta?: number;
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
    amount?: number;
  }[];
  manualExtraKm?: number | null;
  fuelCharge?: number;
  fastagAmount?: number;
  fastagNotes?: string | null;
  otherCharges?: { label: string; amount: number }[];
  discount?: { amount: number; reason: string } | null;
  applyGrace?: boolean;
  waiveLateCharge?: { reason: string } | null;
  safetyDepositHandling?: "SET_OFF" | "REFUND_IN_FULL";
  expectedDelta?: number;
}

export interface EditOperationResponse<T> {
  message: string;
  changed: string[];
  data: T;
  /** The money difference and the session that settles it */
  adjustment?: (AdjustmentPlan & { session: PaymentSession | null }) | null;
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
  previewPickupEdit: async (bookingId: string, body: EditPickupBody) => {
    const response = await apiClient.post<{ data: EditPreview }>(`/employee/pickup/${bookingId}/edit/preview`, body);
    return response.data.data;
  },
  previewReturnEdit: async (bookingId: string, body: EditReturnBody) => {
    const response = await apiClient.post<{ data: EditPreview }>(`/employee/return/${bookingId}/edit/preview`, body);
    return response.data.data;
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

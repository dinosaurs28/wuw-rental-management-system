// Completed pickups / returns (client item 1): the read-only summary of
// GET /api/employee/{pickup|return}/:bookingId/summary and the Edit Pickup /
// Edit Return bodies (PATCH /api/employee/{pickup|return}/:bookingId).
import type { DlCollectionStatus } from '../lib/dlStatus';
import type { SafetyDepositHandling } from '../lib/counterPayment';
import type { ReturnSession } from './api';
import type { DropBill, ReturnLateSummary } from './return';
import type { BookingListType } from './queue';

// PENDING = not done yet (open the workflow); null = not on that queue (cancelled …).
export type CompletedState = 'PENDING' | 'COMPLETED' | 'AWAITING_MANAGER';

// Who completed it and when; nulls on very old rows.
export interface CompletionInfo {
  at: string | null;
  byName: string | null;
}

export interface SummaryPhoto {
  publicId: string;
  fileId: string; // FileObject publicId — what removeFileIds takes
  url: string;
  label: string | null; // capture slot ("Front", "Odometer" …); null = extra photo
  createdAt: string;
}

export interface SummaryBillLine {
  label: string;
  amount: string; // signed: charges +, discounts / payments −
  kind: 'CHARGE' | 'DISCOUNT' | 'PAYMENT';
}

// An edit's money difference: one line per bill line (old → new).
export interface AdjustmentLine {
  key: string;
  part: 'PICKUP' | 'DROP';
  entryType: string;
  referenceType: string | null;
  referenceId: string | null;
  label: string;
  oldAmount: string;
  newAmount: string;
  delta: string;
}

// How an edit's difference is settled (preview, and the save's response).
export interface AdjustmentPlan {
  delta: string; // new − old; + = collect, − = refund
  action: 'COLLECT' | 'REFUND' | 'NONE';
  amount: string;
  // COUNTER = settled now on the adjustment session; BRANCH_MANAGER = legacy return charges (Settlements)
  settledBy: 'COUNTER' | 'BRANCH_MANAGER';
  methods: { collect: string[]; refund: string[] };
  lines: AdjustmentLine[];
  changedLines: number;
}

// An edit's ADJUSTMENT session: settle it with record-payment / record-refund.
export interface AdjustmentRecord {
  session: ReturnSession;
  operation: 'PICKUP' | 'RETURN' | null;
  lines: AdjustmentLine[];
  createdAt: string;
  completedAt: string | null;
}

// POST /api/employee/{pickup|return}/:bookingId/edit/preview
export interface EditPreview {
  adjustment: AdjustmentPlan;
  drop: {
    flow: 'DROP_BILL' | 'LEGACY';
    bill: DropBill | null;
    late: ReturnLateSummary | null;
    km: { endOdometer: number; kmDriven: number | null; extraKm: number; includedKm: number | null } | null;
    charges: string;
    depositHandling: SafetyDepositHandling;
  } | null;
  pendingAdjustment: ReturnSession | null;
  /** The unsettled difference this save replaces (its money is worked out again in this one) */
  supersedes?: ReturnSession | null;
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
  vehicles: Array<{ publicId: string; make: string; model: string; regNo: string }>;
  dl: { status: DlCollectionStatus | null; depositNote: string | null };
  photos: SummaryPhoto[];
  // An edit's difference still to collect / refund (absent on older servers)
  pendingAdjustment?: AdjustmentRecord | null;
  // Edits whose difference was settled
  adjustments?: AdjustmentRecord[];
}

export interface PickupSummary extends SummaryBase {
  phase: 'PICKUP';
  odometer: number | null;
  fuelLevel: string | null; // "1".."10"
  // ₹ on the FASTag at the handover — editable for any car, required when the car
  // is marked as having a FASTag (vehicleHasFastag; absent on older servers).
  // hasFastag: it counts as a FASTag car for the booking (marked, or a balance read).
  fastag: { hasFastag: boolean; vehicleHasFastag?: boolean; balance: string | null };
  safetyDeposit: string;
  captureFields: Array<{ name: string; required: boolean }>;
  // The settled pickup bill (payment-session branches); null otherwise.
  bill: { lines: SummaryBillLine[]; netPayable: string } | null;
  edit: {
    allowed: boolean;
    // Always false since the full edit (money changes are settled, not refused).
    odometerCheckedAgainstCharges: boolean;
    fastagCheckedAgainstCharges: boolean;
    // Corrected pickup readings re-price the completed drop (absent on older servers).
    readingsMoveDropCharges?: boolean;
    // The safety deposit can be changed (car out, nothing recorded at the drop).
    depositEditable?: boolean;
    depositLockedReason?: string | null;
    dlStatusEditable: boolean;
    dlStatusLockedReason: string | null;
  };
}

export interface ReturnSummaryDamage {
  publicId: string;
  area: string;
  severity: 'Minor' | 'Moderate' | 'Severe' | string;
  description: string;
  amount: string;
  chargeCustomer: boolean;
  billedAtDrop: boolean;
  editable: boolean; // false once the branch manager reviewed it
  photos: Array<{ fileId: string; url: string }>;
}

export interface ReturnSummary extends SummaryBase {
  phase: 'RETURN';
  odometer: {
    pickup: number | null;
    start: number | null; // start of the car handed back (after a swap)
    end: number | null;
    kmDriven: number | null;
    freeKm: number | null;
    extraKm: number | null;
    swapCount: number;
    measured: boolean; // false: a swap without readings
  };
  fuel: { pickup: string | null; return: string | null };
  // FASTag of the car handed back — shown / editable (and required) when hasFastag:
  // it counts as a FASTag car for the booking (marked, or a balance read at pickup / swap).
  fastag: {
    hasFastag: boolean;
    vehicleHasFastag?: boolean;
    startBalance: string | null; // when the customer got the car
    balance: string | null; // at the drop
    usage: string | null; // worked out from the readings; null = typed charge
  };
  damages: ReturnSummaryDamage[];
  bill: {
    settledBy: 'DROP_BILL' | 'BRANCH_MANAGER';
    lines: SummaryBillLine[];
    netPayable: string;
  } | null;
  // What the drop recorded, to prefill Edit Return (absent on older servers)
  editState?: {
    flow: 'DROP_BILL' | 'LEGACY';
    inputs: DropEditInputs;
    billedLines: Array<{ entryType: string; referenceType: string | null; referenceId: string | null; label: string; amount: string }>;
    damages: Array<{ publicId: string; label: string; amount: string; editable: boolean }>;
  } | null;
  edit: { allowed: boolean; fuelEditable: boolean };
}

// The drop's bill inputs as recorded / last edited (2-dp strings for money).
export interface DropEditInputs {
  endOdometer: number | null;
  manualExtraKm: number | null;
  returnFuelLevel: string | null;
  returnFastagBalance: string | null;
  fuelCharge: string;
  fastagAmount: string;
  fastagNotes: string | null;
  otherCharges: Array<{ label: string; amount: string }>;
  discount: { amount: string; reason: string } | null;
  applyGrace: boolean;
  waiveReason: string | null;
  depositHandling: SafetyDepositHandling;
  damageAmounts: Record<string, string>;
}

export interface EditPickupBody {
  odo?: number;
  pickupFuelLevel?: string;
  pickupFastagBalance?: number;
  // New safety deposit total (car still out)
  safetyDeposit?: number;
  // The difference the review showed — 409 EDIT_DELTA_CHANGED when it moved
  expectedDelta?: number;
  dlStatus?: DlCollectionStatus;
  drivingLicenceNumber?: string;
  addPhotos?: Array<{ fileId: string; label?: string | null }>;
  removeFileIds?: string[];
}

export interface EditReturnBody {
  endOdometer?: number;
  returnFuelLevel?: string;
  returnFastagBalance?: number;
  addPhotos?: Array<{ fileId: string }>;
  removeFileIds?: string[];
  damages?: Array<{
    publicId: string;
    area?: string;
    description?: string;
    severity?: 'Minor' | 'Moderate' | 'Severe';
    addPhotoIds?: string[];
    removeFileIds?: string[];
    amount?: number;
  }>;
  // Drop bill inputs (absent = as recorded)
  manualExtraKm?: number | null;
  fuelCharge?: number;
  fastagAmount?: number;
  fastagNotes?: string | null;
  otherCharges?: Array<{ label: string; amount: number }>;
  discount?: { amount: number; reason: string } | null;
  applyGrace?: boolean;
  waiveLateCharge?: { reason: string } | null;
  safetyDepositHandling?: SafetyDepositHandling;
  expectedDelta?: number;
}

export interface EditOperationResponse<T> {
  message: string;
  changed: string[];
  data: T;
  // The money difference and the session that settles it (absent on older servers)
  adjustment?: (AdjustmentPlan & { session: ReturnSession | null }) | null;
}

// 409 when a reading would move money already computed or settled.
export const EDIT_CHANGES_CHARGES = 'EDIT_CHANGES_CHARGES';

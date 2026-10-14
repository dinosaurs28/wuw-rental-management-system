// Completed pickups / returns (client item 1): the read-only summary of
// GET /api/employee/{pickup|return}/:bookingId/summary and the Edit Pickup /
// Edit Return bodies (PATCH /api/employee/{pickup|return}/:bookingId).
import type { DlCollectionStatus } from '../lib/dlStatus';
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
}

export interface PickupSummary extends SummaryBase {
  phase: 'PICKUP';
  odometer: number | null;
  fuelLevel: string | null; // "1".."10"
  // ₹ on the FASTag at the handover — shown / editable only when hasFastag.
  fastag: { hasFastag: boolean; balance: string | null };
  safetyDeposit: string;
  captureFields: Array<{ name: string; required: boolean }>;
  // The settled pickup bill (payment-session branches); null otherwise.
  bill: { lines: SummaryBillLine[]; netPayable: string } | null;
  edit: {
    allowed: boolean;
    // A drop already measured km from the pickup reading.
    odometerCheckedAgainstCharges: boolean;
    // The return is done: a FASTag balance that moves the FASTag charge is refused.
    fastagCheckedAgainstCharges: boolean;
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
  // FASTag of the car handed back — shown / editable only when hasFastag.
  fastag: {
    hasFastag: boolean;
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
  edit: { allowed: boolean; fuelEditable: boolean };
}

export interface EditPickupBody {
  odo?: number;
  pickupFuelLevel?: string;
  pickupFastagBalance?: number;
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
  }>;
}

export interface EditOperationResponse<T> {
  message: string;
  changed: string[];
  data: T;
}

// 409 when a reading would move money already computed or settled.
export const EDIT_CHANGES_CHARGES = 'EDIT_CHANGES_CHARGES';

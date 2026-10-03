// Cash shift shapes (#22). Every money figure is a 2-dp string ("1850.00",
// "-50.50"); Number() it before maths and compare in paise.
//
//   Expected in drawer = opening cash + cash collected − cash refunded
//   Variance           = closing (counted) cash − expected   (negative = short)
//
// UPI (UTR) money is linked to the shift but never sits in the drawer.

export type ShiftStatus = 'OPEN' | 'CLOSED' | 'DISCREPANCY_FLAGGED';

// ENDED = CLOSED + DISCREPANCY_FLAGGED.
export type ShiftStatusFilter = 'OPEN' | 'CLOSED' | 'DISCREPANCY_FLAGGED' | 'ENDED';

export interface ShiftView {
  publicId: string;
  // A reconciled shift is CLOSED with reconciledAt set.
  status: ShiftStatus;
  isOpen: boolean;
  // IST date (YYYY-MM-DD) the shift opened on — the day it counts towards.
  istDate: string;
  openedAt: string;
  closedAt: string | null;
  employeePublicId: string;
  employeeName: string;
  // The branch the shift ran in (an executive may have moved branches).
  branchName: string | null;
  openingCash: string;
  // Live while OPEN, the close-time snapshot afterwards.
  cashCollected: string;
  cashRefunded: string;
  expectedClosing: string;
  // null while OPEN.
  closingCash: string | null;
  variance: string | null;
  // Current split of the cash by manager review, also for closed shifts.
  pendingCash: string;
  confirmedCash: string;
  rejectedCash: string;
  upiCollected: string;
  transactionCount: number;
  // The executive's close note; after a reconcile it holds the manager's note.
  discrepancyExplanation: string | null;
  reconciledByName: string | null;
  reconciledAt: string | null;
  // Closed under the old rule (variance vs manager-confirmed cash): the stored
  // expected does not equal opening + collected − refunded.
  legacyVariance: boolean;
}

export type ShiftTransactionPurpose =
  | 'ADVANCE'
  | 'REMAINING_BALANCE'
  | 'FULL_PAYMENT'
  | 'EXTENSION'
  | 'DAMAGE_FEE'
  | 'SAFETY_DEPOSIT'
  | 'OVERPAYMENT_REFUND'
  | 'CANCELLATION_REFUND';

export type ShiftTransactionStatus = 'INITIATED' | 'COLLECTED' | 'CONFIRMED' | 'REJECTED' | 'FAILED' | 'REFUNDED';

export interface ShiftTransaction {
  publicId: string;
  bookingPublicId: string;
  customerName: string | null;
  purpose: ShiftTransactionPurpose;
  method: 'CASH' | 'ONLINE' | 'SPLIT';
  // The CURRENT status — it can change after the shift closed.
  status: ShiftTransactionStatus;
  // OUT = refund paid from the drawer.
  direction: 'IN' | 'OUT';
  totalAmount: string;
  cashAmount: string;
  onlineAmount: string;
  onlineGateway: string | null;
  // The UTR for counter UPI payments (older builds; new ones attach a photo).
  onlineTransactionRef: string | null;
  // Photo of the customer's UPI payment screen (#3) — a 15-minute presigned URL;
  // refetch the shift for a fresh one. Absent on older servers.
  proofPhoto?: { proofFileId: string; publicId: string; url: string; capturedAt: string; expiresIn: number } | null;
  proofPhotoUrl?: string | null;
  collectedAt: string | null;
  confirmedAt: string | null;
  rejectedAt: string | null;
  createdAt: string | null;
  collectedByName: string | null;
  confirmedByName: string | null;
  rejectedByName: string | null;
  rejectionReason: string | null;
  notes: string | null;
  // Recorded after the close snapshot, so not in the shift's figures.
  linkedAfterClose: boolean;
}

export interface ShiftDetail extends ShiftView {
  transactions: ShiftTransaction[];
}

export interface ShiftDayTotals {
  shiftCount: number;
  openCount: number;
  closedCount: number;
  flaggedCount: number;
  openingCash: string;
  cashCollected: string;
  cashRefunded: string;
  expectedClosing: string;
  // Closed shifts only.
  closingCash: string;
  // Leaves out legacy (old-rule) closes; legacyCount says how many.
  variance: string;
  pendingCash: string;
  upiCollected: string;
  legacyCount?: number;
}

// GET /api/employee/payment/shifts/me
export interface MyShiftsResponse {
  shifts: ShiftView[];
  total: number;
  page: number;
  pageSize: number;
  // Per IST day, newest first, over the whole filter (not just this page).
  dailyTotals: Array<ShiftDayTotals & { date: string }>;
  summary: ShiftDayTotals;
  openNowCount: number;
  filters: { status: string | null; from: string | null; to: string | null; openNow: boolean };
}

export interface MyShiftsParams {
  page?: number;
  pageSize?: number;
  status?: ShiftStatusFilter;
  // A single IST day; overrides from/to.
  date?: string;
  from?: string;
  to?: string;
  // Only the shift open right now, whatever the dates and status.
  openNow?: boolean;
}

// GET /api/employee/payment/shifts/me/active. The ShiftView fields are absent
// on servers older than #22, which only sent expectedTotal / pendingTotal.
export type ActiveShift = Pick<ShiftView, 'publicId' | 'status' | 'openedAt'> &
  Partial<Omit<ShiftView, 'publicId' | 'status' | 'openedAt'>> & {
    // Legacy keys: expectedTotal now equals expectedClosing, pendingTotal pendingCash.
    expectedTotal?: string | number | null;
    pendingTotal?: string | number | null;
  };

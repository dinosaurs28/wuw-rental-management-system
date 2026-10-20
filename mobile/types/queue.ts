// Fleet queue (Pickups / Returns / Overdue) response shapes — #17 Daily vs
// Monthly tabs and #8 overdue / no-show returns.
import type { RentalPeriodType } from './api';
import type { DlCollectionStatus } from '../lib/dlStatus';
import type { OperationDraftSummary } from '../lib/operationDraft';
import type { CompletionInfo } from './completedOperation';

// Monthly = rentalPeriodType MONTHLY; everything else (NULL included) is Daily.
export type BookingListType = 'DAILY' | 'MONTHLY';

// Rows of GET /api/employee/booking (pickups) and GET /api/employee/return.
export interface QueueBooking {
  publicId: string;
  startAt: string;
  endAt: string;
  status: string;
  totalFinal: string | number; // Decimal string
  // Absent on servers older than #17.
  rentalPeriodType?: RentalPeriodType | null;
  days?: number;
  bookingType?: BookingListType;
  // Original driving licence status (#3); null = not recorded. Absent on older servers.
  dlStatus?: DlCollectionStatus | null;
  dlDepositNote?: string | null;
  customer: { user: { name: string; phone: string | null } };
  items: Array<{ vehicle: { make: string; model: string; regNo: string } }>;
  // A pickup / drop paused half-way (client item 2); absent on older servers.
  draft?: OperationDraftSummary | null;
  // Rows of `completed` only (client item 1): who completed it and when, and
  // whether it waits on the branch manager's confirmation.
  completed?: CompletionInfo;
  awaitingManager?: boolean;
  returnedAt?: string | null;
}

// counts.daily follows the request's date; counts.monthly has no date.
export interface QueueCounts {
  daily: number;
  monthly: number;
}

export interface QueueListResponse {
  message?: string;
  data?: QueueBooking[];
  type?: BookingListType | null;
  counts?: QueueCounts;
  // includeCompleted=1 only (client item 1): the day's done pickups / returns,
  // in the order they were done. Absent on older servers.
  completed?: QueueBooking[];
}

// GET /api/employee/dashboard/overdue-returns — PICKED_UP bookings past endAt.
// AWAITING_MANAGER_CONFIRMATION and RETURN_IN_PROGRESS mean the vehicle is
// back and only the paperwork is open; they are left out of overdueCount.
export type ReturnState =
  | 'OVERDUE'
  | 'IN_GRACE'
  | 'AWAITING_MANAGER_CONFIRMATION'
  | 'RETURN_IN_PROGRESS';

export interface OverdueReturn {
  publicId: string;
  bookingType: BookingListType;
  rentalPeriodType: RentalPeriodType | null;
  days: number;
  startAt: string;
  endAt: string; // expected return (after any extension)
  originalEndAt: string | null; // set once extended
  endAtDisplay: string; // endAt in IST, formatted by the server
  overdueMinutes: number; // at serverNow
  returnState: ReturnState;
  graceMinutes: number | null; // AUTOMATIC grace only; null = none (off, or MANUAL — applied at the drop)
  graceEndsAt: string | null;
  dlStatus?: DlCollectionStatus | null; // licence held at pickup (#3); absent on older servers
  dlDepositNote?: string | null; // DEPOSIT only
  extensionCount: number;
  extensionPending: boolean;
  pendingExtension: {
    publicId: string;
    status: 'PENDING_PAYMENT' | 'PAYMENT_COLLECTED';
    requestedEndAt: string;
  } | null;
  customer: {
    publicId: string | null;
    name: string | null;
    phone: string | null;
    alternatePhone: string | null;
    drivingLicenceNumber?: string | null; // full DL number on file; absent on older servers
  };
  vehicles: Array<{
    publicId: string;
    make: string;
    model: string;
    regNo: string;
    imageUrl: string | null;
  }>;
  // A drop paused half-way (client item 2); absent on older servers.
  draft?: OperationDraftSummary | null;
}

export interface OverdueReturnsResponse {
  success: boolean;
  message: string;
  data: OverdueReturn[];
  overdueCount: number; // OVERDUE + IN_GRACE — the "N overdue" badge
  counts: {
    OVERDUE: number;
    IN_GRACE: number;
    AWAITING_MANAGER_CONFIRMATION: number;
    RETURN_IN_PROGRESS: number;
    total: number;
  };
  serverNow: string;
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

// ── Search-bar filters of the Pickup / Return queues (Oct 20 2026) ──────────
// Different filters combine with AND, values of one filter with OR. Servers
// older than this ignore the params.
export type QueueWhen = 'today' | 'tomorrow' | 'overdue';
export type QueuePayment = 'balance_due' | 'paid';

// Query params sent with listPickups / listReturns (all optional).
export interface QueueFilterParams {
  typeClass?: string[];
  category?: string[]; // VehicleCategory publicIds
  groupKey?: string[]; // "MAKE__MODEL"
  tripType?: string[];
  when?: QueueWhen[];
  from?: string; // YYYY-MM-DD, IST day, inclusive
  to?: string;
  payment?: QueuePayment[];
}

export interface QueueFilterOption {
  value: string;
  label: string;
  count?: number; // vehicles of the branch with it
}

// GET /api/employee/queue-filters?phase=PICKUP|RETURN → { data }
export interface QueueFilterOptions {
  typeClasses: QueueFilterOption[];
  categories: Array<QueueFilterOption & { typeClass: string }>;
  groups: Array<QueueFilterOption & { make: string; model: string }>;
  tripTypes: QueueFilterOption[];
  when: Array<{ value: QueueWhen; label: string }>;
  payment: Array<{ value: QueuePayment; label: string }>;
}

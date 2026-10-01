// Mirror of packages/schemas/src/dl-status.ts — mobile is outside the pnpm
// workspace, so keep the two files in sync.

/**
 * Original driving licence custody (#3). Chosen at pickup, editable afterwards
 * by Fleet while the booking is CONFIRMED / PICKED_UP.
 *   COLLECTED     — the branch holds the original licence
 *   NOT_COLLECTED — the customer kept it (a valid choice; the pickup goes ahead)
 *   DEPOSIT       — the customer left something else instead (dlDepositNote says what)
 * null on a booking = not recorded (picked up before this release, or by an old
 * app build). Show it as "Not recorded", never as "Not collected".
 */
export const DL_COLLECTION_STATUSES = ['COLLECTED', 'NOT_COLLECTED', 'DEPOSIT'] as const;
export type DlCollectionStatus = (typeof DL_COLLECTION_STATUSES)[number];

export const DL_STATUS_LABELS: Record<DlCollectionStatus, string> = {
  COLLECTED: 'DL collected',
  NOT_COLLECTED: 'DL not collected',
  DEPOSIT: 'DL deposit',
};

export const DL_NOT_RECORDED_LABEL = 'Not recorded';

export const DL_DEPOSIT_NOTE_MAX = 200;

export const DL_STATUS_INVALID_MESSAGE =
  'Choose the driving licence status: Collected, Not collected or Deposit.';
export const DL_DEPOSIT_NOTE_REQUIRED_MESSAGE =
  'Note what the customer left as the DL deposit (e.g. Aadhaar card kept, ₹2,000 cash).';
export const DL_DEPOSIT_NOTE_TOO_LONG_MESSAGE =
  `Keep the DL deposit note to ${DL_DEPOSIT_NOTE_MAX} characters or fewer.`;

/** Booking statuses Fleet may change the DL status in (else 409 DL_STATUS_LOCKED). */
export const DL_EDITABLE_BOOKING_STATUSES = ['CONFIRMED', 'PICKED_UP'] as const;

/** The DL fields the booking details / queue rows carry. Absent on older servers. */
export interface DlStatusFields {
  dlStatus?: DlCollectionStatus | null;
  dlDepositNote?: string | null;
  dlStatusUpdatedAt?: string | null;
}

/** PATCH /api/employee/bookings/:publicId/dl-status body. */
export interface UpdateDlStatusBody {
  dlStatus: DlCollectionStatus;
  dlDepositNote?: string | null;
}

/** PATCH /api/employee/bookings/:publicId/dl-status 200 `data`. */
export interface UpdateDlStatusResult {
  publicId: string;
  status: string;
  dlStatus: DlCollectionStatus | null;
  dlDepositNote: string | null;
  dlStatusUpdatedAt: string | null;
  dlStatusUpdatedBy: { publicId: string; name: string; role: string } | null;
  licenseCollectedAt: string | null;
  changed: boolean;
}

/** 4xx codes the pickup and DL-status endpoints return for the DL fields. */
export const DL_ERROR_CODES = [
  'INVALID_DL_STATUS',
  'DL_DEPOSIT_NOTE_REQUIRED',
  'DL_DEPOSIT_NOTE_TOO_LONG',
  'LICENSE_NOT_COLLECTED',
] as const;

export function isDlErrorCode(code: unknown): boolean {
  return typeof code === 'string' && (DL_ERROR_CODES as readonly string[]).includes(code);
}

export function dlStatusLabel(status: DlCollectionStatus | null | undefined): string {
  return status ? DL_STATUS_LABELS[status] : DL_NOT_RECORDED_LABEL;
}

/** True when the status needs a deposit note. */
export function dlStatusNeedsNote(status: DlCollectionStatus | null | undefined): boolean {
  return status === 'DEPOSIT';
}

export function canEditDlStatus(bookingStatus: string | null | undefined): boolean {
  return !!bookingStatus && (DL_EDITABLE_BOOKING_STATUSES as readonly string[]).includes(bookingStatus);
}

/**
 * What still blocks a DL choice, or null when it can be sent. Mirrors the
 * server rules: a status is required and DEPOSIT needs a non-blank note.
 */
export function dlChoiceProblem(status: DlCollectionStatus | null, note: string): string | null {
  if (!status) return DL_STATUS_INVALID_MESSAGE;
  if (dlStatusNeedsNote(status)) {
    const trimmed = note.trim();
    if (!trimmed) return DL_DEPOSIT_NOTE_REQUIRED_MESSAGE;
    if (trimmed.length > DL_DEPOSIT_NOTE_MAX) return DL_DEPOSIT_NOTE_TOO_LONG_MESSAGE;
  }
  return null;
}

/** Request fields for a pickup / update: the note only goes with DEPOSIT. */
export function dlChoiceBody(status: DlCollectionStatus, note: string): UpdateDlStatusBody {
  return dlStatusNeedsNote(status) ? { dlStatus: status, dlDepositNote: note.trim() } : { dlStatus: status };
}

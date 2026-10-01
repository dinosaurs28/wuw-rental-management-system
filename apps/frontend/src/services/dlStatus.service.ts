import apiClient from "@/lib/axios";
import type { DlCollectionStatusValue } from "@repo/schemas";

/** Original driving licence custody (#3). null = not recorded (old pickups / old app builds). */
export type DlStatus = DlCollectionStatusValue | null;

/** Who may change it: Fleet (CONFIRMED / PICKED_UP only) or the Branch Manager (any status). */
export type DlStatusRole = "employee" | "manager";

/** Fleet may only change the DL status while the booking is in one of these statuses. */
export const STAFF_DL_EDITABLE_STATUSES = ["CONFIRMED", "PICKED_UP"] as const;

export function canStaffEditDlStatus(bookingStatus: string | null | undefined): boolean {
  return (STAFF_DL_EDITABLE_STATUSES as readonly string[]).includes(bookingStatus ?? "");
}

export interface UpdateDlStatusBody {
  dlStatus: DlCollectionStatusValue;
  /** Required for DEPOSIT (≤ 200 chars); the server clears it for the other statuses. */
  dlDepositNote?: string | null;
}

export interface DlStatusUpdateResult {
  publicId: string;
  /** Booking status. */
  status: string;
  dlStatus: DlStatus;
  dlDepositNote: string | null;
  dlStatusUpdatedAt: string | null;
  dlStatusUpdatedBy: { publicId: string; name: string; role: string } | null;
  licenseCollectedAt: string | null;
  /** false when the same status and note were sent again (nothing written). */
  changed: boolean;
}

interface DlStatusUpdateResponse {
  success: true;
  message: string;
  data: DlStatusUpdateResult;
}

const DL_STATUS_PATH: Record<DlStatusRole, (publicId: string) => string> = {
  employee: (publicId) => `/employee/bookings/${publicId}/dl-status`,
  manager: (publicId) => `/branchManager/bookings/${publicId}/dl-status`,
};

export const dlStatusService = {
  /**
   * PATCH /employee/bookings/:publicId/dl-status (Fleet; 409 DL_STATUS_LOCKED
   * unless CONFIRMED / PICKED_UP) or PATCH /branchManager/bookings/:publicId/dl-status
   * (BM; any status). Errors: INVALID_DL_STATUS, DL_DEPOSIT_NOTE_REQUIRED,
   * DL_DEPOSIT_NOTE_TOO_LONG, BOOKING_NOT_FOUND.
   */
  update: async (
    role: DlStatusRole,
    publicId: string,
    body: UpdateDlStatusBody,
  ): Promise<DlStatusUpdateResponse> => {
    const response = await apiClient.patch<DlStatusUpdateResponse>(
      DL_STATUS_PATH[role](publicId),
      body,
    );
    return response.data;
  },
};

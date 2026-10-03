import {
  DL_STATUS_DEPOSIT_REMOVED_MESSAGE,
  DL_STATUS_INVALID_MESSAGE,
  DL_STATUS_LABELS,
  isDlStatusSelectable,
  type DlCollectionStatusValue,
} from "@repo/schemas";
import type { DlStatus, UpdateDlStatusBody } from "@/services/dlStatus.service";

// Rules shared by the pickup selector and the DL status edit dialog (#3).
// DL Deposit was removed (Oct 2026): only COLLECTED / NOT_COLLECTED can be chosen;
// an old DEPOSIT row must be re-picked before it can be saved.

/** Why the choice can't be sent yet, or null when it is complete. */
export function dlChoiceError(status: DlStatus): string | null {
  if (!status) return DL_STATUS_INVALID_MESSAGE;
  if (!isDlStatusSelectable(status)) return DL_STATUS_DEPOSIT_REMOVED_MESSAGE;
  return null;
}

/**
 * Pickup variant (X1): the DL status is optional at handover — leaving it unset
 * is fine (recorded later from the booking).
 */
export function pickupDlChoiceError(status: DlStatus): string | null {
  return status ? dlChoiceError(status) : null;
}

/** Request fields for a complete choice. */
export function dlChoicePayload(status: DlCollectionStatusValue): UpdateDlStatusBody {
  return { dlStatus: status };
}

/** null (old pickups / old app builds) is "Not recorded" — never "Not collected". */
export function dlStatusLabel(status: DlStatus | undefined): string {
  return status ? DL_STATUS_LABELS[status] : "Not recorded";
}

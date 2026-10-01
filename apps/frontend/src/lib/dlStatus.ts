import {
  DL_DEPOSIT_NOTE_MAX,
  DL_DEPOSIT_NOTE_REQUIRED_MESSAGE,
  DL_DEPOSIT_NOTE_TOO_LONG_MESSAGE,
  DL_STATUS_INVALID_MESSAGE,
  DL_STATUS_LABELS,
  dlStatusNeedsNote,
  type DlCollectionStatusValue,
} from "@repo/schemas";
import type { DlStatus, UpdateDlStatusBody } from "@/services/dlStatus.service";

// Rules shared by the pickup selector and the DL status edit dialog (#3).

/** Why the choice can't be sent yet, or null when it is complete. */
export function dlChoiceError(status: DlStatus, note: string): string | null {
  if (!status) return DL_STATUS_INVALID_MESSAGE;
  if (dlStatusNeedsNote(status)) {
    const trimmed = note.trim();
    if (!trimmed) return DL_DEPOSIT_NOTE_REQUIRED_MESSAGE;
    if (trimmed.length > DL_DEPOSIT_NOTE_MAX) return DL_DEPOSIT_NOTE_TOO_LONG_MESSAGE;
  }
  return null;
}

/** Request fields for a complete choice; the note is sent for DEPOSIT only. */
export function dlChoicePayload(status: DlCollectionStatusValue, note: string): UpdateDlStatusBody {
  return dlStatusNeedsNote(status)
    ? { dlStatus: status, dlDepositNote: note.trim() }
    : { dlStatus: status };
}

/** null (old pickups / old app builds) is "Not recorded" — never "Not collected". */
export function dlStatusLabel(status: DlStatus | undefined): string {
  return status ? DL_STATUS_LABELS[status] : "Not recorded";
}

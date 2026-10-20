/**
 * Optional note the Fleet Executive writes at the pickup and at the drop
 * (client, Oct 20 2026: "During Pickup and Drop add an optional Note section…
 * viewed during drop, by branch manager when they check a vehicle's rent
 * history"). Pure rules — no database (services/booking/operation-notes.service.ts
 * stores and reads them).
 *
 * Request fields: `pickupNote` (pickup session initiate, legacy pickup, Edit
 * Pickup) and `dropNote` (drop bill compute, legacy drop, Edit Drop). Optional
 * everywhere: older app builds don't send them and nothing changes.
 */

/** Most characters a note may have (after trimming). */
export const OPERATION_NOTE_MAX = 1000;

export type OperationNoteKind = "PICKUP" | "DROP";

export type OperationNoteErrorCode = "OPERATION_NOTE_INVALID" | "OPERATION_NOTE_TOO_LONG";

/** A note that can't be saved — 400 with its code; `field` is the request field. */
export class OperationNoteError extends Error {
  readonly status = 400;
  constructor(
    public readonly code: OperationNoteErrorCode,
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "OperationNoteError";
  }

  toJSON() {
    return { success: false, code: this.code, field: this.field, message: this.message };
  }
}

/**
 * The note as sent: undefined = not sent (leave what is saved), null = no note
 * (an empty or blank text, or null, clears it), else the trimmed text. Throws
 * OperationNoteError for a non-text value or a note over OPERATION_NOTE_MAX.
 */
export function parseOperationNote(raw: unknown, field: string): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") {
    throw new OperationNoteError("OPERATION_NOTE_INVALID", field, "The note must be text.");
  }
  const text = raw.trim();
  if (text.length === 0) return null;
  if (text.length > OPERATION_NOTE_MAX) {
    throw new OperationNoteError(
      "OPERATION_NOTE_TOO_LONG",
      field,
      `Keep the note under ${OPERATION_NOTE_MAX} characters (it has ${text.length}).`,
    );
  }
  return text;
}

/** Whether saving `next` changes the saved note (undefined = not sent: no change). */
export function operationNoteChanges(current: string | null | undefined, next: string | null | undefined): boolean {
  if (next === undefined) return false;
  return (current ?? null) !== next;
}

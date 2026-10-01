import { z } from "zod";

/**
 * Original driving licence custody (#3). Chosen at pickup, editable afterwards
 * by Fleet (while CONFIRMED / PICKED_UP) and the Branch Manager (any time).
 * Mirrors the DlCollectionStatus DB enum.
 *   COLLECTED     — the branch holds the original licence
 *   NOT_COLLECTED — the customer kept it
 *   DEPOSIT       — the customer left something else instead (dlDepositNote says what)
 */
export const DL_COLLECTION_STATUSES = ["COLLECTED", "NOT_COLLECTED", "DEPOSIT"] as const;
export type DlCollectionStatusValue = (typeof DL_COLLECTION_STATUSES)[number];

export const DL_STATUS_LABELS: Record<DlCollectionStatusValue, string> = {
  COLLECTED: "DL collected",
  NOT_COLLECTED: "DL not collected",
  DEPOSIT: "DL deposit",
};

export const DL_DEPOSIT_NOTE_MAX = 200;

export const DL_STATUS_INVALID_MESSAGE =
  "Choose the driving licence status: Collected, Not collected or Deposit.";
export const DL_DEPOSIT_NOTE_REQUIRED_MESSAGE =
  "Note what the customer left as the DL deposit (e.g. Aadhaar card kept, ₹2,000 cash).";
export const DL_DEPOSIT_NOTE_TOO_LONG_MESSAGE =
  `Keep the DL deposit note to ${DL_DEPOSIT_NOTE_MAX} characters or fewer.`;

export const dlCollectionStatusSchema = z.enum(DL_COLLECTION_STATUSES, {
  errorMap: () => ({ message: DL_STATUS_INVALID_MESSAGE }),
});

export const dlDepositNoteSchema = z
  .string({ invalid_type_error: "The DL deposit note must be text." })
  .trim()
  .max(DL_DEPOSIT_NOTE_MAX, DL_DEPOSIT_NOTE_TOO_LONG_MESSAGE);

/** True when the status needs a deposit note. */
export function dlStatusNeedsNote(status: DlCollectionStatusValue | null | undefined): boolean {
  return status === "DEPOSIT";
}

/**
 * PATCH /employee/bookings/:publicId/dl-status and
 * PATCH /branchManager/bookings/:publicId/dl-status body.
 * dlDepositNote is required for DEPOSIT and ignored (cleared) otherwise.
 */
export const updateDlStatusSchema = z
  .object({
    dlStatus: dlCollectionStatusSchema,
    dlDepositNote: dlDepositNoteSchema.nullish(),
  })
  .superRefine((d, ctx) => {
    if (dlStatusNeedsNote(d.dlStatus) && !d.dlDepositNote) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dlDepositNote"],
        message: DL_DEPOSIT_NOTE_REQUIRED_MESSAGE,
      });
    }
  });

export type UpdateDlStatusInput = z.infer<typeof updateDlStatusSchema>;

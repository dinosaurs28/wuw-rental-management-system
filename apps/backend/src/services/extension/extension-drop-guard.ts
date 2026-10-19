/**
 * A rental whose drop is recorded and waiting for the branch manager
 * (PICKED_UP + requiresManagerConfirmation + returnedAt: isDropRecorded) no
 * longer holds its car: availability releases it to other customers. It must
 * not be extended, or the extension could overlap a new booking. Refused at
 * eligibility, evaluate and commit (re-checked under the booking row lock),
 * for staff and customers, with the swap service's MANAGER_CONFIRMATION_PENDING
 * code (409).
 */
import { isDropRecorded } from "../../utils/availability/vehicleEligibility.js";

export const MANAGER_CONFIRMATION_PENDING = "MANAGER_CONFIRMATION_PENDING" as const;
export const DROP_RECORDED_EXTENSION_MESSAGE =
  "The drop is recorded and waiting for the branch manager's confirmation — it can't be extended.";

export class ExtensionDropRecordedError extends Error {
  readonly code = MANAGER_CONFIRMATION_PENDING;
  readonly status = 409;

  constructor() {
    super(DROP_RECORDED_EXTENSION_MESSAGE);
    this.name = "ExtensionDropRecordedError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message };
  }
}

/** Throws ExtensionDropRecordedError when the booking's drop is recorded (isDropRecorded). */
export function assertExtendableDrop(booking: {
  status: string;
  requiresManagerConfirmation?: boolean | null;
  returnedAt?: Date | null;
}): void {
  if (isDropRecorded(booking)) throw new ExtensionDropRecordedError();
}

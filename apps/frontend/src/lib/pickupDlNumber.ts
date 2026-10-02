import {
  DL_INVALID_MESSAGE,
  DL_REQUIRED_MESSAGE,
  isValidDrivingLicence,
  normalizeDrivingLicence,
} from "@repo/schemas";

/**
 * Driving licence NUMBER at pickup (X2). The DL / KYC picture is optional; the
 * handover needs the customer's DL number — on file, or typed by staff and sent
 * as `drivingLicenceNumber` (the server saves it to the customer).
 * See apps/backend/src/services/booking/pickup-dl-number.service.ts.
 */

/** 422 — no DL number on file and none sent. */
export const DL_NUMBER_REQUIRED = "DL_NUMBER_REQUIRED";
/** 400 — the number sent isn't a valid DL number. */
export const INVALID_DL_NUMBER = "INVALID_DL_NUMBER";

type ApiErrorLike = { response?: { data?: { code?: unknown } } };

/** The pickup was refused over the DL number (show the message at the input). */
export function isPickupDlNumberError(err: unknown): boolean {
  const code = (err as ApiErrorLike | undefined)?.response?.data?.code;
  return code === DL_NUMBER_REQUIRED || code === INVALID_DL_NUMBER;
}

/** "KA0120110012345" → "KA01 20110012345" (state + RTO, then the rest), for reading off the card. */
export function formatDlNumber(value: string): string {
  const n = normalizeDrivingLicence(value);
  return n.length > 4 ? `${n.slice(0, 4)} ${n.slice(4)}` : n;
}

export interface PickupDlNumberState {
  /** Show the input: nothing on file, or staff chose to correct the stored number. */
  inputShown: boolean;
  /** Why the handover can't go ahead yet, or null. */
  problem: string | null;
  /** Normalised number to send, or undefined (keep the stored one). */
  toSend: string | undefined;
}

/**
 * @param onFile  the customer's stored number (pickup details), null = none
 * @param input   what staff typed
 * @param editing staff opened the input to correct a stored number
 */
export function pickupDlNumberState(
  onFile: string | null | undefined,
  input: string,
  editing: boolean,
): PickupDlNumberState {
  const stored = onFile?.trim() || null;
  const inputShown = !stored || editing;
  if (!inputShown) return { inputShown, problem: null, toSend: undefined };

  const typed = normalizeDrivingLicence(input);
  if (!typed) {
    // Blank while correcting = keep the stored number
    return { inputShown, problem: stored ? null : DL_REQUIRED_MESSAGE, toSend: undefined };
  }
  if (!isValidDrivingLicence(typed)) {
    return { inputShown, problem: DL_INVALID_MESSAGE, toSend: undefined };
  }
  return { inputShown, problem: null, toSend: typed === stored ? undefined : typed };
}

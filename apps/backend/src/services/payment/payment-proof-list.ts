/**
 * Which payment-screen photos a counter UPI payment request names (Oct 2026):
 * new clients send `proof_file_ids` (1–3, in slot order — the customer may
 * have paid in several UPI transactions), older builds send one
 * `proof_file_id`. Pure — no database — so it is unit tested on its own;
 * payment-proof.service.ts checks each id against the branch's uploads.
 */
import { PAYMENT_PROOF_MAX_PHOTOS } from "@repo/schemas";

export { PAYMENT_PROOF_MAX_PHOTOS };

export type ProofIdListResult =
  | { ok: true; ids: string[] }
  /** `position` (1-based) = the photo the problem is about, when it is one photo. */
  | { ok: false; message: string; position?: number };

const isBlank = (v: unknown) => v === undefined || v === null || v === "";

/**
 * The ordered photo ids a request names: `proof_file_ids` when given, else the
 * legacy single `proof_file_id`, else none (the caller decides whether a photo
 * is required). When both are sent the single id must be the first photo.
 */
export function normalizeProofIdList(single: unknown, list: unknown): ProofIdListResult {
  let first: string | null = null;
  if (!isBlank(single)) {
    if (typeof single !== "string" || single.trim().length === 0) {
      return { ok: false, message: "proof_file_id must be the id of the uploaded payment photo.", position: 1 };
    }
    first = single.trim();
  }

  if (isBlank(list)) return { ok: true, ids: first ? [first] : [] };
  if (!Array.isArray(list)) {
    return { ok: false, message: "proof_file_ids must be a list of uploaded payment photo ids." };
  }
  if (list.length === 0) return { ok: true, ids: first ? [first] : [] };
  if (list.length > PAYMENT_PROOF_MAX_PHOTOS) {
    return {
      ok: false,
      message: `Attach at most ${PAYMENT_PROOF_MAX_PHOTOS} payment photos to one payment.`,
    };
  }

  const ids: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return { ok: false, message: `Payment photo ${i + 1} is missing — take it again or remove it.`, position: i + 1 };
    }
    const id = raw.trim();
    if (ids.includes(id)) {
      return { ok: false, message: `Payment photo ${i + 1} is the same photo as an earlier one.`, position: i + 1 };
    }
    ids.push(id);
  }

  if (first && first !== ids[0]) {
    return { ok: false, message: "proof_file_id must be the first of proof_file_ids.", position: 1 };
  }
  return { ok: true, ids };
}

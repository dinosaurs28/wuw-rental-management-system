/**
 * Refund payment-success photo (Oct 25 2026, client: "Cancel rent refund, or
 * normal refund made needs photo upload of payment success of refund").
 * Pure — no database — so it is unit-tested (refund-proof-rules.test.ts).
 *
 * Which refunds need the photo of the transfer's success screen:
 *   UPI / BANK_TRANSFER paid out now by the branch   REQUIRED
 *   CASH                                             optional (no success screen
 *                                                    to photograph; the drawer /
 *                                                    the manager's acknowledgement
 *                                                    backs it)
 *   ORIGINAL_PAYMENT / Razorpay (completed later     exempt (the gateway's refund
 *   with the gateway refund id)                      id backs it)
 *
 * Applies to: the BM's manual Cancel Rent refund, "Refund to customer" (BM,
 * admin, Fleet), refund request mark-paid, and the Fleet Executive's refunds at
 * the drop (drop bill record-refund / deposit refund, legacy drop refund).
 *
 * NOT applied inside the BM's Pending Settlements (client request (a): "the
 * branch manager will check the transactions and then settle the pending
 * settlement. So remove photo upload there") — its settle, deposit refund and
 * over-payment refund accept a photo from older clients but never require one.
 *
 * Old app builds that send a UPI refund without a photo get 400
 * REFUND_PROOF_REQUIRED with REFUND_PROOF_REQUIRED_MESSAGE.
 */
import { REFUND_PROOF_REQUIRED_MESSAGE as SHARED_REFUND_PROOF_REQUIRED_MESSAGE } from "@repo/schemas";
import { StatusCode } from "../../types/statusCode.js";

export const REFUND_PROOF_REQUIRED_CODE = "REFUND_PROOF_REQUIRED" as const;

export const REFUND_PROOF_REQUIRED_MESSAGE = SHARED_REFUND_PROOF_REQUIRED_MESSAGE;

/**
 * Whether a refund paid by `method` needs the payment-success photo.
 * Accepts every method name the refund endpoints use: CASH, UPI, BANK_TRANSFER,
 * ONLINE (a counter refund paid back by UPI / transfer), ORIGINAL_PAYMENT.
 * `gateway` (optional) — the stored onlineGateway: RAZORPAY means a gateway refund.
 */
export function refundNeedsProof(method: string | null | undefined, gateway?: string | null): boolean {
  const m = (method ?? "").trim().toUpperCase();
  const g = (gateway ?? "").trim().toUpperCase();
  if (g === "RAZORPAY") return false;
  return m === "UPI" || m === "BANK_TRANSFER" || m === "ONLINE";
}

export interface RefundProofRefusal {
  status: StatusCode;
  code: typeof REFUND_PROOF_REQUIRED_CODE;
  message: string;
  field: string;
}

/** The 400 to send when a transfer refund comes without its photo, or null. */
export function refundProofRefusal(
  method: string | null | undefined,
  hasProof: boolean,
  opts: { gateway?: string | null; field?: string } = {},
): RefundProofRefusal | null {
  if (hasProof || !refundNeedsProof(method, opts.gateway)) return null;
  return {
    status: StatusCode.BAD_REQUEST,
    code: REFUND_PROOF_REQUIRED_CODE,
    message: REFUND_PROOF_REQUIRED_MESSAGE,
    field: opts.field ?? "proofFileId",
  };
}

/** A Razorpay refund id ("rfnd_…") — a gateway refund completed with it needs no photo. */
export function isGatewayRefundRef(ref: string | null | undefined): boolean {
  return /^rfnd_/i.test((ref ?? "").trim());
}

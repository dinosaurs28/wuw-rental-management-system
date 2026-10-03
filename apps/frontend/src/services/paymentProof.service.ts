import apiClient from "@/lib/axios";

/**
 * UPI payment-proof photos (Oct 2026 TODO #3): a photo of the customer's
 * payment-success screen, taken when they pay the branch's merchant UPI QR at
 * the counter. It replaces typing the UTR. Upload it first, then send its
 * `proofFileId` as `proof_file_id` with the payment.
 *
 * The photo is stored privately; `url` is a presigned link that lasts
 * `expiresIn` seconds (15 minutes). GET returns a fresh one.
 */
export interface PaymentProofView {
  /** Send this as `proof_file_id`. */
  proofFileId: string;
  publicId: string;
  url: string;
  mime: string;
  size: number;
  capturedAt: string;
  expiresIn: number;
}

/** Fleet Executive (/employee) or Branch Manager (/branchManager) upload route. */
export type PaymentProofRole = "staff" | "manager";

const BASE: Record<PaymentProofRole, string> = {
  staff: "/employee/payment/proof",
  manager: "/branchManager/payment/proof",
};

export const paymentProofService = {
  /**
   * Multipart field "file". Errors: 400 FILE_REQUIRED / INVALID_FILE_TYPE /
   * INVALID_IMAGE / IMAGE_TOO_SMALL, 413 FILE_TOO_LARGE.
   */
  upload: async (role: PaymentProofRole, file: File): Promise<PaymentProofView> => {
    const form = new FormData();
    form.append("file", file);
    const res = await apiClient.post<{ data: PaymentProofView; message: string }>(BASE[role], form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return res.data.data;
  },

  /** A fresh presigned URL. 404 PAYMENT_PROOF_NOT_FOUND (missing / other branch). */
  get: async (role: PaymentProofRole, proofFileId: string): Promise<PaymentProofView> => {
    const res = await apiClient.get<{ data: PaymentProofView }>(
      `${BASE[role]}/${encodeURIComponent(proofFileId)}`,
    );
    return res.data.data;
  },
};

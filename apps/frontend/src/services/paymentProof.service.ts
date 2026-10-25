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

/**
 * Fleet Executive (/employee) or Branch Manager (/branchManager) upload route, or
 * (Oct 25 2026) `admin:<bookingPublicId>` — the admin's refund photo, stored under
 * that booking's branch (POST /admin/bookings/:publicId/refund-proof; no re-fetch).
 */
export type PaymentProofRole = "staff" | "manager" | `admin:${string}`;

const BASE: Record<"staff" | "manager", string> = {
  staff: "/employee/payment/proof",
  manager: "/branchManager/payment/proof",
};

const uploadUrl = (role: PaymentProofRole) =>
  role.startsWith("admin:")
    ? `/admin/bookings/${encodeURIComponent(role.slice("admin:".length))}/refund-proof`
    : BASE[role as "staff" | "manager"];

/** The upload role for "Refund to customer": the admin uploads against the booking. */
export const refundProofRole = (scope: "manager" | "admin" | "employee", bookingPublicId: string): PaymentProofRole =>
  scope === "admin" ? `admin:${bookingPublicId}` : scope === "employee" ? "staff" : "manager";

export const paymentProofService = {
  /**
   * Multipart field "file". Errors: 400 FILE_REQUIRED / INVALID_FILE_TYPE /
   * INVALID_IMAGE / IMAGE_TOO_SMALL, 413 FILE_TOO_LARGE.
   */
  upload: async (role: PaymentProofRole, file: File): Promise<PaymentProofView> => {
    const form = new FormData();
    form.append("file", file);
    const res = await apiClient.post<{ data: PaymentProofView; message: string }>(uploadUrl(role), form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return res.data.data;
  },

  /** A fresh presigned URL. 404 PAYMENT_PROOF_NOT_FOUND (missing / other branch). */
  get: async (role: PaymentProofRole, proofFileId: string): Promise<PaymentProofView> => {
    if (role.startsWith("admin:")) throw new Error("No re-fetch route for an admin refund photo");
    const res = await apiClient.get<{ data: PaymentProofView }>(
      `${BASE[role as "staff" | "manager"]}/${encodeURIComponent(proofFileId)}`,
    );
    return res.data.data;
  },
};

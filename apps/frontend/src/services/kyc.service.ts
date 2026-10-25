import apiClient from "@/lib/axios";
import type {
  BookingQrPhotoData,
  CustomerQrPhotoData,
  QrPhotoResponse,
} from "@/types/qrPhoto";

// KYC Document types matching backend KycType enum
export type KycDocumentType = "DL" | "AADHAAR" | "PAN";

// KYC document side matching backend KycSide enum
export type KycSide = "FRONT" | "BACK";

// Response types based on backend controller
export interface KycDocument {
  id: number;
  publicId: string;
  customerId: number;
  type: KycDocumentType;
  side: KycSide;
  status: "PENDING" | "APPROVED" | "REJECTED";
  fileId: number;
  createdAt: string;
  updatedAt: string;
  file: {
    id: number;
    publicId: string;
    key: string;
    url: string;
    mime: string;
    size: number;
  };
}

export interface GetKycDocumentsResponse {
  message: string;
  data: KycDocument[];
}

export interface UploadKycDocumentResponse {
  message: string;
  data: KycDocument;
}

export interface DeleteKycDocumentResponse {
  message: string;
}

export const kycService = {
  /**
   * Get all KYC documents for the authenticated user
   * GET /user/kyc
   */
  getDocuments: async (): Promise<GetKycDocumentsResponse> => {
    const response = await apiClient.get<GetKycDocumentsResponse>("/user/kyc");
    return response.data;
  },

  /**
   * Upload a new KYC document
   * POST /user/kyc
   * Uses FormData with 'file' and 'type' fields
   */
  uploadDocument: async (
    file: File,
    type: KycDocumentType,
    side: KycSide,
  ): Promise<UploadKycDocumentResponse> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", type);
    formData.append("side", side);

    const response = await apiClient.post<UploadKycDocumentResponse>(
      "/user/kyc",
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      },
    );
    return response.data;
  },

  /**
   * Delete a KYC document by its publicId
   * DELETE /user/kyc
   * Body: { id, customer_public_id }
   */
  deleteDocument: async (
    publicId: string,
    customerPublicId: string,
  ): Promise<DeleteKycDocumentResponse> => {
    const response = await apiClient.delete<DeleteKycDocumentResponse>(
      `/user/kyc`,
      {
        data: {
          id: publicId,
          customer_public_id: customerPublicId,
        },
      },
    );
    return response.data;
  },

  // --- EMPLOYEE METHODS ---

  /**
   * Get KYC documents for a specific booking
   * GET /employee/kyc/:bookingId
   */
  getBookingKyc: async (bookingId: string) => {
    type BookingKycResponse = {
      message: string;
      customerName: string;
      /** The customer's user publicId (walk-in KYC upload) — newer servers */
      customerUserPublicId?: string;
      /** Driving licence photos on file (required to book, Oct 17 2026) — newer servers */
      dlPhotos?: {
        ok: boolean;
        missingSides: KycSide[];
        rejectedSides: KycSide[];
      };
      /** Aadhaar photos on file (required to book, Oct 25 2026) — newer servers */
      aadhaarPhotos?: {
        ok: boolean;
        missingSides: KycSide[];
        rejectedSides: KycSide[];
      };
      kyc: {
        publicId: string;
        type: KycDocumentType;
        /** Present once the booking KYC endpoint returns it */
        side?: KycSide;
        status: "PENDING" | "APPROVED" | "REJECTED";
        file: {
          url: string;
          mime: string;
        };
      }[];
    };
    try {
      const response = await apiClient.get<BookingKycResponse>(`/employee/kyc/${bookingId}`);
      return response.data;
    } catch (error: any) {
      // 404 = the customer has no KYC documents: the body still names the
      // customer and the missing licence photos.
      const body = error?.response?.status === 404 ? error.response.data : null;
      if (body && typeof body === "object" && "customerName" in body) {
        return { ...(body as BookingKycResponse), kyc: [] };
      }
      throw error;
    }
  },

  /**
   * Get KYC documents for a specific customer (Employee only)
   * GET /employee/walkin/kyc/:customerPublicId
   */
  getCustomerKyc: async (customerPublicId: string) => {
    const response = await apiClient.get<GetKycDocumentsResponse>(
      `/employee/walkin/kyc/${customerPublicId}`,
    );
    return response.data;
  },

  /**
   * Delete a KYC document (Employee only)
   * DELETE /employee/walkin/kyc
   * Body: { id: publicId, customer_public_id } — the server checks the document
   * belongs to the customer being served.
   */
  deleteWalkinKyc: async (
    publicId: string,
    customerPublicId: string,
  ): Promise<DeleteKycDocumentResponse> => {
    const response = await apiClient.delete<DeleteKycDocumentResponse>(
      `/employee/walkin/kyc`,
      {
        data: {
          id: publicId,
          customer_public_id: customerPublicId,
        },
      },
    );
    return response.data;
  },

  /**
   * Verify KYC document status
   * PATCH /employee/kyc/:kycId/status
   */
  verifyKyc: async (kycId: string, status: "APPROVED" | "REJECTED") => {
    const response = await apiClient.patch<{
      message: string;
      data: {
        id: string;
        status: string;
      };
    }>(`/employee/kyc/${kycId}/status`, { status });
    return response.data;
  },

  // --- CUSTOMER QR CODE PHOTO (Employee only) ---

  /**
   * Customer's current QR code photo
   * GET /employee/customer/:publicId/qr-photo (User.publicId)
   */
  getCustomerQrPhoto: async (customerPublicId: string) => {
    const response = await apiClient.get<QrPhotoResponse<CustomerQrPhotoData>>(
      `/employee/customer/${customerPublicId}/qr-photo`,
    );
    return response.data.data;
  },

  /**
   * Capture or replace the customer's current QR code photo (multipart 'file')
   * POST /employee/customer/:publicId/qr-photo
   */
  uploadCustomerQrPhoto: async (customerPublicId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await apiClient.post<QrPhotoResponse<CustomerQrPhotoData>>(
      `/employee/customer/${customerPublicId}/qr-photo`,
      formData,
      { headers: { "Content-Type": "multipart/form-data" }, timeout: 60000 },
    );
    return response.data;
  },

  /**
   * Remove the customer's current QR code photo (booking snapshots are kept)
   * DELETE /employee/customer/:publicId/qr-photo
   */
  deleteCustomerQrPhoto: async (customerPublicId: string) => {
    const response = await apiClient.delete<QrPhotoResponse<CustomerQrPhotoData>>(
      `/employee/customer/${customerPublicId}/qr-photo`,
    );
    return response.data;
  },

  /**
   * QR code photo for a booking of this branch (snapshot, else the customer's current one)
   * GET /employee/bookings/:bookingId/qr-photo
   */
  getBookingQrPhoto: async (bookingId: string) => {
    const response = await apiClient.get<QrPhotoResponse<BookingQrPhotoData>>(
      `/employee/bookings/${bookingId}/qr-photo`,
    );
    return response.data.data;
  },

  /**
   * Replace the booking's QR code photo (HOLD/CONFIRMED only; 409 QR_PHOTO_FROZEN after)
   * POST /employee/bookings/:bookingId/qr-photo
   */
  uploadBookingQrPhoto: async (bookingId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await apiClient.post<QrPhotoResponse<BookingQrPhotoData>>(
      `/employee/bookings/${bookingId}/qr-photo`,
      formData,
      { headers: { "Content-Type": "multipart/form-data" }, timeout: 60000 },
    );
    return response.data;
  },
};

import apiClient from "@/lib/axios";

// KYC Document types matching backend KycType enum
export type KycDocumentType = 'DL' | 'AADHAAR' | 'PAN';

// Response types based on backend controller
export interface KycDocument {
    id: number;
    publicId: string;
    customerId: number;
    type: KycDocumentType;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
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
        type: KycDocumentType
    ): Promise<UploadKycDocumentResponse> => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', type);

        const response = await apiClient.post<UploadKycDocumentResponse>(
            "/user/kyc",
            formData,
            {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
            }
        );
        return response.data;
    },

    /**
     * Delete a KYC document by its publicId
     * DELETE /user/kyc/:id
     */
    deleteDocument: async (publicId: string): Promise<DeleteKycDocumentResponse> => {
        const response = await apiClient.delete<DeleteKycDocumentResponse>(
            `/user/kyc/${publicId}`
        );
        return response.data;
    },
};

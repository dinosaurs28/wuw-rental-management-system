import { create } from "zustand";
import type { KycDocument, KycDocumentType, KycSide } from "@/services/kyc.service";

interface KycState {
  // Document type selection
  selectedDocumentType: KycDocumentType | null;

  // Uploaded documents list
  uploadedDocuments: KycDocument[];

  // Loading states
  isUploading: boolean;
  isFetching: boolean;
  deletingDocumentId: string | null; // Public ID of document being deleted

  // Actions
  setSelectedDocumentType: (type: KycDocumentType | null) => void;
  setUploadedDocuments: (documents: KycDocument[]) => void;
  addDocument: (document: KycDocument) => void;
  removeDocument: (publicId: string) => void;
  setIsUploading: (isUploading: boolean) => void;
  setIsFetching: (isFetching: boolean) => void;
  setDeletingDocumentId: (publicId: string | null) => void;

  // Computed
  hasRequiredDocuments: () => boolean;
  getDocumentByType: (type: KycDocumentType, side?: KycSide) => KycDocument | undefined;
}

export const useKycStore = create<KycState>((set, get) => ({
  // Initial state
  selectedDocumentType: null,
  uploadedDocuments: [],
  isUploading: false,
  isFetching: false,
  deletingDocumentId: null,

  // Actions
  setSelectedDocumentType: (type) => set({ selectedDocumentType: type }),

  setUploadedDocuments: (documents) => set({ uploadedDocuments: documents }),

  addDocument: (document) =>
    set((state) => ({
      uploadedDocuments: [document, ...state.uploadedDocuments],
    })),

  removeDocument: (publicId) =>
    set((state) => ({
      uploadedDocuments: state.uploadedDocuments.filter(
        (doc) => doc.publicId !== publicId,
      ),
    })),

  setIsUploading: (isUploading) => set({ isUploading }),

  setIsFetching: (isFetching) => set({ isFetching }),

  setDeletingDocumentId: (publicId) => set({ deletingDocumentId: publicId }),

  // Computed helpers
  hasRequiredDocuments: () => {
    const { uploadedDocuments } = get();
    // A type is complete when it has both FRONT and BACK, or has an APPROVED side (backwards compat)
    const types = [...new Set(uploadedDocuments.map((doc) => doc.type))];
    return types.some((type) => {
      const docs = uploadedDocuments.filter((d) => d.type === type);
      const hasApproved = docs.some((d) => d.status === "APPROVED");
      const hasFront = docs.some((d) => d.side === "FRONT");
      const hasBack = docs.some((d) => d.side === "BACK");
      return hasApproved || (hasFront && hasBack);
    });
  },

  getDocumentByType: (type, side) => {
    const { uploadedDocuments } = get();
    return uploadedDocuments.find(
      (doc) => doc.type === type && (side === undefined || doc.side === side),
    );
  },
}));

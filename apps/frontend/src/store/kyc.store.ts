import { create } from "zustand";
import { hasDlPhotosOnFile } from "@repo/schemas";
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

  // A replaced document (a rejected side uploaded again) keeps its publicId
  addDocument: (document) =>
    set((state) => ({
      uploadedDocuments: [
        document,
        ...state.uploadedDocuments.filter((doc) => doc.publicId !== document.publicId),
      ],
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
  // Both driving licence photos (front + back, not rejected) — required to book
  hasRequiredDocuments: () => hasDlPhotosOnFile(get().uploadedDocuments),

  getDocumentByType: (type, side) => {
    const { uploadedDocuments } = get();
    return uploadedDocuments.find(
      (doc) => doc.type === type && (side === undefined || doc.side === side),
    );
  },
}));

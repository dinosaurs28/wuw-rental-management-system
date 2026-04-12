import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Shield } from "lucide-react";
import axios from "axios";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DocumentTypeSelector } from "@/components/verification/DocumentTypeSelector";
import { DocumentUploadZone } from "@/components/verification/DocumentUploadZone";
import { UploadedDocumentsGrid } from "@/components/verification/UploadedDocumentsGrid";
import { compressImage } from "@/lib/utils";
import { useKycStore } from "@/store/kyc.store";
import { useAuthStore } from "@/store/auth.store";
import { kycService } from "@/services/kyc.service";

interface InlineKycUploadProps {
  onUploadSuccess: () => void;
  onCancel: () => void;
}

export const InlineKycUpload = ({
  onUploadSuccess,
  onCancel,
}: InlineKycUploadProps) => {
  const {
    selectedDocumentType,
    uploadedDocuments,
    isUploading,
    isFetching,
    deletingDocumentId,
    setSelectedDocumentType,
    setUploadedDocuments,
    addDocument,
    removeDocument,
    setIsUploading,
    setIsFetching,
    setDeletingDocumentId,
  } = useKycStore();

  const [uploadError, setUploadError] = useState<string | null>(null);

  // Fetch existing documents on mount
  useEffect(() => {
    const fetchDocuments = async () => {
      setIsFetching(true);
      try {
        const response = await kycService.getDocuments();
        setUploadedDocuments(response.data);
      } catch {
        toast.error("Failed to load documents");
      } finally {
        setIsFetching(false);
      }
    };

    fetchDocuments();
  }, [setUploadedDocuments, setIsFetching]);

  const handleFileSelect = useCallback(
    async (file: File) => {
      if (!selectedDocumentType) {
        toast.error("Please select a document type first");
        return;
      }

      setUploadError(null);
      setIsUploading(true);

      try {
        const processedFile = await compressImage(file);
        const response = await kycService.uploadDocument(
          processedFile,
          selectedDocumentType,
        );
        addDocument(response.data);
        setSelectedDocumentType(null);
        toast.success("Document uploaded successfully");
        onUploadSuccess();
      } catch (error) {
        if (axios.isAxiosError(error)) {
          if (error.response?.status === 409) {
            setUploadError(
              "Document of this type already exists. Delete it first to upload a new one.",
            );
            toast.error("Document already exists");
          } else {
            setUploadError(error.response?.data?.message || "Upload failed");
            toast.error("Failed to upload document");
          }
        } else {
          setUploadError("An unexpected error occurred");
          toast.error("Failed to upload document");
        }
      } finally {
        setIsUploading(false);
      }
    },
    [
      selectedDocumentType,
      addDocument,
      setIsUploading,
      setSelectedDocumentType,
      onUploadSuccess,
    ],
  );

  const handleDeleteDocument = useCallback(
    async (publicId: string) => {
      const user = useAuthStore.getState().user;
      if (!user?.id) {
        toast.error("User information missing");
        return;
      }

      setDeletingDocumentId(publicId);

      try {
        await kycService.deleteDocument(publicId, user.id);
        removeDocument(publicId);
        toast.success("Document deleted successfully");
      } catch {
        toast.error("Failed to delete document");
      } finally {
        setDeletingDocumentId(null);
      }
    },
    [removeDocument, setDeletingDocumentId],
  );

  const uploadedTypes = uploadedDocuments.map((doc) => doc.type);

  return (
    <div className="space-y-5 pt-2">
      {/* Document Type Selection */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Select Document Type
        </h2>
        <DocumentTypeSelector
          selectedType={selectedDocumentType}
          onSelectType={setSelectedDocumentType}
          disabledTypes={uploadedTypes}
        />
      </section>

      {/* Upload Zone */}
      <section>
        <DocumentUploadZone
          onFileSelect={handleFileSelect}
          isUploading={isUploading}
          disabled={!selectedDocumentType}
          error={uploadError}
        />
        {!selectedDocumentType && !isUploading && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            Select a document type above to enable upload
          </p>
        )}
      </section>

      {/* Uploaded Documents */}
      <section>
        {isFetching ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <UploadedDocumentsGrid
            documents={uploadedDocuments}
            onDeleteDocument={handleDeleteDocument}
            deletingDocumentId={deletingDocumentId}
          />
        )}
      </section>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-zinc-100">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Shield className="size-3.5" />
          <span>Documents are encrypted and stored securely.</span>
        </div>
        <Button variant="outline" size="sm" onClick={onCancel}>
          <ArrowLeft className="size-3.5 mr-1.5" />
          Back
        </Button>
      </div>
    </div>
  );
};

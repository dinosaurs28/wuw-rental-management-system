import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Shield } from "lucide-react";
import axios from "axios";

import { Button } from "@/components/ui/button";
import { DocumentTypeSelector } from "@/components/verification/DocumentTypeSelector";
import { DocumentUploadZone } from "@/components/verification/DocumentUploadZone";
import { UploadedDocumentsGrid } from "@/components/verification/UploadedDocumentsGrid";
import { compressImage } from "@/lib/utils";
import { useKycStore } from "@/store/kyc.store";
import { useAuthStore } from "@/store/auth.store";
import { kycService, type KycDocumentType, type KycSide } from "@/services/kyc.service";

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
    deletingDocumentId,
    setSelectedDocumentType,
    addDocument,
    removeDocument,
    setIsUploading,
    setDeletingDocumentId,
  } = useKycStore();

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadingSide, setUploadingSide] = useState<KycSide | null>(null);
  const [selectedSide, setSelectedSide] = useState<KycSide | null>(null);

  const handleSelectType = useCallback(
    (type: KycDocumentType | null) => {
      setSelectedDocumentType(type);
      setSelectedSide(null);
      setUploadError(null);
    },
    [setSelectedDocumentType],
  );

  const handleFileSelect = useCallback(
    async (file: File, side: KycSide) => {
      if (!selectedDocumentType) {
        toast.error("Please select a document type first");
        return;
      }

      setUploadError(null);
      setUploadingSide(side);
      setIsUploading(true);

      try {
        const processedFile = await compressImage(file);
        const response = await kycService.uploadDocument(
          processedFile,
          selectedDocumentType,
          side,
        );
        addDocument(response.data);
        toast.success(`${side === "FRONT" ? "Front" : "Back"} side uploaded`);
        setSelectedSide(null);

        const allDocs = useKycStore.getState().uploadedDocuments;
        const hasFront = allDocs.some(
          (d) => d.type === selectedDocumentType && d.side === "FRONT",
        );
        const hasBack = allDocs.some(
          (d) => d.type === selectedDocumentType && d.side === "BACK",
        );
        if (hasFront && hasBack) {
          setSelectedDocumentType(null);
          onUploadSuccess();
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          if (error.response?.status === 409) {
            setUploadError("This side already exists. Delete it first to re-upload.");
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
        setUploadingSide(null);
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

  const KYC_TYPES: KycDocumentType[] = ["DL", "AADHAAR", "PAN"];

  const fullyUploadedTypes = KYC_TYPES.filter((type) => {
    const hasFront = uploadedDocuments.some((d) => d.type === type && d.side === "FRONT");
    const hasBack = uploadedDocuments.some((d) => d.type === type && d.side === "BACK");
    return hasFront && hasBack;
  });

  const partialTypes = KYC_TYPES.filter((type) => {
    const hasFront = uploadedDocuments.some((d) => d.type === type && d.side === "FRONT");
    const hasBack = uploadedDocuments.some((d) => d.type === type && d.side === "BACK");
    return (hasFront || hasBack) && !(hasFront && hasBack);
  });

  const frontDoc = selectedDocumentType
    ? uploadedDocuments.find((d) => d.type === selectedDocumentType && d.side === "FRONT")
    : null;
  const backDoc = selectedDocumentType
    ? uploadedDocuments.find((d) => d.type === selectedDocumentType && d.side === "BACK")
    : null;

  return (
    <div className="space-y-5 pt-2">
      {/* Step 1 — Document Type */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Step 1 — Select Document Type
        </h2>
        <DocumentTypeSelector
          selectedType={selectedDocumentType}
          onSelectType={handleSelectType}
          disabledTypes={fullyUploadedTypes}
          partialTypes={partialTypes}
        />
      </section>

      {/* Step 2 — Side */}
      {selectedDocumentType && (
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Step 2 — Select Side
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {(["FRONT", "BACK"] as KycSide[]).map((side) => {
              const isUploaded = side === "FRONT" ? !!frontDoc : !!backDoc;
              const isSelected = selectedSide === side;
              return (
                <button
                  key={side}
                  type="button"
                  onClick={() => !isUploaded && setSelectedSide(side)}
                  disabled={isUploaded}
                  className={[
                    "relative flex flex-col items-center justify-center gap-1 p-4 rounded-xl border-2 transition-all duration-200 focus:outline-none",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : isUploaded
                        ? "border-emerald-200 bg-emerald-50/50 opacity-70 cursor-not-allowed"
                        : "border-zinc-200 bg-zinc-50 hover:border-zinc-300 cursor-pointer",
                  ].join(" ")}
                >
                  {isUploaded && (
                    <span className="absolute top-2 right-2 text-[9px] font-black tracking-widest uppercase bg-emerald-500/20 text-emerald-500 px-2 py-0.5 rounded-full border border-emerald-500/20">
                      ✓
                    </span>
                  )}
                  <span className="text-sm font-bold text-zinc-900">
                    {side === "FRONT" ? "Front Side" : "Back Side"}
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    {side === "FRONT" ? "Photo / ID number" : "Address / signature"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Step 3 — Upload Zone */}
      {selectedDocumentType && selectedSide && (
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Step 3 — Upload {selectedSide === "FRONT" ? "Front" : "Back"} Side
          </h2>
          <DocumentUploadZone
            side={selectedSide}
            onFileSelect={(file) => handleFileSelect(file, selectedSide)}
            isUploading={!!uploadingSide}
            disabled={false}
            error={uploadError}
          />
        </section>
      )}

      {!selectedDocumentType && (
        <p className="text-xs text-muted-foreground text-center">
          Select a document type above to continue
        </p>
      )}

      {/* Uploaded Documents */}
      <section>
        <UploadedDocumentsGrid
          documents={uploadedDocuments}
          onDeleteDocument={handleDeleteDocument}
          deletingDocumentId={deletingDocumentId}
        />
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

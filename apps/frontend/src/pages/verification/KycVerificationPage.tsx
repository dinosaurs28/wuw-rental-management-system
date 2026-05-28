import { useEffect, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Shield, Loader2 } from "lucide-react";
import type { KycDocumentType, KycSide } from "@/services/kyc.service";
import axios from "axios";

import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DocumentTypeSelector } from "@/components/verification/DocumentTypeSelector";
import { DocumentUploadZone } from "@/components/verification/DocumentUploadZone";
import { compressImage } from "@/lib/utils";
import { UploadedDocumentsGrid } from "@/components/verification/UploadedDocumentsGrid";

import { useKycStore } from "@/store/kyc.store";
import { useAuthStore } from "@/store/auth.store";
import { kycService } from "@/services/kyc.service";

export const KycVerificationPage = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuthStore();

  const {
    selectedDocumentType,
    uploadedDocuments,
    isFetching,
    deletingDocumentId,
    setSelectedDocumentType,
    setUploadedDocuments,
    addDocument,
    removeDocument,
    setIsUploading,
    setIsFetching,
    setDeletingDocumentId,
    hasRequiredDocuments,
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

  // Check auth and redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      toast.error("Please sign in to continue verification");
      navigate("/auth/sign-in", { replace: true });
    }
  }, [isAuthenticated, authLoading, navigate]);

  // Fetch existing documents on mount
  useEffect(() => {
    const fetchDocuments = async () => {
      setIsFetching(true);
      try {
        const response = await kycService.getDocuments();
        setUploadedDocuments(response.data);
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 403) {
          toast.error("Please sign in to continue verification");
          navigate("/auth/sign-in", { replace: true });
        } else {
          toast.error("Failed to load documents");
        }
      } finally {
        setIsFetching(false);
      }
    };

    if (isAuthenticated) {
      fetchDocuments();
    }
  }, [isAuthenticated, setUploadedDocuments, setIsFetching, navigate]);

  // Handle file upload
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

        // Auto-deselect type once both sides are uploaded
        const allDocs = useKycStore.getState().uploadedDocuments;
        const hasFront = allDocs.some(
          (d) => d.type === selectedDocumentType && d.side === "FRONT",
        );
        const hasBack = allDocs.some(
          (d) => d.type === selectedDocumentType && d.side === "BACK",
        );
        if (hasFront && hasBack) {
          setSelectedDocumentType(null);
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          if (error.response?.status === 403) {
            toast.error("Please sign in to continue verification");
            navigate("/auth/sign-in", { replace: true });
          } else if (error.response?.status === 409) {
            setUploadError(
              "This side already exists. Delete it first to re-upload.",
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
        setUploadingSide(null);
      }
    },
    [
      selectedDocumentType,
      addDocument,
      setIsUploading,
      setSelectedDocumentType,
      navigate,
    ],
  );

  // Handle document deletion
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
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 403) {
          toast.error("Please sign in to continue verification");
          navigate("/auth/sign-in", { replace: true });
        } else {
          toast.error("Failed to delete document");
        }
      } finally {
        setDeletingDocumentId(null);
      }
    },
    [removeDocument, setDeletingDocumentId, navigate],
  );

  const KYC_TYPES: KycDocumentType[] = ["DL", "AADHAAR", "PAN"];

  // Types where BOTH sides are uploaded → disabled in selector
  const fullyUploadedTypes = KYC_TYPES.filter((type) => {
    const hasFront = uploadedDocuments.some(
      (d) => d.type === type && d.side === "FRONT",
    );
    const hasBack = uploadedDocuments.some(
      (d) => d.type === type && d.side === "BACK",
    );
    return hasFront && hasBack;
  });

  // Types where only one side is uploaded → partial badge
  const partialTypes = KYC_TYPES.filter((type) => {
    const hasFront = uploadedDocuments.some(
      (d) => d.type === type && d.side === "FRONT",
    );
    const hasBack = uploadedDocuments.some(
      (d) => d.type === type && d.side === "BACK",
    );
    return (hasFront || hasBack) && !(hasFront && hasBack);
  });

  // Which sides are already uploaded for the selected type
  const frontDoc = selectedDocumentType
    ? uploadedDocuments.find(
        (d) => d.type === selectedDocumentType && d.side === "FRONT",
      )
    : null;
  const backDoc = selectedDocumentType
    ? uploadedDocuments.find(
        (d) => d.type === selectedDocumentType && d.side === "BACK",
      )
    : null;

  // Handle continue button
  const handleContinue = () => {
    // Navigate to review page (to be implemented)
    navigate("/verification/review");
  };

  // Handle back button
  const handleBack = () => {
    navigate(-1);
  };

  // Loading state
  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-zinc-50">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50">
      <Navbar />

      <main className="flex-1 container mx-auto px-4 pt-28 md:pt-32 pb-10">
        {/* Main Card */}
        <Card className="max-w-4xl mx-auto shadow-lg">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl md:text-3xl font-bold">
              Identity Verification
            </CardTitle>
            <CardDescription className="text-base">
              To maintain our premium service standards, please upload your
              official documents.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-8 pt-6">
            {/* Step 1 — Document Type */}
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                Step 1 — Select Document Type
              </h2>
              <DocumentTypeSelector
                selectedType={selectedDocumentType}
                onSelectType={handleSelectType}
                disabledTypes={fullyUploadedTypes}
                partialTypes={partialTypes}
              />
            </section>

            {/* Step 2 — Side Selection */}
            {selectedDocumentType && (
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                  Step 2 — Select Side
                </h2>
                <div className="grid grid-cols-2 gap-3">
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
                          "relative flex flex-col items-center justify-center gap-2 p-5 rounded-[1.5rem] border-2 transition-all duration-200 focus:outline-none",
                          isSelected
                            ? "border-orange-400 bg-orange-50 shadow-[0_0_20px_rgba(249,115,22,0.1)]"
                            : isUploaded
                              ? "border-emerald-200 bg-emerald-50/50 opacity-70 cursor-not-allowed"
                              : "border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-zinc-100 cursor-pointer",
                        ].join(" ")}
                      >
                        {isUploaded && (
                          <span className="absolute top-3 right-3 text-[9px] font-black tracking-widest uppercase bg-emerald-500/20 text-emerald-500 px-2 py-0.5 rounded-full border border-emerald-500/20">
                            Uploaded
                          </span>
                        )}
                        <span className="text-base font-bold text-zinc-900">
                          {side === "FRONT" ? "Front Side" : "Back Side"}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {side === "FRONT"
                            ? "Photo / ID number side"
                            : "Address / signature side"}
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
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                  Step 3 — Upload{" "}
                  {selectedSide === "FRONT" ? "Front" : "Back"} Side
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
              <p className="text-sm text-muted-foreground text-center">
                Select a document type above to continue
              </p>
            )}

            {/* Uploaded Documents Grid */}
            <section>
              {isFetching ? (
                <div className="space-y-4">
                  <Skeleton className="h-4 w-48" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="aspect-[4/3] rounded-lg" />
                    ))}
                  </div>
                </div>
              ) : (
                <UploadedDocumentsGrid
                  documents={uploadedDocuments}
                  onDeleteDocument={handleDeleteDocument}
                  deletingDocumentId={deletingDocumentId}
                />
              )}
            </section>
          </CardContent>
        </Card>

        {/* Footer Actions */}
        <div className="max-w-4xl mx-auto mt-6 px-4 sm:px-0">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-4 border-t border-border">
            {/* Security Note */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Shield className="w-4 h-4" />
              <span>Your documents are encrypted and stored securely.</span>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <Button
                variant="outline"
                onClick={handleBack}
                className="flex-1 sm:flex-initial"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={handleContinue}
                disabled={!hasRequiredDocuments()}
                className="flex-1 sm:flex-initial"
              >
                Continue to Review
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default KycVerificationPage;
